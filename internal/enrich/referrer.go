package enrich

import (
	"net/url"
	"strings"
)

// ParseReferrer splits a referrer URL into (host, path).
// Invalid inputs return ("", "").
func ParseReferrer(raw string) (host, path string) {
	if raw == "" {
		return "", ""
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "", ""
	}
	return strings.ToLower(u.Host), u.Path
}

// ParsedURL extracts the fields we store off the event's `url`.
type ParsedURL struct {
	Hostname string
	Path     string
	Query    string
	UTM      UTMParams
}

// UTMParams holds the standard UTM fields we promote to their own columns.
type UTMParams struct {
	Source   string
	Medium   string
	Campaign string
	Term     string
	Content  string
}

// ParseURL pulls hostname, path, query, and utm_* from a raw URL.
func ParseURL(raw string) (ParsedURL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return ParsedURL{}, err
	}
	q := u.Query()
	return ParsedURL{
		Hostname: strings.ToLower(u.Host),
		Path:     u.Path,
		Query:    u.RawQuery,
		UTM: UTMParams{
			Source:   q.Get("utm_source"),
			Medium:   q.Get("utm_medium"),
			Campaign: q.Get("utm_campaign"),
			Term:     q.Get("utm_term"),
			Content:  q.Get("utm_content"),
		},
	}, nil
}

// HostnameMatches reports whether hostname equals one of `allowed`, with
// optional leading "www." stripped from both sides (case-insensitive).
func HostnameMatches(hostname string, allowed []string) bool {
	hn := strings.TrimPrefix(strings.ToLower(hostname), "www.")
	for _, a := range allowed {
		if strings.TrimPrefix(strings.ToLower(a), "www.") == hn {
			return true
		}
	}
	return false
}
