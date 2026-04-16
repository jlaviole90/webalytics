// Package enrich converts raw collect payloads + request context into fully
// populated domain.Event rows.
//
// All identity operations happen here. No IP or raw UA is ever written to
// ClickHouse; we keep the first 16 bytes of an HMAC and throw everything else
// away before the event leaves this package.
package enrich

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"time"
)

// SessionHasher derives stable 16-byte session identifiers from
// (site, ip, ua, rotating-daily-salt).
//
// The "rotating daily salt" is derived from the current UTC date plus a
// process-wide base salt, so the id is unlinkable across days without
// requiring any persistent rotation machinery.
type SessionHasher struct {
	baseSalt []byte
	now      func() time.Time
}

// NewSessionHasher returns a hasher that reads the current time from now.
// Pass time.Now in production.
func NewSessionHasher(baseSalt string, now func() time.Time) *SessionHasher {
	if now == nil {
		now = time.Now
	}
	return &SessionHasher{baseSalt: []byte(baseSalt), now: now}
}

// Hash computes the current day's session id for this (site, ip, ua) triple.
// Returns a 16-byte prefix of HMAC-SHA256.
func (h *SessionHasher) Hash(siteID, ip, ua string) [16]byte {
	key := h.dailyKey()
	mac := hmac.New(sha256.New, key)
	// Fixed-order fields, length-prefixed so concatenation isn't ambiguous.
	writeLP(mac, siteID)
	writeLP(mac, ip)
	writeLP(mac, ua)
	sum := mac.Sum(nil)

	var out [16]byte
	copy(out[:], sum[:16])
	return out
}

// dailyKey returns baseSalt || ASCII(YYYYMMDD UTC).
func (h *SessionHasher) dailyKey() []byte {
	t := h.now().UTC()
	date := t.Format("20060102")
	key := make([]byte, 0, len(h.baseSalt)+len(date))
	key = append(key, h.baseSalt...)
	key = append(key, date...)
	return key
}

func writeLP(w interface {
	Write(p []byte) (int, error)
}, s string) {
	var lenbuf [4]byte
	binary.BigEndian.PutUint32(lenbuf[:], uint32(len(s)))
	_, _ = w.Write(lenbuf[:])
	_, _ = w.Write([]byte(s))
}
