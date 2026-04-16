package v1

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/webalytics/webalytics/internal/domain"
	"github.com/webalytics/webalytics/internal/server"
)

type domainResponse struct {
	ID         string     `json:"id"`
	SiteID     string     `json:"site_id"`
	Hostname   string     `json:"hostname"`
	IsPrimary  bool       `json:"is_primary"`
	VerifiedAt *time.Time `json:"verified_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

func toDomainResponse(d *domain.Domain) domainResponse {
	return domainResponse{
		ID:         d.ID.String(),
		SiteID:     d.SiteID.String(),
		Hostname:   d.Hostname,
		IsPrimary:  d.IsPrimary,
		VerifiedAt: d.VerifiedAt,
		CreatedAt:  d.CreatedAt,
	}
}

func listDomains(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		siteID := chi.URLParam(r, "siteId")
		if _, ok := parseUUID(w, siteID); !ok {
			return
		}
		doms, err := d.Domains.ListBySite(r.Context(), orgID(r), siteID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		out := make([]domainResponse, 0, len(doms))
		for i := range doms {
			out = append(out, toDomainResponse(&doms[i]))
		}
		writeJSON(w, http.StatusOK, out)
	}
}

type createDomainReq struct {
	Hostname  string `json:"hostname"`
	IsPrimary bool   `json:"is_primary"`
}

func createDomain(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		siteID := chi.URLParam(r, "siteId")
		if _, ok := parseUUID(w, siteID); !ok {
			return
		}
		var in createDomainReq
		if err := decodeJSON(r, &in); err != nil || in.Hostname == "" {
			server.Error(w, http.StatusBadRequest, "validation_failed", "hostname is required")
			return
		}
		created, err := d.Domains.Create(r.Context(), orgID(r), siteID, in.Hostname, in.IsPrimary)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		// A new hostname invalidates the ingest cache for the site's public id.
		// We don't have the public id here; cheapest option is to let the cache
		// entry expire by its TTL, which is short by design.
		writeJSON(w, http.StatusCreated, toDomainResponse(created))
	}
}

func deleteDomain(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		siteID := chi.URLParam(r, "siteId")
		domID := chi.URLParam(r, "domainId")
		if _, ok := parseUUID(w, siteID); !ok {
			return
		}
		if _, ok := parseUUID(w, domID); !ok {
			return
		}
		if err := d.Domains.Delete(r.Context(), orgID(r), siteID, domID); err != nil {
			writeStoreError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
