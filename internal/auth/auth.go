// Package auth implements the bearer-token middleware for /v1 routes.
//
// The middleware resolves the Authorization header into an organization_id
// and a set of scopes, then attaches them to the request context via the
// server package so downstream handlers and the postgres WithOrg tx wrapper
// can read them.
package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/webalytics/webalytics/internal/domain"
	"github.com/webalytics/webalytics/internal/server"
	"github.com/webalytics/webalytics/internal/storage/postgres"
)

// Resolver is the minimal storage interface the middleware needs.
// Implemented by *postgres.TokenStore.
type Resolver interface {
	Resolve(ctx context.Context, raw string) (*domain.APIToken, error)
}

// Middleware returns an http middleware enforcing a valid bearer token.
// On success it installs org_id + scopes on the request context. On failure
// it writes a JSON 401/403.
func Middleware(r Resolver) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			raw := extractBearer(req.Header.Get("Authorization"))
			if raw == "" {
				server.Error(w, http.StatusUnauthorized, "unauthorized", "missing bearer token")
				return
			}
			tok, err := r.Resolve(req.Context(), raw)
			if err != nil {
				if errors.Is(err, postgres.ErrNotFound) {
					server.Error(w, http.StatusUnauthorized, "unauthorized", "invalid bearer token")
					return
				}
				server.Error(w, http.StatusInternalServerError, "internal_error", "auth backend error")
				return
			}
			ctx := server.WithOrgID(req.Context(), tok.OrganizationID.String())
			ctx = server.WithToken(ctx, tok.ID.String(), tok.Scopes)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	}
}

// RequireScope rejects the request unless the token's scopes include `scope`.
// The `admin:*` scope is a superset convenience: any token with "admin:export"
// etc. NEVER implies unrelated scopes; scope strings are literal.
func RequireScope(scope string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			scopes := server.ScopesFrom(req.Context())
			if !hasScope(scopes, scope) {
				server.Error(w, http.StatusForbidden, "forbidden", "token lacks scope "+scope)
				return
			}
			next.ServeHTTP(w, req)
		})
	}
}

func hasScope(scopes []string, want string) bool {
	for _, s := range scopes {
		if s == want {
			return true
		}
	}
	return false
}

// extractBearer pulls the token value from an "Authorization: Bearer ..." header.
func extractBearer(h string) string {
	const prefix = "Bearer "
	if len(h) < len(prefix) || !strings.EqualFold(h[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(h[len(prefix):])
}
