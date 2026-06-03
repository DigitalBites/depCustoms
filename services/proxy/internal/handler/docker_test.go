package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	gatewayv1 "github.com/getcustoms/proxy/gen/customs/v1"
	"github.com/getcustoms/proxy/internal/cache"
	"github.com/getcustoms/proxy/internal/client"
	"github.com/getcustoms/proxy/internal/config"
	"github.com/getcustoms/proxy/internal/metadata"
	"github.com/getcustoms/proxy/internal/pkgmeta"
	"github.com/getcustoms/proxy/internal/testutil"
	"github.com/getcustoms/proxy/internal/wal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeDockerResolver stands in for the production dockerResolver in readiness
// E2E tests so we don't have to stub the full Docker registry protocol. It
// emits PackageRequests in the same shape prepareManifestRequest would
// produce: IsArtifact, Package="hub.docker.io/<repo>", RequestedRef=<tag>,
// Version=<resolved digest>.
type fakeDockerResolver struct {
	pkg          string
	requestedRef string
	resolvedRef  string
}

func (r *fakeDockerResolver) Ecosystem() string { return "docker" }

func (r *fakeDockerResolver) ParseRequest(_ *http.Request) PackageRequest {
	return PackageRequest{
		Package:      r.pkg,
		Version:      r.resolvedRef,
		RequestedRef: r.requestedRef,
		ResolvedRef:  r.resolvedRef,
		IsArtifact:   true,
		ArtifactKey:  "manifest",
	}
}

func (r *fakeDockerResolver) PreparePolicyRequest(_ http.ResponseWriter, _ *http.Request, req PackageRequest, _ string) (PackageRequest, bool) {
	return req, true
}

func (r *fakeDockerResolver) OnServeAllowed(w http.ResponseWriter, _ *http.Request, _ PackageRequest, _ string) ServeOutcome {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
	return ServeOutcome{ServeMode: ServeModePull, BytesTransferred: 2}
}

func (r *fakeDockerResolver) OnProxyMetadata(_ http.ResponseWriter, _ *http.Request, _ string) bool {
	return true
}

const (
	dockerE2EDigestMatch    = "sha256:11111111111111111111111111111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	dockerE2EDigestMismatch = "sha256:22222222222222222222222222222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
)

