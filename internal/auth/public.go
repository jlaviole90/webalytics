// Package auth holds the bearer-token middlewares. auth.go is the classic
// admin-token middleware for /v1. This file implements the complementary
// middleware for /public/v1 — browser-safe, site-scoped, read-only tokens.
package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/webalytics/webalytics/internal/domain"
	"github.com/webalytics/webalytics/internal/server"
	"github.com/webalytics/webalytics/internal/storage/postgres"
)

// PublicResolver resolves a raw wb_pub_live_ token into a domain.PublicToken.
// Implemented by *postgres.PublicTokenStore.
type PublicResolver interface {
	Resolve(ctx context.Context, raw string) (*domain.PublicToken, error)
}

// PublicSiteResolver resolves a wb_live_* public site ID to a site UUID.
// Allows clients to use the public site ID in URL paths instead of having
// to know the internal UUID.
type PublicSiteResolver interface {
	ResolvePublicSiteID(ctx context.Context, publicSiteID string) (string, error)
}

// PublicTokenMiddleware returns an http middleware that:
//
//  1. Extracts a bearer token from the Authorization header.
//  2. Resolves it against PublicResolver; 401s on miss.
//  3. Enforces the token's AllowedOrigins list against the request's
//     Origin header, if the list is non-empty.
//  4. Emits CORS response headers so browsers allow the response through.
//  5. Short-circuits CORS preflight (OPTIONS) with a 204.
//  6. Verifies that the {siteId} URL param matches the token's SiteID so
//     a token minted for site A cannot read site B's stats by swapping
//     the URL.
//  7. Installs the resolved organization_id into the request context so
//     downstream handlers + the RLS-enforced postgres.WithOrg tx reach
//     the right tenant rows.
//
// This is intentionally NOT a drop-in replacement for auth.Middleware —
// it enforces narrower guarantees and must only be mounted under routes
// that are safe to run read-only (i.e. /public/v1/sites/{siteId}/stats/*).
func PublicTokenMiddleware(r PublicResolver, sites PublicSiteResolver) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			origin := req.Header.Get("Origin")

			// Preflight: browsers send OPTIONS WITHOUT the Authorization
			// header, so we must respond to it before attempting to
			// resolve a token. We emit a permissive-looking preflight,
			// but the subsequent GET still has to pass real auth, so
			// this is not a bypass. We can't check the token here
			// (no Authorization header is sent on preflight), so we
			// allow any origin for the preflight itself.
			if req.Method == http.MethodOptions {
				writeCORSHeaders(w, origin, true)
				w.WriteHeader(http.StatusNoContent)
				return
			}

			raw := extractBearer(req.Header.Get("Authorization"))
			if raw == "" {
				writeCORSHeaders(w, origin, false)
				server.Error(w, http.StatusUnauthorized, "unauthorized", "missing bearer token")
				return
			}

			tok, err := r.Resolve(req.Context(), raw)
			if err != nil {
				if errors.Is(err, postgres.ErrNotFound) {
					writeCORSHeaders(w, origin, false)
					server.Error(w, http.StatusUnauthorized, "unauthorized", "invalid embed token")
					return
				}
				writeCORSHeaders(w, origin, false)
				server.Error(w, http.StatusInternalServerError, "internal_error", "auth backend error")
				return
			}

			// Origin allowlist check.
			if len(tok.AllowedOrigins) > 0 {
				if origin == "" || !matchOrigin(origin, tok.AllowedOrigins) {
					writeCORSHeaders(w, origin, false)
					server.Error(w, http.StatusForbidden, "forbidden_origin",
						"origin not allowed for this token")
					return
				}
			}

			// Site binding: the URL's {siteId} must match the token's
			// SiteID. Clients may pass either the UUID or the wb_live_*
			// public site ID — we resolve the latter to a UUID so
			// downstream handlers always see a UUID.
			siteParam := chi.URLParam(req, "siteId")
			resolvedSiteID := siteParam

			if siteParam != "" && strings.HasPrefix(siteParam, "wb_") {
				// Client passed a public site ID; resolve to UUID.
				if sites == nil {
					writeCORSHeaders(w, origin, false)
					server.Error(w, http.StatusInternalServerError, "internal_error", "site resolver not configured")
					return
				}
				uuid, err := sites.ResolvePublicSiteID(req.Context(), siteParam)
				if err != nil {
					writeCORSHeaders(w, origin, false)
					server.Error(w, http.StatusNotFound, "not_found", "unknown site id")
					return
				}
				resolvedSiteID = uuid
			}

			if resolvedSiteID != "" && resolvedSiteID != tok.SiteID.String() {
				writeCORSHeaders(w, origin, originAllowed(origin, tok.AllowedOrigins))
				server.Error(w, http.StatusForbidden, "forbidden_site",
					"token is not authorized for this site")
				return
			}

			// Rewrite the chi route param to the resolved UUID so
			// downstream handlers (stats.go) always receive a UUID
			// regardless of what the client passed in the URL.
			if resolvedSiteID != siteParam {
				rctx := chi.RouteContext(req.Context())
				for i, k := range rctx.URLParams.Keys {
					if k == "siteId" {
						rctx.URLParams.Values[i] = resolvedSiteID
						break
					}
				}
			}

			// Success path: grant CORS and install context.
			writeCORSHeaders(w, origin, true)
			ctx := server.WithOrgID(req.Context(), tok.OrganizationID.String())
			ctx = server.WithToken(ctx, tok.ID.String(), []string{"read:public_stats"})
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	}
}

// matchOrigin compares the request Origin against the allowlist. We do a
// case-insensitive, exact string match on the full scheme+host (ports
// included). Callers are expected to store the canonical form in the DB
// (e.g. 'https://jlav.io', not 'https://JLAV.io/').
func matchOrigin(origin string, allowed []string) bool {
	o := strings.ToLower(strings.TrimSpace(origin))
	for _, a := range allowed {
		if strings.ToLower(strings.TrimSpace(a)) == o {
			return true
		}
	}
	return false
}

// writeCORSHeaders emits the CORS response headers. `allow` is an
// explicit decision from the caller — true means "grant CORS for this
// origin", false means "do NOT echo the Origin back, only set Vary".
// Keeping the decision explicit avoids subtle leaks on failure paths
// (e.g. echoing Origin inside a 403 body means the attacker's page
// can read the error message).
func writeCORSHeaders(w http.ResponseWriter, origin string, allow bool) {
	h := w.Header()
	h.Set("Vary", "Origin")
	h.Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With")
	h.Set("Access-Control-Max-Age", "86400")
	if allow && origin != "" {
		h.Set("Access-Control-Allow-Origin", origin)
	}
}

// originAllowed reports whether an Origin is allowed given the token's
// allowlist. An empty allowlist means "public — any origin is fine".
func originAllowed(origin string, allowed []string) bool {
	if len(allowed) == 0 {
		return origin != ""
	}
	return matchOrigin(origin, allowed)
}
