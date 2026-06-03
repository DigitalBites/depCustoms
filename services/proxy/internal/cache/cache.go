// Package cache provides an in-memory TTL cache for policy Check results.
package cache

import (
	"time"

	"github.com/getcustoms/proxy/internal/proxycache"
)

// CacheKey uniquely identifies a policy decision for a given token-hash + package tuple.
type CacheKey struct {
	ProjectTokenHash string
	Ecosystem        string
	Package          string
	Version          string
}

// CacheEntry stores a cached policy decision alongside metadata for TTL eviction.
type CacheEntry struct {
	Decision        string
	Reason          string
	Detail          string
	CacheTTLSeconds int32
	CachedAt        time.Time
	// ServeMode mirrors the proto ServeMode enum name (e.g. "SERVE_MODE_REDIRECT").
	// Only meaningful when Decision is DECISION_ALLOW.
	ServeMode string
	// TenantID and ProjectID are returned by the control plane on each Check
	// response and cached here so WAL events can include them without a
	// separate lookup.
	TenantID  string
	ProjectID string
}

// Cache is a thread-safe in-memory store for CacheEntry values.
type Cache struct {
	inner *proxycache.Cache[CacheKey, CacheEntry]
}

// New returns an initialised Cache and starts the background eviction goroutine.
func New() *Cache {
	return &Cache{
		inner: proxycache.New[CacheKey, CacheEntry](
			proxycache.WithPerEntryTTL[CacheKey, CacheEntry](func(e CacheEntry) time.Duration {
				return time.Duration(e.CacheTTLSeconds) * time.Second
			}),
			proxycache.WithCachedAtFunc[CacheKey, CacheEntry](func(e CacheEntry) time.Time {
				return e.CachedAt
			}),
		),
	}
}

// Get retrieves an entry by key. Returns (entry, true) if found and not expired,
// or (zero, false) otherwise.
func (c *Cache) Get(key CacheKey) (CacheEntry, bool) {
	return c.inner.Get(key)
}

// Set stores an entry in the cache.
func (c *Cache) Set(key CacheKey, entry CacheEntry) {
	c.inner.Set(key, entry)
}
