package postgres

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/webalytics/webalytics/internal/domain"
)

// PublicTokenStore backs the browser-safe, site-scoped, read-only tokens
// surfaced at /public/v1/...
//
// Resolution mirrors TokenStore: a SECURITY DEFINER function bypasses RLS
// because the token IS how we learn the tenant context.
type PublicTokenStore struct {
	pool *pgxpool.Pool
}

func NewPublicTokenStore(pool *pgxpool.Pool) *PublicTokenStore {
	return &PublicTokenStore{pool: pool}
}

// HashPublicToken returns the storage-side hash of a raw public token.
// We reuse SHA-256 for the same reason we use it on api_tokens: the raw
// value is high-entropy so brute force against the stored hash is
// infeasible without offline DB access.
func HashPublicToken(raw string) []byte {
	h := sha256.Sum256([]byte(raw))
	return h[:]
}

// NewRawPublicToken returns a freshly-generated embed token.
// Format: wb_pub_live_<32 hex chars>. The prefix is deliberately distinct
// from wb_pat_live_ so operators can tell at a glance which kind of token
// a log line refers to.
func NewRawPublicToken() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return "wb_pub_live_" + hex.EncodeToString(b[:])
}

// Resolve verifies a raw public token and returns the associated PublicToken.
// Returns ErrNotFound on miss / revoked / expired.
func (s *PublicTokenStore) Resolve(ctx context.Context, raw string) (*domain.PublicToken, error) {
	hash := HashPublicToken(raw)

	var t domain.PublicToken
	err := s.pool.QueryRow(ctx, `
		SELECT id, site_id, organization_id, name, allowed_origins, expires_at
		FROM resolve_public_token($1)
	`, hash).Scan(
		&t.ID, &t.SiteID, &t.OrganizationID, &t.Name, &t.AllowedOrigins, &t.ExpiresAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	// Fire-and-forget last_used_at bump so we can detect stale embeds /
	// abandoned integrations. Don't block the hot path on it.
	go func(id uuid.UUID) {
		bgCtx, cancel := contextWithShortTimeout()
		defer cancel()
		_, _ = s.pool.Exec(bgCtx, `SELECT touch_public_token($1)`, id)
	}(t.ID)

	return &t, nil
}

// CreatePublicTokenInput describes a new public token to mint.
type CreatePublicTokenInput struct {
	SiteID         uuid.UUID
	Name           string
	AllowedOrigins []string
	ExpiresAt      *time.Time
}

// CreatedPublicToken is the shape returned immediately after minting. The
// raw wire value is surfaced exactly once; it is never stored server-side.
type CreatedPublicToken struct {
	Token   domain.PublicToken
	Prefix  string
	RawWire string
}

// Create inserts a new public token and returns the raw value. The caller
// must already have set the tenant org context (RLS will reject inserts
// for other tenants) — in practice Create is only called from the
// provisioning script running with org context derived from the CLI.
func (s *PublicTokenStore) Create(ctx context.Context, orgID string, in CreatePublicTokenInput) (*CreatedPublicToken, error) {
	raw := NewRawPublicToken()
	hash := HashPublicToken(raw)
	prefix := raw
	if len(prefix) > 12 {
		prefix = prefix[:12]
	}
	name := in.Name
	if name == "" {
		name = "default"
	}
	origins := in.AllowedOrigins
	if origins == nil {
		// Postgres text[] NOT NULL; empty slice => '{}'.
		origins = []string{}
	}
	return WithOrg(ctx, s.pool, orgID, func(ctx context.Context, tx pgx.Tx) (*CreatedPublicToken, error) {
		var (
			t domain.PublicToken
		)
		err := tx.QueryRow(ctx, `
			INSERT INTO public_tokens
				(site_id, organization_id, name, token_hash, token_prefix, allowed_origins, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (site_id, name) DO UPDATE SET
				token_hash      = EXCLUDED.token_hash,
				token_prefix    = EXCLUDED.token_prefix,
				allowed_origins = EXCLUDED.allowed_origins,
				expires_at      = EXCLUDED.expires_at,
				revoked_at      = NULL
			RETURNING id, site_id, organization_id, name, allowed_origins,
			          expires_at, created_at, last_used_at, revoked_at
		`, in.SiteID, orgID, name, hash, prefix, origins, in.ExpiresAt,
		).Scan(
			&t.ID, &t.SiteID, &t.OrganizationID, &t.Name, &t.AllowedOrigins,
			&t.ExpiresAt, &t.CreatedAt, &t.LastUsedAt, &t.RevokedAt,
		)
		if err != nil {
			return nil, err
		}
		return &CreatedPublicToken{Token: t, Prefix: prefix, RawWire: raw}, nil
	})
}

// ListBySite returns all non-revoked public tokens for a site within the
// current org.
func (s *PublicTokenStore) ListBySite(ctx context.Context, orgID, siteID string) ([]domain.PublicToken, error) {
	return WithOrg(ctx, s.pool, orgID, func(ctx context.Context, tx pgx.Tx) ([]domain.PublicToken, error) {
		rows, err := tx.Query(ctx, `
			SELECT id, site_id, organization_id, name, allowed_origins,
			       expires_at, created_at, last_used_at, revoked_at
			FROM public_tokens
			WHERE site_id = $1 AND revoked_at IS NULL
			ORDER BY created_at DESC
		`, siteID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []domain.PublicToken
		for rows.Next() {
			var t domain.PublicToken
			if err := rows.Scan(&t.ID, &t.SiteID, &t.OrganizationID, &t.Name, &t.AllowedOrigins,
				&t.ExpiresAt, &t.CreatedAt, &t.LastUsedAt, &t.RevokedAt); err != nil {
				return nil, err
			}
			out = append(out, t)
		}
		return out, rows.Err()
	})
}

// Revoke flips revoked_at. The token is kept so audit references remain
// valid; auth refuses it from here on.
func (s *PublicTokenStore) Revoke(ctx context.Context, orgID, tokenID string) error {
	_, err := WithOrg(ctx, s.pool, orgID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		ct, err := tx.Exec(ctx,
			`UPDATE public_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, tokenID)
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
