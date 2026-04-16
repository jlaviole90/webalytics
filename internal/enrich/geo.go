package enrich

import (
	"errors"
	"net"

	"github.com/oschwald/maxminddb-golang"
)

// Geo is the subset of GeoIP2 we keep.
type Geo struct {
	CountryCode string // ISO-3166-1 alpha-2
	Region      string // Largest subdivision
	City        string
}

// GeoResolver wraps a MaxMind reader. Open once at startup, close on shutdown.
// A nil *GeoResolver is safe — Lookup returns zero Geo.
type GeoResolver struct {
	db *maxminddb.Reader
}

// OpenGeo opens the given .mmdb file. Returns (nil, nil) for empty path so
// operators can run without a geo database (all events get empty geo).
func OpenGeo(path string) (*GeoResolver, error) {
	if path == "" {
		return nil, nil
	}
	db, err := maxminddb.Open(path)
	if err != nil {
		return nil, err
	}
	return &GeoResolver{db: db}, nil
}

// Close releases the underlying reader.
func (g *GeoResolver) Close() error {
	if g == nil || g.db == nil {
		return nil
	}
	return g.db.Close()
}

// Lookup returns the Geo for an IP string. Returns zero Geo (no error) on
// missing/invalid input so callers can unconditionally write the result.
func (g *GeoResolver) Lookup(ip string) Geo {
	if g == nil || g.db == nil {
		return Geo{}
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return Geo{}
	}
	var rec mmRecord
	if err := g.db.Lookup(parsed, &rec); err != nil {
		return Geo{}
	}
	var region string
	if len(rec.Subdivisions) > 0 {
		region = rec.Subdivisions[0].Names["en"]
	}
	return Geo{
		CountryCode: rec.Country.ISOCode,
		Region:      region,
		City:        rec.City.Names["en"],
	}
}

// mmRecord matches the MaxMind GeoLite2-City schema fields we read.
type mmRecord struct {
	Country struct {
		ISOCode string `maxminddb:"iso_code"`
	} `maxminddb:"country"`
	City struct {
		Names map[string]string `maxminddb:"names"`
	} `maxminddb:"city"`
	Subdivisions []struct {
		Names map[string]string `maxminddb:"names"`
	} `maxminddb:"subdivisions"`
}

// ErrNoGeoDB is returned by callers that explicitly require geo but got nil.
var ErrNoGeoDB = errors.New("no geoip database configured")
