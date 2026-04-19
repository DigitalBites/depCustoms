package cache_test

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/getcustoms/proxy/internal/cache"
)

func makeKey(pkg string) cache.CacheKey {
	return cache.CacheKey{
		ProjectTokenHash: "hash-tok",
		Ecosystem:        "npm",
		Package:          pkg,
		Version:          "1.0.0",
	}
}

func makeEntry(decision string, ttl int32) cache.CacheEntry {
	return cache.CacheEntry{
		Decision:        decision,
		Reason:          "test",
		CacheTTLSeconds: ttl,
		CachedAt:        time.Now(),
		TenantID:        "tenant-1",
		ProjectID:       "project-1",
	}
}

func TestSetAndGet(t *testing.T) {
	c := cache.New()
	key := makeKey("lodash")
	entry := makeEntry("DECISION_ALLOW", 300)

	c.Set(key, entry)
	got, ok := c.Get(key)

	require.True(t, ok)
	assert.Equal(t, "DECISION_ALLOW", got.Decision)
	assert.Equal(t, "test", got.Reason)
}

func TestTTLExpiry(t *testing.T) {
	c := cache.New()
	key := makeKey("express")
	entry := makeEntry("DECISION_ALLOW", 1) // 1 second TTL
	entry.CachedAt = time.Now().Add(-2 * time.Second)

	c.Set(key, entry)
	_, ok := c.Get(key)
	assert.False(t, ok, "entry with elapsed TTL should not be returned")
}

func TestExpiredNotReturned(t *testing.T) {
	c := cache.New()
	key := makeKey("react")

	// TTL=0 means immediately expired
	entry := makeEntry("DECISION_BLOCK", 0)
	c.Set(key, entry)

	_, ok := c.Get(key)
	assert.False(t, ok, "entry with TTL=0 should be expired on first Get")
}

func TestMissReturnsNotOk(t *testing.T) {
	c := cache.New()
	_, ok := c.Get(makeKey("nonexistent"))
	assert.False(t, ok)
}

func TestTenantProjectIDStored(t *testing.T) {
	c := cache.New()
	key := makeKey("axios")
	entry := cache.CacheEntry{
		Decision:        "DECISION_ALLOW",
		CacheTTLSeconds: 300,
		CachedAt:        time.Now(),
		TenantID:        "tenant-xyz",
		ProjectID:       "project-xyz",
	}

	c.Set(key, entry)
	got, ok := c.Get(key)

	require.True(t, ok)
	assert.Equal(t, "tenant-xyz", got.TenantID)
	assert.Equal(t, "project-xyz", got.ProjectID)
}

func TestConcurrentAccess(t *testing.T) {
	c := cache.New()
	var wg sync.WaitGroup

	// 100 goroutines each doing Set + Get
	for i := range 100 {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			key := cache.CacheKey{
				ProjectTokenHash: "hash-tok",
				Ecosystem:        "npm",
				Package:          string(rune('a' + n%26)),
				Version:          "1.0.0",
			}
			entry := makeEntry("DECISION_ALLOW", 300)
			c.Set(key, entry)
			c.Get(key) //nolint — result not needed for race detection
		}(i)
	}
	wg.Wait()
}

func TestDifferentKeysIndependent(t *testing.T) {
	c := cache.New()

	k1 := makeKey("pkg-a")
	k2 := makeKey("pkg-b")

	c.Set(k1, makeEntry("DECISION_ALLOW", 300))
	c.Set(k2, makeEntry("DECISION_BLOCK", 300))

	e1, ok1 := c.Get(k1)
	e2, ok2 := c.Get(k2)

	require.True(t, ok1)
	require.True(t, ok2)
	assert.Equal(t, "DECISION_ALLOW", e1.Decision)
	assert.Equal(t, "DECISION_BLOCK", e2.Decision)
}
