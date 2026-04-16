package postgres

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/webalytics/webalytics/internal/domain"
)

// DomainStore owns the registered domains per site.
type DomainStore struct {
	pool *pgxpool.Pool
}

func NewDomainStore(pool *pgxpool.Pool) *DomainStore {
	return &DomainStore{pool: pool}
}

// ListBySite returns all domains for a site visible to the caller's org.
func (s *DomainStore) ListBySite(ctx context.Context, orgID, siteID string) ([]domain.Domain, error) {
	return WithOrg(ctx, s.pool, orgID, func(ctx context.Context, tx pgx.Tx) ([]domain.Domain, error) {
		rows, err := tx.Query(ctx, `
			SELECT id, site_id, hostname, is_primary, verified_at, created_at
			FROM domains
			WHERE site_id = $1
			ORDER BY is_primary DESC, hostname ASC
		`, siteID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []domain.Domain
		for rows.Next() {
			var d domain.Domain
			if err := rows.Scan(&d.ID, &d.SiteID, &d.Hostname, &d.IsPrimary, &d.VerifiedAt, &d.CreatedAt); err != nil {
				return nil, err
			}
			out = append(out, d)
		}
		return out, rows.Err()
	})
}

// Create registers a new hostname under a site. Hostnames are normalized to
// lowercase and stripped of surrounding whitespace. Returns ErrConflict when
// the (site_id, hostname) pair already exists.
func (s *DomainStore) Create(ctx context.Context, orgID, siteID, hostname string, isPrimary bool) (*domain.Domain, error) {
	hostname = strings.ToLower(strings.TrimSpace(hostname))
	if hostname == "" {
		return nil, ErrValidation
	}
	return WithOrg(ctx, s.pool, orgID, func(ctx context.Context, tx pgx.Tx) (*domain.Domain, error) {
		// If this is the first domain on the site, force is_primary = true regardless.
		var existing int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM domains WHERE site_id = $1`, siteID).Scan(&existing); err != nil {
			return nil, err
		}
		if existing == 0 {
			isPrimary = true
		} else if isPrimary {
			// Demote any existing primary so the unique partial index doesn't conflict.
			if _, err := tx.Exec(ctx,
				`UPDATE domains SET is_primary = FALSE WHERE site_id = $1 AND is_primary = TRUE`,
				siteID,
			); err != nil {
				return nil, err
			}
		}

		var d domain.Domain
		err := tx.QueryRow(ctx, `
			INSERT INTO domains (site_id, hostname, is_primary)
			VALUES ($1, $2, $3)
			RETURNING id, site_id, hostname, is_primary, verified_at, created_at
		`, siteID, hostname, isPrimary).Scan(
			&d.ID, &d.SiteID, &d.Hostname, &d.IsPrimary, &d.VerifiedAt, &d.CreatedAt,
		)
		if err != nil {
			if isUniqueViolation(err) {
				return nil, ErrConflict
			}
			return nil, err
		}
		return &d, nil
	})
}

// Delete removes a domain by id under the caller's org.
func (s *DomainStore) Delete(ctx context.Context, orgID, siteID, domainID string) error {
	_, err := WithOrg(ctx, s.pool, orgID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		ct, err := tx.Exec(ctx, `DELETE FROM domains WHERE id = $1 AND site_id = $2`, domainID, siteID)
		if err != nil {
			return struct{}{}, err
		}
		if ct.RowsAffected() == 0 {
			return struct{}{}, ErrNotFound
		}
		return struct{}{}, nil
	})
	return err
}

// isUniqueViolation returns true when err is a Postgres 23505 error.
func isUniqueViolation(err error) bool {
	var pgErr interface{ SQLState() string }
	if errors.As(err, &pgErr) {
		return pgErr.SQLState() == "23505"
	}
	return false
}
