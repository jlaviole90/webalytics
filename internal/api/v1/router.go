// Package v1 wires the authenticated query + admin HTTP surface.
//
// Layout mirrors the OpenAPI spec in api/openapi.yaml. The router is
// deliberately thin: each resource has a dedicated file with handlers that
// read from the storage interfaces declared here. This keeps handler tests
// cheap to stub out and keeps this package free of sql.
package v1

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/webalytics/webalytics/internal/auth"
	"github.com/webalytics/webalytics/internal/domain"
	"github.com/webalytics/webalytics/internal/storage/clickhouse"
	"github.com/webalytics/webalytics/internal/storage/postgres"
)

// Deps collects the storage handles the v1 router needs. Plain interface types
// are used where the concrete package is big, so we can swap in fakes for tests.
type Deps struct {
	TokenResolver TokenResolver
	Sites         SitesStore
	Domains       DomainsStore
	Events        EventDefsStore
	Tokens        TokensStore
	Stats         StatsStore
	SiteCache     SiteCacheInvalidator
}

// Mount registers every /v1 route onto the given sub-router.
// The caller is responsible for mounting this at /v1 on the parent router.
func Mount(r chi.Router, d Deps) {
	r.Use(auth.Middleware(d.TokenResolver))

	// Sites
	r.Get("/sites", listSites(d))
	r.Post("/sites", createSite(d))
	r.Route("/sites/{siteId}", func(r chi.Router) {
		r.Get("/", getSite(d))
		r.Patch("/", patchSite(d))
		r.Delete("/", deleteSite(d))

		// Domains
		r.Get("/domains", listDomains(d))
		r.Post("/domains", createDomain(d))
		r.Delete("/domains/{domainId}", deleteDomain(d))

		// Event definitions
		r.Get("/event-definitions", listEventDefs(d))
		r.Post("/event-definitions", createEventDef(d))
		r.Patch("/event-definitions/{eventName}", patchEventDef(d))
		r.Delete("/event-definitions/{eventName}", deleteEventDef(d))

		// Stats
		MountStatsSubtree(r, d)
	})

	// Tokens
	r.Get("/tokens", listTokens(d))
	r.Post("/tokens", createToken(d))
	r.Delete("/tokens/{tokenId}", revokeToken(d))
}

// MountStatsSubtree registers the read-only /stats/* endpoints onto the
// given router. Exposed so /public/v1 can mount the same handlers behind
// the public-token middleware without copy-pasting route registrations.
//
// The caller is responsible for:
//   - having the {siteId} URL param in scope for handler use,
//   - installing auth middleware upstream (org_id must be in context by
//     the time a handler runs).
func MountStatsSubtree(r chi.Router, d Deps) {
	r.Get("/stats/summary", statsSummary(d))
	r.Get("/stats/timeseries", statsTimeseries(d))
	r.Get("/stats/breakdown", statsBreakdown(d))
	r.Get("/stats/web-vitals", statsWebVitals(d))
	r.Get("/stats/realtime", statsRealtime(d))
}

// ----------------------------------------------------------------------------
// Storage interfaces. Defined here rather than in the storage packages so the
// v1 handlers own their consumption boundary.
// ----------------------------------------------------------------------------

// TokenResolver authenticates a bearer token.
type TokenResolver interface {
	Resolve(ctx context.Context, raw string) (*domain.APIToken, error)
}

// SitesStore is the admin surface over `sites`.
type SitesStore interface {
	ListSites(ctx context.Context, orgID string) ([]domain.Site, error)
	GetSiteByID(ctx context.Context, orgID, siteID string) (*domain.Site, error)
	CreateSite(ctx context.Context, orgID string, in postgres.SiteCreateInput, publicSiteID string) (*domain.Site, error)
	UpdateSite(ctx context.Context, orgID, siteID string, in postgres.SiteUpdateInput) (*domain.Site, error)
	DeleteSite(ctx context.Context, orgID, siteID string) error
}

// DomainsStore manages site ↔ hostname mapping.
type DomainsStore interface {
	ListBySite(ctx context.Context, orgID, siteID string) ([]domain.Domain, error)
	Create(ctx context.Context, orgID, siteID, hostname string, isPrimary bool) (*domain.Domain, error)
	Delete(ctx context.Context, orgID, siteID, domainID string) error
}

// EventDefsStore manages explicitly registered custom events.
type EventDefsStore interface {
	ListBySite(ctx context.Context, orgID, siteID string) ([]postgres.EventDefinition, error)
	Create(ctx context.Context, orgID, siteID string, in postgres.CreateEventDefInput) (*postgres.EventDefinition, error)
	Update(ctx context.Context, orgID, siteID, name string, in postgres.UpdateEventDefInput) (*postgres.EventDefinition, error)
	Delete(ctx context.Context, orgID, siteID, name string) error
}

// TokensStore mints and revokes API tokens.
type TokensStore interface {
	List(ctx context.Context, orgID string) ([]domain.APIToken, error)
	Create(ctx context.Context, orgID string, in postgres.CreateTokenInput) (*postgres.Created, error)
	Revoke(ctx context.Context, orgID, tokenID string) error
}

// StatsStore runs analytical reads.
type StatsStore interface {
	Summary(ctx context.Context, orgID, siteID string, w clickhouse.TimeWindow, f clickhouse.Filters) (clickhouse.SummaryMetrics, error)
	SummaryCompared(ctx context.Context, orgID, siteID string, w, cmp clickhouse.TimeWindow, f clickhouse.Filters) (primary, previous clickhouse.SummaryMetrics, err error)
	Timeseries(ctx context.Context, orgID, siteID string, metric, interval string, w clickhouse.TimeWindow, f clickhouse.Filters) ([]clickhouse.TimeseriesPoint, error)
	Breakdown(ctx context.Context, orgID, siteID string, dim, metric string, w clickhouse.TimeWindow, f clickhouse.Filters, limit, offset int) (clickhouse.BreakdownResult, error)
	WebVitals(ctx context.Context, orgID, siteID string, w clickhouse.TimeWindow, groupBy string, f clickhouse.Filters) (clickhouse.WebVitalsResult, error)
	Realtime(ctx context.Context, orgID, siteID string) (clickhouse.RealtimeSnapshot, error)
}

// SiteCacheInvalidator lets admin writes punch through the ingest cache.
type SiteCacheInvalidator interface {
	Invalidate(publicSiteID string)
}

// writeJSON is the canonical JSON writer; shared across handlers so response
// conventions stay uniform.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = encodeJSON(w, v)
}
