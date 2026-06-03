package proxycache_test

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/getcustoms/proxy/internal/proxycache"
)

type ttlValue struct {
	payload string
	ttl     time.Duration
}

func newClock(t *testing.T, base time.Time) (func() time.Time, func(time.Duration)) {
	t.Helper()
	var mu sync.Mutex
	current := base
	now := func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		return current
	}
	advance := func(d time.Duration) {
		mu.Lock()
		current = current.Add(d)
		mu.Unlock()
	}
	return now, advance
}

func newTestCache[V any](t *testing.T, opts ...proxycache.Option[string, V]) *proxycache.Cache[string, V] {
	t.Helper()
	// Background eviction is disabled in unit tests so the suite stays
	// deterministic; the production caches re-enable it via the default.
	defaults := []proxycache.Option[string, V]{
		proxycache.WithEvictionInterval[string, V](0),
	}
	c := proxycache.New(append(defaults, opts...)...)
	t.Cleanup(c.Stop)
	return c
}

func TestStaticTTLExpiry(t *testing.T) {
	now, advance := newClock(t, time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
	c := newTestCache[string](t,
		proxycache.WithStaticTTL[string, string](5*time.Minute),
		proxycache.WithClock[string, string](now),
	)

	c.Set("k", "v")
	got, ok := c.Get("k")
	require.True(t, ok)
	assert.Equal(t, "v", got)

	advance(6 * time.Minute)
	_, ok = c.Get("k")
	assert.False(t, ok)
}

func TestPerEntryTTL(t *testing.T) {
	now, advance := newClock(t, time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
	c := newTestCache[ttlValue](t,
		proxycache.WithPerEntryTTL[string, ttlValue](func(v ttlValue) time.Duration { return v.ttl }),
		proxycache.WithClock[string, ttlValue](now),
	)

	c.Set("short", ttlValue{payload: "s", ttl: time.Minute})
	c.Set("long", ttlValue{payload: "l", ttl: time.Hour})

	advance(2 * time.Minute)
	_, ok := c.Get("short")
	assert.False(t, ok, "short entry should have expired")
	got, ok := c.Get("long")
	require.True(t, ok)
	assert.Equal(t, "l", got.payload)
}

func TestProbeReturnsStale(t *testing.T) {
	now, advance := newClock(t, time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
	c := newTestCache[string](t,
		proxycache.WithStaticTTL[string, string](time.Minute),
		proxycache.WithClock[string, string](now),
	)

	c.Set("k", "v")
	advance(2 * time.Minute)

	value, state, ok := c.Probe("k")
	require.True(t, ok, "stale entries should still report present")
	assert.Equal(t, proxycache.LookupStale, state)
	assert.Equal(t, "v", value)

	_, ok = c.Get("k")
	assert.False(t, ok, "Get treats stale as miss")
}

func TestProbeMiss(t *testing.T) {
	c := newTestCache[string](t,
		proxycache.WithStaticTTL[string, string](time.Minute),
	)

	value, state, ok := c.Probe("absent")
	assert.False(t, ok)
	assert.Equal(t, proxycache.LookupMiss, state)
	assert.Equal(t, "", value)
}

func TestMaxEntriesEvictsOldest(t *testing.T) {
	now, advance := newClock(t, time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
	c := newTestCache[string](t,
		proxycache.WithStaticTTL[string, string](time.Hour),
		proxycache.WithClock[string, string](now),
		proxycache.WithMaxEntries[string, string](3),
	)

	c.Set("oldest", "0")
	advance(time.Second)
	c.Set("a", "1")
	advance(time.Second)
	c.Set("b", "2")
	advance(time.Second)
	c.Set("c", "3")

	_, ok := c.Get("oldest")
	assert.False(t, ok, "oldest entry should have been evicted")
	assert.Equal(t, 3, c.Len())
}

func TestCloneOnGetIsolatesValue(t *testing.T) {
	now, _ := newClock(t, time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
	c := newTestCache[map[string]string](t,
		proxycache.WithStaticTTL[string, map[string]string](time.Hour),
		proxycache.WithClock[string, map[string]string](now),
		proxycache.WithCloneOnGet[string, map[string]string](func(m map[string]string) map[string]string {
			cloned := make(map[string]string, len(m))
			for k, v := range m {
				cloned[k] = v
			}
			return cloned
		}),
	)

	c.Set("k", map[string]string{"version": "1.0.0"})
	first, ok := c.Get("k")
	require.True(t, ok)
	first["version"] = "mutated"

	second, ok := c.Get("k")
	require.True(t, ok)
	assert.Equal(t, "1.0.0", second["version"], "caller mutations should not leak back into the cache")
}

func TestCachedAtFuncUsesValueTimestamp(t *testing.T) {
	now, advance := newClock(t, time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
	type stamped struct {
		fetchedAt time.Time
	}
	c := newTestCache[stamped](t,
		proxycache.WithStaticTTL[string, stamped](time.Minute),
		proxycache.WithClock[string, stamped](now),
		proxycache.WithCachedAtFunc[string, stamped](func(s stamped) time.Time { return s.fetchedAt }),
	)

	// Insert a value whose authoritative timestamp is already 2 minutes
	// in the past — the cache must treat it as stale despite being just
	// stored, because Set time is ignored when WithCachedAtFunc is set.
	c.Set("k", stamped{fetchedAt: now().Add(-2 * time.Minute)})

	_, state, ok := c.Probe("k")
	require.True(t, ok)
	assert.Equal(t, proxycache.LookupStale, state)

	advance(time.Hour) // cache walltime should not matter — the value's stamp does
	_, ok = c.Get("k")
	assert.False(t, ok)
}

func TestHooksFireForLookupAndSet(t *testing.T) {
	now, advance := newClock(t, time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
	var (
		mu      sync.Mutex
		states  []proxycache.LookupState
		setKeys []string
	)
	c := newTestCache[string](t,
		proxycache.WithStaticTTL[string, string](time.Minute),
		proxycache.WithClock[string, string](now),
		proxycache.WithHooks[string, string](proxycache.Hooks[string, string]{
			OnLookup: func(_ string, state proxycache.LookupState) {
				mu.Lock()
				defer mu.Unlock()
				states = append(states, state)
			},
			OnSet: func(key string, _ string) {
				mu.Lock()
				defer mu.Unlock()
				setKeys = append(setKeys, key)
			},
		}),
	)

	_, _ = c.Get("absent")
	c.Set("k", "v")
	_, _ = c.Get("k")
	advance(2 * time.Minute)
	_, _, _ = c.Probe("k")

	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, []proxycache.LookupState{
		proxycache.LookupMiss,
		proxycache.LookupHit,
		proxycache.LookupStale,
	}, states)
	assert.Equal(t, []string{"k"}, setKeys)
}

func TestDeleteRemovesEntry(t *testing.T) {
	c := newTestCache[string](t,
		proxycache.WithStaticTTL[string, string](time.Hour),
	)
	c.Set("k", "v")
	c.Delete("k")
	_, ok := c.Get("k")
	assert.False(t, ok)
}

func TestConcurrentGetSetIsRaceFree(t *testing.T) {
	c := newTestCache[string](t,
		proxycache.WithStaticTTL[string, string](time.Hour),
	)

	var wg sync.WaitGroup
	for i := range 64 {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			key := string(rune('a' + n%26))
			c.Set(key, "v")
			_, _ = c.Get(key)
		}(i)
	}
	wg.Wait()
}

func TestStopHaltsEvictionGoroutine(t *testing.T) {
	now := func() time.Time { return time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC) }
	c := proxycache.New[string, string](
		proxycache.WithStaticTTL[string, string](time.Hour),
		proxycache.WithClock[string, string](now),
		proxycache.WithEvictionInterval[string, string](10*time.Millisecond),
	)

	c.Stop()
	c.Stop() // idempotent — must not panic
}

func TestBackgroundEvictionRemovesExpired(t *testing.T) {
	var ticks atomic.Int32
	now := func() time.Time {
		// Each tick advances the clock by a minute so the background
		// sweep observes expired entries promptly without sleeping.
		n := ticks.Add(1)
		return time.Date(2026, 6, 1, 0, int(n), 0, 0, time.UTC)
	}
	c := proxycache.New[string, string](
		proxycache.WithStaticTTL[string, string](30*time.Second),
		proxycache.WithClock[string, string](now),
		proxycache.WithEvictionInterval[string, string](5*time.Millisecond),
	)
	t.Cleanup(c.Stop)

	c.Set("k", "v")

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if c.Len() == 0 {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("background eviction did not remove expired entry; len=%d", c.Len())
}

func TestEnforceMaxEntriesEvictsExpiredFirst(t *testing.T) {
	now := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	store := map[string]ttlValue{
		"expired": {payload: "old", ttl: time.Nanosecond},
		"fresh-a": {payload: "a", ttl: time.Hour},
		"fresh-b": {payload: "b", ttl: time.Hour},
		"fresh-c": {payload: "c", ttl: time.Hour},
	}
	isExpired := func(v ttlValue) bool { return v.ttl < time.Second }
	timestamp := func(_ ttlValue) time.Time { return now }

	proxycache.EnforceMaxEntries(store, 3, isExpired, timestamp)

	_, present := store["expired"]
	assert.False(t, present, "expired entry should be removed first")
	assert.Len(t, store, 3)
}

func TestEnforceMaxEntriesZeroClears(t *testing.T) {
	store := map[string]string{"a": "1", "b": "2"}
	proxycache.EnforceMaxEntries(store, 0,
		func(string) bool { return false },
		func(string) time.Time { return time.Now() },
	)
	assert.Empty(t, store)
}
