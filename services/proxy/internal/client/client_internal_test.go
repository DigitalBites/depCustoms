package client

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	customsv1 "github.com/getcustoms/proxy/gen/customs/v1"
	"github.com/getcustoms/proxy/internal/testutil"
	"github.com/getcustoms/proxy/internal/wal"
)

func TestBootstrapAuthErrorHelpers(t *testing.T) {
	assert.Equal(t, "", (*BootstrapAuthError)(nil).Error())
	assert.Equal(t, "", (*UnsupportedWALRecordTypeError)(nil).Error())

	authErr := &BootstrapAuthError{StatusCode: 403, Code: "PROXY_DISABLED", Message: "disabled"}
	assert.Contains(t, authErr.Error(), "disabled")
	assert.True(t, authErr.Permanent())

	transient := &BootstrapAuthError{StatusCode: 503, Message: "unavailable"}
	assert.False(t, transient.Permanent())

	clientErr := &BootstrapAuthError{StatusCode: 401, Message: "unauthorized"}
	assert.True(t, clientErr.Permanent())

	unsupported := &UnsupportedWALRecordTypeError{RecordType: "future_record"}
	assert.Contains(t, unsupported.Error(), "future_record")
	assert.True(t, IsUnsupportedWALRecordType(unsupported))
	assert.False(t, IsUnsupportedWALRecordType(errors.New("nope")))
}

func TestCheck_MapsContributorContextAndDefaultServeMode(t *testing.T) {
	var captured *customsv1.CheckRequest

	srv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		CheckFn: func(req *customsv1.CheckRequest) (*customsv1.CheckResponse, error) {
			captured = req
			return &customsv1.CheckResponse{
				Decision:        customsv1.Decision_DECISION_BLOCK,
				Reason:          "policy_rule",
				Detail:          "blocked",
				CacheTtlSeconds: 42,
				ServeMode:       customsv1.ServeMode_SERVE_MODE_UNSPECIFIED,
				TenantId:        "tenant-1",
				ProjectId:       "project-1",
			}, nil
		},
	})

	cl := New(srv.URL, "cxp_test", "test-proxy")
	_, err := cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	resp, err := cl.Check(context.Background(), CheckRequest{
		ProjectToken: "raw-token",
		Ecosystem:    "npm",
		Package:      "pkg",
		Version:      "1.0.0",
		ContributorContext: &ContributorCheckContext{
			RequestedVersion:               "1.0.0",
			RequestedVersionPublishedAt:    "2026-01-01T00:00:00Z",
			SliceExtractedAt:               "2026-01-02T00:00:00Z",
			SliceWindowDays:                90,
			SliceHistoryComplete:           true,
			SliceOldestIncludedPublishedAt: "2025-10-01T00:00:00Z",
			PackageMetadataFingerprint:     "pkg-fingerprint",
			SliceFingerprint:               "slice-fingerprint",
			Versions: []ContributorCheckVersion{{
				Version:           "1.0.0",
				PublishedAt:       "2026-01-01T00:00:00Z",
				Publisher:         "alice",
				Maintainers:       []string{"alice", "bob"},
				HasInstallScripts: true,
				HasAttestation:    true,
				RawPayloadJSON:    `{"name":"pkg"}`,
			}},
		},
	})
	require.NoError(t, err)

	require.NotNil(t, captured)
	require.NotNil(t, captured.ContributorContext)
	require.Len(t, captured.ContributorContext.Versions, 1)
	assert.Equal(t, "1.0.0", captured.ContributorContext.RequestedVersion)
	assert.Equal(t, `{"name":"pkg"}`, captured.ContributorContext.Versions[0].RawPayloadJson)

	assert.Equal(t, "DECISION_BLOCK", resp.Decision)
	assert.Equal(t, "SERVE_MODE_REDIRECT", resp.ServeMode)
}

func TestOpenEventStream_ReturnsStoredAuthError(t *testing.T) {
	cl := New("http://example.com", "cxp_test", "test-proxy")
	cl.SetRuntimeTokenRefresher(func(context.Context, string) error {
		return errors.New("refresh failed")
	})

	stream := cl.OpenEventStream(context.Background())
	err := stream.Send(wal.Event{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "refresh failed")

	_, err = stream.CloseAndReceive()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "refresh failed")
}

