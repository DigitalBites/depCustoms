package handler_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	gatewayv1 "github.com/getcustoms/proxy/gen/customs/v1"
	"github.com/getcustoms/proxy/internal/cache"
	"github.com/getcustoms/proxy/internal/client"
	"github.com/getcustoms/proxy/internal/config"
	"github.com/getcustoms/proxy/internal/handler"
	"github.com/getcustoms/proxy/internal/metadata"
	"github.com/getcustoms/proxy/internal/testutil"
	"github.com/getcustoms/proxy/internal/tokenctx"
	"github.com/getcustoms/proxy/internal/wal"
)

const bearerToken = "Bearer test-token"
const testTokenHash = "4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e"

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

func makeTestDeps(t *testing.T, cpSrv *httptest.Server) (*cache.Cache, *client.Client, *config.Config, *wal.WAL, *metadata.Cache, *metadata.ContributorCache, *metadata.SignalDedupe) {
	t.Helper()
	c := cache.New()
	cfg := &config.Config{
		ProxyID:                               "test-proxy",
		ControlPlaneURL:                       cpSrv.URL,
		ControlPlaneSecret:                    "cxp_test",
		CacheTTLSeconds:                       300,
		PackageMetadataCacheTTLSeconds:        300,
		PackageMetadataSignalDedupeTTLSeconds: 300,
		FlushIntervalSeconds:                  10,
		FlushMaxEvents:                        100,
		EventRetentionHours:                   48,
	}
	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	w := testutil.MakeTempWAL(t)
	return c, cl, cfg, w, metadata.NewCache(5 * time.Minute), mustContributorCache(t), metadata.NewSignalDedupe(5 * time.Minute)
}

func makeHandlerDeps(
	c *cache.Cache,
	cl *client.Client,
	w *wal.WAL,
	tc *tokenctx.Cache,
	mc *metadata.Cache,
	cc *metadata.ContributorCache,
	sd *metadata.SignalDedupe,
) handler.Dependencies {
	acks := metadata.NewAckCache(5 * time.Minute)
	return handler.Dependencies{
		DecisionCache:        c,
		TokenContextCache:    tc,
		PackageMetadataCache: mc,
		ContributorCache:     cc,
		SignalDedupe:         sd,
		MetadataSubmitter:    metadata.NewSubmitter(cl, acks, 2*time.Second),
		ControlPlane:         cl,
		WAL:                  w,
	}
}

// ---------------------------------------------------------------------------
// Full request flows
// ---------------------------------------------------------------------------

func TestFullRequestFlow_Allow(t *testing.T) {
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		CheckFn: func(_ *gatewayv1.CheckRequest) (*gatewayv1.CheckResponse, error) {
			return testutil.CannedAllow("tenant-1", "project-1", 300), nil
		},
	})

	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)
	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, nil, mc, cc, sd), cfg)

	req := httptest.NewRequest("GET", "/lodash/-/lodash-4.17.15.tgz", nil)
	req.Header.Set("Authorization", bearerToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	// Redirect (302) — proxy never fetches in SERVE_MODE_REDIRECT
	assert.Equal(t, http.StatusFound, rec.Code)
	assert.NotEmpty(t, rec.Header().Get("Location"))
}

func TestFullRequestFlow_Block(t *testing.T) {
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		CheckFn: func(_ *gatewayv1.CheckRequest) (*gatewayv1.CheckResponse, error) {
			return testutil.CannedBlock("policy_rule"), nil
		},
	})

	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)
	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, nil, mc, cc, sd), cfg)

	req := httptest.NewRequest("GET", "/bad-pkg/-/bad-pkg-1.0.0.tgz", nil)
	req.Header.Set("Authorization", bearerToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusForbidden, rec.Code)
}

func TestFullRequestFlow_CacheHit(t *testing.T) {
	var cpCallCount int
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		CheckFn: func(_ *gatewayv1.CheckRequest) (*gatewayv1.CheckResponse, error) {
			cpCallCount++
			return testutil.CannedAllow("tenant-1", "project-1", 300), nil
		},
	})

	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)
	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, nil, mc, cc, sd), cfg)

	// Pre-populate cache so the first request is a cache hit
	key := cache.CacheKey{
		ProjectTokenHash: testTokenHash,
		Ecosystem:        "npm",
		Package:          "lodash",
		Version:          "4.17.15",
	}
	c.Set(key, cache.CacheEntry{
		Decision:        "DECISION_ALLOW",
		CacheTTLSeconds: 300,
		CachedAt:        time.Now(),
		ServeMode:       "SERVE_MODE_REDIRECT",
		TenantID:        "tenant-1",
		ProjectID:       "project-1",
	})

	req := httptest.NewRequest("GET", "/lodash/-/lodash-4.17.15.tgz", nil)
	req.Header.Set("Authorization", bearerToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusFound, rec.Code)
	assert.Equal(t, 0, cpCallCount, "control plane should not be called on cache hit")
}

