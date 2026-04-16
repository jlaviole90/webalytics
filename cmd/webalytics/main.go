// Command webalytics runs the ingest + query HTTP service.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/redis/go-redis/v9"

	v1 "github.com/webalytics/webalytics/internal/api/v1"
	"github.com/webalytics/webalytics/internal/config"
	"github.com/webalytics/webalytics/internal/enrich"
	"github.com/webalytics/webalytics/internal/ingest"
	"github.com/webalytics/webalytics/internal/logger"
	"github.com/webalytics/webalytics/internal/server"
	chstore "github.com/webalytics/webalytics/internal/storage/clickhouse"
	pgstore "github.com/webalytics/webalytics/internal/storage/postgres"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "fatal:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := logger.New(cfg.Log.Level, cfg.Log.Format)
	log.Info("starting webalytics",
		slog.String("addr", cfg.HTTP.Addr),
		slog.String("log_level", cfg.Log.Level),
	)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Postgres
	pools, err := pgstore.Open(ctx, cfg.Postgres)
	if err != nil {
		return fmt.Errorf("postgres: %w", err)
	}
	defer pools.Close()

	// ClickHouse
	chConn, err := chstore.Open(ctx, cfg.ClickHouse)
	if err != nil {
		return fmt.Errorf("clickhouse: %w", err)
	}
	defer func() { _ = chConn.Close() }()

	// Redis (optional; rate limiter fails open without it)
	var rdb *redis.Client
	if cfg.Redis.Addr != "" {
		rdb = redis.NewClient(&redis.Options{
			Addr:     cfg.Redis.Addr,
			Password: cfg.Redis.Password,
			DB:       cfg.Redis.DB,
		})
		if err := rdb.Ping(ctx).Err(); err != nil {
			log.Warn("redis unreachable; rate limiting disabled", slog.String("err", err.Error()))
			rdb = nil
		}
	}

	// Storage handles
	tokenStore := pgstore.NewTokenStore(pools.App)
	siteStore := pgstore.NewSiteStore(pools.App)
	domainStore := pgstore.NewDomainStore(pools.App)
	eventDefStore := pgstore.NewEventDefStore(pools.App)
	ingestSiteStore := pgstore.NewIngestSiteStore(pools.Ingest)
	siteCache := pgstore.NewSiteCache(ingestSiteStore, 30*time.Second, 5*time.Second)
	statsStore := chstore.NewStatsStore(chConn)
	eventWriter := chstore.NewEventWriter(chConn)

	// Enricher
	geo, err := enrich.OpenGeo(cfg.GeoIPPath)
	if err != nil {
		log.Warn("geoip disabled", slog.String("err", err.Error()))
	} else {
		defer func() {
			if geo != nil {
				_ = geo.Close()
			}
		}()
	}
	enricher := &ingest.Enricher{
		Sessions: enrich.NewSessionHasher(cfg.SessionSaltBase, time.Now),
		UA:       enrich.NewUAParser(),
		Geo:      geo,
	}

	// Batcher
	batcher := ingest.NewBatchWriter(eventWriter, cfg.Ingest.BatchMaxRows, cfg.Ingest.BatchFlush, log)

	// Rate limiter
	limiter := ingest.NewRateLimiter(rdb, cfg.Ingest.RatePerIP, cfg.Ingest.RatePerSite)

	// Router
	r := chi.NewRouter()
	r.Use(chimw.RealIP)
	r.Use(server.RequestID)
	r.Use(server.Recovery(log))
	r.Use(server.AccessLog(log))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// /collect with permissive CORS (it's a public write endpoint).
	collectHandler := ingest.Handler(ingest.Dependencies{
		Sites:    siteCache,
		NotFound: pgstore.ErrNotFound,
		Enricher: enricher,
		Writer:   batcher,
		Limiter:  limiter,
		Log:      log,
	})
	r.Group(func(r chi.Router) {
		r.Use(cors.Handler(cors.Options{
			AllowedOrigins:   []string{"*"},
			AllowedMethods:   []string{"POST", "GET", "OPTIONS"},
			AllowedHeaders:   []string{"Content-Type"},
			AllowCredentials: false,
			MaxAge:           86400,
		}))
		r.Post("/collect", collectHandler)
		r.Get("/collect", collectHandler) // fallback for beacon-GET
		// Chi's router returns 405 for un-registered methods before middleware
		// runs, so we need an explicit OPTIONS handler for the cors middleware
		// to intercept preflight requests. The body never executes — cors
		// writes the 204 preflight response itself.
		r.Options("/collect", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNoContent)
		})
	})

	// /v1 authenticated surface
	r.Route("/v1", func(r chi.Router) {
		v1.Mount(r, v1.Deps{
			TokenResolver: tokenStore,
			Sites:         siteStore,
			Domains:       domainStore,
			Events:        eventDefStore,
			Tokens:        tokenStore,
			Stats:         statsStore,
			SiteCache:     siteCache,
		})
	})

	// Run
	srv := server.New(cfg.HTTP, r, log)
	runErr := make(chan error, 1)
	go func() { runErr <- srv.Run(ctx) }()

	select {
	case err := <-runErr:
		// Drain the batcher before returning.
		shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.HTTP.ShutdownTimeout)
		defer cancel()
		_ = batcher.Close(shutdownCtx)
		return err
	case <-ctx.Done():
		log.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.HTTP.ShutdownTimeout)
		defer cancel()
		_ = batcher.Close(shutdownCtx)
		return <-runErr
	}
}