func TestParseHelpers(t *testing.T) {
	assert.Equal(t, customsv1.EventType_EVENT_TYPE_METADATA, parseEventType("metadata"))
	assert.Equal(t, customsv1.EventType_EVENT_TYPE_ARTIFACT, parseEventType("artifact"))
	assert.Equal(t, customsv1.EventType_EVENT_TYPE_UPSTREAM_ERROR, parseEventType("upstream_error"))
	assert.Equal(t, customsv1.EventType_EVENT_TYPE_UNSPECIFIED, parseEventType("unknown"))

	assert.Equal(t, customsv1.ServeMode_SERVE_MODE_REDIRECT, parseServeMode("SERVE_MODE_REDIRECT"))
	assert.Equal(t, customsv1.ServeMode_SERVE_MODE_PULL, parseServeMode("SERVE_MODE_PULL"))
	assert.Equal(t, customsv1.ServeMode_SERVE_MODE_UNSPECIFIED, parseServeMode(""))

	assert.Equal(t, customsv1.MetadataCacheStatus_METADATA_CACHE_STATUS_HIT, parseMetadataCacheStatus("hit"))
	assert.Equal(t, customsv1.MetadataCacheStatus_METADATA_CACHE_STATUS_MISS, parseMetadataCacheStatus("miss"))
	assert.Equal(t, customsv1.MetadataCacheStatus_METADATA_CACHE_STATUS_STALE, parseMetadataCacheStatus("stale"))
	assert.Equal(t, customsv1.MetadataCacheStatus_METADATA_CACHE_STATUS_REFRESH, parseMetadataCacheStatus("refresh"))
	assert.Equal(t, customsv1.MetadataCacheStatus_METADATA_CACHE_STATUS_UNSPECIFIED, parseMetadataCacheStatus("nope"))
}

func TestWALRecordConverters(t *testing.T) {
	latestPayload, err := json.Marshal(wal.PackageLatestMetadata{
		Ecosystem:         "npm",
		Package:           "left-pad",
		LatestVersion:     "1.3.0",
		LatestPublishedAt: "2026-01-01T00:00:00Z",
		ObservedAt:        "2026-01-02T00:00:00Z",
		CacheStatus:       "refresh",
	})
	require.NoError(t, err)

	latest, err := walRecordToLatestMetadata(wal.Record{
		SchemaVersion: wal.SchemaVersionV1,
		RecordType:    wal.RecordTypePackageLatestMetadata,
		Payload:       latestPayload,
	})
	require.NoError(t, err)
	assert.Equal(t, "left-pad", latest.Package)

	_, err = walRecordToLatestMetadata(wal.Record{RecordType: wal.RecordTypePackageUsedVersionMetadata})
	require.Error(t, err)

	_, err = walRecordToLatestMetadata(wal.Record{
		RecordType: wal.RecordTypePackageLatestMetadata,
		Payload:    json.RawMessage(`{"bad"`),
	})
	require.Error(t, err)

	contributorPayload, err := json.Marshal(wal.PackageContributorMetadata{
		Ecosystem: "npm",
		Package:   "pkg",
		Versions:  []wal.PackageContributorVersion{{Version: "1.0.0"}},
	})
	require.NoError(t, err)
	contributor, err := walRecordToPackageContributorMetadata(wal.Record{
		RecordType: wal.RecordTypePackageContributorMetadata,
		Payload:    contributorPayload,
	})
	require.NoError(t, err)
	assert.Equal(t, "pkg", contributor.Package)

	_, err = walRecordToPackageContributorMetadata(wal.Record{
		RecordType: wal.RecordTypePackageContributorMetadata,
		Payload:    json.RawMessage(`{`),
	})
	require.Error(t, err)
}

func TestRecordWALRecord_UnsupportedType(t *testing.T) {
	cl := New("http://example.com", "cxp_test", "test-proxy")

	err := cl.RecordWALRecord(context.Background(), wal.Record{RecordType: "future_record"})
	require.Error(t, err)
	assert.True(t, IsUnsupportedWALRecordType(err))
}

func TestRecordProxyStatus_PropagatesRPCError(t *testing.T) {
	srv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		RecordProxyStatusFn: func(req *customsv1.RecordProxyStatusRequest) (*customsv1.RecordProxyStatusResponse, error) {
			return nil, connect.NewError(connect.CodeUnavailable, errors.New("offline"))
		},
	})

	cl := New(srv.URL, "cxp_test", "test-proxy")
	_, err := cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	err = cl.RecordProxyStatus(context.Background(), "proxy_service_running")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "RecordProxyStatus RPC")
}

func TestWalEventToProto_MapsBlockDecision(t *testing.T) {
	msg := walEventToProto(wal.Event{
		Ecosystem:        "npm",
		Package:          "pkg",
		Version:          "1.0.0",
		Decision:         "DECISION_BLOCK",
		EventType:        "upstream_error",
		ServeMode:        "SERVE_MODE_PULL",
		RequestedAt:      "2026-01-01T00:00:00Z",
		ProjectTokenHash: "hash",
		DecisionCache:    true,
		DurationMs:       12,
		DecisionPath:     "check",
		ClientIP:         "1.2.3.4",
	})

	assert.Equal(t, customsv1.Decision_DECISION_BLOCK, msg.Decision)
	assert.Equal(t, customsv1.EventType_EVENT_TYPE_UPSTREAM_ERROR, msg.EventType)
	assert.Equal(t, customsv1.ServeMode_SERVE_MODE_PULL, msg.ServeMode)
}
