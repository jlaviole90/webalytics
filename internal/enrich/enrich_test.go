package enrich

import (
	"testing"
	"time"
)

func TestHostnameMatches(t *testing.T) {
	cases := []struct {
		hostname string
		allowed  []string
		want     bool
	}{
		{"example.com", []string{"example.com"}, true},
		{"www.example.com", []string{"example.com"}, true},
		{"example.com", []string{"www.example.com"}, true},
		{"EXAMPLE.com", []string{"example.com"}, true},
		{"example.com", []string{"other.com", "example.com"}, true},
		{"sub.example.com", []string{"example.com"}, false},
		{"evil.com", []string{"example.com"}, false},
		{"", []string{"example.com"}, false},
		{"example.com", nil, false},
	}
	for _, tc := range cases {
		got := HostnameMatches(tc.hostname, tc.allowed)
		if got != tc.want {
			t.Errorf("HostnameMatches(%q, %v) = %v, want %v", tc.hostname, tc.allowed, got, tc.want)
		}
	}
}

func TestParseURL(t *testing.T) {
	u, err := ParseURL("https://Example.COM/blog/post?utm_source=twitter&utm_medium=social&utm_campaign=launch&utm_term=go&utm_content=hero&x=1")
	if err != nil {
		t.Fatalf("ParseURL: %v", err)
	}
	if u.Hostname != "example.com" {
		t.Errorf("Hostname = %q, want example.com (lowercased)", u.Hostname)
	}
	if u.Path != "/blog/post" {
		t.Errorf("Path = %q", u.Path)
	}
	if u.Query == "" {
		t.Errorf("Query empty")
	}
	if u.UTM.Source != "twitter" || u.UTM.Medium != "social" || u.UTM.Campaign != "launch" ||
		u.UTM.Term != "go" || u.UTM.Content != "hero" {
		t.Errorf("UTM = %+v", u.UTM)
	}
}

func TestParseURL_NoUTM(t *testing.T) {
	u, err := ParseURL("https://example.com/")
	if err != nil {
		t.Fatal(err)
	}
	if (u.UTM != UTMParams{}) {
		t.Errorf("expected empty UTM, got %+v", u.UTM)
	}
}

func TestParseReferrer(t *testing.T) {
	host, path := ParseReferrer("https://twitter.com/some/post")
	if host != "twitter.com" || path != "/some/post" {
		t.Errorf("got (%q, %q)", host, path)
	}
	h2, p2 := ParseReferrer("")
	if h2 != "" || p2 != "" {
		t.Errorf("empty input = (%q, %q)", h2, p2)
	}
	h3, p3 := ParseReferrer("not a url")
	if h3 != "" || p3 != "" {
		t.Errorf("bad input = (%q, %q)", h3, p3)
	}
}

func TestWebVitalRating(t *testing.T) {
	cases := []struct {
		metric string
		value  float64
		want   string
	}{
		{"LCP", 2000, "good"},
		{"LCP", 2500, "good"},
		{"LCP", 3000, "needs-improvement"},
		{"LCP", 5000, "poor"},
		{"INP", 100, "good"},
		{"INP", 300, "needs-improvement"},
		{"INP", 600, "poor"},
		{"CLS", 0.05, "good"},
		{"CLS", 0.2, "needs-improvement"},
		{"CLS", 0.3, "poor"},
		{"FCP", 1000, "good"},
		{"TTFB", 500, "good"},
		{"TTFB", 2000, "poor"},
		{"UNKNOWN", 1, ""},
	}
	for _, tc := range cases {
		got := WebVitalRating(tc.metric, tc.value)
		if got != tc.want {
			t.Errorf("WebVitalRating(%q, %v) = %q, want %q", tc.metric, tc.value, got, tc.want)
		}
	}
}

func TestSessionHasher_StableWithinDay(t *testing.T) {
	fixed := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)
	h := NewSessionHasher("salt", func() time.Time { return fixed })

	a := h.Hash("site1", "1.2.3.4", "UA")
	b := h.Hash("site1", "1.2.3.4", "UA")
	if a != b {
		t.Fatal("expected same hash within same day + inputs")
	}
}

func TestSessionHasher_DiffersPerSite(t *testing.T) {
	fixed := time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC)
	h := NewSessionHasher("salt", func() time.Time { return fixed })

	a := h.Hash("site1", "1.2.3.4", "UA")
	b := h.Hash("site2", "1.2.3.4", "UA")
	if a == b {
		t.Fatal("different site should produce different hash")
	}
}

func TestSessionHasher_RotatesDaily(t *testing.T) {
	t1 := time.Date(2025, 6, 1, 23, 59, 59, 0, time.UTC)
	t2 := time.Date(2025, 6, 2, 0, 0, 1, 0, time.UTC)

	h1 := NewSessionHasher("salt", func() time.Time { return t1 })
	h2 := NewSessionHasher("salt", func() time.Time { return t2 })

	if h1.Hash("s", "ip", "ua") == h2.Hash("s", "ip", "ua") {
		t.Fatal("expected different hashes across day boundary")
	}
}
