package clickhouse

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"
	"github.com/google/uuid"
)

// TimeWindow is an inclusive-exclusive time range.
type TimeWindow struct {
	From time.Time
	To   time.Time
}

// Filters captures the common dimension filters supported by the query API.
// Each slice is a disjunction (IN list); filters across fields are conjunctive.
type Filters struct {
	Hostnames     []string
	Paths         []string
	Routes        []string
	ReferrerHosts []string
	UTMSources    []string
	Countries     []string
	DeviceTypes   []string
	Browsers      []string
	OSes          []string
	Environments []string
	Events        []string
}

// SummaryMetrics is the response shape for the summary endpoint.
type SummaryMetrics struct {
	Visitors   uint64
	Pageviews  uint64
	Sessions   uint64
	BounceRate float64 // 0..1
	AvgSessionS float64
}

// StatsStore runs analytical queries against ClickHouse.
//
// Every method accepts string orgID/siteID (the HTTP layer carries them as
// strings from context / path) and converts internally to uuid.UUID so the
// v1 handlers don't need to drag the uuid package through their signatures.
type StatsStore struct {
	conn driver.Conn
}

func NewStatsStore(conn driver.Conn) *StatsStore {
	return &StatsStore{conn: conn}
}

// Summary is the string-keyed wrapper used by v1 handlers.
func (s *StatsStore) Summary(ctx context.Context, orgID, siteID string, w TimeWindow, f Filters) (SummaryMetrics, error) {
	org, err := uuid.Parse(orgID)
	if err != nil {
		return SummaryMetrics{}, fmt.Errorf("org id: %w", err)
	}
	site, err := uuid.Parse(siteID)
	if err != nil {
		return SummaryMetrics{}, fmt.Errorf("site id: %w", err)
	}
	return s.summaryUUID(ctx, org, site, w, f)
}

// SummaryCompared returns both the primary and the comparison-window summary.
func (s *StatsStore) SummaryCompared(
	ctx context.Context,
	orgID, siteID string,
	primary, cmp TimeWindow,
	f Filters,
) (SummaryMetrics, SummaryMetrics, error) {
	org, err := uuid.Parse(orgID)
	if err != nil {
		return SummaryMetrics{}, SummaryMetrics{}, err
	}
	site, err := uuid.Parse(siteID)
	if err != nil {
		return SummaryMetrics{}, SummaryMetrics{}, err
	}
	p, err := s.summaryUUID(ctx, org, site, primary, f)
	if err != nil {
		return SummaryMetrics{}, SummaryMetrics{}, err
	}
	c, err := s.summaryUUID(ctx, org, site, cmp, f)
	if err != nil {
		return SummaryMetrics{}, SummaryMetrics{}, err
	}
	return p, c, nil
}

// summaryUUID is the uuid-typed implementation of Summary.
func (s *StatsStore) summaryUUID(ctx context.Context, orgID, siteID uuid.UUID, w TimeWindow, f Filters) (SummaryMetrics, error) {
	where, args := buildFilterSQL(orgID, siteID, w, f)

	// Visitors/pageviews/sessions from events; bounce rate/avg session from sessions MV.
	q := fmt.Sprintf(`
		SELECT
			uniq(session_id)                                      AS visitors,
			countIf(event_name = 'pageview')                      AS pageviews,
			uniq(session_id)                                      AS sessions
		FROM events
		WHERE %s
	`, where)

	var out SummaryMetrics
	row := s.conn.QueryRow(ctx, q, args...)
	if err := row.Scan(&out.Visitors, &out.Pageviews, &out.Sessions); err != nil {
		return SummaryMetrics{}, fmt.Errorf("summary top-line: %w", err)
	}

	// Bounce rate + avg session duration from the sessions MV
	qs := `
		SELECT
			countIf(pageviews = 1) / greatest(count(), 1)                                  AS bounce_rate,
			avg(toUnixTimestamp64Milli(last_ts) - toUnixTimestamp64Milli(first_ts)) / 1000 AS avg_s
		FROM sessions
		WHERE organization_id = ? AND site_id = ? AND first_ts >= ? AND first_ts < ?
	`
	var bounce, avgS float64
	row2 := s.conn.QueryRow(ctx, qs, orgID, siteID, w.From, w.To)
	if err := row2.Scan(&bounce, &avgS); err != nil {
		return SummaryMetrics{}, fmt.Errorf("summary sessions: %w", err)
	}
	out.BounceRate = bounce
	out.AvgSessionS = avgS
	return out, nil
}

