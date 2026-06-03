package proxycache

import "time"

// Option configures a Cache at construction time.
type Option[K comparable, V any] func(*Cache[K, V])

// WithStaticTTL applies a uniform TTL to every entry. Mutually exclusive with
// WithPerEntryTTL — the last option wins; callers should only set one.
func WithStaticTTL[K comparable, V any](ttl time.Duration) Option[K, V] {
	return func(c *Cache[K, V]) {
		c.staticTTL = ttl
		c.perEntryTTL = nil
	}
}

// WithPerEntryTTL derives the TTL from the value itself. Useful when the
// upstream response carries its own TTL (e.g. the policy decision cache).
func WithPerEntryTTL[K comparable, V any](fn func(V) time.Duration) Option[K, V] {
	return func(c *Cache[K, V]) {
		c.perEntryTTL = fn
		c.staticTTL = 0
	}
}

// WithMaxEntries caps the cache size. Zero or negative means unbounded.
// Defaults to DefaultMaxEntries.
func WithMaxEntries[K comparable, V any](n int) Option[K, V] {
	return func(c *Cache[K, V]) {
		c.maxEntries = n
	}
}

// WithClock injects the now() function. Tests should pass a controlled clock
// so TTL and eviction behavior is deterministic.
func WithClock[K comparable, V any](fn func() time.Time) Option[K, V] {
	return func(c *Cache[K, V]) {
		if fn != nil {
			c.now = fn
		}
	}
}

// WithEvictionInterval overrides the background sweep cadence. Defaults to
// 60 seconds. Set to zero to disable the background goroutine entirely (the
// cache will still evict on Set when the bound is exceeded).
func WithEvictionInterval[K comparable, V any](d time.Duration) Option[K, V] {
	return func(c *Cache[K, V]) {
		c.evictionInterval = d
	}
}

// WithCloneOnGet deep-copies the value on read so callers cannot mutate
// cached state. The shared Cache does a shallow struct copy by default;
// configure this when the value contains reference types (maps, slices)
// that need isolating.
func WithCloneOnGet[K comparable, V any](fn func(V) V) Option[K, V] {
	return func(c *Cache[K, V]) {
		c.cloneOnGet = fn
	}
}

// WithCachedAtFunc lets the value supply its own "stored at" timestamp for
// TTL checks. Without this option the Cache records the time at Set. Use
// this when the value already carries an authoritative FetchedAt-style
// field (e.g. metadata.Summary.FetchedAt).
func WithCachedAtFunc[K comparable, V any](fn func(V) time.Time) Option[K, V] {
	return func(c *Cache[K, V]) {
		c.cachedAt = fn
	}
}

// WithHooks attaches optional observation callbacks (stats, logging). Hooks
// are called outside the cache lock to keep the critical section small.
func WithHooks[K comparable, V any](h Hooks[K, V]) Option[K, V] {
	return func(c *Cache[K, V]) {
		c.hooks = h
	}
}
