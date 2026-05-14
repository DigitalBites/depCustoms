package pkgmeta

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/getcustoms/proxy/internal/metadata"
	"github.com/getcustoms/proxy/internal/wal"
)

type RefreshMode string

const (
	RefreshModeCacheHit      RefreshMode = "cache_hit"
	RefreshModeSync          RefreshMode = "sync"
	RefreshModeAsyncFallback RefreshMode = "async_fallback"
	RefreshModeFailed        RefreshMode = "failed"
)

type Refresher struct {
	Adapter           Adapter
	Cache             *metadata.Cache
	WAL               *wal.WAL
	Dedupe            *metadata.SignalDedupe
	SyncTimeout       time.Duration
	BackgroundTimeout time.Duration

	mu       sync.Mutex
	inflight map[string]*refreshCall
}

type refreshCall struct {
	done    chan struct{}
	summary metadata.Summary
	err     error
}

func (r *Refresher) Refresh(ctx context.Context, pkg string) RefreshMode {
	if r == nil || r.Adapter == nil || r.Cache == nil || pkg == "" {
		return RefreshModeFailed
	}

	key := metadata.CacheKey{Ecosystem: r.Adapter.Ecosystem(), Package: pkg}
	if _, state, found := r.Cache.Get(key); found && state == metadata.LookupStateHit {
		slog.Debug("package metadata refresh skipped",
			"service", "proxy",
			"ecosystem", key.Ecosystem,
			"package", key.Package,
			"refresh_mode", RefreshModeCacheHit,
			"cache_status", state,
		)
		return RefreshModeCacheHit
	}

	call, started := r.call(pkg)
	if !started {
		slog.Debug("package metadata refresh joined",
			"service", "proxy",
			"ecosystem", key.Ecosystem,
			"package", key.Package,
		)
	}

	syncTimeout := r.SyncTimeout
	if syncTimeout <= 0 {
		syncTimeout = 3 * time.Second
	}
	timer := time.NewTimer(syncTimeout)
	defer timer.Stop()

	select {
	case <-call.done:
		if call.err != nil {
			slog.Warn("package metadata refresh failed",
				"service", "proxy",
				"ecosystem", key.Ecosystem,
				"package", key.Package,
				"refresh_mode", RefreshModeFailed,
				"error", call.err.Error(),
			)
			return RefreshModeFailed
		}
		slog.Debug("package metadata refresh completed",
			"service", "proxy",
			"ecosystem", key.Ecosystem,
			"package", key.Package,
			"refresh_mode", RefreshModeSync,
		)
		return RefreshModeSync
	case <-timer.C:
		slog.Warn("package metadata refresh sync timeout",
			"service", "proxy",
			"ecosystem", key.Ecosystem,
			"package", key.Package,
			"refresh_mode", RefreshModeAsyncFallback,
			"threshold_ms", syncTimeout.Milliseconds(),
		)
		return RefreshModeAsyncFallback
	case <-ctx.Done():
		return RefreshModeAsyncFallback
	}
}

func (r *Refresher) call(pkg string) (*refreshCall, bool) {
	key := r.Adapter.Ecosystem() + "|" + pkg

	r.mu.Lock()
	if r.inflight == nil {
		r.inflight = make(map[string]*refreshCall)
	}
	if call, ok := r.inflight[key]; ok {
		r.mu.Unlock()
		return call, false
	}

	call := &refreshCall{done: make(chan struct{})}
	r.inflight[key] = call
	r.mu.Unlock()

	go r.run(key, pkg, call)
	return call, true
}

func (r *Refresher) run(key string, pkg string, call *refreshCall) {
	defer func() {
		r.mu.Lock()
		delete(r.inflight, key)
		r.mu.Unlock()
		close(call.done)
	}()

	timeout := r.BackgroundTimeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	call.summary, call.err = r.Adapter.FetchSummary(ctx, pkg)
	if call.err != nil {
		return
	}

	cacheKey := metadata.CacheKey{
		Ecosystem: r.Adapter.Ecosystem(),
		Package:   pkg,
	}
	r.Cache.Set(cacheKey, call.summary)
	r.emitLatestMetadataSignal(call.summary)
}

func (r *Refresher) emitLatestMetadataSignal(summary metadata.Summary) {
	if r.WAL == nil {
		return
	}

	fingerprint := LatestMetadataFingerprint(summary)
	if r.Dedupe != nil && !r.Dedupe.ShouldEmit(fingerprint) {
		return
	}

	record, err := NewLatestMetadataRecord(summary)
	if err != nil {
		slog.Warn("failed to marshal package latest metadata",
			"service", "proxy",
			"ecosystem", summary.Ecosystem,
			"package", summary.Package,
			"error", err.Error(),
		)
		return
	}

	if r.WAL.EnqueueAdvisoryRecord(record) {
		slog.Debug("package metadata refresh signal queued",
			"service", "proxy",
			"ecosystem", summary.Ecosystem,
			"package", summary.Package,
		)
		return
	}

	slog.Warn("WAL advisory record queue full; dropping record",
		"service", "proxy",
		"record_type", record.RecordType,
	)
}
