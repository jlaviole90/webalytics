package server

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/webalytics/webalytics/internal/config"
)

// Server wraps *http.Server with lifecycle helpers.
type Server struct {
	http *http.Server
	log  *slog.Logger
	cfg  config.HTTPConfig
}

// New builds a *Server from a router and the HTTP config.
func New(cfg config.HTTPConfig, handler http.Handler, log *slog.Logger) *Server {
	return &Server{
		cfg: cfg,
		log: log,
		http: &http.Server{
			Addr:         cfg.Addr,
			Handler:      handler,
			ReadTimeout:  cfg.ReadTimeout,
			WriteTimeout: cfg.WriteTimeout,
			// Note: no IdleTimeout; chi sets reasonable defaults.
		},
	}
}

// Run starts the server and blocks until ctx is canceled, then gracefully
// shuts down within the configured shutdown timeout.
func (s *Server) Run(ctx context.Context) error {
	errCh := make(chan error, 1)
	go func() {
		s.log.Info("http listening", slog.String("addr", s.cfg.Addr))
		if err := s.http.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		s.log.Info("shutdown signal received, draining")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), s.cfg.ShutdownTimeout)
		defer cancel()
		if err := s.http.Shutdown(shutdownCtx); err != nil {
			return err
		}
		// Drain any remaining error
		select {
		case err := <-errCh:
			return err
		case <-time.After(100 * time.Millisecond):
			return nil
		}
	}
}
