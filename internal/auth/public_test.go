package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/webalytics/webalytics/internal/domain"
	"github.com/webalytics/webalytics/internal/server"
	"github.com/webalytics/webalytics/internal/storage/postgres"
)

// fakePubResolver is a test double for PublicResolver. It knows about
// exactly one raw token and whatever AllowedOrigins was set on it.
type fakePubResolver struct {
	raw   string
	token *domain.PublicToken
	err   error
}

func (f *fakePubResolver) Resolve(_ context.Context, raw string) (*domain.PublicToken, error) {
	if f.err != nil {
		return nil, f.err
	}
	if raw != f.raw {
		return nil, postgres.ErrNotFound
	}
	return f.token, nil
}

// newRouterWithToken mounts the public-token middleware at /x/{siteId}
// so tests can hit different siteId URLs. The handler body records the
// org id it saw so happy-path tests can assert on context propagation.
func newRouterWithToken(t *testing.T, res PublicResolver) (*chi.Mux, *string) {
	t.Helper()
	var seenOrg string
	r := chi.NewRouter()
	r.Route("/x/{siteId}", func(r chi.Router) {
		r.Use(PublicTokenMiddleware(res))
		r.Get("/ping", func(w http.ResponseWriter, req *http.Request) {
			seenOrg = server.OrgIDFrom(req.Context())
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("ok"))
		})
	})
	return r, &seenOrg
}

func TestPublicTokenMiddleware_MissingBearer(t *testing.T) {
	site := uuid.New()
	res := &fakePubResolver{
		raw: "wb_pub_live_abc",
		token: &domain.PublicToken{
			ID: uuid.New(), SiteID: site, OrganizationID: uuid.New(),
		},
	}
	r, _ := newRouterWithToken(t, res)

	req := httptest.NewRequest(http.MethodGet, "/x/"+site.String()+"/ping", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}

func TestPublicTokenMiddleware_InvalidBearer(t *testing.T) {
	site := uuid.New()
	res := &fakePubResolver{
		raw: "wb_pub_live_abc",
		token: &domain.PublicToken{
			ID: uuid.New(), SiteID: site, OrganizationID: uuid.New(),
		},
	}
	r, _ := newRouterWithToken(t, res)

	req := httptest.NewRequest(http.MethodGet, "/x/"+site.String()+"/ping", nil)
	req.Header.Set("Authorization", "Bearer wb_pub_live_NOPE")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestPublicTokenMiddleware_SiteMismatchIsForbidden(t *testing.T) {
	// Token issued for site A; request targets site B.
	siteA := uuid.New()
	siteB := uuid.New()
	org := uuid.New()
	res := &fakePubResolver{
		raw: "wb_pub_live_abc",
		token: &domain.PublicToken{
			ID: uuid.New(), SiteID: siteA, OrganizationID: org,
		},
	}
	r, _ := newRouterWithToken(t, res)

	req := httptest.NewRequest(http.MethodGet, "/x/"+siteB.String()+"/ping", nil)
	req.Header.Set("Authorization", "Bearer wb_pub_live_abc")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("want 403 for cross-site token use, got %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "forbidden_site") {
		t.Fatalf("want forbidden_site error code, got %s", rr.Body.String())
	}
}

func TestPublicTokenMiddleware_OriginMismatchIsForbidden(t *testing.T) {
	site := uuid.New()
	org := uuid.New()
	res := &fakePubResolver{
		raw: "wb_pub_live_abc",
		token: &domain.PublicToken{
			ID: uuid.New(), SiteID: site, OrganizationID: org,
			AllowedOrigins: []string{"https://jlav.io"},
		},
	}
	r, _ := newRouterWithToken(t, res)

	req := httptest.NewRequest(http.MethodGet, "/x/"+site.String()+"/ping", nil)
	req.Header.Set("Authorization", "Bearer wb_pub_live_abc")
	req.Header.Set("Origin", "https://evil.example.com")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("want 403 for origin mismatch, got %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "forbidden_origin") {
		t.Fatalf("want forbidden_origin error code, got %s", rr.Body.String())
	}
	// We MUST NOT grant CORS on a denied origin — that would let the
	// attacker's page see our 403 body (which leaks "such-and-such token
	// exists").
	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("want no CORS allow header on deny, got %q", got)
	}
}

func TestPublicTokenMiddleware_OriginMatchAllowsAndSetsCORS(t *testing.T) {
	site := uuid.New()
	org := uuid.New()
	res := &fakePubResolver{
		raw: "wb_pub_live_abc",
		token: &domain.PublicToken{
			ID: uuid.New(), SiteID: site, OrganizationID: org,
			AllowedOrigins: []string{"https://jlav.io", "https://www.jlav.io"},
		},
	}
	r, seen := newRouterWithToken(t, res)

	req := httptest.NewRequest(http.MethodGet, "/x/"+site.String()+"/ping", nil)
	req.Header.Set("Authorization", "Bearer wb_pub_live_abc")
	req.Header.Set("Origin", "https://jlav.io")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if got := rr.Header().Get("Access-Control-Allow-Origin"); got != "https://jlav.io" {
		t.Fatalf("want echoed origin, got %q", got)
	}
	if v := rr.Header().Get("Vary"); !strings.Contains(v, "Origin") {
		t.Fatalf("Vary must include Origin, got %q", v)
	}
	if *seen != org.String() {
		t.Fatalf("org id not propagated to context: want %s, got %s", org, *seen)
	}
}

func TestPublicTokenMiddleware_EmptyAllowedOriginsAllowsAnyOrigin(t *testing.T) {
	// Public-stats-page mode: token has no origin binding, so anyone
	// with the token can display stats from any origin. This is the
	// "share link" use case.
	site := uuid.New()
	org := uuid.New()
	res := &fakePubResolver{
		raw: "wb_pub_live_abc",
		token: &domain.PublicToken{
			ID: uuid.New(), SiteID: site, OrganizationID: org,
			AllowedOrigins: nil,
		},
	}
	r, _ := newRouterWithToken(t, res)

	for _, origin := range []string{"https://any.example.com", "https://other.example.org"} {
		req := httptest.NewRequest(http.MethodGet, "/x/"+site.String()+"/ping", nil)
		req.Header.Set("Authorization", "Bearer wb_pub_live_abc")
		req.Header.Set("Origin", origin)
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("unbound token should accept origin %s, got %d", origin, rr.Code)
		}
		if got := rr.Header().Get("Access-Control-Allow-Origin"); got != origin {
			t.Fatalf("unbound token should echo origin %s, got %q", origin, got)
		}
	}
}

func TestPublicTokenMiddleware_OptionsPreflightShortCircuits(t *testing.T) {
	// Browsers send OPTIONS without Authorization; the middleware must
	// return a 204 with CORS headers so the real GET is allowed.
	site := uuid.New()
	res := &fakePubResolver{
		// Deliberately empty — preflight must succeed even if the
		// token wouldn't have resolved, because preflight is "can I
		// even try to send this request?"
	}
	r, _ := newRouterWithToken(t, res)

	req := httptest.NewRequest(http.MethodOptions, "/x/"+site.String()+"/ping", nil)
	req.Header.Set("Origin", "https://jlav.io")
	req.Header.Set("Access-Control-Request-Method", "GET")
	req.Header.Set("Access-Control-Request-Headers", "authorization")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("preflight should 204, got %d", rr.Code)
	}
	if got := rr.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(got, "GET") {
		t.Fatalf("preflight must advertise GET, got %q", got)
	}
}
