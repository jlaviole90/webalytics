package v1

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/webalytics/webalytics/internal/server"
	"github.com/webalytics/webalytics/internal/storage/clickhouse"
)

// timeWindowResponse mirrors the OpenAPI TimeWindow schema.
type timeWindowResponse struct {
	From    time.Time         `json:"from"`
	To      time.Time         `json:"to"`
	Compare *comparePairResp  `json:"compare,omitempty"`
}

type comparePairResp struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
}

// metricWithDelta matches MetricValueWithDelta in the spec.
type metricWithDelta struct {
	Value      float64  `json:"value"`
	Previous   *float64 `json:"previous,omitempty"`
	ChangePct  *float64 `json:"change_pct,omitempty"`
}

type summaryResponse struct {
	Window  timeWindowResponse          `json:"window"`
	Metrics map[string]metricWithDelta  `json:"metrics"`
}

// parseWindow reads the mandatory `from` and `to` query params.
func parseWindow(r *http.Request, w http.ResponseWriter) (clickhouse.TimeWindow, bool) {
	from, err := parseTimeParam(r.URL.Query().Get("from"))
	if err != nil {
		server.Error(w, http.StatusBadRequest, "validation_failed", "invalid or missing from")
		return clickhouse.TimeWindow{}, false
	}
	to, err := parseTimeParam(r.URL.Query().Get("to"))
	if err != nil {
		server.Error(w, http.StatusBadRequest, "validation_failed", "invalid or missing to")
		return clickhouse.TimeWindow{}, false
	}
	if !to.After(from) {
		server.Error(w, http.StatusBadRequest, "validation_failed", "to must be after from")
		return clickhouse.TimeWindow{}, false
	}
	return clickhouse.TimeWindow{From: from, To: to}, true
}

// parseFilters reads the common filter query params into clickhouse.Filters.
func parseFilters(r *http.Request) clickhouse.Filters {
	q := r.URL.Query()
	return clickhouse.Filters{
		Hostnames:     q["hostname"],
		Paths:         q["path"],
		Routes:        q["route"],
		ReferrerHosts: q["referrer_host"],
		UTMSources:    q["utm_source"],
		Countries:     q["country"],
		DeviceTypes:   q["device_type"],
		Browsers:      q["browser"],
		OSes:          q["os"],
		Environments: q["environment"],
		Events:        q["event"],
	}
}

// computeCompareWindow maps a `compare` param into an explicit TimeWindow.
func computeCompareWindow(kind string, primary clickhouse.TimeWindow) (clickhouse.TimeWindow, bool) {
	switch kind {
	case "previous_period":
		span := primary.To.Sub(primary.From)
		return clickhouse.TimeWindow{From: primary.From.Add(-span), To: primary.From}, true
	case "previous_year":
		return clickhouse.TimeWindow{
			From: primary.From.AddDate(-1, 0, 0),
			To:   primary.To.AddDate(-1, 0, 0),
		}, true
	}
	return clickhouse.TimeWindow{}, false
}

// pctDelta computes (value - previous) / previous * 100, guarding divide-by-zero.
func pctDelta(cur, prev float64) *float64 {
	if prev == 0 {
		return nil
	}
	v := (cur - prev) / prev * 100
	return &v
}

