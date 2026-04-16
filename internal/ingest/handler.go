package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/webalytics/webalytics/internal/domain"
	"github.com/webalytics/webalytics/internal/enrich"
)

// SiteLookup is the narrow interface the handler needs from the storage layer.
// Implemented by internal/storage/postgres.SiteCache.
type SiteLookup interface {
	Lookup(ctx context.Context, publicSiteID string) (*domain.SiteWithDomains, error)
	Invalidate(publicSiteID string)
}

// NotFoundError signals a miss from the site lookup.
type NotFoundError interface {
	IsNotFound() bool
}

// Dependencies bundles everything the /collect handler needs.
// All fields are required except Limiter (nil disables rate limiting).
type Dependencies struct {
	Sites     SiteLookup
	NotFound  error // the sentinel returned by Sites.Lookup for "missing"
	Enricher  *Enricher
	Writer    *BatchWriter
	Limiter   *RateLimiter
	Log       *slog.Logger
	Now       func() time.Time // injectable for tests
}

// Handler returns the chi/http.Handler for POST /collect.
//
// Semantics:
//   - Every response is 204 by default (even on reject) so real browsers
//     never log errors to the console.
//   - When ?debug=1 is set, we emit an X-Webalytics-Debug header with a
//     stable reason string so developers can trace rejects.
//   - The hot path defers work that can be done after response is written
//     (batching to ClickHouse), but enrichment happens inline because it's
//     cheap and localizes failure modes.
func Handler(deps Dependencies) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		debug := r.URL.Query().Get("debug") == "1"
		writeAccepted := func(reason string) {
			if debug {
				w.Header().Set("X-Webalytics-Debug", reason)
			}
			w.WriteHeader(http.StatusNoContent)
		}

		// DNT / GPC: we always honor them unless the site has an explicit override.
		// Overrides live in site.Settings; we apply them after the site is resolved.
		dntHeader := r.Header.Get("DNT") == "1" || r.Header.Get("Sec-GPC") == "1"

		// Parse
		if r.Body == nil {
			writeAccepted(DropReasonSchema)
			return
		}
		defer r.Body.Close()
		var p CollectPayload
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&p); err != nil {
			writeAccepted(DropReasonSchema)
			return
		}
		if err := Validate(&p); err != nil {
			writeAccepted(DropReasonSchema)
			return
		}

		// Rate limit (pre-lookup) keyed on IP + site_id (which is cheap here)
		ip := clientIP(r)
		if deps.Limiter != nil {
			ok, err := deps.Limiter.Allow(r.Context(), p.SiteID, ip)
			if err != nil {
				deps.Log.Warn("ratelimit backend error", slog.String("err", err.Error()))
			}
			if !ok {
				writeAccepted(DropReasonRateLimited)
				return
			}
		}

		// Lookup
		sd, err := deps.Sites.Lookup(r.Context(), p.SiteID)
		if err != nil {
			if deps.NotFound != nil && errors.Is(err, deps.NotFound) {
				writeAccepted(DropReasonSiteUnknown)
				return
			}
			deps.Log.Warn("site lookup failed", slog.String("err", err.Error()))
			writeAccepted(DropReasonSiteUnknown)
			return
		}

		// DNT: per-site override in settings.allow_dnt skips the check.
		if dntHeader {
			allowDNT, _ := sd.Site.Settings["allow_dnt"].(bool)
			if !allowDNT {
				writeAccepted(DropReasonDNT)
				return
			}
		}

		// Origin / Referer → hostname allowlist
		reqHost := requestHostname(r)
		if reqHost == "" {
			// Server-to-server senders without Origin/Referer can skip this
			// via a write token; the raw /collect endpoint is browser-only.
			writeAccepted(DropReasonDomainMismatch)
			return
		}
		if !enrich.HostnameMatches(reqHost, sd.Hostnames) {
			writeAccepted(DropReasonDomainMismatch)
			return
		}

		// Bot check — the UA parser is the source of truth, but we also have
		// a cheap keyword fallback in the enricher. We do a quick probe here
		// so we can drop before we even run the full enrichment.
		ua := r.UserAgent()
		if isLikelyBotUA(ua) {
			writeAccepted(DropReasonBot)
			return
		}

		// Enrich
		now := time.Now
		if deps.Now != nil {
			now = deps.Now
		}
		ev, err := deps.Enricher.Build(sd.Site, &p, RequestContext{
			IP:        ip,
			UserAgent: ua,
			Now:       now(),
		})
		if err != nil {
			deps.Log.Warn("enrich failed",
				slog.String("err", err.Error()),
				slog.String("site", p.SiteID),
			)
			writeAccepted(DropReasonSchema)
			return
		}

		// Submit for batched write.
		deps.Writer.Submit(ev)

		writeAccepted(DropReasonOK)
	}
}

// requestHostname returns the hostname that we should match against the
// site's domain allowlist. Origin wins over Referer.
func requestHostname(r *http.Request) string {
	if o := r.Header.Get("Origin"); o != "" && o != "null" {
		if u, err := url.Parse(o); err == nil && u.Host != "" {
			return strings.ToLower(u.Hostname())
		}
	}
	if ref := r.Header.Get("Referer"); ref != "" {
		if u, err := url.Parse(ref); err == nil && u.Host != "" {
			return strings.ToLower(u.Hostname())
		}
	}
	return ""
}

// clientIP prefers X-Forwarded-For (leftmost), then X-Real-IP, then RemoteAddr.
// Duplicated from server/middleware.go to avoid an import cycle.
func clientIP(r *http.Request) string {
	if xf := r.Header.Get("X-Forwarded-For"); xf != "" {
		if i := strings.IndexByte(xf, ','); i >= 0 {
			return strings.TrimSpace(xf[:i])
		}
		return strings.TrimSpace(xf)
	}
	if rip := r.Header.Get("X-Real-IP"); rip != "" {
		return rip
	}
	addr := r.RemoteAddr
	if i := strings.LastIndexByte(addr, ':'); i >= 0 {
		return addr[:i]
	}
	return addr
}

// isLikelyBotUA is a fast-path bot check. The full UA parser also classifies
// bots; this just catches the common obvious cases before we pay for parsing.
func isLikelyBotUA(ua string) bool {
	if ua == "" {
		return true
	}
	l := strings.ToLower(ua)
	for _, k := range quickBotKeywords {
		if strings.Contains(l, k) {
			return true
		}
	}
	return false
}

var quickBotKeywords = []string{
	"bot/", "crawler", "spider", "headlesschrome",
	"curl/", "wget/", "python-requests/", "go-http-client",
}
