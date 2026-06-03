package metadata

import (
	"time"

	"github.com/getcustoms/proxy/internal/proxycache"
)

// AckKey identifies a control-plane metadata acknowledgement. Version is
// empty for package-latest-metadata acks and populated for used-version acks.
type AckKey struct {
	Ecosystem string
	Package   string
	Version   string
}

type ackEntry struct {
	Fingerprint string
	AckedAt     time.Time
}

// AckCache tracks which metadata fingerprints the control plane has
// acknowledged so the proxy can skip redundant submits.
type AckCache struct {
	inner *proxycache.Cache[AckKey, ackEntry]
	now   func() time.Time
}

// NewAckCache returns an initialized ACK fingerprint cache.
func NewAckCache(ttl time.Duration) *AckCache {
	return newAckCacheWithClock(ttl, time.Now)
}

// newAckCacheWithClock is the testing seam — production callers use NewAckCache.
func newAckCacheWithClock(ttl time.Duration, now func() time.Time) *AckCache {
	return &AckCache{
		inner: proxycache.New[AckKey, ackEntry](
			proxycache.WithStaticTTL[AckKey, ackEntry](ttl),
			proxycache.WithClock[AckKey, ackEntry](now),
			proxycache.WithCachedAtFunc[AckKey, ackEntry](func(e ackEntry) time.Time { return e.AckedAt }),
		),
		now: now,
	}
}

// IsAcked returns true when the cache holds a fresh ack for the same
// fingerprint. An empty fingerprint never matches.
func (c *AckCache) IsAcked(key AckKey, fingerprint string) bool {
	if fingerprint == "" {
		return false
	}
	entry, ok := c.inner.Get(key)
	if !ok {
		return false
	}
	return entry.Fingerprint == fingerprint
}

// RecordAck stores the most recent acknowledged fingerprint for the key.
func (c *AckCache) RecordAck(key AckKey, fingerprint string) {
	if fingerprint == "" {
		return
	}
	c.inner.Set(key, ackEntry{
		Fingerprint: fingerprint,
		AckedAt:     c.now(),
	})
}
