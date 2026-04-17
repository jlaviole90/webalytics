package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/webalytics/webalytics/internal/domain"
)

// SiteStore is the authenticated (app pool) storage surface.
type SiteStore struct {
	pool *pgxpool.Pool
}

func NewSiteStore(pool *pgxpool.Pool) *SiteStore {
	return &SiteStore{pool: pool}
}

// ListSites returns every site visible to the caller's org (enforced by RLS).
func (s *SiteStore) ListSites(ctx context.Context, orgID string) ([]domain.Site, error) {
	return WithOrg(ctx, s.pool, orgID, func(ctx context.Context, tx pgx.Tx) ([]domain.Site, error) {
		rows, err := tx.Query(ctx, `
			SELECT id, organization_id, public_site_id, name, timezone,
			       retention_days, settings, created_at
			FROM sites
			WHERE deleted_at IS NULL
			ORDER BY created_at DESC
		`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []domain.Site
		for rows.Next() {
			var s domain.Site
			if err := rows.Scan(&s.ID, &s.OrganizationID, &s.PublicSiteID,
				&s.Name, &s.Timezone, &s.RetentionDays, &s.Settings, &s.CreatedAt); err != nil {
				return nil, err
			}
			out = append(out, s)
		}
		return out, rows.Err()
	})
}

// SiteCreateInput is the minimal set of fields needed to create a site.
type SiteCreateInput struct {
	Name          string
	Timezone      string
	RetentionDays int
}

// CreateSite inserts a new site and returns the populated row.
// public_site_id is generated server-side (caller can't spoof it).
func (s *SiteStore) CreateSite(ctx context.Context, orgID string, in SiteCreateInput, publicSiteID string) (*domain.Site, error) {
	tz := in.Timezone
	if tz == "" {
		tz = "UTC"
	}
	retention := in.RetentionDays
	if retention <= 0 {
		retention = 365
	}
	return WithOrg(ctx, s.pool, orgID, func(ctx context.Context, tx pgx.Tx) (*domain.Site, error) {
		var out domain.Site
		err := tx.QueryRow(ctx, `
			INSERT INTO sites (organization_id, public_site_id, name, timezone, retention_days)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id, organization_id, public_site_id, name, timezone, retention_days, settings, created_at
		`, orgID, publicSiteID, in.Name, tz, retention).Scan(
			&out.ID, &out.OrganizationID, &out.PublicSiteID,
			&out.Name, &out.Timezone, &out.RetentionDays, &out.Settings, &out.CreatedAt,
		)
		if err != nil {
			if isUniqueViolation(err) {
				return nil, ErrConflict
			}
			return nil, err
		}
		return &out, nil
	})
}

// SiteUpdateInput carries only the fields the caller wants to change.
type SiteUpdateInput struct {
	Name          *string
	Timezone      *string
	RetentionDays *int
	Settings      map[string]any
}

// UpdateSite applies a partial update and returns the refreshed row.
func (s *SiteStore) UpdateSite(ctx context.Context, orgID, siteID string, in SiteUpdateInput) (*domain.Site, error) {
	return WithOrg(ctx, s.pool, orgID, func(ctx context.Context, tx pgx.Tx) (*domain.Site, error) {
		var out domain.Site
		err := tx.QueryRow(ctx, `
			UPDATE sites SET
				name           = COALESCE($2, name),
				timezone       = COALESCE($3, timezone),
				retention_days = COALESCE($4, retention_days),
				settings       = COALESCE($5, settings)
			WHERE id = $1 AND deleted_at IS NULL
			RETURNING id, organization_id, public_site_id, name, timezone, retention_days, settings, created_at
		`, siteID, in.Name, in.Timezone, in.RetentionDays, in.Settings).Scan(
			&out.ID, &out.OrganizationID, &out.PublicSiteID,
			&out.Name, &out.Timezone, &out.RetentionDays, &out.Settings, &out.CreatedAt,
		)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrNotFound
			}
			return nil, err
		}
		return &out, nil
	})
}

// DeleteSite soft-deletes a site.
func (s *SiteStore) DeleteSite(ctx context.Context, orgID, siteID string) error {
	_, err := WithOrg(ctx, s.pool, orgID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		ct, err := tx.Exec(ctx, `UPDATE sites SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, siteID)
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

// GetSiteByID fetches a single site by UUID for the current org.
func (s *SiteStore) GetSiteByID(ctx context.Context, orgID, siteID string) (*domain.Site, error) {
	return WithOrg(ctx, s.pool, orgID, func(ctx context.Context, tx pgx.Tx) (*domain.Site, error) {
		var out domain.Site
		err := tx.QueryRow(ctx, `
			SELECT id, organization_id, public_site_id, name, timezone,
			       retention_days, settings, created_at
			FROM sites
			WHERE id = $1 AND deleted_at IS NULL
		`, siteID).Scan(
			&out.ID, &out.OrganizationID, &out.PublicSiteID,
			&out.Name, &out.Timezone, &out.RetentionDays, &out.Settings, &out.CreatedAt,
		)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrNotFound
			}
			return nil, err
		}
		return &out, nil
	})
}

// IngestSiteStore reads the ingest_site_lookup view on the BYPASSRLS pool.
// It answers: "does <public_site_id> exist, and does <hostname> belong to it?"
type IngestSiteStore struct {
	pool *pgxpool.Pool
}

func NewIngestSiteStore(pool *pgxpool.Pool) *IngestSiteStore {
	return &IngestSiteStore{pool: pool}
}

// LookupByPublicID returns the site + its registered hostnames. Callers
// compare the request's Origin/Referer hostname against Hostnames before
// accepting the event.
func (s *IngestSiteStore) LookupByPublicID(ctx context.Context, publicSiteID string) (*domain.SiteWithDomains, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT site_id, organization_id, public_site_id, timezone, retention_days, settings, hostname
		FROM ingest_site_lookup
		WHERE public_site_id = $1
	`, publicSiteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out *domain.SiteWithDomains
	for rows.Next() {
		var site domain.Site
		var hostname string
		if err := rows.Scan(
			&site.ID, &site.OrganizationID, &site.PublicSiteID,
			&site.Timezone, &site.RetentionDays, &site.Settings, &hostname,
		); err != nil {
			return nil, err
		}
		if out == nil {
			out = &domain.SiteWithDomains{Site: site}
		}
		out.Hostnames = append(out.Hostnames, hostname)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if out == nil {
		return nil, ErrNotFound
	}
	return out, nil
}

// ResolvePublicSiteID translates a wb_live_* public site ID into the
// internal UUID string. Uses the ingest pool and the ingest_site_lookup
// view (the only table-like object the ingest role can SELECT).
func (s *IngestSiteStore) ResolvePublicSiteID(ctx context.Context, publicSiteID string) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx,
		`SELECT DISTINCT site_id::TEXT FROM ingest_site_lookup WHERE public_site_id = $1`,
		publicSiteID,
	).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	return id, err
}

// ErrNotFound is returned when a lookup misses.
var ErrNotFound = errors.New("not found")
