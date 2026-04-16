//go:build e2e
// +build e2e

// End-to-end test for the full webalytics stack. Assumes `make up && make seed`
// has been run — the seed script writes deploy/.seeded.env which we source here.
//
// The test exercises the hot path end-to-end:
//   1. POSTs a pageview to /collect (twice, different paths)
//   2. POSTs a web_vital
//   3. Polls /v1/sites/{id}/stats/realtime until we see the expected traffic
//
// We allow a generous poll window because ClickHouse materialized views take
// a moment to catch up after a batched insert.
package e2e

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

type env struct {
	Host      string
	SiteID    string
	SiteUUID  string
	Token     string
}

func loadEnv(t *testing.T) env {
	t.Helper()
	// Try environment first, then fall back to deploy/.seeded.env.
	e := env{
		Host:     os.Getenv("WEBALYTICS_HOST"),
		SiteID:   os.Getenv("WEBALYTICS_SITE_ID"),
		SiteUUID: os.Getenv("WEBALYTICS_ORG_SITE_UUID"),
		Token:    os.Getenv("WEBALYTICS_TOKEN"),
	}
	if e.Host == "" || e.SiteID == "" || e.Token == "" {
		b, err := os.ReadFile("../../deploy/.seeded.env")
		if err != nil {
			t.Skipf("no seeded env found; run `make up && make seed` first: %v", err)
		}
		for _, line := range strings.Split(string(b), "\n") {
			k, v, ok := strings.Cut(line, "=")
			if !ok {
				continue
			}
			switch k {
			case "WEBALYTICS_HOST":
				e.Host = v
			case "WEBALYTICS_SITE_ID":
				e.SiteID = v
			case "WEBALYTICS_ORG_SITE_UUID":
				e.SiteUUID = v
			case "WEBALYTICS_TOKEN":
				e.Token = v
			}
		}
	}
	if e.Host == "" || e.SiteID == "" || e.SiteUUID == "" || e.Token == "" {
		t.Fatalf("missing seeded env vars: %+v", e)
	}
	return e
}

func TestCollectAndRealtime(t *testing.T) {
	e := loadEnv(t)
	client := &http.Client{Timeout: 5 * time.Second}

	// 1. Fire three events (two pageviews + one web vital) from a recognized hostname.
	events := []map[string]any{
		{
			"site_id": e.SiteID,
			"event":   "pageview",
			"url":     "http://localhost/blog/hello",
			"title":   "Hello",
		},
		{
			"site_id": e.SiteID,
			"event":   "pageview",
			"url":     "http://localhost/about",
			"title":   "About",
		},
		{
			"site_id": e.SiteID,
			"event":   "web_vital",
			"url":     "http://localhost/blog/hello",
			"vital": map[string]any{
				"name":  "LCP",
				"value": 1500.0,
			},
		},
	}
	for _, body := range events {
		b, _ := json.Marshal(body)
		req, _ := http.NewRequest(http.MethodPost, e.Host+"/collect?debug=1", bytes.NewReader(b))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", "http://localhost")
		req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("collect: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("collect status = %d, want 204", resp.StatusCode)
		}
		if reason := resp.Header.Get("X-Webalytics-Debug"); reason != "ok" {
			t.Fatalf("collect reason = %q, want ok", reason)
		}
	}

	// 2. Poll realtime until we see > 0 online sessions (ClickHouse is eventually consistent).
	deadline := time.Now().Add(15 * time.Second)
	var online int64
	for time.Now().Before(deadline) {
		req, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("%s/v1/sites/%s/stats/realtime", e.Host, e.SiteUUID), nil)
		req.Header.Set("Authorization", "Bearer "+e.Token)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("realtime: %v", err)
		}
		var rt struct {
			Online int64 `json:"online"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&rt)
		resp.Body.Close()
		if rt.Online > 0 {
			online = rt.Online
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if online == 0 {
		t.Fatalf("realtime never reported online > 0 within deadline")
	}
	t.Logf("realtime online = %d", online)
}

func TestCollectUnknownSiteIsSilentlyDropped(t *testing.T) {
	e := loadEnv(t)
	client := &http.Client{Timeout: 5 * time.Second}
	body, _ := json.Marshal(map[string]any{
		"site_id": "wb_live_thisdoesnotexist12345",
		"event":   "pageview",
		"url":     "http://localhost/",
	})
	req, _ := http.NewRequest(http.MethodPost, e.Host+"/collect?debug=1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://localhost")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh)")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("collect: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 even for unknown site", resp.StatusCode)
	}
	if reason := resp.Header.Get("X-Webalytics-Debug"); reason != "site_unknown" {
		t.Fatalf("reason = %q, want site_unknown", reason)
	}
}

func TestV1RequiresBearer(t *testing.T) {
	e := loadEnv(t)
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(e.Host + "/v1/sites")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", resp.StatusCode)
	}
}

func TestV1ListSites(t *testing.T) {
	e := loadEnv(t)
	client := &http.Client{Timeout: 5 * time.Second}
	req, _ := http.NewRequest(http.MethodGet, e.Host+"/v1/sites", nil)
	req.Header.Set("Authorization", "Bearer "+e.Token)
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var body struct {
		Items []map[string]any `json:"items"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if len(body.Items) == 0 {
		t.Fatalf("no sites returned; expected at least the seeded one")
	}
}