func TestFullRequestFlow_CacheBlock(t *testing.T) {
	cpSrv := testutil.MakeMockCP(t, nil)
	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)
	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, nil, mc, cc, sd), cfg)

	key := cache.CacheKey{
		ProjectTokenHash: testTokenHash,
		Ecosystem:        "npm",
		Package:          "blocked-pkg",
		Version:          "1.0.0",
	}
	c.Set(key, cache.CacheEntry{
		Decision:        "DECISION_BLOCK",
		Reason:          "policy_rule",
		CacheTTLSeconds: 300,
		CachedAt:        time.Now(),
	})

	req := httptest.NewRequest("GET", "/blocked-pkg/-/blocked-pkg-1.0.0.tgz", nil)
	req.Header.Set("Authorization", bearerToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusForbidden, rec.Code)
}

func TestFullRequestFlow_InvalidTokenBlockCachedByTokenHash(t *testing.T) {
	var cpCallCount int
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		CheckFn: func(_ *gatewayv1.CheckRequest) (*gatewayv1.CheckResponse, error) {
			cpCallCount++
			resp := testutil.CannedBlock("invalid_token")
			resp.CacheTtlSeconds = 0
			return resp, nil
		},
	})

	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)
	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, nil, mc, cc, sd), cfg)

	firstReq := httptest.NewRequest("GET", "/lodash/-/lodash-4.17.15.tgz", nil)
	firstReq.Header.Set("Authorization", bearerToken)
	firstRec := httptest.NewRecorder()
	h.ServeHTTP(firstRec, firstReq)

	secondReq := httptest.NewRequest("GET", "/left-pad/-/left-pad-1.0.0.tgz", nil)
	secondReq.Header.Set("Authorization", bearerToken)
	secondRec := httptest.NewRecorder()
	h.ServeHTTP(secondRec, secondReq)

	assert.Equal(t, http.StatusForbidden, firstRec.Code)
	assert.Equal(t, http.StatusForbidden, secondRec.Code)
	assert.Equal(t, 1, cpCallCount, "invalid tokens should be blocked locally after the first failed check")

	events, err := w.UndeliveredEvents()
	require.NoError(t, err)
	require.Len(t, events, 1, "repeated cached invalid-token blocks should not create WAL spam")
	assert.Equal(t, "check", events[0].DecisionPath)
}

func TestFullRequestFlow_CPDown_FailClosed(t *testing.T) {
	// CP server that immediately closes connections
	cpSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Hijack and close to simulate unreachable CP
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	t.Cleanup(cpSrv.Close)

	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)
	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, nil, mc, cc, sd), cfg)

	req := httptest.NewRequest("GET", "/lodash/-/lodash-4.17.15.tgz", nil)
	req.Header.Set("Authorization", bearerToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	// Cache miss + CP unavailable → fail closed (503)
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
}