func statsSummary(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		siteID := chi.URLParam(r, "siteId")
		if _, ok := parseUUID(w, siteID); !ok {
			return
		}
		win, ok := parseWindow(r, w)
		if !ok {
			return
		}
		filters := parseFilters(r)

		compareKind := r.URL.Query().Get("compare")
		respWindow := timeWindowResponse{From: win.From, To: win.To}

		var primary clickhouse.SummaryMetrics
		var prev clickhouse.SummaryMetrics
		var err error
		if cmp, has := computeCompareWindow(compareKind, win); has {
			primary, prev, err = d.Stats.SummaryCompared(r.Context(), orgID(r), siteID, win, cmp, filters)
			respWindow.Compare = &comparePairResp{From: cmp.From, To: cmp.To}
		} else {
			primary, err = d.Stats.Summary(r.Context(), orgID(r), siteID, win, filters)
		}
		if err != nil {
			writeStoreError(w, err)
			return
		}

		metrics := map[string]metricWithDelta{
			"visitors":      summaryMetric(float64(primary.Visitors), float64(prev.Visitors), compareKind != ""),
			"pageviews":     summaryMetric(float64(primary.Pageviews), float64(prev.Pageviews), compareKind != ""),
			"sessions":      summaryMetric(float64(primary.Sessions), float64(prev.Sessions), compareKind != ""),
			"bounce_rate":   summaryMetric(primary.BounceRate, prev.BounceRate, compareKind != ""),
			"avg_session_s": summaryMetric(primary.AvgSessionS, prev.AvgSessionS, compareKind != ""),
		}
		writeJSON(w, http.StatusOK, summaryResponse{Window: respWindow, Metrics: metrics})
	}
}

func summaryMetric(cur, prev float64, hasCompare bool) metricWithDelta {
	m := metricWithDelta{Value: cur}
	if hasCompare {
		p := prev
		m.Previous = &p
		m.ChangePct = pctDelta(cur, prev)
	}
	return m
}

type timeseriesPointResp struct {
	Bucket time.Time `json:"bucket"`
	Value  float64   `json:"value"`
}

type timeseriesResponse struct {
	Window   timeWindowResponse    `json:"window"`
	Metric   string                `json:"metric"`
	Interval string                `json:"interval"`
	Points   []timeseriesPointResp `json:"points"`
}

func statsTimeseries(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		siteID := chi.URLParam(r, "siteId")
		if _, ok := parseUUID(w, siteID); !ok {
			return
		}
		win, ok := parseWindow(r, w)
		if !ok {
			return
		}
		q := r.URL.Query()
		metric := q.Get("metric")
		interval := q.Get("interval")
		if metric == "" || interval == "" {
			server.Error(w, http.StatusBadRequest, "validation_failed", "metric and interval are required")
			return
		}

		points, err := d.Stats.Timeseries(r.Context(), orgID(r), siteID, metric, interval, win, parseFilters(r))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		out := timeseriesResponse{
			Window:   timeWindowResponse{From: win.From, To: win.To},
			Metric:   metric,
			Interval: interval,
			Points:   make([]timeseriesPointResp, 0, len(points)),
		}
		for _, p := range points {
			out.Points = append(out.Points, timeseriesPointResp{Bucket: p.Bucket, Value: p.Value})
		}
		writeJSON(w, http.StatusOK, out)
	}
}

type breakdownRowResp struct {
	Key   string  `json:"key"`
	Value float64 `json:"value"`
	Share float64 `json:"share"`
}

type breakdownResponse struct {
	Window     timeWindowResponse `json:"window"`
	Dimension  string             `json:"dimension"`
	Metric     string             `json:"metric"`
	Results    []breakdownRowResp `json:"results"`
	Total      float64            `json:"total"`
	TotalOther float64            `json:"total_other"`
}

func statsBreakdown(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		siteID := chi.URLParam(r, "siteId")
		if _, ok := parseUUID(w, siteID); !ok {
			return
		}
		win, ok := parseWindow(r, w)
		if !ok {
			return
		}
		q := r.URL.Query()
		dim := q.Get("dimension")
		if dim == "" {
			server.Error(w, http.StatusBadRequest, "validation_failed", "dimension required")
			return
		}
		metric := q.Get("metric")
		if metric == "" {
			metric = "visitors"
		}
		limit := parseIntParam(q.Get("limit"), 100, 1, 1000)
		offset := parseIntParam(q.Get("offset"), 0, 0, 1_000_000)

		res, err := d.Stats.Breakdown(r.Context(), orgID(r), siteID, dim, metric, win, parseFilters(r), limit, offset)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		rows := make([]breakdownRowResp, 0, len(res.Rows))
		var shown float64
		for _, row := range res.Rows {
			share := 0.0
			if res.Total > 0 {
				share = row.Value / res.Total
			}
			shown += row.Value
			rows = append(rows, breakdownRowResp{Key: row.Key, Value: row.Value, Share: share})
		}
		writeJSON(w, http.StatusOK, breakdownResponse{
			Window:     timeWindowResponse{From: win.From, To: win.To},
			Dimension:  dim,
			Metric:     metric,
			Results:    rows,
			Total:      res.Total,
			TotalOther: res.Total - shown,
		})
	}
}

