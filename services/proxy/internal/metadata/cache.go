// Package metadata provides proxy-local caches for package freshness summaries
// and freshness-signal dedupe state.
package metadata

import (
	"sync"
	"time"

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

type entry struct {
	summary Summary
}

// Cache is a thread-safe TTL store for package freshness summaries.
type Cache struct {
	mu    sync.RWMutex
	ttl   time.Duration
	store map[CacheKey]entry
	now   func() time.Time
	stats *StatsCollector
}

// NewCache returns an initialized package metadata cache.
func NewCache(ttl time.Duration) *Cache {
	c := &Cache{
		ttl:   ttl,
		store: make(map[CacheKey]entry),
		now:   time.Now,
		stats: newStatsCollector(),
	}
	go c.evictLoop()
	return c
}

// Get returns the current summary and its freshness state.
// Stale entries are returned as advisory data with LookupStateStale.
func (c *Cache) Get(key CacheKey) (Summary, LookupState, bool) {
	c.mu.RLock()
	current, ok := c.store[key]
	c.mu.RUnlock()
	if !ok {
		c.stats.RecordLookup(key.Ecosystem, LookupStateMiss)
		return Summary{}, LookupStateMiss, false
	}

	summary := cloneSummary(current.summary)
	if c.isExpired(summary.FetchedAt) {
		c.stats.RecordLookup(key.Ecosystem, LookupStateStale)
		return summary, LookupStateStale, true
	}
	c.stats.RecordLookup(key.Ecosystem, LookupStateHit)
	return summary, LookupStateHit, true
}

// Set stores or refreshes a package freshness summary.
func (c *Cache) Set(key CacheKey, summary Summary) {
	c.mu.Lock()
	c.store[key] = entry{summary: cloneSummary(summary)}
	c.mu.Unlock()
	c.stats.RecordRefresh(key.Ecosystem)
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

func (c *Cache) isExpired(fetchedAt time.Time) bool {
	if fetchedAt.IsZero() {
		return true
	}
	return c.now().Sub(fetchedAt) > c.ttl
}

func (c *Cache) evictLoop() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		now := c.now()
		c.mu.Lock()
		for key, current := range c.store {
			if current.summary.FetchedAt.IsZero() || now.Sub(current.summary.FetchedAt) > c.ttl {
				delete(c.store, key)
			}
		}
		c.mu.Unlock()
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
