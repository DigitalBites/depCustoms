package client_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	gatewayv1 "github.com/getcustoms/proxy/gen/customs/v1"
	"github.com/getcustoms/proxy/internal/client"
	"github.com/getcustoms/proxy/internal/metadata"
	"github.com/getcustoms/proxy/internal/testutil"
	"github.com/getcustoms/proxy/internal/wal"
)

const (
	testSecret  = "cxp_test_secret"
	testProxyID = "test-proxy-id"
)

func TestExchangeRuntimeToken_StoresRuntimeToken(t *testing.T) {
	srv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		TokenExchangeFn: func(header http.Header) (int, any) {
			assert.Equal(t, testProxyID, header.Get("X-Proxy-Id"))
			assert.Equal(t, testSecret, header.Get("X-Proxy-Secret"))
			return 200, map[string]string{
				"access_token":  "runtime-jwt",
				"expires_at":    "2030-01-01T00:15:00Z",
				"refresh_after": "2030-01-01T00:12:00Z",
			}
		},
	})

	cl := client.New(srv.URL, testSecret, testProxyID)
	refreshAfter, err := cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)
	assert.Equal(t, time.Date(2030, 1, 1, 0, 12, 0, 0, time.UTC), refreshAfter)
	assert.False(t, cl.TokenExpired(time.Now()))
}

func TestExchangeRuntimeToken_PermanentBootstrapError(t *testing.T) {
	srv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		TokenExchangeFn: func(_ http.Header) (int, any) {
			return 403, map[string]any{
				"error": map[string]any{
					"code":    "PROXY_DISABLED",
					"message": "Proxy is disabled",
				},
			}
		},
	})

	cl := client.New(srv.URL, testSecret, testProxyID)
	_, err := cl.ExchangeRuntimeToken(context.Background())
	require.Error(t, err)
	authErr, ok := err.(*client.BootstrapAuthError)
	require.True(t, ok)
	assert.True(t, authErr.Permanent())
	assert.Equal(t, "PROXY_DISABLED", authErr.Code)
}

func TestPing_UsesExchangeRuntimeToken(t *testing.T) {
	srv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		TokenExchangeFn: func(header http.Header) (int, any) {
			assert.Equal(t, testProxyID, header.Get("X-Proxy-Id"))
			assert.Equal(t, testSecret, header.Get("X-Proxy-Secret"))
			return 200, map[string]string{
				"access_token":  "runtime-jwt",
				"expires_at":    "2030-01-01T00:15:00Z",
				"refresh_after": "2030-01-01T00:12:00Z",
			}
		},
	})

	cl := client.New(srv.URL, testSecret, testProxyID)

	require.NoError(t, cl.Ping(context.Background()))
	assert.Equal(t, time.Date(2030, 1, 1, 0, 12, 0, 0, time.UTC), cl.RefreshAfter())
	assert.Equal(t, time.Date(2030, 1, 1, 0, 15, 0, 0, time.UTC), cl.ExpiresAt())
}

func TestEnsureRuntimeToken_UsesConfiguredRefresher(t *testing.T) {
	srv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		CheckFn: func(_ *gatewayv1.CheckRequest) (*gatewayv1.CheckResponse, error) {
			return testutil.CannedPingOK(), nil
		},
	})

	cl := client.New(srv.URL, testSecret, testProxyID)

	var (
		callCount int
		gotReason string
	)
	cl.SetRuntimeTokenRefresher(func(ctx context.Context, reason string) error {
		callCount++
		gotReason = reason
		_, err := cl.ExchangeRuntimeToken(ctx)
		return err
	})

	require.NoError(t, cl.RuntimePing(context.Background()))
	assert.Equal(t, 1, callCount)
	assert.Equal(t, "request", gotReason)
}

