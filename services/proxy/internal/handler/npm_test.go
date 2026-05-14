package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/getcustoms/proxy/internal/metadata"
	"github.com/getcustoms/proxy/internal/testutil"
	"github.com/getcustoms/proxy/internal/wal"
)

func mustContributorCache(t *testing.T) *metadata.ContributorCache {
	t.Helper()
	cache, err := metadata.NewContributorCache(
		filepath.Join(t.TempDir(), "contributor-cache.json"),
		250,
		45,
	)
	require.NoError(t, err)
	return cache
}

func TestNpmParse_UnscopedArtifact(t *testing.T) {
	pkg, version, isTarball := extractPackageVersion("/lodash/-/lodash-4.17.15.tgz")
	assert.Equal(t, "lodash", pkg)
	assert.Equal(t, "4.17.15", version)
	assert.True(t, isTarball)
}

func TestNpmParse_ScopedArtifact(t *testing.T) {
	pkg, version, isTarball := extractPackageVersion("/@scope/pkg/-/pkg-1.2.3.tgz")
	assert.Equal(t, "@scope/pkg", pkg)
	assert.Equal(t, "1.2.3", version)
	assert.True(t, isTarball)
}

func TestNpmParse_UnscopedMetadata(t *testing.T) {
	pkg, version, isTarball := extractPackageVersion("/lodash")
	assert.Equal(t, "lodash", pkg)
	assert.Equal(t, "", version)
	assert.False(t, isTarball)
}

func TestNpmParse_ScopedMetadata(t *testing.T) {
	pkg, version, isTarball := extractPackageVersion("/@scope/pkg")
	assert.Equal(t, "@scope/pkg", pkg)
	assert.Equal(t, "", version)
	assert.False(t, isTarball)
}

func TestNpmParse_UnrecognisedPath(t *testing.T) {
	// A path with no package name (just slashes) returns empty pkg
	pkg, _, _ := extractPackageVersion("/")
	assert.Empty(t, pkg)
}

func TestNpmParse_SecurityAuditEndpointBypassesPolicy(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/-/npm/v1/security/audits/quick", nil)
	resolver := &npmResolver{}

	parsed := resolver.ParseRequest(req)

	assert.Equal(t, "-/npm/v1/security/audits/quick", parsed.Package)
	assert.True(t, parsed.BypassPolicy)
	assert.False(t, parsed.IsArtifact)
}

func TestNpmParseRequest_CanonicalizesPackageIdentity(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/@Scope/Pkg/-/Pkg-1.2.3.tgz", nil)
	resolver := &npmResolver{}

	parsed := resolver.ParseRequest(req)

	assert.Equal(t, "@scope/pkg", parsed.Package)
	assert.Equal(t, "1.2.3", parsed.Version)
	assert.Equal(t, "@Scope/Pkg/-/Pkg-1.2.3.tgz", parsed.ArtifactKey)
	assert.True(t, parsed.IsArtifact)
}

func TestNpmParse_ScopedBabelCore(t *testing.T) {
	pkg, version, isTarball := extractPackageVersion("/@babel/core/-/core-7.24.0.tgz")
	require.True(t, isTarball)
	assert.Equal(t, "@babel/core", pkg)
	assert.Equal(t, "7.24.0", version)
}

func TestNpmParse_PrereleaseArtifact(t *testing.T) {
	pkg, version, isTarball := extractPackageVersion("/rolldown/-/rolldown-1.0.0-rc.13.tgz")
	require.True(t, isTarball)
	assert.Equal(t, "rolldown", pkg)
	assert.Equal(t, "1.0.0-rc.13", version)
}

func TestNpmParse_NoTarballSuffix(t *testing.T) {
	// Tarball section with no dash → empty, not a tarball
	pkg, version, isTarball := extractPackageVersion("/pkg/-/notarball")
	assert.False(t, isTarball)
	assert.Empty(t, version)
	assert.Empty(t, pkg)
}

func TestRewriteTarballURLsUsesConfiguredPublicBaseURL(t *testing.T) {
	metadata := map[string]interface{}{
		"dist": map[string]interface{}{
			"tarball": "https://registry.npmjs.org/lodash/-/lodash-4.17.15.tgz",
		},
	}

	rewriteTarballURLs(metadata, npmDefaultUpstream, "https://proxy.example.com")

	dist, ok := metadata["dist"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "https://proxy.example.com/lodash/-/lodash-4.17.15.tgz", dist["tarball"])
}

