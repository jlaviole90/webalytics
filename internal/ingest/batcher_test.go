package ingest

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/webalytics/webalytics/internal/domain"
)

type fakeSink struct {
	mu       sync.Mutex
	batches  [][]domain.Event
	err      error
	calls    int32
	received int32
}

func (f *fakeSink) InsertEvents(_ context.Context, events []domain.Event) error {
	atomic.AddInt32(&f.calls, 1)
	atomic.AddInt32(&f.received, int32(len(events)))
	f.mu.Lock()
	dup := make([]domain.Event, len(events))
	copy(dup, events)
	f.batches = append(f.batches, dup)
	f.mu.Unlock()
	return f.err
}

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, &slog.HandlerOptions{Level: slog.LevelError}))
}

func TestBatcher_FlushesOnMaxRows(t *testing.T) {
	sink := &fakeSink{}
	// flushEvery large so size is the only trigger
	bw := NewBatchWriter(sink, 3, time.Hour, quietLogger())
	defer bw.Close(context.Background())

	bw.Submit(domain.Event{EventName: "a"})
	bw.Submit(domain.Event{EventName: "b"})
	bw.Submit(domain.Event{EventName: "c"})

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if atomic.LoadInt32(&sink.received) >= 3 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := atomic.LoadInt32(&sink.received); got != 3 {
		t.Fatalf("received = %d, want 3", got)
	}
}

func TestBatcher_FlushesOnTicker(t *testing.T) {
	sink := &fakeSink{}
	bw := NewBatchWriter(sink, 1000, 20*time.Millisecond, quietLogger())
	defer bw.Close(context.Background())

	bw.Submit(domain.Event{EventName: "only"})

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if atomic.LoadInt32(&sink.received) > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := atomic.LoadInt32(&sink.received); got != 1 {
		t.Fatalf("received = %d, want 1", got)
	}
}

func TestBatcher_CloseDrains(t *testing.T) {
	sink := &fakeSink{}
	bw := NewBatchWriter(sink, 1000, time.Hour, quietLogger())

	for i := 0; i < 5; i++ {
		bw.Submit(domain.Event{EventName: "x"})
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := bw.Close(ctx); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if got := atomic.LoadInt32(&sink.received); got != 5 {
		t.Fatalf("received = %d, want 5", got)
	}

	// After close, Submit should be a no-op.
	bw.Submit(domain.Event{EventName: "post-close"})
	if got := atomic.LoadInt32(&sink.received); got != 5 {
		t.Fatalf("after close received = %d, want 5", got)
	}
}

func TestBatcher_SwallowsSinkErrors(t *testing.T) {
	sink := &fakeSink{err: errors.New("boom")}
	bw := NewBatchWriter(sink, 2, time.Hour, quietLogger())
	defer bw.Close(context.Background())

	bw.Submit(domain.Event{EventName: "a"})
	bw.Submit(domain.Event{EventName: "b"})

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if atomic.LoadInt32(&sink.calls) > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if atomic.LoadInt32(&sink.calls) == 0 {
		t.Fatal("sink never called")
	}
	// Subsequent Submits should still work (the writer must not deadlock/panic).
	bw.Submit(domain.Event{EventName: "c"})
}
