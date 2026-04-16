package ingest

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/webalytics/webalytics/internal/domain"
)

// EventSink is the minimal interface the batcher needs to persist events.
// Implemented by internal/storage/clickhouse.InsertEvents.
type EventSink interface {
	InsertEvents(ctx context.Context, events []domain.Event) error
}

// BatchWriter buffers domain.Event values and flushes them to a sink on the
// first of: maxRows reached, flushEvery elapsed, or Close() called.
//
// It is safe for concurrent Submit; it is not safe to Close while writers
// are still calling Submit.
type BatchWriter struct {
	sink       EventSink
	maxRows    int
	flushEvery time.Duration
	log        *slog.Logger

	mu     sync.Mutex
	buf    []domain.Event
	closed bool

	trigger chan struct{}
	done    chan struct{}
}

// NewBatchWriter starts the flush loop and returns the writer. Call Close
// to drain on shutdown.
func NewBatchWriter(sink EventSink, maxRows int, flushEvery time.Duration, log *slog.Logger) *BatchWriter {
	if maxRows <= 0 {
		maxRows = 500
	}
	if flushEvery <= 0 {
		flushEvery = 250 * time.Millisecond
	}
	b := &BatchWriter{
		sink:       sink,
		maxRows:    maxRows,
		flushEvery: flushEvery,
		log:        log,
		buf:        make([]domain.Event, 0, maxRows),
		trigger:    make(chan struct{}, 1),
		done:       make(chan struct{}),
	}
	go b.loop()
	return b
}

// Submit appends one event. Never blocks except briefly under lock.
// Returns immediately; errors during flush are logged, not propagated.
func (b *BatchWriter) Submit(ev domain.Event) {
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return
	}
	b.buf = append(b.buf, ev)
	full := len(b.buf) >= b.maxRows
	b.mu.Unlock()
	if full {
		select {
		case b.trigger <- struct{}{}:
		default:
		}
	}
}

// Close stops accepting new events and flushes what remains.
func (b *BatchWriter) Close(ctx context.Context) error {
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return nil
	}
	b.closed = true
	b.mu.Unlock()
	// signal the loop to drain and exit
	select {
	case b.trigger <- struct{}{}:
	default:
	}
	select {
	case <-b.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (b *BatchWriter) loop() {
	defer close(b.done)
	t := time.NewTicker(b.flushEvery)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			b.flush()
		case <-b.trigger:
			b.flush()
		}
		b.mu.Lock()
		closed, remaining := b.closed, len(b.buf)
		b.mu.Unlock()
		if closed && remaining == 0 {
			return
		}
	}
}

func (b *BatchWriter) flush() {
	b.mu.Lock()
	if len(b.buf) == 0 {
		b.mu.Unlock()
		return
	}
	batch := b.buf
	b.buf = make([]domain.Event, 0, b.maxRows)
	b.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := b.sink.InsertEvents(ctx, batch); err != nil {
		// We deliberately don't retry in memory — the tracker is fire-and-forget
		// and we'd rather lose a batch than grow unbounded under a ClickHouse
		// outage. Alerting on insert failure rate is handled by the metrics
		// counter in the caller.
		b.log.Error("batch flush failed",
			slog.Int("rows", len(batch)),
			slog.String("err", err.Error()),
		)
		return
	}
	b.log.Debug("batch flushed", slog.Int("rows", len(batch)))
}
