package v1

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/webalytics/webalytics/internal/server"
	"github.com/webalytics/webalytics/internal/storage/postgres"
)

type eventDefResponse struct {
	ID          string         `json:"id"`
	SiteID      string         `json:"site_id"`
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Schema      map[string]any `json:"schema,omitempty"`
	IsGoal      bool           `json:"is_goal"`
	CreatedAt   time.Time      `json:"created_at"`
}

func toEventDefResponse(e *postgres.EventDefinition) eventDefResponse {
	return eventDefResponse{
		ID:          e.ID.String(),
		SiteID:      e.SiteID.String(),
		Name:        e.Name,
		Description: e.Description,
		Schema:      e.Schema,
		IsGoal:      e.IsGoal,
		CreatedAt:   e.CreatedAt,
	}
}

func listEventDefs(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		siteID := chi.URLParam(r, "siteId")
		if _, ok := parseUUID(w, siteID); !ok {
			return
		}
		defs, err := d.Events.ListBySite(r.Context(), orgID(r), siteID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		out := make([]eventDefResponse, 0, len(defs))
		for i := range defs {
			out = append(out, toEventDefResponse(&defs[i]))
		}
		writeJSON(w, http.StatusOK, out)
	}
}

type createEventDefReq struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Schema      map[string]any `json:"schema,omitempty"`
	IsGoal      bool           `json:"is_goal,omitempty"`
}

func createEventDef(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		siteID := chi.URLParam(r, "siteId")
		if _, ok := parseUUID(w, siteID); !ok {
			return
		}
		var in createEventDefReq
		if err := decodeJSON(r, &in); err != nil || in.Name == "" {
			server.Error(w, http.StatusBadRequest, "validation_failed", "name is required")
			return
		}
		ev, err := d.Events.Create(r.Context(), orgID(r), siteID, postgres.CreateEventDefInput{
			Name:        in.Name,
			Description: in.Description,
			Schema:      in.Schema,
			IsGoal:      in.IsGoal,
		})
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, toEventDefResponse(ev))
	}
}

type patchEventDefReq struct {
	Description *string        `json:"description,omitempty"`
	Schema      map[string]any `json:"schema,omitempty"`
	IsGoal      *bool          `json:"is_goal,omitempty"`
}

func patchEventDef(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		siteID := chi.URLParam(r, "siteId")
		name := chi.URLParam(r, "eventName")
		if _, ok := parseUUID(w, siteID); !ok {
			return
		}
		if name == "" {
			server.Error(w, http.StatusBadRequest, "validation_failed", "event name required")
			return
		}
		var in patchEventDefReq
		if err := decodeJSON(r, &in); err != nil {
			server.Error(w, http.StatusBadRequest, "validation_failed", "invalid body")
			return
		}
		ev, err := d.Events.Update(r.Context(), orgID(r), siteID, name, postgres.UpdateEventDefInput{
			Description: in.Description,
			Schema:      in.Schema,
			IsGoal:      in.IsGoal,
		})
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, toEventDefResponse(ev))
	}
}

func deleteEventDef(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		siteID := chi.URLParam(r, "siteId")
		name := chi.URLParam(r, "eventName")
		if _, ok := parseUUID(w, siteID); !ok {
			return
		}
		if err := d.Events.Delete(r.Context(), orgID(r), siteID, name); err != nil {
			writeStoreError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