func TestFullRequestFlow_CPDown_UsesTokenContextCacheForWALAttribution(t *testing.T) {
	checkCount := 0
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		CheckFn: func(_ *gatewayv1.CheckRequest) (*gatewayv1.CheckResponse, error) {
			checkCount++
			if checkCount == 1 {
				return testutil.CannedAllow("tenant-1", "project-1", 300), nil
			}
			return nil, connect.NewError(connect.CodeUnavailable, errors.New("control plane unavailable"))
		},
	})

	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)
	tc := tokenctx.New(15 * time.Minute)
	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, tc, mc, cc, sd), cfg)

	firstReq := httptest.NewRequest("GET", "/pkg/-/pkg-1.0.0.tgz", nil)
	firstReq.Header.Set("Authorization", bearerToken)
	firstRec := httptest.NewRecorder()
	h.ServeHTTP(firstRec, firstReq)
	require.Equal(t, http.StatusFound, firstRec.Code)

	secondReq := httptest.NewRequest("GET", "/pkg/-/pkg-2.0.0.tgz", nil)
	secondReq.Header.Set("Authorization", bearerToken)
	secondRec := httptest.NewRecorder()
	h.ServeHTTP(secondRec, secondReq)
	require.Equal(t, http.StatusServiceUnavailable, secondRec.Code)

	records, err := w.UndeliveredRecords()
	require.NoError(t, err)

	var secondEvent wal.Event
	found := false
	for i := len(records) - 1; i >= 0; i-- {
		event, ok := wal.UsageEventFromRecord(records[i])
		if ok && event.DecisionPath == "control_plane_unavailable" {
			secondEvent = event
			found = true
			break
		}
	}
	require.True(t, found)
	assert.Equal(t, "tenant-1", secondEvent.TenantID)
	assert.Equal(t, "project-1", secondEvent.ProjectID)
	assert.Equal(t, "control_plane_unavailable", secondEvent.DecisionPath)
}

func TestPyPIMalformedArtifactPathReturnsNotFound(t *testing.T) {
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		CheckFn: func(_ *gatewayv1.CheckRequest) (*gatewayv1.CheckResponse, error) {
			t.Fatal("control plane should not be called for malformed PyPI artifact paths")
			return nil, nil
		},
	})

	c, cl, cfg, w, _, _, _ := makeTestDeps(t, cpSrv)
	h := handler.NewPyPIProxy(makeHandlerDeps(c, cl, w, nil, nil, nil, nil), cfg)

	req := httptest.NewRequest(http.MethodGet, "/pypi/packages/aa/bb/cc/artifact.tgz", nil)
	req.Header.Set("Authorization", bearerToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Contains(t, rec.Body.String(), "could not parse package from path")
}

func TestArtifactCheckCarriesContributorContextFromWarmedMetadata(t *testing.T) {
	var capturedCheck *gatewayv1.CheckRequest

	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		CheckFn: func(req *gatewayv1.CheckRequest) (*gatewayv1.CheckResponse, error) {
			capturedCheck = req
			return testutil.CannedAllow("tenant-1", "project-1", 300), nil
		},
	})

	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)
	cfg.ContributorEnabled = true
	cfg.ContributorPrefetchWindowDays = 365
	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, nil, mc, cc, sd), cfg)

	err := cc.Set(metadata.CacheKey{Ecosystem: "npm", Package: "pkg"}, metadata.ContributorPackage{
		Ecosystem:                 "npm",
		Package:                   "pkg",
		Fingerprint:               "pkg-fingerprint",
		ExtractedAt:               "2026-04-15T00:00:00Z",
		LatestVersion:             "1.1.0",
		LatestPublishedAt:         "2026-04-01T00:00:00Z",
		HistoryComplete:           false,
		OldestIncludedPublishedAt: "2026-03-01T00:00:00Z",
		Versions: []metadata.ContributorVersion{
			{
				Version:           "1.0.0",
				PublishedAt:       "2026-03-01T00:00:00Z",
				Publisher:         "alice",
				Maintainers:       []string{"alice"},
				HasInstallScripts: false,
				HasAttestation:    false,
				RawPayloadJSON:    `{"_npmUser":{"name":"alice"}}`,
			},
			{
				Version:           "1.1.0",
				PublishedAt:       "2026-04-01T00:00:00Z",
				Publisher:         "bob",
				Maintainers:       []string{"alice", "bob"},
				HasInstallScripts: true,
				HasAttestation:    true,
				RawPayloadJSON:    `{"_npmUser":{"name":"bob"}}`,
			},
		},
	})
	require.NoError(t, err)

	req := httptest.NewRequest("GET", "/pkg/-/pkg-1.0.0.tgz", nil)
	req.Header.Set("Authorization", bearerToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	require.Equal(t, http.StatusFound, rec.Code)
	require.NotNil(t, capturedCheck)
	require.NotNil(t, capturedCheck.ContributorContext)
	assert.Equal(t, "1.0.0", capturedCheck.ContributorContext.RequestedVersion)
	assert.Equal(t, int32(365), capturedCheck.ContributorContext.SliceWindowDays)
	assert.Equal(t, "pkg-fingerprint", capturedCheck.ContributorContext.PackageMetadataFingerprint)
	require.Len(t, capturedCheck.ContributorContext.Versions, 1)
	assert.Equal(t, "1.0.0", capturedCheck.ContributorContext.Versions[0].Version)
	assert.Equal(t, "alice", capturedCheck.ContributorContext.Versions[0].Publisher)
	assert.Equal(t, `{"_npmUser":{"name":"alice"}}`, capturedCheck.ContributorContext.Versions[0].RawPayloadJson)
}

