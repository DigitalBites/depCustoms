// Package proxycache is the shared TTL+bounded cache used by every in-memory
// store in the proxy (decision, package metadata, token context, …).
//
// The module owns the lock, the map, the TTL check, the background eviction
// loop, and the bounded-entry enforcement. Domain concerns — value cloning,
// stats, fingerprint extraction — are wired in via options.
//
// See feature-proxy-cache-unification.md for the design rationale and the
// per-cache migration plan.
package proxycache

import (
	"sync"
	"time"
)

// LookupState classifies the result of a cache lookup. Callers that only
// care about "fresh hit" use Get; callers that want to surface stale data
// (e.g. the package metadata cache returning stale entries as advisory)
// use Probe.
type LookupState string

const (
	LookupMiss  LookupState = "miss"
	LookupHit   LookupState = "hit"
	LookupStale LookupState = "stale"
)

// Hooks are opt-in observation callbacks fired outside the cache lock.
type Hooks[K comparable, V any] struct {
	// OnLookup fires after every Get/Probe with the resolved state.
	OnLookup func(key K, state LookupState)
	// OnSet fires after every successful Set.
	OnSet func(key K, value V)
}

// Cache is a thread-safe TTL+bounded store keyed by K and holding V.
type Cache[K comparable, V any] struct {
	mu               sync.RWMutex
	store            map[K]entry[V]
	maxEntries       int
	staticTTL        time.Duration
	perEntryTTL      func(V) time.Duration
	cachedAt         func(V) time.Time
	cloneOnGet       func(V) V
	hooks            Hooks[K, V]
	now              func() time.Time
	evictionInterval time.Duration
	stopCh           chan struct{}
	stopOnce         sync.Once
}

type entry[V any] struct {
	value    V
	cachedAt time.Time
}

// New returns an initialized Cache and starts the background eviction
// goroutine unless WithEvictionInterval(0) was passed.
func New[K comparable, V any](opts ...Option[K, V]) *Cache[K, V] {
	c := &Cache[K, V]{
		store:            make(map[K]entry[V]),
		maxEntries:       DefaultMaxEntries,
		now:              time.Now,
		evictionInterval: 60 * time.Second,
		stopCh:           make(chan struct{}),
	}
	for _, opt := range opts {
		opt(c)
	}

	if c.evictionInterval > 0 {
		go c.evictLoop()
	}
	return c
}

// Get returns the value if present and fresh. Stale entries are reported
// as a miss. Use Probe when the caller wants visibility into stale state.
func (c *Cache[K, V]) Get(key K) (V, bool) {
	value, state := c.lookup(key)
	if state == LookupHit {
		return value, true
	}
	var zero V
	return zero, false
}

// Probe returns the value (if any), its lookup state, and whether the key
// was present at all. Stale entries are returned for callers that treat
// them as advisory (e.g. metadata.Cache).
func (c *Cache[K, V]) Probe(key K) (V, LookupState, bool) {
	value, state := c.lookup(key)
	return value, state, state != LookupMiss
}

func (c *Cache[K, V]) lookup(key K) (V, LookupState) {
	c.mu.RLock()
	current, ok := c.store[key]
	c.mu.RUnlock()

	var zero V
	if !ok {
		c.fireLookup(key, LookupMiss)
		return zero, LookupMiss
	}

	value := current.value
	if c.cloneOnGet != nil {
		value = c.cloneOnGet(value)
	}

	if c.isExpiredEntry(current) {
		c.fireLookup(key, LookupStale)
		return value, LookupStale
	}
	c.fireLookup(key, LookupHit)
	return value, LookupHit
}

// Set stores value under key and enforces the bounded-entry policy.
func (c *Cache[K, V]) Set(key K, value V) {
	now := c.now()
	c.mu.Lock()
	c.store[key] = entry[V]{value: value, cachedAt: now}
	EnforceMaxEntries(c.store, c.maxEntries, c.isExpiredEntry, func(e entry[V]) time.Time {
		return e.cachedAt
	})
	c.mu.Unlock()

	if c.hooks.OnSet != nil {
		c.hooks.OnSet(key, value)
	}
}

// Delete removes a single entry. No-op if the key is absent.
func (c *Cache[K, V]) Delete(key K) {
	c.mu.Lock()
	delete(c.store, key)
	c.mu.Unlock()
}

// Len returns the current entry count (including stale entries that
// haven't been swept yet).
func (c *Cache[K, V]) Len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.store)
}

// Stop terminates the background eviction goroutine. Safe to call multiple
// times. Tests should call Stop via t.Cleanup; production proxies run for
// the process lifetime and don't need it.
func (c *Cache[K, V]) Stop() {
	c.stopOnce.Do(func() { close(c.stopCh) })
}

func (c *Cache[K, V]) isExpiredEntry(e entry[V]) bool {
	ttl := c.ttlFor(e.value)
	at := c.timestampFor(e)
	if at.IsZero() {
		return true
	}
	return c.now().Sub(at) > ttl
}

func (c *Cache[K, V]) ttlFor(value V) time.Duration {
	if c.perEntryTTL != nil {
		return c.perEntryTTL(value)
	}
	return c.staticTTL
}

func (c *Cache[K, V]) timestampFor(e entry[V]) time.Time {
	if c.cachedAt != nil {
		return c.cachedAt(e.value)
	}
	return e.cachedAt
}

func (c *Cache[K, V]) fireLookup(key K, state LookupState) {
	if c.hooks.OnLookup != nil {
		c.hooks.OnLookup(key, state)
	}
}

func (c *Cache[K, V]) evictLoop() {
	ticker := time.NewTicker(c.evictionInterval)
	defer ticker.Stop()

	for {
		select {
		case <-c.stopCh:
			return
		case <-ticker.C:
			c.sweepExpired()
		}
	}
}

func (c *Cache[K, V]) sweepExpired() {
	c.mu.Lock()
	for key, current := range c.store {
		if c.isExpiredEntry(current) {
			delete(c.store, key)
		}
	}
	c.mu.Unlock()
}