// TestDockerArtifactSubmitsVerifiedPublishTimeBeforeCheck exercises the full
// engine readiness flow for a Docker Hub manifest cache miss:
//
//   - Docker Hub tag metadata is fetched and the resolved manifest digest is
//     verified against the tag response;
//   - the verified publish time is submitted as PackageUsedVersionMetadata via
//     direct RPC BEFORE the Check call;
//   - the happy path writes nothing to the advisory WAL.
func TestDockerArtifactSubmitsVerifiedPublishTimeBeforeCheck(t *testing.T) {
	var usedSubmits []*gatewayv1.RecordPackageUsedVersionMetadataRequest
	var lastUsedSubmitAt, checkAt time.Time

	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		CheckFn: func(_ *gatewayv1.CheckRequest) (*gatewayv1.CheckResponse, error) {
			checkAt = time.Now()
			return testutil.CannedAllow("tenant-1", "project-1", 300), nil
		},
		RecordPackageUsedVersionMetadataFn: func(r *gatewayv1.RecordPackageUsedVersionMetadataRequest) (*gatewayv1.RecordPackageUsedVersionMetadataResponse, error) {
			lastUsedSubmitAt = time.Now()
			usedSubmits = append(usedSubmits, r)
			return &gatewayv1.RecordPackageUsedVersionMetadataResponse{}, nil
		},
	})

	hub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v2/repositories/library/redis/tags/7.0", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"digest": "` + dockerE2EDigestMatch + `",
			"last_updated": "2024-08-20T10:00:00Z",
			"images": []
		}`))
	}))
	defer hub.Close()

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	walStore := testutil.MakeTempWAL(t)
	acks := metadata.NewAckCache(5 * time.Minute)
	submitter := metadata.NewSubmitter(cl, acks, 2*time.Second)

	deps := Dependencies{
		DecisionCache:        cache.New(),
		PackageMetadataCache: metadata.NewCache(5 * time.Minute),
		MetadataSubmitter:    submitter,
		DockerHubLookup: &pkgmeta.DockerHubTagLookup{
			BaseURL: hub.URL,
			Client:  hub.Client(),
		},
		ControlPlane: cl,
		WAL:          walStore,
	}
	cfg := &config.Config{
		ProxyID:            "test-proxy",
		ControlPlaneURL:    cpSrv.URL,
		ControlPlaneSecret: "cxp_test",
		CacheTTLSeconds:    300,
	}

	resolver := &fakeDockerResolver{
		pkg:          "hub.docker.io/library/redis",
		requestedRef: "7.0",
		resolvedRef:  dockerE2EDigestMatch,
	}
	h := newEngine(deps, cfg, resolver)

	req := httptest.NewRequest(http.MethodGet, "/v2/library/redis/manifests/7.0", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	require.Len(t, usedSubmits, 1)
	assert.Equal(t, "hub.docker.io/library/redis", usedSubmits[0].Package)
	assert.Equal(t, dockerE2EDigestMatch, usedSubmits[0].UsedVersion)
	assert.Equal(t, "2024-08-20T10:00:00Z", usedSubmits[0].UsedVersionPublishedAt)
	assert.True(t, lastUsedSubmitAt.Before(checkAt), "metadata submit must complete before Check")

	records, err := walStore.UndeliveredRecords()
	require.NoError(t, err)
	for _, record := range records {
		assert.NotEqual(t, wal.RecordTypePackageUsedVersionMetadata, record.RecordType,
			"happy path must not enqueue WAL used-version metadata backfill")
	}
}

// TestDockerArtifactWithheldPublishTimeOnDigestMismatch verifies that when the
// resolved manifest digest does not match what Docker Hub reports for the tag,
// the submitted metadata carries an empty UsedVersionPublishedAt — the rule's
// null-handling takes over and the request still proceeds.
func TestDockerArtifactWithheldPublishTimeOnDigestMismatch(t *testing.T) {
	var usedSubmits []*gatewayv1.RecordPackageUsedVersionMetadataRequest

	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		RecordPackageUsedVersionMetadataFn: func(r *gatewayv1.RecordPackageUsedVersionMetadataRequest) (*gatewayv1.RecordPackageUsedVersionMetadataResponse, error) {
			usedSubmits = append(usedSubmits, r)
			return &gatewayv1.RecordPackageUsedVersionMetadataResponse{}, nil
		},
	})

	hub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"digest": "` + dockerE2EDigestMatch + `",
			"last_updated": "2024-08-20T10:00:00Z",
			"images": []
		}`))
	}))
	defer hub.Close()

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	walStore := testutil.MakeTempWAL(t)
	acks := metadata.NewAckCache(5 * time.Minute)
	submitter := metadata.NewSubmitter(cl, acks, 2*time.Second)

	deps := Dependencies{
		DecisionCache:        cache.New(),
		PackageMetadataCache: metadata.NewCache(5 * time.Minute),
		MetadataSubmitter:    submitter,
		DockerHubLookup: &pkgmeta.DockerHubTagLookup{
			BaseURL: hub.URL,
			Client:  hub.Client(),
		},
		ControlPlane: cl,
		WAL:          walStore,
	}
	cfg := &config.Config{
		ProxyID:            "test-proxy",
		ControlPlaneURL:    cpSrv.URL,
		ControlPlaneSecret: "cxp_test",
		CacheTTLSeconds:    300,
	}

	resolver := &fakeDockerResolver{
		pkg:          "hub.docker.io/library/redis",
		requestedRef: "7.0",
		resolvedRef:  dockerE2EDigestMismatch,
	}
	h := newEngine(deps, cfg, resolver)

	req := httptest.NewRequest(http.MethodGet, "/v2/library/redis/manifests/7.0", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	require.Len(t, usedSubmits, 1)
	assert.Equal(t, dockerE2EDigestMismatch, usedSubmits[0].UsedVersion)
	assert.Empty(t, usedSubmits[0].UsedVersionPublishedAt,
		"digest mismatch must yield empty publish time so rule null-handling takes over")
}

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

func TestDockerCleanupPreparedRequestDeletesPrefetchedManifest(t *testing.T) {
	resolver := &dockerResolver{}
	req := httptest.NewRequest("GET", "/v2/alpine/manifests/3.20", nil)

	resolver.preparedByReq.Store(req, dockerPreparedResponse{body: []byte("manifest")})
	resolver.CleanupPreparedRequest(req)

	_, ok := resolver.preparedByReq.Load(req)
	assert.False(t, ok)
}

func TestDockerTokenRealmHostAllowed(t *testing.T) {
	assert.True(t, dockerTokenRealmHostAllowed(dockerHubNetworkRegistry, dockerHubTokenRealmHost))
	assert.False(t, dockerTokenRealmHostAllowed(dockerHubNetworkRegistry, "registry-1.docker.io"))
	assert.True(t, dockerTokenRealmHostAllowed("ghcr.io", "ghcr.io"))
	assert.True(t, dockerTokenRealmHostAllowed("registry.example.com:5000", "registry.example.com"))
	assert.False(t, dockerTokenRealmHostAllowed("ghcr.io", "auth.example.com"))
}

func TestDockerValidateTokenRealmRequiresHTTPS(t *testing.T) {
	resolver := &dockerResolver{cfg: dockerConfig{allowPrivateUpstreams: true}}
	realmURL, err := url.Parse("http://ghcr.io/token")
	require.NoError(t, err)

	err = resolver.validateTokenRealm(dockerParsedRequest{networkRegistry: "ghcr.io"}, realmURL)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "https")
}