// TimeseriesPoint is one bucket of a time series result.
type TimeseriesPoint struct {
	Bucket time.Time
	Value  float64
}

// Timeseries returns one metric over time at the given interval.
// Supported metrics: visitors, pageviews, sessions.
func (s *StatsStore) Timeseries(
	ctx context.Context,
	orgID, siteID string,
	metric, interval string,
	w TimeWindow, f Filters,
) ([]TimeseriesPoint, error) {
	org, err := uuid.Parse(orgID)
	if err != nil {
		return nil, err
	}
	site, err := uuid.Parse(siteID)
	if err != nil {
		return nil, err
	}
	return s.timeseriesUUID(ctx, org, site, metric, interval, w, f)
}

func (s *StatsStore) timeseriesUUID(
	ctx context.Context,
	orgID, siteID uuid.UUID,
	metric, interval string,
	w TimeWindow, f Filters,
) ([]TimeseriesPoint, error) {
	bucketExpr := intervalBucketExpr(interval)
	where, args := buildFilterSQL(orgID, siteID, w, f)

	var agg string
	switch metric {
	case "visitors", "sessions":
		agg = "uniq(session_id)"
	case "pageviews":
		agg = "countIf(event_name = 'pageview')"
	default:
		return nil, fmt.Errorf("unsupported metric %q for timeseries in v1", metric)
	}

	q := fmt.Sprintf(`
		SELECT %s AS bucket, %s AS value
		FROM events
		WHERE %s
		GROUP BY bucket
		ORDER BY bucket
	`, bucketExpr, agg, where)

	rows, err := s.conn.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("timeseries: %w", err)
	}
	defer rows.Close()

	var out []TimeseriesPoint
	for rows.Next() {
		var p TimeseriesPoint
		if err := rows.Scan(&p.Bucket, &p.Value); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// RealtimeSnapshot is the response for /stats/realtime.
type RealtimeSnapshot struct {
	Online       uint64
	TopPages     []TopItem
	TopHostnames []TopItem
}

// TopItem is one row of a top-N list.
type TopItem struct {
	Key   string
	Count uint64
}

// Realtime returns the number of unique sessions in the last 5 minutes + top
// pages and hostnames in that window.
func (s *StatsStore) Realtime(ctx context.Context, orgID, siteID string) (RealtimeSnapshot, error) {
	org, err := uuid.Parse(orgID)
	if err != nil {
		return RealtimeSnapshot{}, err
	}
	site, err := uuid.Parse(siteID)
	if err != nil {
		return RealtimeSnapshot{}, err
	}
	return s.realtimeUUID(ctx, org, site)
}

func (s *StatsStore) realtimeUUID(ctx context.Context, orgID, siteID uuid.UUID) (RealtimeSnapshot, error) {
	var out RealtimeSnapshot
	// Online
	row := s.conn.QueryRow(ctx, `
		SELECT uniq(session_id)
		FROM events
		WHERE organization_id = ? AND site_id = ? AND ts > now() - INTERVAL 5 MINUTE
	`, orgID, siteID)
	if err := row.Scan(&out.Online); err != nil {
		return out, fmt.Errorf("realtime online: %w", err)
	}

	// Top pages
	pages, err := s.topN(ctx, orgID, siteID, "url_path")
	if err != nil {
		return out, err
	}
	out.TopPages = pages

	// Top hostnames
	hosts, err := s.topN(ctx, orgID, siteID, "hostname")
	if err != nil {
		return out, err
	}
	out.TopHostnames = hosts

	return out, nil
}

func (s *StatsStore) topN(ctx context.Context, orgID, siteID uuid.UUID, dim string) ([]TopItem, error) {
	q := fmt.Sprintf(`
		SELECT %s AS k, uniq(session_id) AS v
		FROM events
		WHERE organization_id = ? AND site_id = ? AND ts > now() - INTERVAL 5 MINUTE
		GROUP BY k
		ORDER BY v DESC
		LIMIT 10
	`, dim)
	rows, err := s.conn.Query(ctx, q, orgID, siteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TopItem
	for rows.Next() {
		var it TopItem
		if err := rows.Scan(&it.Key, &it.Count); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// -----------------------------------------------------------------------------
// SQL building helpers
// -----------------------------------------------------------------------------

// buildFilterSQL emits a WHERE fragment + positional args for the common
// dimension filters. Always includes the mandatory tenant + time predicates.
func buildFilterSQL(orgID, siteID uuid.UUID, w TimeWindow, f Filters) (string, []any) {
	var clauses []string
	args := []any{orgID, siteID, w.From, w.To}
	clauses = append(clauses,
		"organization_id = ?",
		"site_id = ?",
		"ts >= ?",
		"ts < ?",
	)

	add := func(col string, values []string) {
		if len(values) == 0 {
			return
		}
		placeholders := make([]string, len(values))
		for i, v := range values {
			placeholders[i] = "?"
			args = append(args, v)
		}
		clauses = append(clauses, fmt.Sprintf("%s IN (%s)", col, strings.Join(placeholders, ",")))
	}

	add("hostname", f.Hostnames)
	add("url_path", f.Paths)
	add("route", f.Routes)
	add("referrer_host", f.ReferrerHosts)
	add("utm_source", f.UTMSources)
	add("country_code", f.Countries)
	add("ua_device_type", f.DeviceTypes)
	add("ua_browser", f.Browsers)
	add("ua_os", f.OSes)
	add("environment", f.Environments)
	add("event_name", f.Events)

	return strings.Join(clauses, " AND "), args
}

// -----------------------------------------------------------------------------
// Breakdown
// -----------------------------------------------------------------------------

// BreakdownResult is the result of a group-by on one dimension.
type BreakdownResult struct {
	Rows  []BreakdownRow
	Total float64
}

// BreakdownRow is one key -> value pair from a group-by.
type BreakdownRow struct {
	Key   string
	Value float64
}

// allowedDimensions is the whitelist of columns we accept for group-by.
// Anything not in this map is rejected to prevent SQL injection via the
// `dimension` query param.
var allowedDimensions = map[string]string{
	"hostname":      "hostname",
	"path":          "url_path",
	"route":         "route",
	"referrer_host": "referrer_host",
	"utm_source":    "utm_source",
	"utm_medium":    "utm_medium",
	"utm_campaign":  "utm_campaign",
	"country":       "country_code",
	"region":        "region",
	"city":          "city",
	"device_type":   "ua_device_type",
	"browser":       "ua_browser",
	"os":            "ua_os",
	"language":      "language",
	"event_name":    "event_name",
	"environment":   "environment",
	"release":       "release",
}

// Breakdown groups by the given dimension and aggregates `metric`.
// Supported metrics: visitors, pageviews, sessions.
func (s *StatsStore) Breakdown(
	ctx context.Context,
	orgID, siteID string,
	dimension, metric string,
	w TimeWindow, f Filters,
	limit, offset int,
) (BreakdownResult, error) {
	org, err := uuid.Parse(orgID)
	if err != nil {
		return BreakdownResult{}, err
	}
	site, err := uuid.Parse(siteID)
	if err != nil {
		return BreakdownResult{}, err
	}
	col, ok := allowedDimensions[dimension]
	if !ok {
		return BreakdownResult{}, fmt.Errorf("unsupported dimension %q", dimension)
	}
	var agg string
	switch metric {
	case "", "visitors", "sessions":
		agg = "uniq(session_id)"
	case "pageviews":
		agg = "countIf(event_name = 'pageview')"
	default:
		return BreakdownResult{}, fmt.Errorf("unsupported metric %q for breakdown", metric)
	}
	if limit <= 0 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	where, args := buildFilterSQL(org, site, w, f)

	q := fmt.Sprintf(`
		SELECT %s AS k, toFloat64(%s) AS v
		FROM events
		WHERE %s
		GROUP BY k
		ORDER BY v DESC
		LIMIT %d OFFSET %d
	`, col, agg, where, limit, offset)

	rows, err := s.conn.Query(ctx, q, args...)
	if err != nil {
		return BreakdownResult{}, fmt.Errorf("breakdown: %w", err)
	}
	defer rows.Close()
	var out BreakdownResult
	for rows.Next() {
		var r BreakdownRow
		if err := rows.Scan(&r.Key, &r.Value); err != nil {
			return BreakdownResult{}, err
		}
		out.Rows = append(out.Rows, r)
	}
	if err := rows.Err(); err != nil {
		return BreakdownResult{}, err
	}

	// Total aggregate over the same filters (so `share` can be computed client-side).
	tq := fmt.Sprintf(`SELECT toFloat64(%s) FROM events WHERE %s`, agg, where)
	if err := s.conn.QueryRow(ctx, tq, args...).Scan(&out.Total); err != nil {
		return BreakdownResult{}, fmt.Errorf("breakdown total: %w", err)
	}
	return out, nil
}

// -----------------------------------------------------------------------------
// Web Vitals
// -----------------------------------------------------------------------------

// VitalDistribution is the per-metric distribution summary.
type VitalDistribution struct {
	Samples uint64
	P75     float64
	P95     float64
	Good    uint64
	NI      uint64
	Poor    uint64
}

// WebVitalsGroup is one group row (keyed by group_by).
type WebVitalsGroup struct {
	Key     string
	Metrics map[string]VitalDistribution
}

// WebVitalsResult is the full response.
type WebVitalsResult struct {
	GroupBy string
	Groups  []WebVitalsGroup
}

// WebVitals returns p75/p95 distributions for Core Web Vitals, optionally
// grouped by hostname / route / path.
func (s *StatsStore) WebVitals(
	ctx context.Context,
	orgID, siteID string,
	w TimeWindow,
	groupBy string,
	f Filters,
) (WebVitalsResult, error) {
	org, err := uuid.Parse(orgID)
	if err != nil {
		return WebVitalsResult{}, err
	}
	site, err := uuid.Parse(siteID)
	if err != nil {
		return WebVitalsResult{}, err
	}
	var groupCol string
	switch groupBy {
	case "", "none":
		groupCol = "''"
	case "hostname":
		groupCol = "hostname"
	case "route":
		groupCol = "route"
	case "path":
		groupCol = "url_path"
	default:
		return WebVitalsResult{}, fmt.Errorf("unsupported group_by %q", groupBy)
	}

	// Force event_name = web_vital and metric_value not null.
	f.Events = []string{"web_vital"}
	where, args := buildFilterSQL(org, site, w, f)

	q := fmt.Sprintf(`
		SELECT
			%s                                                      AS grp,
			metric_name                                             AS mn,
			count()                                                 AS samples,
			quantileTDigest(0.75)(toFloat64(metric_value))          AS p75,
			quantileTDigest(0.95)(toFloat64(metric_value))          AS p95,
			countIf(metric_rating = 'good')                         AS good,
			countIf(metric_rating = 'needs-improvement')            AS ni,
			countIf(metric_rating = 'poor')                         AS poor
		FROM events
		WHERE %s AND metric_value IS NOT NULL
		GROUP BY grp, mn
		ORDER BY grp, mn
	`, groupCol, where)

	rows, err := s.conn.Query(ctx, q, args...)
	if err != nil {
		return WebVitalsResult{}, fmt.Errorf("web vitals: %w", err)
	}
	defer rows.Close()

	byGroup := map[string]*WebVitalsGroup{}
	var order []string
	for rows.Next() {
		var (
			grp, mn                string
			samples, good, ni, poor uint64
			p75, p95               float64
		)
		if err := rows.Scan(&grp, &mn, &samples, &p75, &p95, &good, &ni, &poor); err != nil {
			return WebVitalsResult{}, err
		}
		g, ok := byGroup[grp]
		if !ok {
			g = &WebVitalsGroup{Key: grp, Metrics: map[string]VitalDistribution{}}
			byGroup[grp] = g
			order = append(order, grp)
		}
		g.Metrics[mn] = VitalDistribution{
			Samples: samples, P75: p75, P95: p95,
			Good: good, NI: ni, Poor: poor,
		}
	}
	if err := rows.Err(); err != nil {
		return WebVitalsResult{}, err
	}

	out := WebVitalsResult{GroupBy: groupBy}
	if out.GroupBy == "" {
		out.GroupBy = "none"
	}
	for _, k := range order {
		out.Groups = append(out.Groups, *byGroup[k])
	}
	return out, nil
}

// intervalBucketExpr maps an interval name to a ClickHouse time-bucket
// expression over ts.
func intervalBucketExpr(interval string) string {
	switch interval {
	case "minute":
		return "toStartOfMinute(ts)"
	case "hour":
		return "toStartOfHour(ts)"
	case "week":
		return "toStartOfWeek(ts)"
	case "month":
		return "toStartOfMonth(ts)"
	default: // day
		return "toStartOfDay(ts)"
	}
}
