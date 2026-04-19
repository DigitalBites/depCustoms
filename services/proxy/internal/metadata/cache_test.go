package metadata

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCacheHitMissAndStale(t *testing.T) {
	c := NewCache(5 * time.Minute)
	base := time.Date(2026, 4, 8, 22, 0, 0, 0, time.UTC)
	c.now = func() time.Time { return base }

	key := CacheKey{Ecosystem: "npm", Package: "lodash"}

	_, state, ok := c.Get(key)
	require.False(t, ok)
	assert.Equal(t, LookupStateMiss, state)

	c.Set(key, Summary{
		Ecosystem:         "npm",
		Package:           "lodash",
		LatestVersion:     "4.17.21",
		LatestPublishedAt: "2026-04-01T00:00:00Z",
		FetchedAt:         base,
		Source:            "npm_packument",
		VersionPublishTimes: map[string]string{
			"4.17.21": "2026-04-01T00:00:00Z",
		},
	})

	summary, state, ok := c.Get(key)
	require.True(t, ok)
	assert.Equal(t, LookupStateHit, state)
	assert.Equal(t, "4.17.21", summary.LatestVersion)
	assert.Equal(t, "2026-04-01T00:00:00Z", summary.VersionPublishTimes["4.17.21"])

	base = base.Add(6 * time.Minute)
	summary, state, ok = c.Get(key)
	require.True(t, ok)
	assert.Equal(t, LookupStateStale, state)
	assert.Equal(t, "4.17.21", summary.LatestVersion)
}

func TestCacheSetClonesVersionMap(t *testing.T) {
	c := NewCache(5 * time.Minute)
	base := time.Date(2026, 4, 8, 22, 0, 0, 0, time.UTC)
	c.now = func() time.Time { return base }

	sourceMap := map[string]string{"1.0.0": "2026-01-01T00:00:00Z"}
	key := CacheKey{Ecosystem: "npm", Package: "pkg"}
	c.Set(key, Summary{
		Ecosystem:           "npm",
		Package:             "pkg",
		LatestVersion:       "1.0.0",
		FetchedAt:           base,
		VersionPublishTimes: sourceMap,
	})
	sourceMap["1.0.0"] = "mutated"

	summary, state, ok := c.Get(key)
	require.True(t, ok)
	assert.Equal(t, LookupStateHit, state)
	assert.Equal(t, "2026-01-01T00:00:00Z", summary.VersionPublishTimes["1.0.0"])

	summary.VersionPublishTimes["1.0.0"] = "changed-again"
	summary2, _, ok := c.Get(key)
	require.True(t, ok)
	assert.Equal(t, "2026-01-01T00:00:00Z", summary2.VersionPublishTimes["1.0.0"])
}