func TestNpmMetadataRejectsOversizedResponse(t *testing.T) {
	const metadataMaxSize = 32 << 20

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{"versions":{"1.0.0":{"dist":{"tarball":"`)
		_, _ = io.WriteString(w, "a")
		_, _ = w.Write(make([]byte, metadataMaxSize))
		_, _ = io.WriteString(w, `"}}}}`)
	}))
	defer upstream.Close()

	resolver := &npmResolver{
		cfg: npmConfig{
			upstreamRegistry: upstream.URL,
			publicBaseURL:    "https://proxy.example.com",
			metadataMaxSize:  metadataMaxSize,
		},
		httpClient: upstream.Client(),
	}

	req := httptest.NewRequest(http.MethodGet, "/lodash", nil)
	rec := httptest.NewRecorder()
	ok := resolver.OnProxyMetadata(rec, req, "lodash")

	assert.False(t, ok)
	assert.Equal(t, http.StatusBadGateway, rec.Code)
	assert.Contains(t, rec.Body.String(), "metadata size limit")
}

func TestNpmRedirectPreservesOriginalArtifactPath(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/rolldown/-/rolldown-1.0.0-rc.13.tgz", nil)
	rec := httptest.NewRecorder()
	resolver := &npmResolver{cfg: npmConfig{upstreamRegistry: npmDefaultUpstream}}

	resolver.redirectToUpstream(rec, req, "rolldown/-/rolldown-1.0.0-rc.13.tgz")

	assert.Equal(t, http.StatusFound, rec.Code)
	assert.Equal(
		t,
		"https://registry.npmjs.org/rolldown/-/rolldown-1.0.0-rc.13.tgz",
		rec.Header().Get("Location"),
	)
}

func TestNpmMetadataReturnsTrueOnSuccess(t *testing.T) {
	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{"versions":{"1.0.0":{"dist":{"tarball":"`+upstream.URL+`/lodash/-/lodash-1.0.0.tgz"}}}}`)
	}))
	defer upstream.Close()

	resolver := &npmResolver{
		cfg: npmConfig{
			upstreamRegistry: upstream.URL,
			publicBaseURL:    "https://proxy.example.com",
			metadataMaxSize:  32 << 20,
		},
		httpClient: upstream.Client(),
	}

	req := httptest.NewRequest(http.MethodGet, "/lodash", nil)
	rec := httptest.NewRecorder()
	ok := resolver.OnProxyMetadata(rec, req, "lodash")

	assert.True(t, ok)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "https://proxy.example.com/lodash/-/lodash-1.0.0.tgz")
}

func TestNpmMetadataDerivesRewriteBaseFromTrustedForwardedHeaders(t *testing.T) {
	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{"versions":{"1.0.0":{"dist":{"tarball":"`+upstream.URL+`/lodash/-/lodash-1.0.0.tgz"}}}}`)
	}))
	defer upstream.Close()

	resolver := &npmResolver{
		cfg: npmConfig{
			upstreamRegistry: upstream.URL,
			trustedProxyNets: []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")},
			metadataMaxSize:  32 << 20,
		},
		httpClient: upstream.Client(),
	}

	req := httptest.NewRequest(http.MethodGet, "/lodash", nil)
	req.RemoteAddr = "10.0.0.5:1234"
	req.Host = "proxy:8080"
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "packages.example.test")
	rec := httptest.NewRecorder()
	ok := resolver.OnProxyMetadata(rec, req, "lodash")

	assert.True(t, ok)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "https://packages.example.test/lodash/-/lodash-1.0.0.tgz")
}

