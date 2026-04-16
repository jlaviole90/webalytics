// Package logger wraps log/slog with opinionated defaults for this service.
package logger

import (
	"io"
	"log/slog"
	"os"
	"strings"
)

// New returns a configured *slog.Logger.
//
// format = "json" | "text" (anything else falls back to json)
// level  = "debug" | "info" | "warn" | "error"
func New(level, format string) *slog.Logger {
	return newWith(os.Stdout, level, format)
}

func newWith(w io.Writer, level, format string) *slog.Logger {
	opts := &slog.HandlerOptions{Level: parseLevel(level)}

	var h slog.Handler
	if strings.EqualFold(format, "text") {
		h = slog.NewTextHandler(w, opts)
	} else {
		h = slog.NewJSONHandler(w, opts)
	}
	return slog.New(h)
}

func parseLevel(s string) slog.Level {
	switch strings.ToLower(s) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
