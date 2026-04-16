// Package config loads service configuration from environment variables.
//
// The canonical set of variables lives in .env.example at the repo root.
// We use caarlos0/env because it's ~100 lines of code, struct-tag driven,
// and doesn't pull in the world like viper does.
package config

import (
	"fmt"
	"time"

	"github.com/caarlos0/env/v11"
)

// Config is the top-level service configuration.
type Config struct {
	HTTP       HTTPConfig       `envPrefix:"HTTP_"`
	Log        LogConfig        `envPrefix:"LOG_"`
	Postgres   PostgresConfig   `envPrefix:"POSTGRES_"`
	ClickHouse ClickHouseConfig `envPrefix:"CLICKHOUSE_"`
	Redis      RedisConfig      `envPrefix:"REDIS_"`
	Ingest     IngestConfig     `envPrefix:"INGEST_"`
	GeoIPPath  string           `env:"GEOIP_DB_PATH"`
	SessionSaltBase string       `env:"SESSION_SALT_BASE,notEmpty"`
}

type HTTPConfig struct {
	Addr            string        `env:"ADDR"            envDefault:":8080"`
	ReadTimeout     time.Duration `env:"READ_TIMEOUT"    envDefault:"15s"`
	WriteTimeout    time.Duration `env:"WRITE_TIMEOUT"   envDefault:"15s"`
	ShutdownTimeout time.Duration `env:"SHUTDOWN_TIMEOUT" envDefault:"30s"`
}

type LogConfig struct {
	Level  string `env:"LEVEL"  envDefault:"info"`
	Format string `env:"FORMAT" envDefault:"json"`
}

type PostgresConfig struct {
	AppDSN    string `env:"APP_DSN,notEmpty"`
	IngestDSN string `env:"INGEST_DSN,notEmpty"`
	MaxConns  int32  `env:"MAX_CONNS" envDefault:"20"`
}

type ClickHouseConfig struct {
	Addr     string `env:"ADDR,notEmpty"`
	Database string `env:"DATABASE" envDefault:"webalytics"`
	User     string `env:"USER"     envDefault:"default"`
	Password string `env:"PASSWORD"`
}

type RedisConfig struct {
	Addr     string `env:"ADDR,notEmpty"`
	Password string `env:"PASSWORD"`
	DB       int    `env:"DB" envDefault:"0"`
}

type IngestConfig struct {
	BatchMaxRows int           `env:"BATCH_MAX_ROWS" envDefault:"500"`
	BatchFlush   time.Duration `env:"BATCH_FLUSH_MS" envDefault:"250ms"`
	RatePerIP    int           `env:"RATE_PER_IP"    envDefault:"50"`
	RatePerSite  int           `env:"RATE_PER_SITE"  envDefault:"500"`
}

// Load reads the environment and returns a validated Config.
func Load() (Config, error) {
	var c Config
	if err := env.Parse(&c); err != nil {
		return Config{}, fmt.Errorf("parse config: %w", err)
	}
	if err := c.validate(); err != nil {
		return Config{}, fmt.Errorf("validate config: %w", err)
	}
	return c, nil
}

func (c Config) validate() error {
	if len(c.SessionSaltBase) < 16 {
		return fmt.Errorf("SESSION_SALT_BASE must be at least 16 characters")
	}
	if c.Ingest.BatchMaxRows < 1 {
		return fmt.Errorf("INGEST_BATCH_MAX_ROWS must be >= 1")
	}
	return nil
}
