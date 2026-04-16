package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// EventDefinition is the stored row for an explicitly registered custom event.
type EventDefinition struct {
	ID          uuid.UUID
	SiteID      uuid.UUID
	Name        string
	Description string
	Schema      map[string]any
	IsGoal      bool
	CreatedAt   time.Time
}

// EventDefStore manages event_definitions rows.
type EventDefStore struct {
	pool *pgxpool.Pool
}

func NewEventDefStore(pool *pgxpool.Pool) *EventDefStore {
	return &EventDefStore{pool: pool}
}

func (s *EventDefStore) ListBySite(ctx context.Context, orgID, siteID string) ([]EventDefinition, error) {
	return WithOrg(ctx, s.pool, orgID, func(ctx context.Context, tx pgx.Tx) ([]EventDefinition, error) {
		rows, err := tx.Query(ctx, `
			SELECT id, site_id, name, COALESCE(description, ''), schema, is_goal, created_at
			FROM event_definitions
			WHERE site_id = $1
			ORDER BY name ASC
		`, siteID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []EventDefinition
		for rows.Next() {
			var e EventDefinition
			if err := rows.Scan(&e.ID, &e.SiteID, &e.Name, &e.Description, &e.Schema, &e.IsGoal, &e.CreatedAt); err != nil {
				return nil, err
			}
			out = append(out, e)
		}
		return out, rows.Err()
	})
}

// CreateEventDefInput carries the fields of a new event definition.
type CreateEventDefInput struct {
	Name        string
	Description string
	Schema      map[string]any
	IsGoal      bool
}

func (s *EventDefStore) Create(ctx context.Context, orgID, siteID string, in CreateEventDefInput) (*EventDefinition, error) {
	return WithOrg(ctx, s.pool, orgID, func(ctx context.Context, tx pgx.Tx) (*EventDefinition, error) {
		var e EventDefinition
		err := tx.QueryRow(ctx, `
			INSERT INTO event_definitions (site_id, name, description, schema, is_goal)
			VALUES ($1, $2, NULLIF($3, ''), $4, $5)
			RETURNING id, site_id, name, COALESCE(description, ''), schema, is_goal, created_at
		`, siteID, in.Name, in.Description, in.Schema, in.IsGoal).Scan(
			&e.ID, &e.SiteID, &e.Name, &e.Description, &e.Schema, &e.IsGoal, &e.CreatedAt,
		)
		if err != nil {
			if isUniqueViolation(err) {
				return nil, ErrConflict
			}
			return nil, err
		}
		return &e, nil
	})
}

// UpdateEventDefInput is a partial update.
type UpdateEventDefInput struct {
	Description *string
	Schema      map[string]any
	IsGoal      *bool
}

func (s *EventDefStore) Update(ctx context.Context, orgID, siteID, name string, in UpdateEventDefInput) (*EventDefinition, error) {
	return WithOrg(ctx, s.pool, orgID, func(ctx context.Context, tx pgx.Tx) (*EventDefinition, error) {
		var e EventDefinition
		err := tx.QueryRow(ctx, `
			UPDATE event_definitions SET
				description = COALESCE($3, description),
				schema      = COALESCE($4, schema),
				is_goal     = COALESCE($5, is_goal)
			WHERE site_id = $1 AND name = $2
			RETURNING id, site_id, name, COALESCE(description, ''), schema, is_goal, created_at
		`, siteID, name, in.Description, in.Schema, in.IsGoal).Scan(
			&e.ID, &e.SiteID, &e.Name, &e.Description, &e.Schema, &e.IsGoal, &e.CreatedAt,
		)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrNotFound
			}
			return nil, err
		}
		return &e, nil
	})
}

func (s *EventDefStore) Delete(ctx context.Context, orgID, siteID, name string) error {
	_, err := WithOrg(ctx, s.pool, orgID, func(ctx context.Context, tx pgx.Tx) (struct{}, error) {
		ct, err := tx.Exec(ctx, `DELETE FROM event_definitions WHERE site_id = $1 AND name = $2`, siteID, name)
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

// GoalNames returns the names of event definitions flagged as goals. Used by
// the query layer to count goal completions. Cached by the caller.
func (s *EventDefStore) GoalNames(ctx context.Context, orgID, siteID string) ([]string, error) {
	return WithOrg(ctx, s.pool, orgID, func(ctx context.Context, tx pgx.Tx) ([]string, error) {
		rows, err := tx.Query(ctx, `SELECT name FROM event_definitions WHERE site_id = $1 AND is_goal = TRUE`, siteID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var n string
			if err := rows.Scan(&n); err != nil {
				return nil, err
			}
			out = append(out, n)
		}
		return out, rows.Err()
	})
}