// ---------------------------------------------------------------------------
// WAL population
// ---------------------------------------------------------------------------

func TestWALPopulatedOnCacheHit(t *testing.T) {
	cpSrv := testutil.MakeMockCP(t, nil)
	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)
	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, nil, mc, cc, sd), cfg)

	key := cache.CacheKey{
		ProjectTokenHash: testTokenHash,
		Ecosystem:        "npm",
		Package:          "lodash",
		Version:          "4.17.15",
	}
	c.Set(key, cache.CacheEntry{
		Decision:        "DECISION_ALLOW",
		CacheTTLSeconds: 300,
		CachedAt:        time.Now(),
		ServeMode:       "SERVE_MODE_REDIRECT",
		TenantID:        "tenant-wal",
		ProjectID:       "project-wal",
	})

	req := httptest.NewRequest("GET", "/lodash/-/lodash-4.17.15.tgz", nil)
	req.Header.Set("Authorization", bearerToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	require.Equal(t, http.StatusFound, rec.Code)

	events, err := w.UndeliveredEvents()
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, "artifact", events[0].EventType)
	assert.True(t, events[0].DecisionCache)
	assert.Equal(t, "tenant-wal", events[0].TenantID)
	assert.Equal(t, "project-wal", events[0].ProjectID)
	// serve_mode must reflect what the proxy actually did, not just what it was told.
	assert.Equal(t, "SERVE_MODE_REDIRECT", events[0].ServeMode)
}

func TestCacheHitAllowFailsClosedWhenWALAppendFails(t *testing.T) {
	cpSrv := testutil.MakeMockCP(t, nil)
	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)
	require.NoError(t, w.Close())
	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, nil, mc, cc, sd), cfg)

	key := cache.CacheKey{
		ProjectTokenHash: testTokenHash,
		Ecosystem:        "npm",
		Package:          "lodash",
		Version:          "4.17.15",
	}
	c.Set(key, cache.CacheEntry{
		Decision:        "DECISION_ALLOW",
		CacheTTLSeconds: 300,
		CachedAt:        time.Now(),
		ServeMode:       "SERVE_MODE_REDIRECT",
		TenantID:        "tenant-wal",
		ProjectID:       "project-wal",
	})

	req := httptest.NewRequest("GET", "/lodash/-/lodash-4.17.15.tgz", nil)
	req.Header.Set("Authorization", bearerToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	assert.Empty(t, rec.Header().Get("Location"))
}

func TestCacheHitBlockFailsClosedWhenWALAppendFails(t *testing.T) {
	cpSrv := testutil.MakeMockCP(t, nil)
	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)
	require.NoError(t, w.Close())
	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, nil, mc, cc, sd), cfg)

	key := cache.CacheKey{
		ProjectTokenHash: testTokenHash,
		Ecosystem:        "npm",
		Package:          "blocked-pkg",
		Version:          "1.0.0",
	}
	c.Set(key, cache.CacheEntry{
		Decision:        "DECISION_BLOCK",
		Reason:          "policy_rule",
		CacheTTLSeconds: 300,
		CachedAt:        time.Now(),
		TenantID:        "tenant-wal",
		ProjectID:       "project-wal",
	})

	req := httptest.NewRequest("GET", "/blocked-pkg/-/blocked-pkg-1.0.0.tgz", nil)
	req.Header.Set("Authorization", bearerToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	assert.Contains(t, rec.Body.String(), "audit log unavailable")
}

func TestWALPopulatedOnFreshCheck(t *testing.T) {
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		CheckFn: func(_ *gatewayv1.CheckRequest) (*gatewayv1.CheckResponse, error) {
			return testutil.CannedAllow("tenant-fresh", "project-fresh", 300), nil
		},
	})

	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)
	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, nil, mc, cc, sd), cfg)

	req := httptest.NewRequest("GET", "/lodash/-/lodash-4.17.15.tgz", nil)
	req.Header.Set("Authorization", bearerToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	require.Equal(t, http.StatusFound, rec.Code)

	events, err := w.UndeliveredEvents()
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, "artifact", events[0].EventType)
	assert.False(t, events[0].DecisionCache)
	assert.Equal(t, "tenant-fresh", events[0].TenantID)
	assert.Equal(t, "project-fresh", events[0].ProjectID)
	// serve_mode must reflect what the proxy actually did.
	assert.Equal(t, "SERVE_MODE_REDIRECT", events[0].ServeMode)
}

