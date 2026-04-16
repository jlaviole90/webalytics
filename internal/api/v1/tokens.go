package v1

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/webalytics/webalytics/internal/domain"
	"github.com/webalytics/webalytics/internal/server"
	"github.com/webalytics/webalytics/internal/storage/postgres"
)

type tokenResponse struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	SiteID     *string    `json:"site_id,omitempty"`
	Scopes     []string   `json:"scopes"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

type tokenCreatedResponse struct {
	tokenResponse
	Token string `json:"token"` // raw; shown once
}

func toTokenResponse(t *domain.APIToken) tokenResponse {
	var siteID *string
	if t.SiteID != nil {
		s := t.SiteID.String()
		siteID = &s
	}
	return tokenResponse{
		ID:        t.ID.String(),
		Name:      t.Name,
		SiteID:    siteID,
		Scopes:    t.Scopes,
		ExpiresAt: t.ExpiresAt,
		CreatedAt: t.CreatedAt,
	}
}

func listTokens(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tokens, err := d.Tokens.List(r.Context(), orgID(r))
		if err != nil {
			writeStoreError(w, err)
			return
		}
		out := make([]tokenResponse, 0, len(tokens))
		for i := range tokens {
			out = append(out, toTokenResponse(&tokens[i]))
		}
		writeJSON(w, http.StatusOK, out)
	}
}

type createTokenReq struct {
	Name      string     `json:"name"`
	SiteID    *string    `json:"site_id,omitempty"`
	Scopes    []string   `json:"scopes"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
}

func createToken(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in createTokenReq
		if err := decodeJSON(r, &in); err != nil {
			server.Error(w, http.StatusBadRequest, "validation_failed", "invalid body")
			return
		}
		if in.Name == "" || len(in.Scopes) == 0 {
			server.Error(w, http.StatusBadRequest, "validation_failed", "name and scopes are required")
			return
		}
		var siteID *uuid.UUID
		if in.SiteID != nil && *in.SiteID != "" {
			id, err := uuid.Parse(*in.SiteID)
			if err != nil {
				server.Error(w, http.StatusBadRequest, "validation_failed", "invalid site_id")
				return
			}
			siteID = &id
		}
		created, err := d.Tokens.Create(r.Context(), orgID(r), postgres.CreateTokenInput{
			Name:      in.Name,
			SiteID:    siteID,
			Scopes:    in.Scopes,
			ExpiresAt: in.ExpiresAt,
		})
		if err != nil {
			writeStoreError(w, err)
			return
		}
		resp := tokenCreatedResponse{
			tokenResponse: toTokenResponse(&created.Token),
			Token:         created.RawWire,
		}
		writeJSON(w, http.StatusCreated, resp)
	}
}

func revokeToken(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "tokenId")
		if _, ok := parseUUID(w, id); !ok {
			return
		}
		if err := d.Tokens.Revoke(r.Context(), orgID(r), id); err != nil {
			writeStoreError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
