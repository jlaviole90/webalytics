// Package postgres is the control-plane storage adapter.
package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/webalytics/webalytics/internal/config"
)

// Pools holds the two pgx pools: one for the app (RLS-enforced) and one
// for the ingest hot path (BYPASSRLS, read-only via ingest_site_lookup).
type Pools struct {
	App    *pgxpool.Pool
	Ingest *pgxpool.Pool
}

// Open opens both pools, pings them, and returns a Pools handle.
func Open(ctx context.Context, cfg config.PostgresConfig) (*Pools, error) {
	appPool, err := openPool(ctx, cfg.AppDSN, cfg.MaxConns)
	if err != nil {
		return nil, fmt.Errorf("open app pool: %w", err)
	}
	ingestPool, err := openPool(ctx, cfg.IngestDSN, cfg.MaxConns)
	if err != nil {
		appPool.Close()
		return nil, fmt.Errorf("open ingest pool: %w", err)
	}
	return &Pools{App: appPool, Ingest: ingestPool}, nil
}

func openPool(ctx context.Context, dsn string, maxConns int32) (*pgxpool.Pool, error) {
	pc, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	if maxConns > 0 {
		pc.MaxConns = maxConns
	}
	pool, err := pgxpool.NewWithConfig(ctx, pc)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

// Close closes both pools.
func (p *Pools) Close() {
	if p == nil {
		return
	}
	if p.App != nil {
		p.App.Close()
	}
	if p.Ingest != nil {
		p.Ingest.Close()
	}
}

// WithOrg opens a transaction, sets `webalytics.org_id` for the duration of
// that tx (so RLS policies see the right tenant), runs fn, and commits.
//
// Any query path that touches tenant-scoped tables on the app pool MUST go
// through this. The pgx.Tx passed to fn is live only until Commit/Rollback.
func WithOrg[T any](
	ctx context.Context,
	pool *pgxpool.Pool,
	orgID string,
	fn func(ctx context.Context, tx pgx.Tx) (T, error),
) (T, error) {
	var zero T
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return zero, err
	}
	// Best-effort rollback; Commit supersedes it.
	defer func() { _ = tx.Rollback(ctx) }()

	// SET LOCAL is scoped to the transaction; set_config(..., true) is the
	// functional equivalent that takes a parameter via placeholder.
	if _, err := tx.Exec(ctx, "SELECT set_config('webalytics.org_id', $1, true)", orgID); err != nil {
		return zero, fmt.Errorf("set org_id: %w", err)
	}
	out, err := fn(ctx, tx)
	if err != nil {
		return zero, err
	}
	if err := tx.Commit(ctx); err != nil {
		return zero, err
	}
	return out, nil
}