func TestWALPopulatedOnCacheHit_PullMode(t *testing.T) {
	cpSrv := testutil.MakeMockCP(t, nil)
	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)

	// Pre-seed cache with PULL so no CP call is made.
	key := cache.CacheKey{ProjectTokenHash: testTokenHash, Ecosystem: "npm", Package: "lodash", Version: "4.17.15"}
	c.Set(key, cache.CacheEntry{
		Decision:        "DECISION_ALLOW",
		CacheTTLSeconds: 300,
		CachedAt:        time.Now(),
		ServeMode:       "SERVE_MODE_PULL",
		TenantID:        "tenant-pull",
		ProjectID:       "project-pull",
	})

	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, nil, mc, cc, sd), cfg)
	req := httptest.NewRequest("GET", "/lodash/-/lodash-4.17.15.tgz", nil)
	req.Header.Set("Authorization", bearerToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	// The upstream pull attempt may fail (no real npm in tests); that's fine.
	// pullFromUpstream always returns ServeOutcome{ServeMode: ServeModePull, ...}
	// so the WAL event must record SERVE_MODE_PULL regardless of upstream outcome.
	events, err := w.UndeliveredEvents()
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, "SERVE_MODE_PULL", events[0].ServeMode, "WAL must record what the proxy actually did")
}

// ---------------------------------------------------------------------------
// Correlation headers — present on all responses
// ---------------------------------------------------------------------------

func TestCorrelationHeaders_OnBlock(t *testing.T) {
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		CheckFn: func(_ *gatewayv1.CheckRequest) (*gatewayv1.CheckResponse, error) {
			return testutil.CannedBlock("policy_rule"), nil
		},
	})

	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)
	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, nil, mc, cc, sd), cfg)

	req := httptest.NewRequest("GET", "/pkg/-/pkg-1.0.0.tgz", nil)
	req.Header.Set("Authorization", bearerToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	assert.NotEmpty(t, rec.Header().Get("X-Customs-Request-Id"))
	assert.NotEmpty(t, rec.Header().Get("X-Customs-Trace-Id"))
}

func TestCorrelationHeaders_OnAllow(t *testing.T) {
	cpSrv := testutil.MakeMockCP(t, nil)
	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)
	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, nil, mc, cc, sd), cfg)

	req := httptest.NewRequest("GET", "/lodash/-/lodash-4.17.15.tgz", nil)
	req.Header.Set("Authorization", bearerToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	assert.NotEmpty(t, rec.Header().Get("X-Customs-Request-Id"))
	assert.NotEmpty(t, rec.Header().Get("X-Customs-Trace-Id"))
}

func TestCorrelationHeaders_On401(t *testing.T) {
	cpSrv := testutil.MakeMockCP(t, nil)
	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)
	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, nil, mc, cc, sd), cfg)

	req := httptest.NewRequest("GET", "/lodash/-/lodash-4.17.15.tgz", nil)
	// No Authorization header
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.NotEmpty(t, rec.Header().Get("X-Customs-Request-Id"))
}

func TestCorrelationHeaders_On404(t *testing.T) {
	cpSrv := testutil.MakeMockCP(t, nil)
	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)
	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, nil, mc, cc, sd), cfg)

	// Unparseable npm path
	req := httptest.NewRequest("GET", "/not/a/valid/npm/path/at/all", nil)
	req.Header.Set("Authorization", bearerToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.NotEmpty(t, rec.Header().Get("X-Customs-Request-Id"))
}

// ---------------------------------------------------------------------------
// Ping fast-fail
// ---------------------------------------------------------------------------

func TestPingFailsFastOnUnregistered(t *testing.T) {
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		TokenExchangeFn: func(_ http.Header) (int, any) {
			return 401, map[string]any{
				"error": map[string]any{
					"code":    "UNREGISTERED_PROXY",
					"message": "Proxy is not registered",
				},
			}
		},
	})

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	err := cl.Ping(context.Background())
	require.Error(t, err)
}

