package ingest

import (
	"errors"
	"strings"
	"testing"
)

func TestValidate(t *testing.T) {
	base := func() *CollectPayload {
		return &CollectPayload{
			SiteID: "wb_live_" + strings.Repeat("a", 16),
			Event:  "pageview",
			URL:    "https://example.com/foo",
		}
	}

	tests := []struct {
		name    string
		mutate  func(*CollectPayload)
		wantErr error
	}{
		{"valid", func(*CollectPayload) {}, nil},
		{"bad site prefix", func(p *CollectPayload) { p.SiteID = "xx_live_" + strings.Repeat("a", 16) }, ErrInvalidSiteID},
		{"site too short", func(p *CollectPayload) { p.SiteID = "wb_live_short" }, ErrInvalidSiteID},
		{"event empty", func(p *CollectPayload) { p.Event = "" }, ErrInvalidEvent},
		{"event bad chars", func(p *CollectPayload) { p.Event = "no spaces!" }, ErrInvalidEvent},
		{"url empty", func(p *CollectPayload) { p.URL = "" }, ErrInvalidURL},
		{"url too long", func(p *CollectPayload) { p.URL = "http://" + strings.Repeat("a", 2050) }, ErrInvalidURL},
		{"env bad chars", func(p *CollectPayload) { p.Environment = "prod uction" }, ErrInvalidEnvironment},
		{"web_vital missing vital", func(p *CollectPayload) { p.Event = "web_vital" }, ErrVitalMissing},
		{"web_vital bad metric", func(p *CollectPayload) {
			p.Event = "web_vital"
			p.Vital = &VitalWire{Name: "XYZ", Value: 1}
		}, ErrVitalName},
		{"web_vital negative", func(p *CollectPayload) {
			p.Event = "web_vital"
			p.Vital = &VitalWire{Name: "LCP", Value: -5}
		}, ErrVitalValue},
		{"vital on non-vital event", func(p *CollectPayload) {
			p.Vital = &VitalWire{Name: "LCP", Value: 1}
		}, ErrVitalOnNonVital},
		{"too many props", func(p *CollectPayload) {
			p.Props = map[string]any{}
			for i := 0; i < 51; i++ {
				p.Props[string(rune('a'+i%26))+string(rune('a'+i/26))] = "x"
			}
		}, ErrTooManyProps},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p := base()
			tc.mutate(p)
			err := Validate(p)
			if tc.wantErr == nil {
				if err != nil {
					t.Fatalf("got err %v, want nil", err)
				}
				return
			}
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("got err %v, want %v", err, tc.wantErr)
			}
		})
	}
}
