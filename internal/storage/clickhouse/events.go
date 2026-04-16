package clickhouse

import (
	"context"
	"fmt"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/shopspring/decimal"
	"github.com/webalytics/webalytics/internal/domain"
)

// eventsColumns is the canonical column list. Order MUST match both the
// INSERT below and the PrepareBatch `column(i).Append` calls in the writer.
var eventsColumns = []string{
	"organization_id", "site_id", "ts",
	"session_id", "visitor_id", "is_new_session",
	"event_name", "hostname", "url_path", "route", "url_query",
	"referrer_host", "referrer_path",
	"environment", "release",
	"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
	"ua_browser", "ua_browser_ver", "ua_os", "ua_os_ver", "ua_device_type",
	"country_code", "region", "city",
	"page_title", "screen_w", "screen_h", "viewport_w", "viewport_h", "language",
	"props", "revenue", "revenue_currency",
	"metric_name", "metric_value", "metric_rating",
	"load_time_ms", "ttfb_ms",
}

// EventWriter binds a driver.Conn to the InsertEvents method so it satisfies
// ingest.EventSink without the ingest package depending on driver internals.
type EventWriter struct {
	conn driver.Conn
}

// NewEventWriter wraps a driver.Conn for event inserts.
func NewEventWriter(conn driver.Conn) *EventWriter {
	return &EventWriter{conn: conn}
}

// InsertEvents appends a batch to ClickHouse.
func (w *EventWriter) InsertEvents(ctx context.Context, events []domain.Event) error {
	return insertEvents(ctx, w.conn, events)
}

// insertEvents performs a single batched insert. The connection must not be
// nil; the caller guarantees non-empty `events`.
//
// We use PrepareBatch because clickhouse-go's batch path is 3-5x faster than
// row-by-row Exec for wide columnar writes.
func insertEvents(ctx context.Context, conn driver.Conn, events []domain.Event) error {
	if len(events) == 0 {
		return nil
	}

	stmt := fmt.Sprintf(
		"INSERT INTO events (%s)",
		join(eventsColumns, ", "),
	)
	batch, err := conn.PrepareBatch(ctx, stmt)
	if err != nil {
		return fmt.Errorf("prepare batch: %w", err)
	}

	for _, ev := range events {
		vals := []any{
			ev.OrganizationID,
			ev.SiteID,
			ev.Ts,
			ev.SessionID[:],
			ev.VisitorID[:],
			ev.IsNewSession,
			ev.EventName,
			ev.Hostname,
			ev.URLPath,
			ev.Route,
			ev.URLQuery,
			ev.ReferrerHost,
			ev.ReferrerPath,
			ev.Environment,
			ev.Release,
			ev.UTMSource,
			ev.UTMMedium,
			ev.UTMCampaign,
			ev.UTMTerm,
			ev.UTMContent,
			ev.UABrowser,
			ev.UABrowserVer,
			ev.UAOS,
			ev.UAOSVer,
			ev.UADeviceType,
			// LowCardinality(FixedString(2)) — the driver dedupes values in a
			// Go map, which panics on []byte. Convert to string first.
			string(ev.CountryCode[:]),
			ev.Region,
			ev.City,
			ev.PageTitle,
			ev.ScreenW,
			ev.ScreenH,
			ev.ViewportW,
			ev.ViewportH,
			ev.Language,
			ev.Props,
			toDecimal(ev.Revenue),
			ev.RevenueCurrency,
			ev.MetricName,
			ev.MetricValue,
			ev.MetricRating,
			ev.LoadTimeMs,
			ev.TTFBMs,
		}
		if len(vals) != len(eventsColumns) {
			return fmt.Errorf("event column count mismatch: got %d, want %d", len(vals), len(eventsColumns))
		}
		if err := batch.Append(vals...); err != nil {
			return fmt.Errorf("append row: %w", err)
		}
	}
	if err := batch.Send(); err != nil {
		return fmt.Errorf("send batch: %w", err)
	}
	return nil
}

// toDecimal converts an optional float revenue to *decimal.Decimal, which is
// the type clickhouse-go accepts for Decimal(P, S) columns.
// Returns nil when the source is nil (maps to ClickHouse NULL on a Nullable
// column).
func toDecimal(f *float64) *decimal.Decimal {
	if f == nil {
		return nil
	}
	d := decimal.NewFromFloat(*f)
	return &d
}

// join avoids importing "strings" for a trivial join.
func join(xs []string, sep string) string {
	if len(xs) == 0 {
		return ""
	}
	out := xs[0]
	for i := 1; i < len(xs); i++ {
		out += sep + xs[i]
	}
	return out
}
