package ingest

import (
	"fmt"
	"strconv"
	"time"

	"github.com/webalytics/webalytics/internal/domain"
	"github.com/webalytics/webalytics/internal/enrich"
)

// Enricher combines the various enrichment steps into a single entry point.
// It is stateless with respect to each request; all shared state (geo db,
// UA parser, session hasher) is carried by the handles on the struct.
type Enricher struct {
	Sessions *enrich.SessionHasher
	UA       *enrich.UAParser
	Geo      *enrich.GeoResolver
}

// RequestContext carries the per-request fields the Enricher needs that don't
// live on the payload itself.
type RequestContext struct {
	IP        string
	UserAgent string
	Now       time.Time
}

// Build produces a fully populated domain.Event ready for insertion.
// The site + org are passed explicitly because they come from the lookup
// performed before enrichment.
func (e *Enricher) Build(
	site domain.Site,
	p *CollectPayload,
	rc RequestContext,
) (domain.Event, error) {
	parsed, err := enrich.ParseURL(p.URL)
	if err != nil {
		return domain.Event{}, fmt.Errorf("parse url: %w", err)
	}
	refHost, refPath := enrich.ParseReferrer(p.Referrer)

	ts := rc.Now
	if ts.IsZero() {
		ts = time.Now().UTC()
	} else {
		ts = ts.UTC()
	}

	ev := domain.Event{
		OrganizationID: site.OrganizationID,
		SiteID:         site.ID,
		Ts:             ts,
		EventName:      p.Event,
		Hostname:       parsed.Hostname,
		URLPath:        parsed.Path,
		Route:          p.Route,
		URLQuery:       parsed.Query,
		ReferrerHost:   refHost,
		ReferrerPath:   refPath,
		Environment:    nonEmpty(p.Environment, "production"),
		Release:        p.Release,
		UTMSource:      parsed.UTM.Source,
		UTMMedium:      parsed.UTM.Medium,
		UTMCampaign:    parsed.UTM.Campaign,
		UTMTerm:        parsed.UTM.Term,
		UTMContent:     parsed.UTM.Content,
		PageTitle:      p.Title,
		Language:       p.Language,
	}

	if p.Screen != nil {
		ev.ScreenW = p.Screen.W
		ev.ScreenH = p.Screen.H
	}
	if p.Viewport != nil {
		ev.ViewportW = p.Viewport.W
		ev.ViewportH = p.Viewport.H
	}

	// Identity
	sid := e.Sessions.Hash(site.PublicSiteID, rc.IP, rc.UserAgent)
	ev.SessionID = sid
	ev.VisitorID = sid // cookieless default: same value; promoted when consented mode ships
	ev.IsNewSession = 1 // best-effort; the sessions MV is the authoritative source for bounce/duration

	// UA
	if e.UA != nil {
		ua := e.UA.Parse(rc.UserAgent)
		ev.UABrowser = ua.Browser
		ev.UABrowserVer = ua.BrowserVer
		ev.UAOS = ua.OS
		ev.UAOSVer = ua.OSVer
		ev.UADeviceType = ua.DeviceType
	}

	// Geo
	if e.Geo != nil {
		g := e.Geo.Lookup(rc.IP)
		if len(g.CountryCode) == 2 {
			copy(ev.CountryCode[:], g.CountryCode)
		}
		ev.Region = g.Region
		ev.City = g.City
	}

	// Props (flattened to string map)
	if len(p.Props) > 0 {
		ev.Props = make(map[string]string, len(p.Props))
		for k, v := range p.Props {
			ev.Props[k] = stringify(v)
		}
	}

	// Revenue
	if p.Revenue != nil {
		amount := p.Revenue.Amount
		ev.Revenue = &amount
		ev.RevenueCurrency = p.Revenue.Currency
	}

	// Perf (pageview rows)
	if p.Perf != nil {
		if p.Perf.TTFBMs > 0 {
			v := p.Perf.TTFBMs
			ev.TTFBMs = &v
		}
		if p.Perf.LoadMs > 0 {
			v := p.Perf.LoadMs
			ev.LoadTimeMs = &v
		}
	}

	// Web Vital
	if p.Event == "web_vital" && p.Vital != nil {
		ev.MetricName = p.Vital.Name
		val := p.Vital.Value
		ev.MetricValue = &val
		if p.Vital.Rating != "" {
			ev.MetricRating = p.Vital.Rating
		} else {
			ev.MetricRating = enrich.WebVitalRating(p.Vital.Name, p.Vital.Value)
		}
	}

	return ev, nil
}

func nonEmpty(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

// stringify converts an arbitrary JSON-decoded value into a string suitable
// for ClickHouse's Map(String, String). Nested objects/arrays are dropped
// because the schema explicitly rejects them, but we're defensive here since
// Validate only enforces the shape loosely for `props`.
func stringify(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case bool:
		if t {
			return "true"
		}
		return "false"
	case float64:
		// json.Number default for numbers; avoid scientific notation for ints.
		if t == float64(int64(t)) {
			return strconv.FormatInt(int64(t), 10)
		}
		return strconv.FormatFloat(t, 'f', -1, 64)
	case int:
		return strconv.Itoa(t)
	case int64:
		return strconv.FormatInt(t, 10)
	default:
		return fmt.Sprintf("%v", t)
	}
}