func TestNpmMetadataIgnoresForwardedHeadersFromUntrustedPeer(t *testing.T) {
	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{"versions":{"1.0.0":{"dist":{"tarball":"`+upstream.URL+`/lodash/-/lodash-1.0.0.tgz"}}}}`)
	}))
	defer upstream.Close()

	resolver := &npmResolver{
		cfg: npmConfig{
			upstreamRegistry: upstream.URL,
			trustedProxyNets: []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")},
			metadataMaxSize:  32 << 20,
		},
		httpClient: upstream.Client(),
	}

	req := httptest.NewRequest(http.MethodGet, "/lodash", nil)
	req.RemoteAddr = "203.0.113.10:1234"
	req.Host = "127.0.0.1:8080"
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "packages.example.test")
	rec := httptest.NewRecorder()
	ok := resolver.OnProxyMetadata(rec, req, "lodash")

	assert.True(t, ok)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "http://127.0.0.1:8080/lodash/-/lodash-1.0.0.tgz")
}

func TestNPMSecurityAuditPassthroughRejectsOversizedRequestBody(t *testing.T) {
	upstreamCalled := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamCalled = true
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	resolver := &npmResolver{
		cfg: npmConfig{
			upstreamRegistry:  upstream.URL,
			auditMaxBodyBytes: 8,
		},
		httpClient: upstream.Client(),
	}

	req := httptest.NewRequest(http.MethodPost, "/-/npm/v1/security/audits/quick", strings.NewReader("123456789"))
	rec := httptest.NewRecorder()

	ok := resolver.OnProxyMetadata(rec, req, "-/npm/v1/security/audits/quick")

	assert.False(t, ok)
	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
	assert.Contains(t, rec.Body.String(), "request body exceeded 8 bytes limit")
	assert.False(t, upstreamCalled)
}

func TestNPMSecurityAuditPassthroughForwardsBoundedRequestBody(t *testing.T) {
	const requestBody = `{"name":"pkg","dependencies":{"lodash":"4.17.21"}}`

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		assert.Equal(t, requestBody, string(body))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()

	resolver := &npmResolver{
		cfg: npmConfig{
			upstreamRegistry:  upstream.URL,
			auditMaxBodyBytes: len(requestBody),
		},
		httpClient: upstream.Client(),
	}

	req := httptest.NewRequest(http.MethodPost, "/-/npm/v1/security/audits/quick", strings.NewReader(requestBody))
	rec := httptest.NewRecorder()

	ok := resolver.OnProxyMetadata(rec, req, "-/npm/v1/security/audits/quick")

	assert.True(t, ok)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"ok":true}`, rec.Body.String())
}

func TestNpmMetadataPopulatesPackageMetadataCache(t *testing.T) {
	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{
			"dist-tags":{"latest":"4.17.21"},
			"time":{
				"created":"2026-01-01T00:00:00Z",
				"modified":"2026-04-01T00:00:00Z",
				"4.17.21":"2026-03-01T00:00:00Z"
			},
			"versions":{
				"4.17.21":{"dist":{"tarball":"`+upstream.URL+`/lodash/-/lodash-4.17.21.tgz"}}
			}
		}`)
	}))
	defer upstream.Close()

	walStore := testutil.MakeTempWAL(t)
	metadataCache := metadata.NewCache(5 * time.Minute)
	resolver := &npmResolver{
		cfg: npmConfig{
			upstreamRegistry: upstream.URL,
			publicBaseURL:    "https://proxy.example.com",
			metadataMaxSize:  32 << 20,
		},
		httpClient:    upstream.Client(),
		metadataCache: metadataCache,
		signalDedupe:  metadata.NewSignalDedupe(5 * time.Minute),
		wal:           walStore,
	}

	req := httptest.NewRequest(http.MethodGet, "/lodash", nil)
	rec := httptest.NewRecorder()

	ok := resolver.OnProxyMetadata(rec, req, "lodash")
	require.True(t, ok)

	summary, state, found := metadataCache.Get(metadata.CacheKey{Ecosystem: "npm", Package: "lodash"})
	require.True(t, found)
	assert.Equal(t, metadata.LookupStateHit, state)
	assert.Equal(t, "4.17.21", summary.LatestVersion)
	assert.Equal(t, "2026-03-01T00:00:00Z", summary.LatestPublishedAt)
	assert.Equal(t, "2026-03-01T00:00:00Z", summary.VersionPublishTimes["4.17.21"])

	require.Eventually(t, func() bool {
		records, err := walStore.UndeliveredRecords()
		if err != nil || len(records) != 1 {
			return false
		}
		if records[0].RecordType != wal.RecordTypePackageLatestMetadata {
			return false
		}
		var payload wal.PackageLatestMetadata
		if err := json.Unmarshal(records[0].Payload, &payload); err != nil {
			return false
		}
		return payload.Package == "lodash" && payload.LatestVersion == "4.17.21"
	}, 2*time.Second, 20*time.Millisecond)
}

func TestNpmMetadataDedupesUnchangedLatestSignal(t *testing.T) {
	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{
			"dist-tags":{"latest":"1.0.0"},
			"time":{"1.0.0":"2026-01-01T00:00:00Z"},
			"versions":{"1.0.0":{"dist":{"tarball":"`+upstream.URL+`/pkg/-/pkg-1.0.0.tgz"}}}
		}`)
	}))
	defer upstream.Close()

	walStore := testutil.MakeTempWAL(t)
	resolver := &npmResolver{
		cfg: npmConfig{
			upstreamRegistry: upstream.URL,
			publicBaseURL:    "https://proxy.example.com",
			metadataMaxSize:  32 << 20,
		},
		httpClient:    upstream.Client(),
		metadataCache: metadata.NewCache(5 * time.Minute),
		signalDedupe:  metadata.NewSignalDedupe(5 * time.Minute),
		wal:           walStore,
	}

	req := httptest.NewRequest(http.MethodGet, "/pkg", nil)
	rec := httptest.NewRecorder()
	require.True(t, resolver.OnProxyMetadata(rec, req, "pkg"))

	rec2 := httptest.NewRecorder()
	require.True(t, resolver.OnProxyMetadata(rec2, req, "pkg"))

	require.Eventually(t, func() bool {
		records, err := walStore.UndeliveredRecords()
		return err == nil && len(records) == 1
	}, 2*time.Second, 20*time.Millisecond)
}