func TestRuntimePing_UsesBearerToken(t *testing.T) {
	srv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		CheckHeaderFn: func(header http.Header) {
			assert.Equal(t, "Bearer runtime-token", header.Get("Authorization"))
		},
		CheckFn: func(_ *gatewayv1.CheckRequest) (*gatewayv1.CheckResponse, error) {
			return testutil.CannedPingOK(), nil
		},
	})

	cl := client.New(srv.URL, testSecret, testProxyID)
	_, err := cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)
	require.NoError(t, cl.RuntimePing(context.Background()))
}

func TestCheck_MapsAllFieldsAndUsesBearerToken(t *testing.T) {
	var captured *gatewayv1.CheckRequest

	srv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		CheckHeaderFn: func(header http.Header) {
			assert.Equal(t, "Bearer runtime-token", header.Get("Authorization"))
		},
		CheckFn: func(req *gatewayv1.CheckRequest) (*gatewayv1.CheckResponse, error) {
			captured = req
			return testutil.CannedAllow("t1", "p1", 60), nil
		},
	})

	cl := client.New(srv.URL, testSecret, testProxyID)
	_, err := cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	resp, err := cl.Check(context.Background(), client.CheckRequest{
		ProjectToken: "raw-token",
		Ecosystem:    "npm",
		Package:      "lodash",
		Version:      "4.17.15",
		TraceID:      "trace-abc",
		RequestID:    "req-123",
		SpanID:       "span-456",
		ClientIP:     "1.2.3.4",
	})
	require.NoError(t, err)

	require.NotNil(t, captured)
	assert.Equal(t, "raw-token", captured.ProjectToken)
	assert.Equal(t, "npm", captured.Ecosystem)
	assert.Equal(t, "lodash", captured.Package)
	assert.Equal(t, "4.17.15", captured.Version)
	assert.Equal(t, "trace-abc", captured.TraceId)
	assert.Equal(t, "req-123", captured.RequestId)
	assert.Equal(t, "span-456", captured.SpanId)
	assert.Equal(t, "1.2.3.4", captured.ClientIp)

	assert.Equal(t, "DECISION_ALLOW", resp.Decision)
	assert.Equal(t, "t1", resp.TenantID)
	assert.Equal(t, "p1", resp.ProjectID)
}

func TestEventStream_SendAndReceiveCount(t *testing.T) {
	var captured []*gatewayv1.RecordUsageRequest

	srv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		RecordUsageFn: func(events []*gatewayv1.RecordUsageRequest) (*gatewayv1.RecordUsageResponse, error) {
			captured = events
			return &gatewayv1.RecordUsageResponse{Recorded: int32(len(events))}, nil
		},
	})

	cl := client.New(srv.URL, testSecret, testProxyID)
	_, err := cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	stream := cl.OpenEventStream(context.Background())
	e := wal.Event{
		Ecosystem:        "npm",
		Package:          "lodash",
		Version:          "4.17.15",
		Decision:         "DECISION_ALLOW",
		EventType:        "artifact",
		DecisionCache:    true,
		RequestedAt:      time.Now().UTC().Format(time.RFC3339),
		ProjectTokenHash: "hash-1",
		ClientIP:         "1.2.3.4",
	}

	require.NoError(t, stream.Send(e))
	assert.Equal(t, 1, stream.Sent())
	count, err := stream.CloseAndReceive()
	require.NoError(t, err)
	assert.Equal(t, int32(1), count)
	require.Len(t, captured, 1)
	assert.Equal(t, "lodash", captured[0].Package)
}

func TestRecordProxyStatus_UsesBearerToken(t *testing.T) {
	var captured *gatewayv1.RecordProxyStatusRequest

	srv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		RecordProxyStatusHeaderFn: func(header http.Header) {
			assert.Equal(t, "Bearer runtime-token", header.Get("Authorization"))
		},
		RecordProxyStatusFn: func(req *gatewayv1.RecordProxyStatusRequest) (*gatewayv1.RecordProxyStatusResponse, error) {
			captured = req
			return &gatewayv1.RecordProxyStatusResponse{}, nil
		},
	})

	cl := client.New(srv.URL, testSecret, testProxyID)
	_, err := cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	require.NoError(t, cl.RecordProxyStatus(context.Background(), "control_plane_available"))
	require.NotNil(t, captured)
	assert.Equal(t, "control_plane_available", captured.GetEvent().GetEventType())
}

