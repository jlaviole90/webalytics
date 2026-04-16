package ingest

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// RateLimiter implements a fixed-window-per-second counter keyed on (scope, bucket).
// Two limits matter for /collect:
//   - perIP:   protects the origin from a single bad actor, even when valid site_id
//   - perSite: protects the pipeline from an individual site blowing the batcher
//
// Fixed windows are fine here because the goal is graceful backpressure, not
// precise throughput regulation; the lost accuracy at window boundaries is
// immaterial for a drop-and-ignore policy.
type RateLimiter struct {
	rdb         *redis.Client
	perIPLimit  int
	perSiteLim  int
}

// NewRateLimiter wraps a redis client with the configured per-IP / per-site caps.
// Pass perIP <= 0 or perSite <= 0 to disable that dimension.
func NewRateLimiter(rdb *redis.Client, perIP, perSite int) *RateLimiter {
	return &RateLimiter{rdb: rdb, perIPLimit: perIP, perSiteLim: perSite}
}

// Allow reports whether a request from (siteID, ip) is under both caps.
// When redis is unavailable we fail open: a monitoring system is a better
// signal than silently dropping production traffic.
func (r *RateLimiter) Allow(ctx context.Context, siteID, ip string) (bool, error) {
	if r == nil || r.rdb == nil {
		return true, nil
	}
	now := time.Now().Unix()
	if r.perIPLimit > 0 && ip != "" {
		ok, err := r.incr(ctx, fmt.Sprintf("rl:ip:%s:%d", ip, now), r.perIPLimit)
		if err != nil {
			return true, err // fail open
		}
		if !ok {
			return false, nil
		}
	}
	if r.perSiteLim > 0 && siteID != "" {
		ok, err := r.incr(ctx, fmt.Sprintf("rl:site:%s:%d", siteID, now), r.perSiteLim)
		if err != nil {
			return true, err
		}
		if !ok {
			return false, nil
		}
	}
	return true, nil
}

// incr bumps the counter and returns whether we're still under limit.
// The key lives for 2s so the window can overlap safely.
func (r *RateLimiter) incr(ctx context.Context, key string, limit int) (bool, error) {
	pipe := r.rdb.TxPipeline()
	n := pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, 2*time.Second)
	if _, err := pipe.Exec(ctx); err != nil {
		return false, err
	}
	return n.Val() <= int64(limit), nil
}
