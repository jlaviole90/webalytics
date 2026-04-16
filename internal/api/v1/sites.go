package v1

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/webalytics/webalytics/internal/domain"
	"github.com/webalytics/webalytics/internal/server"
	"github.com/webalytics/webalytics/internal/storage/postgres"
)

// siteResponse is the JSON shape of a site returned by /v1/sites.
// Matches the `Site` schema in openapi.yaml.
type siteResponse struct {
	ID             string         `json:"id"`
	OrganizationID string         `json:"organization_id"`
	PublicSiteID   string         `json:"public_site_id"`
	Name           string         `json:"name"`
	Timezone       string         `json:"timezone"`
	RetentionDays  int            `json:"retention_days"`
	Settings       map[string]any `json:"settings"`
	CreatedAt      time.Time      `json:"created_at"`
}

func toSiteResponse(s *domain.Site) siteResponse {
	return siteResponse{
		ID:             s.ID.String(),
		OrganizationID: s.OrganizationID.String(),
		PublicSiteID:   s.PublicSiteID,
		Name:           s.Name,
		Timezone:       s.Timezone,
		RetentionDays:  s.RetentionDays,
		Settings:       s.Settings,
		CreatedAt:      s.CreatedAt,
	}
}

func listSites(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sites, err := d.Sites.ListSites(r.Context(), orgID(r))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		items := make([]siteResponse, 0, len(sites))
		for i := range sites {
			items = append(items, toSiteResponse(&sites[i]))
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items": items,
			"total": len(items),
		})
	}
}

type createSiteReq struct {
	Name          string `json:"name"`
	Timezone      string `json:"timezone,omitempty"`
	RetentionDays int    `json:"retention_days,omitempty"`
}

func createSite(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in createSiteReq
		if err := decodeJSON(r, &in); err != nil {
			server.Error(w, http.StatusBadRequest, "validation_failed", "invalid body")
			return
		}
		if strings.TrimSpace(in.Name) == "" {
			server.Error(w, http.StatusBadRequest, "validation_failed", "name is required")
			return
		}
		site, err := d.Sites.CreateSite(r.Context(), orgID(r), postgres.SiteCreateInput{
			Name:          in.Name,
			Timezone:      in.Timezone,
			RetentionDays: in.RetentionDays,
		}, NewPublicSiteID("live"))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, toSiteResponse(site))
	}
}

func getSite(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		siteID := chi.URLParam(r, "siteId")
		if _, ok := parseUUID(w, siteID); !ok {
			return
		}
		site, err := d.Sites.GetSiteByID(r.Context(), orgID(r), siteID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, toSiteResponse(site))
	}
}

type patchSiteReq struct {
	Name          *string        `json:"name,omitempty"`
	Timezone      *string        `json:"timezone,omitempty"`
	RetentionDays *int           `json:"retention_days,omitempty"`
	Settings      map[string]any `json:"settings,omitempty"`
}

func patchSite(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		siteID := chi.URLParam(r, "siteId")
		if _, ok := parseUUID(w, siteID); !ok {
			return
		}
		var in patchSiteReq
		if err := decodeJSON(r, &in); err != nil {
			server.Error(w, http.StatusBadRequest, "validation_failed", "invalid body")
			return
		}
		site, err := d.Sites.UpdateSite(r.Context(), orgID(r), siteID, postgres.SiteUpdateInput{
			Name:          in.Name,
			Timezone:      in.Timezone,
			RetentionDays: in.RetentionDays,
			Settings:      in.Settings,
		})
		if err != nil {
			writeStoreError(w, err)
			return
		}
		// Any setting or name change might affect the ingest cache; safest to invalidate.
		d.SiteCache.Invalidate(site.PublicSiteID)
		writeJSON(w, http.StatusOK, toSiteResponse(site))
	}
}

func deleteSite(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		siteID := chi.URLParam(r, "siteId")
		if _, ok := parseUUID(w, siteID); !ok {
			return
		}
		// Fetch the site to know its public_site_id for cache invalidation.
		site, err := d.Sites.GetSiteByID(r.Context(), orgID(r), siteID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		if err := d.Sites.DeleteSite(r.Context(), orgID(r), siteID); err != nil {
			writeStoreError(w, err)
			return
		}
		d.SiteCache.Invalidate(site.PublicSiteID)
		w.WriteHeader(http.StatusNoContent)
	}
}

// NewPublicSiteID generates a `wb_<env>_<hex>` identifier. Public and
// embedded in trackers; not a secret.
func NewPublicSiteID(env string) string {
	var b [10]byte
	_, _ = rand.Read(b[:])
	return "wb_" + env + "_" + hex.EncodeToString(b[:])
}
