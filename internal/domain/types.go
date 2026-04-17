// Package domain holds the core types shared across storage and handlers.
// Keeping these in their own package keeps the storage adapters free of
// HTTP concerns and vice versa.
package domain

import (
	"time"

	"github.com/google/uuid"
)

// Site is the logical property grouping traffic.
type Site struct {
	ID             uuid.UUID
	OrganizationID uuid.UUID
	PublicSiteID   string
	Name           string
	Timezone       string
	RetentionDays  int
	Settings       map[string]any
	CreatedAt      time.Time
}

// Domain is a hostname registered to a site.
type Domain struct {
	ID         uuid.UUID
	SiteID     uuid.UUID
	Hostname   string
	IsPrimary  bool
	VerifiedAt *time.Time
	CreatedAt  time.Time
}

// SiteWithDomains is the shape cached on the ingest hot path.
type SiteWithDomains struct {
	Site      Site
	Hostnames []string
}

// APIToken is the stored (hashed) credential used for bearer auth on /v1.
type APIToken struct {
	ID             uuid.UUID
	OrganizationID uuid.UUID
	SiteID         *uuid.UUID
	Name           string
	Scopes         []string
	ExpiresAt      *time.Time
	CreatedAt      time.Time
	RevokedAt      *time.Time
}

// PublicToken is a narrow, browser-safe, read-only credential scoped to a
// single site. Unlike APIToken it can legitimately ship to the browser
// because:
//
//   - It can only reach /public/v1/... endpoints (mounted separately; the
//     admin /v1 router refuses it).
//   - Those endpoints are read-only aggregates (no PII, no session ids,
//     no UA strings, no IPs).
//   - It is bound to exactly one SiteID; SiteID mismatch on the URL is a
//     403 even if the token is otherwise valid.
//   - It optionally carries an AllowedOrigins allowlist, enforced via CORS
//     preflight + server-side re-check of the Origin header.
type PublicToken struct {
	ID             uuid.UUID
	SiteID         uuid.UUID
	OrganizationID uuid.UUID
	Name           string
	AllowedOrigins []string
	ExpiresAt      *time.Time
	CreatedAt      time.Time
	LastUsedAt     *time.Time
	RevokedAt      *time.Time
}

// Event is the enriched event ready to insert into ClickHouse.
// Field order intentionally mirrors the column order of
// `migrations/clickhouse/0001_events.sql`.
type Event struct {
	OrganizationID uuid.UUID
	SiteID         uuid.UUID
	Ts             time.Time

	SessionID     [16]byte
	VisitorID     [16]byte
	IsNewSession  uint8

	EventName    string
	Hostname     string
	URLPath      string
	Route        string
	URLQuery     string
	ReferrerHost string
	ReferrerPath string

	Environment string
	Release     string

	UTMSource   string
	UTMMedium   string
	UTMCampaign string
	UTMTerm     string
	UTMContent  string

	UABrowser    string
	UABrowserVer string
	UAOS         string
	UAOSVer      string
	UADeviceType string

	CountryCode [2]byte
	Region      string
	City        string

	PageTitle string
	ScreenW   uint16
	ScreenH   uint16
	ViewportW uint16
	ViewportH uint16
	Language  string

	Props           map[string]string
	Revenue         *float64 // Decimal(18,4) wire-wise but float64 at the boundary
	RevenueCurrency string

	MetricName   string
	MetricValue  *float64
	MetricRating string

	LoadTimeMs *uint32
	TTFBMs     *uint32
}
