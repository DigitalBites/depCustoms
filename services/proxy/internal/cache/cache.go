// Package cache provides an in-memory TTL cache for policy Check results.
package cache

import (
	"sync"
	"time"
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

// isExpired reports whether the entry has exceeded its TTL.
func (e CacheEntry) isExpired() bool {
	ttl := time.Duration(e.CacheTTLSeconds) * time.Second
	return time.Since(e.CachedAt) > ttl
}

// Cache is a thread-safe in-memory store for CacheEntry values.
type Cache struct {
	mu    sync.RWMutex
	store map[CacheKey]CacheEntry
}

// New returns an initialised Cache and starts the background eviction goroutine.
func New() *Cache {
	c := &Cache{
		store: make(map[CacheKey]CacheEntry),
	}
	go c.evictLoop()
	return c
}

// Get retrieves an entry by key. Returns (entry, true) if found and not expired,
// or (zero, false) otherwise.
func (c *Cache) Get(key CacheKey) (CacheEntry, bool) {
	c.mu.RLock()
	entry, ok := c.store[key]
	c.mu.RUnlock()

	if !ok || entry.isExpired() {
		return CacheEntry{}, false
	}
	return entry, true
}

// Set stores an entry in the cache.
func (c *Cache) Set(key CacheKey, entry CacheEntry) {
	c.mu.Lock()
	c.store[key] = entry
	c.mu.Unlock()
}

// evictLoop runs a sweep every 60 seconds to remove expired entries.
func (c *Cache) evictLoop() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		c.mu.Lock()
		for k, v := range c.store {
			if v.isExpired() {
				delete(c.store, k)
			}
		}
		c.mu.Unlock()
	}
}
