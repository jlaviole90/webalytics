package clickhouse

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestBuildFilterSQL_MinimumClause(t *testing.T) {
	org := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	site := uuid.MustParse("00000000-0000-0000-0000-000000000002")
	w := TimeWindow{
		From: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
		To:   time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC),
	}
	where, args := buildFilterSQL(org, site, w, Filters{})

	wantSubs := []string{
		"organization_id = ?",
		"site_id = ?",
		"ts >= ?",
		"ts < ?",
	}
	for _, s := range wantSubs {
		if !strings.Contains(where, s) {
			t.Errorf("missing %q in %q", s, where)
		}
	}
	if got := strings.Count(where, " AND "); got != 3 {
		t.Errorf("with no filters expected 3 ANDs, got %d in %q", got, where)
	}
	if len(args) != 4 {
		t.Errorf("args len = %d, want 4: %v", len(args), args)
	}
	if args[0] != org || args[1] != site || args[2] != w.From || args[3] != w.To {
		t.Errorf("args out of order: %v", args)
	}
}

func TestBuildFilterSQL_AppendsFiltersInOrder(t *testing.T) {
	org := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	site := uuid.MustParse("00000000-0000-0000-0000-000000000002")
	w := TimeWindow{
		From: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
		To:   time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC),
	}
	f := Filters{
		Hostnames: []string{"a.com", "b.com"},
		Countries: []string{"US"},
		Events:    []string{"pageview"},
	}
	where, args := buildFilterSQL(org, site, w, f)

	if !strings.Contains(where, "hostname IN (?,?)") {
		t.Errorf("expected multi-value IN for hostname; got %q", where)
	}
	if !strings.Contains(where, "country_code IN (?)") {
		t.Errorf("expected single-value IN for country; got %q", where)
	}
	if !strings.Contains(where, "event_name IN (?)") {
		t.Errorf("expected IN for event_name; got %q", where)
	}
	// Positional args must match the clause order the builder emits.
	// The builder inserts hostname before country before event; that's what
	// callers rely on.
	wantTail := []any{"a.com", "b.com", "US", "pageview"}
	got := args[4:]
	if len(got) != len(wantTail) {
		t.Fatalf("tail args = %v, want %v", got, wantTail)
	}
	for i := range got {
		if got[i] != wantTail[i] {
			t.Errorf("arg[%d] = %v, want %v", i, got[i], wantTail[i])
		}
	}
}

func TestBuildFilterSQL_IgnoresEmptySlices(t *testing.T) {
	org := uuid.New()
	site := uuid.New()
	w := TimeWindow{From: time.Now(), To: time.Now().Add(time.Hour)}

	where, args := buildFilterSQL(org, site, w, Filters{
		Hostnames: []string{},
		Paths:     nil,
	})
	if strings.Contains(where, "hostname") || strings.Contains(where, "url_path") {
		t.Errorf("empty slices should not add clauses; got %q", where)
	}
	if len(args) != 4 {
		t.Errorf("args = %v", args)
	}
}