func TestNpmMetadataDedupesPackageContributorMetadataAndCarriesPackageState(t *testing.T) {
	var upstream *httptest.Server
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{
			"dist-tags":{"latest":"1.1.0"},
			"time":{
				"created":"2026-01-01T00:00:00Z",
				"modified":"2026-04-01T00:00:00Z",
				"1.0.0":"2026-03-01T00:00:00Z",
				"1.1.0":"2026-03-15T00:00:00Z"
			},
			"versions":{
				"1.0.0":{
					"_npmUser":{"name":"alice"},
					"maintainers":[{"name":"alice"}],
					"dist":{"tarball":"`+upstream.URL+`/pkg/-/pkg-1.0.0.tgz"}
				},
				"1.1.0":{
					"_npmUser":{"name":"bob"},
					"maintainers":[{"name":"alice"},{"name":"bob"}],
					"scripts":{"postinstall":"node postinstall.js"},
					"dist":{
						"tarball":"`+upstream.URL+`/pkg/-/pkg-1.1.0.tgz",
						"attestations":{}
					}
				}
			}
		}`)
	}))
	defer upstream.Close()

	walStore := testutil.MakeTempWAL(t)
	resolver := &npmResolver{
		cfg: npmConfig{
			upstreamRegistry: upstream.URL,
			publicBaseURL:    "https://proxy.example.com",
			metadataMaxSize:  32 << 20,
			contributor: npmContributorConfig{
				enabled:            true,
				prefetchWindowDays: 90,
			},
		},
		httpClient:       upstream.Client(),
		metadataCache:    metadata.NewCache(5 * time.Minute),
		contributorCache: mustContributorCache(t),
		signalDedupe:     metadata.NewSignalDedupe(5 * time.Minute),
		wal:              walStore,
	}

	req := httptest.NewRequest(http.MethodGet, "/pkg", nil)
	rec := httptest.NewRecorder()
	require.True(t, resolver.OnProxyMetadata(rec, req, "pkg"))

	rec2 := httptest.NewRecorder()
	require.True(t, resolver.OnProxyMetadata(rec2, req, "pkg"))

	require.Eventually(t, func() bool {
		records, err := walStore.UndeliveredRecords()
		if err != nil || len(records) != 2 {
			return false
		}

		var contributor wal.PackageContributorMetadata
		for _, record := range records {
			if record.RecordType != wal.RecordTypePackageContributorMetadata {
				continue
			}
			if err := json.Unmarshal(record.Payload, &contributor); err != nil {
				return false
			}
		}

		return contributor.Package == "pkg" &&
			contributor.Fingerprint != "" &&
			contributor.LatestVersion == "1.1.0" &&
			contributor.LatestPublishedAt == "2026-03-15T00:00:00Z" &&
			contributor.OldestIncludedPublishedAt == "2026-03-01T00:00:00Z" &&
			!contributor.HistoryComplete &&
			len(contributor.Versions) == 2
	}, 2*time.Second, 20*time.Millisecond)
}