type vitalDistResp struct {
	Samples   uint64         `json:"samples"`
	P75       float64        `json:"p75"`
	P95       float64        `json:"p95"`
	RatingPct vitalRatingPct `json:"rating_pct"`
}

type vitalRatingPct struct {
	Good              float64 `json:"good"`
	NeedsImprovement  float64 `json:"needs_improvement"`
	Poor              float64 `json:"poor"`
}

type webVitalsGroupResp struct {
	Key     string                   `json:"key"`
	Metrics map[string]vitalDistResp `json:"metrics"`
}

type webVitalsResponse struct {
	Window  timeWindowResponse    `json:"window"`
	GroupBy string                `json:"group_by"`
	Groups  []webVitalsGroupResp  `json:"groups"`
}

func statsWebVitals(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		siteID := chi.URLParam(r, "siteId")
		if _, ok := parseUUID(w, siteID); !ok {
			return
		}
		win, ok := parseWindow(r, w)
		if !ok {
			return
		}
		groupBy := r.URL.Query().Get("group_by")
		if groupBy == "" {
			groupBy = "none"
		}
		res, err := d.Stats.WebVitals(r.Context(), orgID(r), siteID, win, groupBy, parseFilters(r))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		out := webVitalsResponse{
			Window:  timeWindowResponse{From: win.From, To: win.To},
			GroupBy: res.GroupBy,
			Groups:  make([]webVitalsGroupResp, 0, len(res.Groups)),
		}
		for _, g := range res.Groups {
			metrics := map[string]vitalDistResp{}
			for name, m := range g.Metrics {
				total := float64(m.Samples)
				if total == 0 {
					total = 1
				}
				metrics[name] = vitalDistResp{
					Samples: m.Samples,
					P75:     m.P75,
					P95:     m.P95,
					RatingPct: vitalRatingPct{
						Good:             float64(m.Good) / total,
						NeedsImprovement: float64(m.NI) / total,
						Poor:             float64(m.Poor) / total,
					},
				}
			}
			out.Groups = append(out.Groups, webVitalsGroupResp{Key: g.Key, Metrics: metrics})
		}
		writeJSON(w, http.StatusOK, out)
	}
}

type topItemResp struct {
	Key      string `json:"key,omitempty"`
	Path     string `json:"path,omitempty"`
	Hostname string `json:"hostname,omitempty"`
	Visitors uint64 `json:"visitors"`
}

type realtimeResponse struct {
	Online       uint64                 `json:"online"`
	TopPages     []topItemResp          `json:"top_pages"`
	TopHostnames []topItemResp          `json:"top_hostnames"`
	Recent       []map[string]any       `json:"recent"`
}

func statsRealtime(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		siteID := chi.URLParam(r, "siteId")
		if _, ok := parseUUID(w, siteID); !ok {
			return
		}
		snap, err := d.Stats.Realtime(r.Context(), orgID(r), siteID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		pages := make([]topItemResp, 0, len(snap.TopPages))
		for _, p := range snap.TopPages {
			pages = append(pages, topItemResp{Path: p.Key, Visitors: p.Count})
		}
		hosts := make([]topItemResp, 0, len(snap.TopHostnames))
		for _, h := range snap.TopHostnames {
			hosts = append(hosts, topItemResp{Hostname: h.Key, Visitors: h.Count})
		}
		writeJSON(w, http.StatusOK, realtimeResponse{
			Online:       snap.Online,
			TopPages:     pages,
			TopHostnames: hosts,
			Recent:       []map[string]any{}, // filled by a follow-up; schema shape held
		})
	}
}
