package metadata

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCacheStatsSnapshotAndRestore(t *testing.T) {
	c := NewCache(5 * time.Minute)
	base := time.Date(2026, 4, 8, 23, 0, 0, 0, time.UTC)
	c.now = func() time.Time { return base }
	c.stats.now = c.now
	c.stats.windowStarted = base

	key := CacheKey{Ecosystem: "npm", Package: "vite"}

	_, _, _ = c.Get(key)
	c.Set(key, Summary{
		Ecosystem:     "npm",
		Package:       "vite",
		LatestVersion: "7.1.0",
		FetchedAt:     base,
	})
	_, _, _ = c.Get(key)
	c.RecordParseFailure("npm")
	c.RecordStoreFailure("npm")

	base = base.Add(2 * time.Minute)
	windows := c.SnapshotStatsAndReset()
	require.Len(t, windows, 1)
	assert.Equal(t, "npm", windows[0].Ecosystem)
	assert.EqualValues(t, 1, windows[0].Misses)
	assert.EqualValues(t, 1, windows[0].Hits)
	assert.EqualValues(t, 1, windows[0].Refreshes)
	assert.EqualValues(t, 1, windows[0].ParseFailures)
	assert.EqualValues(t, 1, windows[0].StoreFailures)
	assert.Equal(t, time.Date(2026, 4, 8, 23, 0, 0, 0, time.UTC), windows[0].WindowStarted)
	assert.Equal(t, time.Date(2026, 4, 8, 23, 2, 0, 0, time.UTC), windows[0].WindowEnded)

	assert.Empty(t, c.SnapshotStatsAndReset())

	c.RestoreStats(windows)
	restored := c.SnapshotStatsAndReset()
	require.Len(t, restored, 1)
	assert.EqualValues(t, 1, restored[0].Misses)
	assert.EqualValues(t, 1, restored[0].Hits)
}