func TestDockerValidateTokenRealmRejectsWrongHost(t *testing.T) {
	resolver := &dockerResolver{cfg: dockerConfig{allowPrivateUpstreams: true}}
	realmURL, err := url.Parse("https://auth.example.com/token")
	require.NoError(t, err)

	err = resolver.validateTokenRealm(dockerParsedRequest{networkRegistry: "ghcr.io"}, realmURL)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "not allowed")
}

func TestDockerValidateTokenRealmRejectsPrivateHostByDefault(t *testing.T) {
	resolver := &dockerResolver{}
	realmURL, err := url.Parse("https://127.0.0.1:5000/token")
	require.NoError(t, err)

	err = resolver.validateTokenRealm(dockerParsedRequest{networkRegistry: "127.0.0.1:5000"}, realmURL)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "private or reserved")
}

func TestDockerTokenForChallengeValidatesRealmBeforeCacheHit(t *testing.T) {
	resolver := &dockerResolver{
		cfg:        dockerConfig{authTokenTTLSeconds: 300, allowPrivateUpstreams: true},
		tokenCache: &dockerTokenCache{entries: make(map[string]dockerTokenEntry)},
	}
	parsed := dockerParsedRequest{networkRegistry: "ghcr.io", repository: "org/image"}
	resolver.tokenCache.Set("ghcr.io|registry.example|repository:org/image:pull", "cached-token", 5*time.Minute)

	token, err := resolver.tokenForChallenge(context.Background(), parsed, dockerBearerChallenge{
		realm:   "https://auth.example.com/token",
		service: "registry.example",
	})

	require.Error(t, err)
	assert.Empty(t, token)
	assert.Contains(t, err.Error(), "not allowed")
}

func TestExtractDockerDescriptorsIncludesIndexManifests(t *testing.T) {
	body := []byte(`{
		"schemaVersion": 2,
		"mediaType": "application/vnd.oci.image.index.v1+json",
		"manifests": [
			{
				"mediaType": "application/vnd.oci.image.manifest.v1+json",
				"digest": "sha256:amd64",
				"size": 123
			},
			{
				"mediaType": "application/vnd.oci.image.manifest.v1+json",
				"digest": "sha256:arm64",
				"size": 456
			}
		]
	}`)

	descriptors := extractDockerDescriptors("application/vnd.oci.image.index.v1+json", body)

	require.Len(t, descriptors, 2)
	assert.Equal(t, "sha256:amd64", descriptors[0].digest)
	assert.Equal(t, int64(123), descriptors[0].size)
	assert.Equal(t, "sha256:arm64", descriptors[1].digest)
}

func TestBuildDockerRelatedVersionsClassifiesIndexChildren(t *testing.T) {
	body := []byte(`{
		"schemaVersion": 2,
		"mediaType": "application/vnd.oci.image.index.v1+json",
		"manifests": [
			{
				"mediaType": "application/vnd.oci.image.manifest.v1+json",
				"digest": "sha256:arm64",
				"size": 456,
				"platform": {"os": "linux", "architecture": "arm64", "variant": "v8"}
			}
		]
	}`)

	related := buildDockerRelatedVersions("application/vnd.oci.image.index.v1+json", body)

	require.Len(t, related, 1)
	assert.Equal(t, "sha256:arm64", related[0].Version)
	assert.Equal(t, "digest", related[0].VersionKind)
	assert.Equal(t, "docker_manifest", related[0].ArtifactKind)
	assert.Equal(t, "child", related[0].DisplayRole)
	assert.Equal(t, "index_manifest", related[0].RelationshipType)
	assert.Equal(t, "linux", related[0].PlatformOS)
	assert.Equal(t, "arm64", related[0].PlatformArch)
	assert.Equal(t, "v8", related[0].PlatformVariant)
}

func TestBuildDockerRelatedVersionsClassifiesManifestBlobs(t *testing.T) {
	body := []byte(`{
		"schemaVersion": 2,
		"config": {
			"mediaType": "application/vnd.oci.image.config.v1+json",
			"digest": "sha256:config",
			"size": 123
		},
		"layers": [
			{
				"mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
				"digest": "sha256:layer",
				"size": 789
			}
		]
	}`)

	related := buildDockerRelatedVersions("application/vnd.oci.image.manifest.v1+json", body)

	require.Len(t, related, 2)
	assert.Equal(t, "sha256:config", related[0].Version)
	assert.Equal(t, "docker_blob", related[0].ArtifactKind)
	assert.Equal(t, "internal", related[0].DisplayRole)
	assert.Equal(t, "manifest_config", related[0].RelationshipType)
	assert.Equal(t, "sha256:layer", related[1].Version)
	assert.Equal(t, "manifest_layer", related[1].RelationshipType)
}
