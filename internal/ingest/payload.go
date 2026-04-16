// Package ingest handles the POST /collect hot path.
package ingest

// CollectPayload mirrors api/collect.schema.json.
//
// Decode tolerates extra fields silently; validation is enforced in
// validator.go. Pointer fields are optional/nullable; bare values are
// required where the schema says so.
type CollectPayload struct {
	SiteID      string          `json:"site_id"`
	Event       string          `json:"event"`
	URL         string          `json:"url"`
	Referrer    string          `json:"referrer,omitempty"`
	Title       string          `json:"title,omitempty"`
	Environment string          `json:"environment,omitempty"`
	Release     string          `json:"release,omitempty"`
	Route       string          `json:"route,omitempty"`
	Screen      *Dims           `json:"screen,omitempty"`
	Viewport    *Dims           `json:"viewport,omitempty"`
	Language    string          `json:"language,omitempty"`
	Props       map[string]any  `json:"props,omitempty"`
	Revenue     *RevenueWire    `json:"revenue,omitempty"`
	Perf        *PerfWire       `json:"perf,omitempty"`
	Vital       *VitalWire      `json:"vital,omitempty"`
	TsClient    int64           `json:"ts_client,omitempty"`
}

type Dims struct {
	W uint16 `json:"w"`
	H uint16 `json:"h"`
}

type RevenueWire struct {
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
}

type PerfWire struct {
	TTFBMs uint32 `json:"ttfb_ms,omitempty"`
	LoadMs uint32 `json:"load_ms,omitempty"`
}

type VitalWire struct {
	Name    string  `json:"name"`
	Value   float64 `json:"value"`
	Rating  string  `json:"rating,omitempty"`
	ID      string  `json:"id,omitempty"`
	NavType string  `json:"nav_type,omitempty"`
}