// TestArtifactRequest_SubmitsUsedVersionMetadataFromWarmCache verifies that on
// a decision-cache miss the readiness step submits cached used-version
// metadata via the foreground RPC before Check is called.
func TestArtifactRequest_SubmitsUsedVersionMetadataFromWarmCache(t *testing.T) {
	var submitted []*gatewayv1.RecordPackageUsedVersionMetadataRequest
	var submitTime, checkTime time.Time
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		CheckFn: func(_ *gatewayv1.CheckRequest) (*gatewayv1.CheckResponse, error) {
			checkTime = time.Now()
			return testutil.CannedAllow("tenant-1", "project-1", 300), nil
		},
		RecordPackageUsedVersionMetadataFn: func(r *gatewayv1.RecordPackageUsedVersionMetadataRequest) (*gatewayv1.RecordPackageUsedVersionMetadataResponse, error) {
			submitTime = time.Now()
			submitted = append(submitted, r)
			return &gatewayv1.RecordPackageUsedVersionMetadataResponse{}, nil
		},
	})
	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)
	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, nil, mc, cc, sd), cfg)

	mc.Set(metadata.CacheKey{Ecosystem: "npm", Package: "lodash"}, metadata.Summary{
		Ecosystem:         "npm",
		Package:           "lodash",
		LatestVersion:     "4.17.21",
		LatestPublishedAt: "2026-03-01T00:00:00Z",
		FetchedAt:         time.Now(),
		VersionPublishTimes: map[string]string{
			"4.17.15": "2025-01-01T00:00:00Z",
			"4.17.21": "2026-03-01T00:00:00Z",
		},
	})

	req := httptest.NewRequest("GET", "/lodash/-/lodash-4.17.15.tgz", nil)
	req.Header.Set("Authorization", bearerToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	require.Equal(t, http.StatusFound, rec.Code)
	require.Len(t, submitted, 1)
	assert.Equal(t, "lodash", submitted[0].Package)
	assert.Equal(t, "4.17.15", submitted[0].UsedVersion)
	assert.Equal(t, "2025-01-01T00:00:00Z", submitted[0].UsedVersionPublishedAt)
	assert.Equal(t, "4.17.21", submitted[0].LatestVersion)
	assert.True(t, submitTime.Before(checkTime), "metadata submit must complete before Check")

	for _, record := range undeliveredRecordsOrEmpty(t, w) {
		assert.NotEqual(t, wal.RecordTypePackageUsedVersionMetadata, record.RecordType,
			"happy path must not enqueue WAL backfill")
	}
}

// TestArtifactRequest_BackfillsSparseUsedVersionMetadataMiss verifies that on
// a cache miss with no freshness data the readiness step does not block Check
// on a foreground RPC. The sparse record is still queued to the advisory WAL.
func TestArtifactRequest_BackfillsSparseUsedVersionMetadataMiss(t *testing.T) {
	var submitted []*gatewayv1.RecordPackageUsedVersionMetadataRequest
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		CheckFn: func(_ *gatewayv1.CheckRequest) (*gatewayv1.CheckResponse, error) {
			return testutil.CannedAllow("tenant-1", "project-1", 300), nil
		},
		RecordPackageUsedVersionMetadataFn: func(r *gatewayv1.RecordPackageUsedVersionMetadataRequest) (*gatewayv1.RecordPackageUsedVersionMetadataResponse, error) {
			submitted = append(submitted, r)
			return &gatewayv1.RecordPackageUsedVersionMetadataResponse{}, nil
		},
	})
	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)
	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, nil, mc, cc, sd), cfg)

	req := httptest.NewRequest("GET", "/left-pad/-/left-pad-1.0.0.tgz", nil)
	req.Header.Set("Authorization", bearerToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	require.Equal(t, http.StatusFound, rec.Code)
	require.Empty(t, submitted)
	require.Eventually(t, func() bool {
		for _, record := range undeliveredRecordsOrEmpty(t, w) {
			if record.RecordType != wal.RecordTypePackageUsedVersionMetadata {
				continue
			}
			var payload wal.PackageUsedVersionMetadata
			if err := json.Unmarshal(record.Payload, &payload); err != nil {
				return false
			}
			return payload.Package == "left-pad" &&
				payload.UsedVersion == "1.0.0" &&
				payload.LatestVersion == ""
		}
		return false
	}, 2*time.Second, 20*time.Millisecond)
}

