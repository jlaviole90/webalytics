package ingest

import (
	"errors"
	"regexp"
)

var (
	siteIDRE   = regexp.MustCompile(`^wb_(live|test)_[A-Za-z0-9]{16,}$`)
	eventRE    = regexp.MustCompile(`^[a-zA-Z0-9_.:-]{1,64}$`)
	envRE      = regexp.MustCompile(`^[a-zA-Z0-9_.-]{1,32}$`)
	validVital = map[string]struct{}{
		"LCP": {}, "INP": {}, "CLS": {}, "FCP": {}, "TTFB": {},
	}
)

// Drop reasons. These strings are what we emit on the X-Webalytics-Debug
// header when ?debug=1 is set. Stable; log-friendly.
const (
	DropReasonOK              = "ok"
	DropReasonSchema          = "schema"
	DropReasonSiteUnknown     = "site_unknown"
	DropReasonDomainMismatch  = "domain_mismatch"
	DropReasonRateLimited     = "rate_limited"
	DropReasonDNT             = "dnt_honored"
	DropReasonBot             = "bot_filtered"
)

// Validate performs cheap schema checks that don't require IO.
// Returns an error whose message is one of the DropReason* constants.
func Validate(p *CollectPayload) error {
	if !siteIDRE.MatchString(p.SiteID) {
		return ErrInvalidSiteID
	}
	if !eventRE.MatchString(p.Event) {
		return ErrInvalidEvent
	}
	if p.URL == "" || len(p.URL) > 2048 {
		return ErrInvalidURL
	}
	if p.Environment != "" && !envRE.MatchString(p.Environment) {
		return ErrInvalidEnvironment
	}
	if p.Event == "web_vital" {
		if p.Vital == nil {
			return ErrVitalMissing
		}
		if _, ok := validVital[p.Vital.Name]; !ok {
			return ErrVitalName
		}
		if p.Vital.Value < 0 {
			return ErrVitalValue
		}
	} else if p.Vital != nil {
		return ErrVitalOnNonVital
	}
	if p.Props != nil && len(p.Props) > 50 {
		return ErrTooManyProps
	}
	return nil
}

var (
	ErrInvalidSiteID      = errors.New("invalid site_id")
	ErrInvalidEvent       = errors.New("invalid event name")
	ErrInvalidURL         = errors.New("invalid url")
	ErrInvalidEnvironment = errors.New("invalid environment")
	ErrVitalMissing       = errors.New("web_vital requires vital block")
	ErrVitalName          = errors.New("invalid vital name")
	ErrVitalValue         = errors.New("invalid vital value")
	ErrVitalOnNonVital    = errors.New("vital block only allowed on web_vital events")
	ErrTooManyProps       = errors.New("too many props (max 50)")
)
