// Package server wires HTTP middleware and route registration.
package server

import (
	"context"
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
)

type ctxKey string

const (
	ctxKeyRequestID ctxKey = "request_id"
	ctxKeyOrgID     ctxKey = "organization_id"
	ctxKeyTokenID   ctxKey = "token_id"
	ctxKeyScopes    ctxKey = "token_scopes"
)

// RequestID injects an X-Request-ID header (generates one if missing).
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = uuid.NewString()
		}
		w.Header().Set("X-Request-ID", id)
		ctx := context.WithValue(r.Context(), ctxKeyRequestID, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequestIDFrom returns the request ID stored in the context, if any.
func RequestIDFrom(ctx context.Context) string {
	if v, ok := ctx.Value(ctxKeyRequestID).(string); ok {
		return v
	}
	return ""
}

// OrgIDFrom returns the authenticated organization ID or empty.
func OrgIDFrom(ctx context.Context) string {
	if v, ok := ctx.Value(ctxKeyOrgID).(string); ok {
		return v
	}
	return ""
}

// WithOrgID returns a context carrying the authenticated organization ID.
func WithOrgID(ctx context.Context, orgID string) context.Context {
	return context.WithValue(ctx, ctxKeyOrgID, orgID)
}

// WithToken attaches token id and scopes to the context.
func WithToken(ctx context.Context, tokenID string, scopes []string) context.Context {
	ctx = context.WithValue(ctx, ctxKeyTokenID, tokenID)
	ctx = context.WithValue(ctx, ctxKeyScopes, scopes)
	return ctx
}

// ScopesFrom returns the authenticated token's scopes.
func ScopesFrom(ctx context.Context) []string {
	if v, ok := ctx.Value(ctxKeyScopes).([]string); ok {
		return v
	}
	return nil
}

// Recovery converts panics into 500s without killing the server.
func Recovery(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rec := recover(); rec != nil {
					log.Error("panic recovered",
						slog.Any("panic", rec),
						slog.String("stack", string(debug.Stack())),
						slog.String("request_id", RequestIDFrom(r.Context())),
					)
					w.WriteHeader(http.StatusInternalServerError)
					_, _ = w.Write([]byte(`{"error":{"code":"internal_error","message":"internal error"}}`))
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// AccessLog logs one line per request at info level with method, path, status, duration.
func AccessLog(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)
			log.Info("http",
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", ww.Status()),
				slog.Int("bytes", ww.BytesWritten()),
				slog.Duration("dur", time.Since(start)),
				slog.String("request_id", RequestIDFrom(r.Context())),
				slog.String("remote", clientIP(r)),
			)
		})
	}
}

// clientIP extracts the caller IP, preferring the leftmost X-Forwarded-For.
func clientIP(r *http.Request) string {
	if xf := r.Header.Get("X-Forwarded-For"); xf != "" {
		// leftmost entry
		for i := 0; i < len(xf); i++ {
			if xf[i] == ',' {
				return xf[:i]
			}
		}
		return xf
	}
	if rip := r.Header.Get("X-Real-IP"); rip != "" {
		return rip
	}
	// RemoteAddr is host:port
	addr := r.RemoteAddr
	for i := len(addr) - 1; i >= 0; i-- {
		if addr[i] == ':' {
			return addr[:i]
		}
	}
	return addr
}