// TestArtifactRequest_DedupesUsedVersionMetadataByAck verifies that two
// requests for the same artifact only submit metadata once because the ACK
// cache records the first successful submission.
func TestArtifactRequest_DedupesUsedVersionMetadataByAck(t *testing.T) {
	var submitCount int
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		CheckFn: func(_ *gatewayv1.CheckRequest) (*gatewayv1.CheckResponse, error) {
			return testutil.CannedAllow("tenant-1", "project-1", 300), nil
		},
		RecordPackageUsedVersionMetadataFn: func(_ *gatewayv1.RecordPackageUsedVersionMetadataRequest) (*gatewayv1.RecordPackageUsedVersionMetadataResponse, error) {
			submitCount++
			return &gatewayv1.RecordPackageUsedVersionMetadataResponse{}, nil
		},
	})
	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)
	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, nil, mc, cc, sd), cfg)

	mc.Set(metadata.CacheKey{Ecosystem: "npm", Package: "pkg"}, metadata.Summary{
		Ecosystem:         "npm",
		Package:           "pkg",
		LatestVersion:     "1.0.0",
		LatestPublishedAt: "2026-01-01T00:00:00Z",
		FetchedAt:         time.Now(),
		VersionPublishTimes: map[string]string{
			"1.0.0": "2026-01-01T00:00:00Z",
		},
	})

	req := httptest.NewRequest("GET", "/pkg/-/pkg-1.0.0.tgz", nil)
	req.Header.Set("Authorization", bearerToken)

	rec1 := httptest.NewRecorder()
	h.ServeHTTP(rec1, req)
	require.Equal(t, http.StatusFound, rec1.Code)

	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req)
	require.Equal(t, http.StatusFound, rec2.Code)

	assert.Equal(t, 1, submitCount, "second request must be ack-cached")
}

// TestArtifactRequest_BackfillsUsedVersionMetadataOnSubmitFailure verifies
// that when the foreground submit fails the proxy enqueues a WAL backfill
// record so the catalog still converges.
func TestArtifactRequest_BackfillsUsedVersionMetadataOnSubmitFailure(t *testing.T) {
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		CheckFn: func(_ *gatewayv1.CheckRequest) (*gatewayv1.CheckResponse, error) {
			return testutil.CannedAllow("tenant-1", "project-1", 300), nil
		},
		RecordPackageUsedVersionMetadataFn: func(_ *gatewayv1.RecordPackageUsedVersionMetadataRequest) (*gatewayv1.RecordPackageUsedVersionMetadataResponse, error) {
			return nil, connect.NewError(connect.CodeUnavailable, errors.New("boom"))
		},
	})
	c, cl, cfg, w, mc, cc, sd := makeTestDeps(t, cpSrv)
	h := handler.NewNPMProxy(makeHandlerDeps(c, cl, w, nil, mc, cc, sd), cfg)

	mc.Set(metadata.CacheKey{Ecosystem: "npm", Package: "lodash"}, metadata.Summary{
		Ecosystem:         "npm",
		Package:           "lodash",
		LatestVersion:     "4.17.21",
		LatestPublishedAt: "2026-03-01T00:00:00Z",
		FetchedAt:         time.Now(),
		VersionPublishTimes: map[string]string{
			"4.17.15": "2025-01-01T00:00:00Z",
		},
	})

	req := httptest.NewRequest("GET", "/lodash/-/lodash-4.17.15.tgz", nil)
	req.Header.Set("Authorization", bearerToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	require.Equal(t, http.StatusFound, rec.Code)
	require.Eventually(t, func() bool {
		for _, record := range undeliveredRecordsOrEmpty(t, w) {
			if record.RecordType != wal.RecordTypePackageUsedVersionMetadata {
				continue
			}
			var payload wal.PackageUsedVersionMetadata
			if err := json.Unmarshal(record.Payload, &payload); err != nil {
				return false
			}
			if payload.Package == "lodash" && payload.UsedVersion == "4.17.15" {
				return true
			}
		}
		return false
	}, 2*time.Second, 20*time.Millisecond)
}

func undeliveredRecordsOrEmpty(t *testing.T, w *wal.WAL) []wal.Record {
	t.Helper()
	records, err := w.UndeliveredRecords()
	if err != nil {
		return nil
	}
	return records
}