func TestRecordPackageLatestMetadata_UsesBearerToken(t *testing.T) {
	var captured *gatewayv1.RecordPackageLatestMetadataRequest

	srv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		RecordPackageLatestMetadataHeaderFn: func(header http.Header) {
			assert.Equal(t, "Bearer runtime-token", header.Get("Authorization"))
		},
		RecordPackageLatestMetadataFn: func(req *gatewayv1.RecordPackageLatestMetadataRequest) (*gatewayv1.RecordPackageLatestMetadataResponse, error) {
			captured = req
			return &gatewayv1.RecordPackageLatestMetadataResponse{}, nil
		},
	})

	cl := client.New(srv.URL, testSecret, testProxyID)
	_, err := cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	require.NoError(t, cl.RecordPackageLatestMetadata(context.Background(), wal.PackageLatestMetadata{
		Ecosystem:         "npm",
		Package:           "lodash",
		LatestVersion:     "4.17.21",
		LatestPublishedAt: "2026-01-02T00:00:00Z",
		ObservedAt:        "2026-01-03T00:00:00Z",
		CacheStatus:       "refresh",
	}))

	require.NotNil(t, captured)
	assert.Equal(t, "lodash", captured.Package)
	assert.Equal(t, "4.17.21", captured.LatestVersion)
	assert.Equal(t, gatewayv1.MetadataCacheStatus_METADATA_CACHE_STATUS_REFRESH, captured.CacheStatus)
}

func TestRecordWALRecord_UsedVersionMetadata(t *testing.T) {
	var captured *gatewayv1.RecordPackageUsedVersionMetadataRequest

	srv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		RecordPackageUsedVersionMetadataFn: func(req *gatewayv1.RecordPackageUsedVersionMetadataRequest) (*gatewayv1.RecordPackageUsedVersionMetadataResponse, error) {
			captured = req
			return &gatewayv1.RecordPackageUsedVersionMetadataResponse{}, nil
		},
	})

	cl := client.New(srv.URL, testSecret, testProxyID)
	_, err := cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	payload, err := json.Marshal(wal.PackageUsedVersionMetadata{
		Ecosystem:              "npm",
		Package:                "rolldown",
		UsedVersion:            "1.0.0-rc.13",
		UsedVersionPublishedAt: "2026-01-04T00:00:00Z",
		ObservedAt:             "2026-01-05T00:00:00Z",
		CacheStatus:            "hit",
		LatestVersion:          "1.0.0-rc.13",
		LatestPublishedAt:      "2026-01-04T00:00:00Z",
	})
	require.NoError(t, err)

	record := wal.Record{
		SchemaVersion: wal.SchemaVersionV1,
		RecordType:    wal.RecordTypePackageUsedVersionMetadata,
		RecordedAt:    "2026-01-05T00:00:00Z",
		Payload:       payload,
	}

	require.NoError(t, cl.RecordWALRecord(context.Background(), record))
	require.NotNil(t, captured)
	assert.Equal(t, "rolldown", captured.Package)
	assert.Equal(t, "1.0.0-rc.13", captured.UsedVersion)
	assert.Equal(t, gatewayv1.MetadataCacheStatus_METADATA_CACHE_STATUS_HIT, captured.CacheStatus)
}

