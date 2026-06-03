// Package metadata provides proxy-local caches for package freshness summaries
// and freshness-signal dedupe state.
package metadata

import (
	"time"

	"github.com/getcustoms/proxy/internal/proxycache"
	"github.com/getcustoms/proxy/internal/taxonomy"
)

type LookupState string

const (
	LookupStateMiss  LookupState = taxonomy.MetadataCacheStatusMiss
	LookupStateHit   LookupState = taxonomy.MetadataCacheStatusHit
	LookupStateStale LookupState = taxonomy.MetadataCacheStatusStale
)

// CacheKey uniquely identifies package-level metadata independent of project or version.
type CacheKey struct {
	Ecosystem string
	Package   string
}

// Summary is the proxy-local package freshness snapshot captured from upstream metadata.
type Summary struct {
	Ecosystem           string
	Package             string
	LatestVersion       string
	LatestPublishedAt   string
	FetchedAt           time.Time
	Source              string
	VersionPublishTimes map[string]string
}

// Cache is a thread-safe TTL store for package freshness summaries.
// Stale entries are returned as advisory data with LookupStateStale.
type Cache struct {
	inner *proxycache.Cache[CacheKey, Summary]
	stats *StatsCollector
}

// NewCache returns an initialized package metadata cache.
func NewCache(ttl time.Duration) *Cache {
	return newCacheWithClock(ttl, time.Now)
}

// newCacheWithClock is the testing seam — production callers use NewCache.
// It wires the same clock into the bounded TTL cache and the stats collector
// so deterministic tests see one consistent view of time.
func newCacheWithClock(ttl time.Duration, now func() time.Time) *Cache {
	stats := newStatsCollectorWithClock(now)
	c := &Cache{stats: stats}
	c.inner = proxycache.New[CacheKey, Summary](
		proxycache.WithStaticTTL[CacheKey, Summary](ttl),
		proxycache.WithClock[CacheKey, Summary](now),
		proxycache.WithCachedAtFunc[CacheKey, Summary](func(s Summary) time.Time { return s.FetchedAt }),
		proxycache.WithCloneOnGet[CacheKey, Summary](cloneSummary),
		proxycache.WithHooks[CacheKey, Summary](proxycache.Hooks[CacheKey, Summary]{
			OnLookup: func(key CacheKey, state proxycache.LookupState) {
				stats.RecordLookup(key.Ecosystem, translateLookupState(state))
			},
			OnSet: func(key CacheKey, _ Summary) {
				stats.RecordRefresh(key.Ecosystem)
			},
		}),
	)
	return c
}

// Get returns the current summary and its freshness state.
// Stale entries are returned as advisory data with LookupStateStale.
func (c *Cache) Get(key CacheKey) (Summary, LookupState, bool) {
	summary, state, ok := c.inner.Probe(key)
	if !ok {
		return Summary{}, LookupStateMiss, false
	}
	return summary, translateLookupState(state), true
}

// Set stores or refreshes a package freshness summary.
func (c *Cache) Set(key CacheKey, summary Summary) {
	c.inner.Set(key, cloneSummary(summary))
}

// RecordParseFailure increments the parse-failure counter for the ecosystem.
func (c *Cache) RecordParseFailure(ecosystem string) {
	c.stats.RecordParseFailure(ecosystem)
}

// RecordStoreFailure increments the store-failure counter for the ecosystem.
func (c *Cache) RecordStoreFailure(ecosystem string) {
	c.stats.RecordStoreFailure(ecosystem)
}

// SnapshotStatsAndReset returns the current aggregate windows and clears them.
func (c *Cache) SnapshotStatsAndReset() []CacheStatsWindow {
	return c.stats.SnapshotAndReset()
}

// RestoreStats merges previously snapshotted windows back into the collector.
func (c *Cache) RestoreStats(windows []CacheStatsWindow) {
	c.stats.Restore(windows)
}

func translateLookupState(s proxycache.LookupState) LookupState {
	switch s {
	case proxycache.LookupHit:
		return LookupStateHit
	case proxycache.LookupStale:
		return LookupStateStale
	default:
		return LookupStateMiss
	}
}

func cloneSummary(summary Summary) Summary {
	cloned := summary
	if len(summary.VersionPublishTimes) == 0 {
		return cloned
	}
	cloned.VersionPublishTimes = make(map[string]string, len(summary.VersionPublishTimes))
	for version, publishedAt := range summary.VersionPublishTimes {
		cloned.VersionPublishTimes[version] = publishedAt
	}
	return cloned
}
