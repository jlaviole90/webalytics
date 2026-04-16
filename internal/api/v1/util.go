package v1

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/webalytics/webalytics/internal/server"
	"github.com/webalytics/webalytics/internal/storage/postgres"
)

// orgID reads the authenticated org from context. Handlers can assume it is
// present because the auth middleware refuses unauthenticated requests.
func orgID(r *http.Request) string { return server.OrgIDFrom(r.Context()) }

// decodeJSON decodes a JSON body into dst. Returns a bad-request-style error
// string the caller can forward to server.Error.
func decodeJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

func encodeJSON(w io.Writer, v any) error {
	return json.NewEncoder(w).Encode(v)
}

// writeStoreError maps postgres sentinel errors to HTTP responses.
func writeStoreError(w http.ResponseWriter, err error) {
	writeStoreErrorCtx(nil, w, err)
}

// writeStoreErrorCtx is like writeStoreError but logs the underlying error
// on the 500 path. Handlers that have access to *slog.Logger should prefer
// this variant; the original writeStoreError is kept for callsites that
// don't yet thread a logger through.
func writeStoreErrorCtx(log *slog.Logger, w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, postgres.ErrNotFound):
		server.Error(w, http.StatusNotFound, "not_found", "resource not found")
	case errors.Is(err, postgres.ErrConflict):
		server.Error(w, http.StatusConflict, "conflict", "already exists")
	case errors.Is(err, postgres.ErrValidation):
		server.Error(w, http.StatusBadRequest, "validation_failed", "invalid input")
	default:
		// Never return the raw error to the client (could leak schema),
		// but always log it so the operator can actually debug.
		if log != nil {
			log.Error("store error", slog.String("err", err.Error()))
		} else {
			slog.Default().Error("store error", slog.String("err", err.Error()))
		}
		server.Error(w, http.StatusInternalServerError, "internal_error", "internal error")
	}
}

// parseUUID validates a UUID path parameter; writes a 400 and returns false
// when invalid.
func parseUUID(w http.ResponseWriter, raw string) (uuid.UUID, bool) {
	id, err := uuid.Parse(raw)
	if err != nil {
		server.Error(w, http.StatusBadRequest, "validation_failed", "invalid uuid")
		return uuid.Nil, false
	}
	return id, true
}

// parseTimeParam parses ISO 8601 date-times. The API requires RFC3339-ish
// input; we accept the common layouts Go's json/time emit.
func parseTimeParam(raw string) (time.Time, error) {
	if raw == "" {
		return time.Time{}, errors.New("missing time")
	}
	layouts := []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05Z", "2006-01-02"}
	for _, l := range layouts {
		if t, err := time.Parse(l, raw); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, errors.New("invalid time")
}

// parseIntParam parses a bounded integer query param. Returns def when empty.
func parseIntParam(raw string, def, min, max int) int {
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < min || n > max {
		return def
	}
	return n
}
