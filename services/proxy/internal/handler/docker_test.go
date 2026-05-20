package handler

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseDockerRequestPath_DefaultsToDockerHub(t *testing.T) {
	parsed, ok := parseDockerRequestPath("/v2/alpine/manifests/3.20")
	require.True(t, ok)
	assert.Equal(t, dockerKindManifest, parsed.kind)
	assert.Equal(t, dockerHubDisplayRegistry, parsed.displayRegistry)
	assert.Equal(t, dockerHubNetworkRegistry, parsed.networkRegistry)
	assert.Equal(t, "library/alpine", parsed.repository)
	assert.Equal(t, "3.20", parsed.reference)
	assert.False(t, parsed.isDigest)
}

func TestParseDockerRequestPath_ExplicitDockerHubAlias(t *testing.T) {
	parsed, ok := parseDockerRequestPath("/v2/docker.io/alpine/manifests/3.20")
	require.True(t, ok)
	assert.Equal(t, dockerHubDisplayRegistry, parsed.displayRegistry)
	assert.Equal(t, dockerHubNetworkRegistry, parsed.networkRegistry)
	assert.Equal(t, "library/alpine", parsed.repository)
}

func TestParseDockerRequestPath_ExplicitCustomRegistry(t *testing.T) {
	parsed, ok := parseDockerRequestPath("/v2/ghcr.io/org/image/manifests/sha256:abc")
	require.True(t, ok)
	assert.Equal(t, "ghcr.io", parsed.displayRegistry)
	assert.Equal(t, "ghcr.io", parsed.networkRegistry)
	assert.Equal(t, "org/image", parsed.repository)
	assert.Equal(t, "sha256:abc", parsed.reference)
	assert.True(t, parsed.isDigest)
}

func TestParseDockerRequestPath_Blob(t *testing.T) {
	parsed, ok := parseDockerRequestPath("/v2/registry.company.com/team/app/blobs/sha256:def")
	require.True(t, ok)
	assert.Equal(t, dockerKindBlob, parsed.kind)
	assert.Equal(t, "registry.company.com", parsed.displayRegistry)
	assert.Equal(t, "team/app", parsed.repository)
	assert.Equal(t, "sha256:def", parsed.blobDigest)
}

func TestParseDockerRequestPath_Invalid(t *testing.T) {
	_, ok := parseDockerRequestPath("/v2/ghcr.io/org/image/tags/list")
	assert.False(t, ok)
}

func TestDockerBlobAllowCacheUsesConfiguredTTL(t *testing.T) {
	cache := &dockerBlobAllowCache{
		ttl:     1,
		entries: make(map[string]dockerBlobAllowEntry),
	}
	cache.Set("token", "hub.docker.io", "registry-1.docker.io", "library/alpine", "sha256:layer", dockerBlobAllowEntry{
		manifestDigest: "sha256:manifest",
		allowedAt:      time.Now().Add(-2 * time.Second),
	})

	_, ok := cache.Get("token", "hub.docker.io", "registry-1.docker.io", "library/alpine", "sha256:layer")
	assert.False(t, ok)
}