func TestRecordWALRecord_PackageContributorMetadata(t *testing.T) {
	var captured *gatewayv1.RecordPackageContributorMetadataRequest

	srv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		RecordPackageContributorMetadataHeaderFn: func(header http.Header) {
			assert.Equal(t, "Bearer runtime-token", header.Get("Authorization"))
		},
		RecordPackageContributorMetadataFn: func(req *gatewayv1.RecordPackageContributorMetadataRequest) (*gatewayv1.RecordPackageContributorMetadataResponse, error) {
			captured = req
			return &gatewayv1.RecordPackageContributorMetadataResponse{}, nil
		},
	})

	cl := client.New(srv.URL, testSecret, testProxyID)
	_, err := cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	payload, err := json.Marshal(wal.PackageContributorMetadata{
		Ecosystem:                 "npm",
		Package:                   "pkg",
		ExtractedAt:               "2026-04-15T00:00:00Z",
		Fingerprint:               "pkg-fingerprint",
		LatestVersion:             "1.1.0",
		LatestPublishedAt:         "2026-04-14T00:00:00Z",
		HistoryComplete:           false,
		OldestIncludedPublishedAt: "2026-04-01T00:00:00Z",
		Versions: []wal.PackageContributorVersion{
			{
				Version:           "1.0.0",
				PublishedAt:       "2026-04-01T00:00:00Z",
				Publisher:         "alice",
				Maintainers:       []string{"alice"},
				HasInstallScripts: false,
				HasAttestation:    false,
			},
			{
				Version:           "1.1.0",
				PublishedAt:       "2026-04-14T00:00:00Z",
				Publisher:         "bob",
				Maintainers:       []string{"alice", "bob"},
				HasInstallScripts: true,
				HasAttestation:    true,
			},
		},
	})
	require.NoError(t, err)

	record := wal.Record{
		SchemaVersion: wal.SchemaVersionV1,
		RecordType:    wal.RecordTypePackageContributorMetadata,
		RecordedAt:    "2026-04-15T00:00:00Z",
		Payload:       payload,
	}

	require.NoError(t, cl.RecordWALRecord(context.Background(), record))
	require.NotNil(t, captured)
	assert.Equal(t, "pkg", captured.Package)
	assert.Equal(t, "pkg-fingerprint", captured.Fingerprint)
	assert.Equal(t, "1.1.0", captured.LatestVersion)
	assert.Equal(t, "2026-04-14T00:00:00Z", captured.LatestPublishedAt)
	assert.False(t, captured.HistoryComplete)
	assert.Equal(t, "2026-04-01T00:00:00Z", captured.OldestIncludedPublishedAt)
	require.Len(t, captured.Versions, 2)
	assert.Equal(t, "1.0.0", captured.Versions[0].Version)
	assert.Equal(t, "alice", captured.Versions[0].Publisher)
	assert.Equal(t, "1.1.0", captured.Versions[1].Version)
	assert.True(t, captured.Versions[1].HasInstallScripts)
	assert.True(t, captured.Versions[1].HasAttestation)
}

func TestRecordMetadataCacheStats_UsesBearerToken(t *testing.T) {
	var captured *gatewayv1.RecordMetadataCacheStatsRequest

	srv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		RecordMetadataCacheStatsHeaderFn: func(header http.Header) {
			assert.Equal(t, "Bearer runtime-token", header.Get("Authorization"))
		},
		RecordMetadataCacheStatsFn: func(req *gatewayv1.RecordMetadataCacheStatsRequest) (*gatewayv1.RecordMetadataCacheStatsResponse, error) {
			captured = req
			return &gatewayv1.RecordMetadataCacheStatsResponse{}, nil
		},
	})

	cl := client.New(srv.URL, testSecret, testProxyID)
	_, err := cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	require.NoError(t, cl.RecordMetadataCacheStats(context.Background(), metadata.CacheStatsWindow{
		Ecosystem:     "npm",
		Hits:          10,
		Misses:        4,
		StaleHits:     2,
		Refreshes:     6,
		ParseFailures: 1,
		StoreFailures: 0,
		WindowStarted: time.Date(2026, 4, 8, 22, 0, 0, 0, time.UTC),
		WindowEnded:   time.Date(2026, 4, 8, 22, 5, 0, 0, time.UTC),
	}))

	require.NotNil(t, captured)
	assert.Equal(t, "npm", captured.Ecosystem)
	assert.EqualValues(t, 10, captured.Hits)
	assert.EqualValues(t, 4, captured.Misses)
	assert.EqualValues(t, 2, captured.StaleHits)
}
