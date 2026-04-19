package metadata

import (
	"sync"
	"time"
)

// SignalDedupe tracks recently emitted freshness signal fingerprints so the
// proxy does not repeatedly enqueue identical package metadata messages.
type SignalDedupe struct {
	mu    sync.Mutex
	ttl   time.Duration
	store map[string]time.Time
	now   func() time.Time
}

// NewSignalDedupe returns an initialized dedupe cache.
func NewSignalDedupe(ttl time.Duration) *SignalDedupe {
	d := &SignalDedupe{
		ttl:   ttl,
		store: make(map[string]time.Time),
		now:   time.Now,
	}
	go d.evictLoop()
	return d
}

// ShouldEmit records the fingerprint if it is new or expired and reports
// whether a corresponding freshness signal should be emitted.
func (d *SignalDedupe) ShouldEmit(fingerprint string) bool {
	now := d.now()

	d.mu.Lock()
	defer d.mu.Unlock()

	if seenAt, ok := d.store[fingerprint]; ok && now.Sub(seenAt) <= d.ttl {
		return false
	}
	d.store[fingerprint] = now
	return true
}

func (d *SignalDedupe) evictLoop() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		now := d.now()
		d.mu.Lock()
		for fingerprint, seenAt := range d.store {
			if now.Sub(seenAt) > d.ttl {
				delete(d.store, fingerprint)
			}
		}
		d.mu.Unlock()
	}
}
