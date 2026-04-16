package postgres

import (
	"context"
	"sync"
	"time"

	"github.com/webalytics/webalytics/internal/domain"
)

// SiteCache wraps IngestSiteStore with a short in-memory TTL so the ingest
// hot path doesn't round-trip to Postgres on every request.
//
// Cache entries live for ttl. A nil "not found" is also cached (briefly) to
// prevent amplification when a scraper throws random site IDs at us.
type SiteCache struct {
	store *IngestSiteStore
	ttl   time.Duration
	neg   time.Duration

	mu      sync.RWMutex
	entries map[string]cacheEntry
}

type cacheEntry struct {
	value     *domain.SiteWithDomains
	expiresAt time.Time
	found     bool
}

// NewSiteCache returns a cache with a positive TTL (found) and a shorter
// negative TTL (not found).
func NewSiteCache(store *IngestSiteStore, ttl, negativeTTL time.Duration) *SiteCache {
	return &SiteCache{
		store:   store,
		ttl:     ttl,
		neg:     negativeTTL,
		entries: make(map[string]cacheEntry, 128),
	}
}

// Lookup returns the site or ErrNotFound, reading from cache where possible.
func (c *SiteCache) Lookup(ctx context.Context, publicSiteID string) (*domain.SiteWithDomains, error) {
	if e, ok := c.get(publicSiteID); ok {
		if e.found {
			return e.value, nil
		}
		return nil, ErrNotFound
	}
	v, err := c.store.LookupByPublicID(ctx, publicSiteID)
	if err != nil {
		if err == ErrNotFound {
			c.put(publicSiteID, nil, false, c.neg)
		}
		return nil, err
	}
	c.put(publicSiteID, v, true, c.ttl)
	return v, nil
}

// Invalidate removes a cached entry (call after control-plane updates).
func (c *SiteCache) Invalidate(publicSiteID string) {
	c.mu.Lock()
	delete(c.entries, publicSiteID)
	c.mu.Unlock()
}

func (c *SiteCache) get(k string) (cacheEntry, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	e, ok := c.entries[k]
	if !ok || time.Now().After(e.expiresAt) {
		return cacheEntry{}, false
	}
	return e, true
}

func (c *SiteCache) put(k string, v *domain.SiteWithDomains, found bool, ttl time.Duration) {
	c.mu.Lock()
	c.entries[k] = cacheEntry{value: v, found: found, expiresAt: time.Now().Add(ttl)}
	c.mu.Unlock()
}
