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

// TokenStore looks up API tokens. It runs on the app pool, but token lookup
// needs to work BEFORE we know the tenant (the token IS how we learn it), so
// this one query bypasses the org predicate. The caller is responsible for
// then installing the resolved org_id into the request context.
type TokenStore struct {
	pool *pgxpool.Pool
}

func NewTokenStore(pool *pgxpool.Pool) *TokenStore {
	return &TokenStore{pool: pool}
}

// HashToken returns the storage-side hash of a raw token string. We use a
// fast SHA-256 here rather than argon2id because the lookup is per-request;
// the raw token is high-entropy (256 bits), so brute-forcing the hash is
// infeasible without offline access to the DB.
func HashToken(raw string) []byte {
	h := sha256.Sum256([]byte(raw))
	return h[:]
}

// Resolve verifies a raw bearer token and returns the associated APIToken
// (minus the hash) on success.
func (s *TokenStore) Resolve(ctx context.Context, raw string) (*domain.APIToken, error) {
	hash := HashToken(raw)

	var (
		tok    domain.APIToken
		siteID *uuid.UUID
	)
	err := s.pool.QueryRow(ctx, `
		SELECT id, organization_id, site_id, name, scopes, expires_at, created_at, revoked_at
		FROM resolve_api_token($1)
	`, hash).Scan(
		&tok.ID, &tok.OrganizationID, &siteID, &tok.Name, &tok.Scopes,
		&tok.ExpiresAt, &tok.CreatedAt, &tok.RevokedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	tok.SiteID = siteID

	// Fire-and-forget last_used_at bump; we don't block the request on it.
	go func(id uuid.UUID) {
		bgCtx, cancel := contextWithShortTimeout()
		defer cancel()
		_, _ = s.pool.Exec(bgCtx, `SELECT touch_api_token($1)`, id)
	}(tok.ID)

	return &tok, nil
}

// CreateTokenInput describes a new API token.
type CreateTokenInput struct {
	Name      string
	SiteID    *uuid.UUID
	Scopes    []string
	ExpiresAt *time.Time
	CreatedBy *uuid.UUID
}

// Created is the shape returned to callers who just minted a token. The raw
// string is only ever surfaced here; it is never stored server-side.
type Created struct {
	Token   domain.APIToken
	Prefix  string
	RawWire string
}

// NewRawToken returns a freshly-generated bearer token string.
// Format: wb_pat_live_<32 hex chars>.
func NewRawToken() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return "wb_pat_live_" + hex.EncodeToString(b[:])
}

// Create inserts a new token and returns (record, raw_wire_value).
func (s *TokenStore) Create(ctx context.Context, orgID string, in CreateTokenInput) (*Created, error) {
	raw := NewRawToken()
	hash := HashToken(raw)
	prefix := raw
	if len(prefix) > 12 {
		prefix = prefix[:12]
	}
	return WithOrg(ctx, s.pool, orgID, func(ctx context.Context, tx pgx.Tx) (*Created, error) {
		var (
			out    domain.APIToken
			siteID *uuid.UUID
		)
		err := tx.QueryRow(ctx, `
			INSERT INTO api_tokens (organization_id, site_id, name, token_hash, token_prefix, scopes, expires_at, created_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			RETURNING id, organization_id, site_id, name, scopes, expires_at, created_at, revoked_at
		`,
			orgID, in.SiteID, in.Name, hash, prefix, in.Scopes, in.ExpiresAt, in.CreatedBy,
		).Scan(&out.ID, &out.OrganizationID, &siteID, &out.Name, &out.Scopes,
			&out.ExpiresAt, &out.CreatedAt, &out.RevokedAt,
		)
		if err != nil {
			return nil, err
		}
		out.SiteID = siteID
		return &Created{Token: out, Prefix: prefix, RawWire: raw}, nil
	})
}

// List returns all non-revoked tokens for the caller's org.
func (s *TokenStore) List(ctx context.Context, orgID string) ([]domain.APIToken, error) {
	return WithOrg(ctx, s.pool, orgID, func(ctx context.Context, tx pgx.Tx) ([]domain.APIToken, error) {
		rows, err := tx.Query(ctx, `
			SELECT id, organization_id, site_id, name, scopes, expires_at, created_at, revoked_at
			FROM api_tokens
			WHERE organization_id = $1 AND revoked_at IS NULL
			ORDER BY created_at DESC
		`, orgID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []domain.APIToken
		for rows.Next() {
			var t domain.APIToken
			var siteID *uuid.UUID
			if err := rows.Scan(&t.ID, &t.OrganizationID, &siteID, &t.Name, &t.Scopes,
				&t.ExpiresAt, &t.CreatedAt, &t.RevokedAt); err != nil {
				return nil, err
			}
			t.SiteID = siteID
			out = append(out, t)
		}
		return out, rows.Err()
	})
}

// Revoke marks a token revoked. Lookup still succeeds by id; auth refuses it.
func (s *TokenStore) Revoke(ctx context.Context, orgID, tokenID string) error {
	_, err := WithOrg(ctx, s.pool, orgID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		ct, err := tx.Exec(ctx,
			`UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, tokenID)
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

