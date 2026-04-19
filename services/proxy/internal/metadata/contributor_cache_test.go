package metadata

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestContributorCachePersistsAndReloads(t *testing.T) {
	path := filepath.Join(t.TempDir(), "contributor-cache.json")

	cache, err := NewContributorCache(path, 250, 45)
	require.NoError(t, err)

	base := time.Date(2026, 4, 15, 0, 0, 0, 0, time.UTC)
	cache.now = func() time.Time { return base }

	key := CacheKey{Ecosystem: "npm", Package: "lodash"}
	err = cache.Set(key, ContributorPackage{
		Ecosystem:                 "npm",
		Package:                   "lodash",
		Fingerprint:               "pkg-fingerprint",
		ExtractedAt:               "2026-04-15T00:00:00Z",
		LatestVersion:             "4.18.1",
		LatestPublishedAt:         "2026-04-15T00:00:00Z",
		HistoryComplete:           false,
		OldestIncludedPublishedAt: "2025-01-01T00:00:00Z",
		Versions: []ContributorVersion{
			{
				Version:           "4.17.15",
				PublishedAt:       "2025-12-01T00:00:00Z",
				Publisher:         "alice",
				Maintainers:       []string{"alice"},
				HasInstallScripts: false,
				HasAttestation:    false,
				RawPayloadJSON:    `{"_npmUser":{"name":"alice"}}`,
			},
			{
				Version:           "4.18.1",
				PublishedAt:       "2026-04-15T00:00:00Z",
				Publisher:         "bob",
				Maintainers:       []string{"alice", "bob"},
				HasInstallScripts: true,
				HasAttestation:    true,
				RawPayloadJSON:    `{"_npmUser":{"name":"bob"}}`,
			},
		},
	})
	require.NoError(t, err)

	reloaded, err := NewContributorCache(path, 250, 45)
	require.NoError(t, err)
	reloaded.now = func() time.Time { return base }

	pkg, found := reloaded.Get(key)
	require.True(t, found)
	assert.Equal(t, "pkg-fingerprint", pkg.Fingerprint)
	assert.Len(t, pkg.Versions, 2)
	assert.Equal(t, "4.17.15", pkg.Versions[0].Version)
	assert.Equal(t, `{"_npmUser":{"name":"alice"}}`, pkg.Versions[0].RawPayloadJSON)
	assert.Equal(t, "2026-04-15T00:00:00Z", pkg.LastAccessedAt)
}

func TestContributorCacheBuildSliceAnchorsRequestedVersionHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "contributor-cache.json")
	cache, err := NewContributorCache(path, 250, 45)
	require.NoError(t, err)

	base := time.Date(2026, 4, 20, 0, 0, 0, 0, time.UTC)
	cache.now = func() time.Time { return base }

	key := CacheKey{Ecosystem: "npm", Package: "pkg"}
	err = cache.Set(key, ContributorPackage{
		Ecosystem:                 "npm",
		Package:                   "pkg",
		Fingerprint:               "pkg-fingerprint",
		ExtractedAt:               "2026-04-20T00:00:00Z",
		LatestVersion:             "1.2.0",
		LatestPublishedAt:         "2026-04-20T00:00:00Z",
		HistoryComplete:           false,
		OldestIncludedPublishedAt: "2025-01-01T00:00:00Z",
		Versions: []ContributorVersion{
			{Version: "0.9.0", PublishedAt: "2025-01-01T00:00:00Z", Publisher: "alpha"},
			{Version: "1.0.0", PublishedAt: "2025-12-01T00:00:00Z", Publisher: "alice"},
			{Version: "1.0.1", PublishedAt: "2026-01-10T00:00:00Z", Publisher: "alice"},
			{Version: "1.1.0", PublishedAt: "2026-03-01T00:00:00Z", Publisher: "bob"},
			{Version: "1.2.0", PublishedAt: "2026-04-20T00:00:00Z", Publisher: "carol"},
		},
	})
	require.NoError(t, err)

	slice, ok := cache.BuildSlice(key, "1.1.0", 30)
	require.True(t, ok)

	assert.Equal(t, "1.1.0", slice.RequestedVersion)
	assert.Equal(t, "2026-03-01T00:00:00Z", slice.RequestedVersionPublishedAt)
	assert.Equal(t, "pkg-fingerprint", slice.PackageMetadataFingerprint)
	assert.Equal(t, 2, len(slice.Versions))
	assert.Equal(t, "1.0.1", slice.Versions[0].Version) // anchor before window
	assert.Equal(t, "1.1.0", slice.Versions[1].Version) // requested version
	assert.Equal(t, "2026-01-10T00:00:00Z", slice.OldestIncludedPublishedAt)
	assert.NotEmpty(t, slice.SliceFingerprint)
}

func TestContributorCacheGetDoesNotPersistReadAccess(t *testing.T) {
	path := filepath.Join(t.TempDir(), "contributor-cache.json")
	cache, err := NewContributorCache(path, 250, 45)
	require.NoError(t, err)

	base := time.Date(2026, 4, 20, 0, 0, 0, 0, time.UTC)
	cache.now = func() time.Time { return base }

	key := CacheKey{Ecosystem: "npm", Package: "pkg"}
	err = cache.Set(key, ContributorPackage{
		Ecosystem:       "npm",
		Package:         "pkg",
		ExtractedAt:     "2026-04-20T00:00:00Z",
		LastAccessedAt:  "2026-04-20T00:00:00Z",
		HistoryComplete: false,
		Versions: []ContributorVersion{
			{Version: "1.0.0", PublishedAt: "2026-04-20T00:00:00Z", Publisher: "alice"},
		},
	})
	require.NoError(t, err)

	infoBefore, err := os.Stat(path)
	require.NoError(t, err)

	cache.now = func() time.Time { return base.Add(2 * time.Hour) }
	pkg, found := cache.Get(key)
	require.True(t, found)
	assert.Equal(t, "2026-04-20T02:00:00Z", pkg.LastAccessedAt)

	infoAfter, err := os.Stat(path)
	require.NoError(t, err)
	assert.Equal(t, infoBefore.ModTime(), infoAfter.ModTime())
}
