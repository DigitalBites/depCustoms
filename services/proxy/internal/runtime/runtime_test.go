package proxyruntime

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	gatewayv1 "github.com/getcustoms/proxy/gen/customs/v1"
	"github.com/getcustoms/proxy/internal/client"
	"github.com/getcustoms/proxy/internal/config"
	"github.com/getcustoms/proxy/internal/metadata"
	"github.com/getcustoms/proxy/internal/testutil"
	"github.com/getcustoms/proxy/internal/wal"
)

func TestBuildDependencies_ConstructsRuntimeCollaborators(t *testing.T) {
	dir := t.TempDir()
	cfg := &config.Config{
		WALPath:                               filepath.Join(dir, "events.ndjson"),
		CheckpointPath:                        filepath.Join(dir, "events.checkpoint"),
		TokenContextCacheTTLSeconds:           900,
		PackageMetadataCacheTTLSeconds:        300,
		PackageMetadataSignalDedupeTTLSeconds: 300,
		ContributorMetadataCachePath:          filepath.Join(dir, "contributor-cache.json"),
		ContributorMetadataVersionCap:         250,
		ContributorMetadataColdDays:           45,
		ControlPlaneURL:                       "http://localhost:3000",
		ControlPlaneSecret:                    "cxp_test",
		ProxyID:                               "test-proxy",
	}

	deps, err := BuildDependencies(cfg)
	require.NoError(t, err)
	require.NotNil(t, deps)
	assert.NotNil(t, deps.DecisionCache)
	assert.NotNil(t, deps.TokenContextCache)
	assert.NotNil(t, deps.PackageMetadataCache)
	assert.NotNil(t, deps.ContributorCache)
	assert.NotNil(t, deps.SignalDedupe)
	assert.NotNil(t, deps.WAL)
	assert.NotNil(t, deps.ControlPlane)
}

func TestBuildDependencies_PropagatesWALCreationError(t *testing.T) {
	dir := t.TempDir()
	blocker := filepath.Join(dir, "blocker")
	require.NoError(t, os.WriteFile(blocker, []byte("x"), 0o600))

	cfg := &config.Config{
		WALPath:                               filepath.Join(blocker, "events.ndjson"),
		CheckpointPath:                        filepath.Join(dir, "events.checkpoint"),
		TokenContextCacheTTLSeconds:           900,
		PackageMetadataCacheTTLSeconds:        300,
		PackageMetadataSignalDedupeTTLSeconds: 300,
		ContributorMetadataCachePath:          filepath.Join(dir, "contributor-cache.json"),
		ContributorMetadataVersionCap:         250,
		ContributorMetadataColdDays:           45,
		ControlPlaneURL:                       "http://localhost:3000",
		ControlPlaneSecret:                    "cxp_test",
		ProxyID:                               "test-proxy",
	}

	deps, err := BuildDependencies(cfg)
	require.Error(t, err)
	assert.Nil(t, deps)
}

func TestBuildDependencies_PropagatesContributorCacheError(t *testing.T) {
	dir := t.TempDir()
	blocker := filepath.Join(dir, "blocker")
	require.NoError(t, os.WriteFile(blocker, []byte("x"), 0o600))

	cfg := &config.Config{
		WALPath:                               filepath.Join(dir, "events.ndjson"),
		CheckpointPath:                        filepath.Join(dir, "events.checkpoint"),
		TokenContextCacheTTLSeconds:           900,
		PackageMetadataCacheTTLSeconds:        300,
		PackageMetadataSignalDedupeTTLSeconds: 300,
		ContributorMetadataCachePath:          filepath.Join(blocker, "contributor-cache.json"),
		ContributorMetadataVersionCap:         250,
		ContributorMetadataColdDays:           45,
		ControlPlaneURL:                       "http://localhost:3000",
		ControlPlaneSecret:                    "cxp_test",
		ProxyID:                               "test-proxy",
	}

	deps, err := BuildDependencies(cfg)
	require.Error(t, err)
	require.NotNil(t, deps)
	assert.Nil(t, deps.ContributorCache)
}

func TestRunUsageStreamManagerCompactsDeliveredEvents(t *testing.T) {
	dir := t.TempDir()
	walPath := filepath.Join(dir, "events.ndjson")
	checkpointPath := filepath.Join(dir, "events.checkpoint")

	w, err := wal.New(walPath, checkpointPath)
	require.NoError(t, err)

	oldEvent := wal.Event{
		Ecosystem:        "npm",
		Package:          "left-pad",
		Version:          "1.0.0",
		Decision:         "DECISION_ALLOW",
		EventType:        "artifact",
		RequestedAt:      time.Now().UTC().Add(-72 * time.Hour).Format(time.RFC3339),
		ProjectTokenHash: "hash-1",
	}
	require.NoError(t, w.Append(oldEvent))

	recordedCh := make(chan struct{}, 1)
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		RecordUsageFn: func(events []*gatewayv1.RecordUsageRequest) (*gatewayv1.RecordUsageResponse, error) {
			if len(events) == 1 && events[0].Package == "left-pad" {
				select {
				case recordedCh <- struct{}{}:
				default:
				}
			}
			return &gatewayv1.RecordUsageResponse{Recorded: int32(len(events))}, nil
		},
	})

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	_, err = cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)
	cfg := &config.Config{
		FlushIntervalSeconds: 1,
		FlushMaxEvents:       1,
		EventRetentionHours:  1,
	}

	notifyCh := make(chan struct{}, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	state := NewRuntimeState()
	state.SetControlPlaneReachable(true)
	state.SetAuthRefreshHealthy(true)

	done := make(chan struct{})
	go func() {
		defer close(done)
		runUsageStreamManager(ctx, w, cl, cfg, state, notifyCh)
	}()

	select {
	case <-recordedCh:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for RecordUsage")
	}

	require.Eventually(t, func() bool {
		data, err := os.ReadFile(walPath)
		return err == nil && len(data) == 0
	}, 5*time.Second, 50*time.Millisecond)

	cancel()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for stream manager shutdown")
	}

	w2, err := wal.New(walPath, checkpointPath)
	require.NoError(t, err)

	events, err := w2.UndeliveredEvents()
	require.NoError(t, err)
	assert.Empty(t, events)

	data, err := os.ReadFile(walPath)
	require.NoError(t, err)
	assert.Empty(t, string(data))
}

func TestBuildHTTPServer_ReportsTokenRefreshFailureSeparately(t *testing.T) {
	cfg := &config.Config{Port: 8080}
	state := NewRuntimeState()
	state.SetControlPlaneReachable(true)
	state.SetAuthRefreshHealthy(false)

	srv := BuildHTTPServer(cfg, &Dependencies{
		DecisionCache: nil,
		WAL:           nil,
		ControlPlane:  nil,
	}, state)

	req := httptest.NewRequest("GET", "/healthz", nil)
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)

	require.Equal(t, 503, rec.Code)
	assert.Contains(t, rec.Body.String(), "token_refresh_failed")
}

func TestStartBackgroundWorkers_RegistersWALNotifyChannel(t *testing.T) {
	dir := t.TempDir()
	w, err := wal.New(filepath.Join(dir, "events.ndjson"), filepath.Join(dir, "events.checkpoint"))
	require.NoError(t, err)

	deps := &Dependencies{
		WAL:                  w,
		ControlPlane:         client.New("http://127.0.0.1:1", "cxp_test", "test-proxy"),
		PackageMetadataCache: metadata.NewCache(5 * time.Minute),
	}
	cfg := &config.Config{
		FlushIntervalSeconds:                    60,
		FlushMaxEvents:                          10,
		EventRetentionHours:                     48,
		MetadataCacheStatsReportIntervalSeconds: 60,
	}
	state := NewRuntimeState()

	ctx, cancel := context.WithCancel(context.Background())
	notifyCh := StartBackgroundWorkers(ctx, cfg, deps, state)
	cancel()

	require.NotNil(t, notifyCh)
	require.NoError(t, w.Append(wal.Event{
		Ecosystem:        "npm",
		Package:          "pkg",
		Version:          "1.0.0",
		Decision:         "DECISION_ALLOW",
		EventType:        "artifact",
		RequestedAt:      time.Now().UTC().Format(time.RFC3339),
		ProjectTokenHash: "hash",
	}))

	select {
	case <-notifyCh:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for WAL notify signal")
	}
}

func TestRunUsageStreamManager_ReplaysMixedRecordTypesInOrder(t *testing.T) {
	dir := t.TempDir()
	walPath := filepath.Join(dir, "events.ndjson")
	checkpointPath := filepath.Join(dir, "events.checkpoint")

	w, err := wal.New(walPath, checkpointPath)
	require.NoError(t, err)

	require.NoError(t, w.Append(wal.Event{
		Ecosystem:        "npm",
		Package:          "left-pad",
		Version:          "1.0.0",
		Decision:         "DECISION_ALLOW",
		EventType:        "artifact",
		RequestedAt:      "2026-01-01T00:00:00Z",
		ProjectTokenHash: "hash-1",
	}))

	latestPayload, err := json.Marshal(wal.PackageLatestMetadata{
		Ecosystem:         "npm",
		Package:           "left-pad",
		LatestVersion:     "1.3.0",
		LatestPublishedAt: "2026-01-02T00:00:00Z",
		ObservedAt:        "2026-01-03T00:00:00Z",
		CacheStatus:       "refresh",
	})
	require.NoError(t, err)
	require.NoError(t, w.AppendRecord(wal.Record{
		SchemaVersion: wal.SchemaVersionV1,
		RecordType:    wal.RecordTypePackageLatestMetadata,
		RecordedAt:    "2026-01-03T00:00:00Z",
		Payload:       latestPayload,
	}))

	usedPayload, err := json.Marshal(wal.PackageUsedVersionMetadata{
		Ecosystem:              "npm",
		Package:                "left-pad",
		UsedVersion:            "1.0.0",
		UsedVersionPublishedAt: "2026-01-01T00:00:00Z",
		ObservedAt:             "2026-01-03T00:00:01Z",
		CacheStatus:            "hit",
		LatestVersion:          "1.3.0",
		LatestPublishedAt:      "2026-01-02T00:00:00Z",
	})
	require.NoError(t, err)
	require.NoError(t, w.AppendRecord(wal.Record{
		SchemaVersion: wal.SchemaVersionV1,
		RecordType:    wal.RecordTypePackageUsedVersionMetadata,
		RecordedAt:    "2026-01-03T00:00:01Z",
		Payload:       usedPayload,
	}))

	type observedCall struct {
		kind    string
		pkg     string
		version string
	}
	observed := make(chan observedCall, 3)

	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		RecordUsageFn: func(events []*gatewayv1.RecordUsageRequest) (*gatewayv1.RecordUsageResponse, error) {
			for _, event := range events {
				observed <- observedCall{kind: "usage", pkg: event.Package, version: event.Version}
			}
			return &gatewayv1.RecordUsageResponse{Recorded: int32(len(events))}, nil
		},
		RecordPackageLatestMetadataFn: func(req *gatewayv1.RecordPackageLatestMetadataRequest) (*gatewayv1.RecordPackageLatestMetadataResponse, error) {
			observed <- observedCall{kind: "latest", pkg: req.Package, version: req.LatestVersion}
			return &gatewayv1.RecordPackageLatestMetadataResponse{}, nil
		},
		RecordPackageUsedVersionMetadataFn: func(req *gatewayv1.RecordPackageUsedVersionMetadataRequest) (*gatewayv1.RecordPackageUsedVersionMetadataResponse, error) {
			observed <- observedCall{kind: "used", pkg: req.Package, version: req.UsedVersion}
			return &gatewayv1.RecordPackageUsedVersionMetadataResponse{}, nil
		},
	})

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	_, err = cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	cfg := &config.Config{
		FlushIntervalSeconds: 1,
		FlushMaxEvents:       10,
		EventRetentionHours:  48,
	}

	notifyCh := make(chan struct{}, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	state := NewRuntimeState()
	state.SetControlPlaneReachable(true)
	state.SetAuthRefreshHealthy(true)

	done := make(chan struct{})
	go func() {
		defer close(done)
		runUsageStreamManager(ctx, w, cl, cfg, state, notifyCh)
	}()

	var got []observedCall
	require.Eventually(t, func() bool {
		for len(observed) > 0 {
			got = append(got, <-observed)
		}
		return len(got) == 3
	}, 5*time.Second, 50*time.Millisecond)

	require.Equal(t, []observedCall{
		{kind: "usage", pkg: "left-pad", version: "1.0.0"},
		{kind: "latest", pkg: "left-pad", version: "1.3.0"},
		{kind: "used", pkg: "left-pad", version: "1.0.0"},
	}, got)

	w2, err := wal.New(walPath, checkpointPath)
	require.NoError(t, err)
	records, err := w2.UndeliveredRecords()
	require.NoError(t, err)
	assert.Empty(t, records)

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for stream manager shutdown")
	}
}

func TestRunUsageStreamManager_SkipsUnsupportedRecordTypes(t *testing.T) {
	dir := t.TempDir()
	walPath := filepath.Join(dir, "events.ndjson")
	checkpointPath := filepath.Join(dir, "events.checkpoint")

	w, err := wal.New(walPath, checkpointPath)
	require.NoError(t, err)

	unknownPayload, err := json.Marshal(map[string]any{
		"note": "future durable message",
	})
	require.NoError(t, err)
	require.NoError(t, w.AppendRecord(wal.Record{
		SchemaVersion: wal.SchemaVersionV1,
		RecordType:    "future_record_type",
		RecordedAt:    "2026-01-03T00:00:00Z",
		Payload:       unknownPayload,
	}))
	require.NoError(t, w.Append(wal.Event{
		Ecosystem:        "npm",
		Package:          "left-pad",
		Version:          "1.0.0",
		Decision:         "DECISION_ALLOW",
		EventType:        "artifact",
		RequestedAt:      "2026-01-03T00:00:01Z",
		ProjectTokenHash: "hash-1",
	}))

	recorded := make(chan string, 1)
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		RecordUsageFn: func(events []*gatewayv1.RecordUsageRequest) (*gatewayv1.RecordUsageResponse, error) {
			for _, event := range events {
				recorded <- event.Package
			}
			return &gatewayv1.RecordUsageResponse{Recorded: int32(len(events))}, nil
		},
	})

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	_, err = cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	cfg := &config.Config{
		FlushIntervalSeconds: 1,
		FlushMaxEvents:       10,
		EventRetentionHours:  48,
	}

	notifyCh := make(chan struct{}, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	state := NewRuntimeState()
	state.SetControlPlaneReachable(true)
	state.SetAuthRefreshHealthy(true)

	done := make(chan struct{})
	go func() {
		defer close(done)
		runUsageStreamManager(ctx, w, cl, cfg, state, notifyCh)
	}()

	require.Eventually(t, func() bool {
		return len(recorded) == 1
	}, 5*time.Second, 50*time.Millisecond)
	assert.Equal(t, "left-pad", <-recorded)

	w2, err := wal.New(walPath, checkpointPath)
	require.NoError(t, err)
	records, err := w2.UndeliveredRecords()
	require.NoError(t, err)
	assert.Empty(t, records)

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for stream manager shutdown")
	}
}

func TestInitializeControlPlaneAuth_LogsAndRecordsStartupEvent(t *testing.T) {
	var (
		logBuf       bytes.Buffer
		recordedType string
	)

	prev := slog.Default()
	logger := slog.New(slog.NewTextHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)
	defer slog.SetDefault(prev)

	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		RecordProxyStatusFn: func(req *gatewayv1.RecordProxyStatusRequest) (*gatewayv1.RecordProxyStatusResponse, error) {
			recordedType = req.GetEvent().GetEventType()
			return &gatewayv1.RecordProxyStatusResponse{}, nil
		},
	})

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	state := NewRuntimeState()

	require.NoError(t, InitializeControlPlaneAuth(context.Background(), cl, state))
	assert.True(t, state.ControlPlaneReachable())
	assert.True(t, state.AuthRefreshHealthy())
	assert.Equal(t, "proxy_service_running", recordedType)

	logs := logBuf.String()
	assert.True(t, strings.Contains(logs, "requesting control plane runtime token"), logs)
	assert.True(t, strings.Contains(logs, "control plane runtime token acquired"), logs)
	assert.True(t, strings.Contains(logs, "reason=startup"), logs)
}

func TestInitializeControlPlaneAuth_StartsDegradedOnTransientFailure(t *testing.T) {
	var logBuf bytes.Buffer

	prev := slog.Default()
	logger := slog.New(slog.NewTextHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)
	defer slog.SetDefault(prev)

	cl := client.New("http://127.0.0.1:1", "cxp_test", "test-proxy")
	state := NewRuntimeState()

	require.NoError(t, InitializeControlPlaneAuth(context.Background(), cl, state))
	assert.False(t, state.ControlPlaneReachable())
	assert.False(t, state.AuthRefreshHealthy())

	logs := logBuf.String()
	assert.True(t, strings.Contains(logs, "initial control plane auth unavailable; starting degraded and retrying in background"), logs)
}

func TestInitializeControlPlaneAuth_ReturnsPermanentBootstrapFailure(t *testing.T) {
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		TokenExchangeFn: func(_ http.Header) (int, any) {
			return 403, map[string]any{
				"error": map[string]any{
					"code":    "PROXY_DISABLED",
					"message": "Proxy is disabled",
				},
			}
		},
	})

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	state := NewRuntimeState()

	err := InitializeControlPlaneAuth(context.Background(), cl, state)
	require.Error(t, err)

	authErr, ok := err.(*client.BootstrapAuthError)
	require.True(t, ok)
	assert.True(t, authErr.Permanent())
}

func TestExchangeRuntimeToken_SetsDegradedStateOnBootstrapAuthFailure(t *testing.T) {
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		TokenExchangeFn: func(_ http.Header) (int, any) {
			return 403, map[string]any{
				"error": map[string]any{
					"code":    "PROXY_DISABLED",
					"message": "Proxy is disabled",
				},
			}
		},
	})

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	state := NewRuntimeState()

	err := exchangeRuntimeToken(context.Background(), cl, state, "startup")
	require.Error(t, err)

	authErr, ok := err.(*client.BootstrapAuthError)
	require.True(t, ok)
	assert.Equal(t, "PROXY_DISABLED", authErr.Code)
	assert.True(t, state.ControlPlaneReachable())
	assert.False(t, state.AuthRefreshHealthy())
}

func TestRunProtectedWorker_ExitsOnFailFastPanic(t *testing.T) {
	exitCh := make(chan int, 1)
	prevExit := exitProcess
	exitProcess = func(code int) {
		exitCh <- code
	}
	defer func() {
		exitProcess = prevExit
	}()

	runProtectedWorker("usage_stream_manager", true, func() {
		panic("boom")
	})

	select {
	case code := <-exitCh:
		assert.Equal(t, 1, code)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for fail-fast exit")
	}
}

func TestRecordStopped_RecordsProxyStoppedEvent(t *testing.T) {
	recorded := make(chan string, 1)
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		RecordProxyStatusFn: func(req *gatewayv1.RecordProxyStatusRequest) (*gatewayv1.RecordProxyStatusResponse, error) {
			recorded <- req.GetEvent().GetEventType()
			return &gatewayv1.RecordProxyStatusResponse{}, nil
		},
	})

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	_, err := cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	RecordStopped(cl)

	select {
	case eventType := <-recorded:
		assert.Equal(t, "proxy_service_stopped", eventType)
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for stopped event")
	}
}

func TestServerErrorLogWriter_ClassifiesRuntimeMessages(t *testing.T) {
	cases := []struct {
		name            string
		message         string
		expectedLevel   string
		expectedFailure string
	}{
		{name: "header too large", message: "http: request header too large", expectedLevel: "WARN", expectedFailure: "request_header_too_large"},
		{name: "header timeout", message: "http: timeout reading request headers", expectedLevel: "WARN", expectedFailure: "read_header_timeout"},
		{name: "tls handshake", message: "http: TLS handshake error from 127.0.0.1: EOF", expectedLevel: "WARN", expectedFailure: "tls_handshake_error"},
		{name: "generic runtime", message: "http: Server closed", expectedLevel: "INFO", expectedFailure: "server_runtime"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var logBuf bytes.Buffer
			prev := slog.Default()
			logger := slog.New(slog.NewTextHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelDebug}))
			slog.SetDefault(logger)
			defer slog.SetDefault(prev)

			w := &serverErrorLogWriter{}
			n, err := w.Write([]byte(tc.message + "\n"))
			require.NoError(t, err)
			assert.Equal(t, len(tc.message)+1, n)

			logs := logBuf.String()
			assert.Contains(t, logs, "http server runtime event")
			assert.Contains(t, logs, "failure_type="+tc.expectedFailure)
			assert.Contains(t, logs, "level="+tc.expectedLevel)
		})
	}
}

func TestProbeControlPlaneHealth_TransitionsToReachableFromDegraded(t *testing.T) {
	recorded := make(chan string, 1)
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		CheckFn: func(_ *gatewayv1.CheckRequest) (*gatewayv1.CheckResponse, error) {
			return testutil.CannedPingOK(), nil
		},
		RecordProxyStatusFn: func(req *gatewayv1.RecordProxyStatusRequest) (*gatewayv1.RecordProxyStatusResponse, error) {
			recorded <- req.GetEvent().GetEventType()
			return &gatewayv1.RecordProxyStatusResponse{}, nil
		},
	})

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	_, err := cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	state := NewRuntimeState()
	state.SetControlPlaneReachable(false)
	state.SetAuthRefreshHealthy(true)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	go func() {
		defer close(done)
		probeControlPlaneHealth(ctx, cl, state)
	}()

	require.Eventually(t, state.ControlPlaneReachable, 5*time.Second, 50*time.Millisecond)

	select {
	case eventType := <-recorded:
		assert.Equal(t, "proxy_service_running", eventType)
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for reconnect status event")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for probe shutdown")
	}
}

func TestProbeControlPlaneHealth_RecordsRunningOnInitialConnect(t *testing.T) {
	recorded := make(chan string, 1)
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		CheckFn: func(_ *gatewayv1.CheckRequest) (*gatewayv1.CheckResponse, error) {
			return testutil.CannedPingOK(), nil
		},
		RecordProxyStatusFn: func(req *gatewayv1.RecordProxyStatusRequest) (*gatewayv1.RecordProxyStatusResponse, error) {
			recorded <- req.GetEvent().GetEventType()
			return &gatewayv1.RecordProxyStatusResponse{}, nil
		},
	})

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	_, err := cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	state := NewRuntimeState()
	state.SetControlPlaneReachable(true)
	state.SetControlPlaneReachable(false)
	state.SetAuthRefreshHealthy(true)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		probeControlPlaneHealth(ctx, cl, state)
	}()

	select {
	case eventType := <-recorded:
		assert.Equal(t, "proxy_service_running", eventType)
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for initial connected event")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for probe shutdown")
	}
}

func TestRefreshRuntimeTokenLoop_ExitsOnPermanentBootstrapFailure(t *testing.T) {
	exitCh := make(chan int, 1)
	prevExit := exitProcess
	exitProcess = func(code int) {
		exitCh <- code
	}
	defer func() {
		exitProcess = prevExit
	}()

	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		TokenExchangeFn: func(_ http.Header) (int, any) {
			return 403, map[string]any{
				"error": map[string]any{
					"code":    "PROXY_DISABLED",
					"message": "Proxy is disabled",
				},
			}
		},
	})

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	state := NewRuntimeState()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	go func() {
		defer close(done)
		refreshRuntimeTokenLoop(ctx, cl, state)
	}()

	select {
	case code := <-exitCh:
		assert.Equal(t, 1, code)
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for refresh loop exit")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for refresh loop shutdown")
	}
}

func TestRefreshRuntimeTokenLoop_LogsRetryWhenExpiredTokenRefreshFails(t *testing.T) {
	var logBuf bytes.Buffer
	prev := slog.Default()
	logger := slog.New(slog.NewTextHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelWarn}))
	slog.SetDefault(logger)
	defer slog.SetDefault(prev)

	callCount := 0
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		TokenExchangeFn: func(_ http.Header) (int, any) {
			callCount++
			if callCount == 1 {
				return 200, map[string]string{
					"access_token":  "expired-token",
					"expires_at":    "2000-01-01T00:00:00Z",
					"refresh_after": "2000-01-01T00:00:00Z",
				}
			}
			return 503, map[string]any{
				"error": map[string]any{
					"code":    "TEMPORARY_UNAVAILABLE",
					"message": "Control plane unavailable",
				},
			}
		},
	})

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	_, err := cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	state := NewRuntimeState()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		refreshRuntimeTokenLoop(ctx, cl, state)
	}()

	require.Eventually(t, func() bool {
		return strings.Contains(logBuf.String(), "runtime token unavailable; retrying bootstrap exchange")
	}, 5*time.Second, 50*time.Millisecond)

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for refresh loop shutdown")
	}
}

func TestRefreshRuntimeTokenLoop_DoesNotLogRetryWhenTokenStillValid(t *testing.T) {
	var logBuf bytes.Buffer
	prev := slog.Default()
	logger := slog.New(slog.NewTextHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelWarn}))
	slog.SetDefault(logger)
	defer slog.SetDefault(prev)

	callCount := 0
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		TokenExchangeFn: func(_ http.Header) (int, any) {
			callCount++
			if callCount == 1 {
				return 200, map[string]string{
					"access_token":  "valid-token",
					"expires_at":    "2030-01-01T00:15:00Z",
					"refresh_after": "2000-01-01T00:00:00Z",
				}
			}
			return 503, map[string]any{
				"error": map[string]any{
					"code":    "TEMPORARY_UNAVAILABLE",
					"message": "Control plane unavailable",
				},
			}
		},
	})

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	_, err := cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	state := NewRuntimeState()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		refreshRuntimeTokenLoop(ctx, cl, state)
	}()

	require.Eventually(t, func() bool {
		return callCount >= 2
	}, 5*time.Second, 50*time.Millisecond)
	assert.NotContains(t, logBuf.String(), "runtime token unavailable; retrying bootstrap exchange")

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for refresh loop shutdown")
	}
}

func TestRunMetadataCacheStatsReporter_ReportsAndRestoresOnFailure(t *testing.T) {
	metadataCache := metadata.NewCache(5 * time.Minute)
	metadataCache.Set(metadata.CacheKey{Ecosystem: "npm", Package: "lodash"}, metadata.Summary{
		Ecosystem:         "npm",
		Package:           "lodash",
		LatestVersion:     "1.0.0",
		LatestPublishedAt: "2026-01-01T00:00:00Z",
		FetchedAt:         time.Now().UTC(),
	})
	_, _, _ = metadataCache.Get(metadata.CacheKey{Ecosystem: "npm", Package: "lodash"})
	_, _, _ = metadataCache.Get(metadata.CacheKey{Ecosystem: "npm", Package: "missing"})

	recorded := make(chan *gatewayv1.RecordMetadataCacheStatsRequest, 1)
	failFirst := true
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		RecordMetadataCacheStatsFn: func(req *gatewayv1.RecordMetadataCacheStatsRequest) (*gatewayv1.RecordMetadataCacheStatsResponse, error) {
			if failFirst {
				failFirst = false
				return nil, assert.AnError
			}
			recorded <- req
			return &gatewayv1.RecordMetadataCacheStatsResponse{}, nil
		},
	})

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	_, err := cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	state := NewRuntimeState()
	state.SetControlPlaneReachable(true)
	state.SetAuthRefreshHealthy(true)
	cfg := &config.Config{MetadataCacheStatsReportIntervalSeconds: 1}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		runMetadataCacheStatsReporter(ctx, metadataCache, cl, cfg, state)
	}()

	select {
	case stats := <-recorded:
		assert.Equal(t, "npm", stats.Ecosystem)
		assert.EqualValues(t, 1, stats.Hits)
		assert.EqualValues(t, 1, stats.Misses)
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for metadata stats report")
	}

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for metadata reporter shutdown")
	}
}

func TestRecordProxyStatusEvent_LogsWarningOnFailure(t *testing.T) {
	var logBuf bytes.Buffer
	prev := slog.Default()
	logger := slog.New(slog.NewTextHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelWarn}))
	slog.SetDefault(logger)
	defer slog.SetDefault(prev)

	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		RecordProxyStatusFn: func(req *gatewayv1.RecordProxyStatusRequest) (*gatewayv1.RecordProxyStatusResponse, error) {
			return nil, assert.AnError
		},
	})

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	_, err := cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	recordProxyStatusEvent(cl, "proxy_service_running")

	assert.Contains(t, logBuf.String(), "failed to record proxy status event")
	assert.Contains(t, logBuf.String(), "event_type=proxy_service_running")
}

func TestRunUsageStreamManager_PartialAckReplaysTailInSameFlush(t *testing.T) {
	dir := t.TempDir()
	w, err := wal.New(filepath.Join(dir, "events.ndjson"), filepath.Join(dir, "events.checkpoint"))
	require.NoError(t, err)
	require.NoError(t, w.Append(wal.Event{
		Ecosystem:        "npm",
		Package:          "pkg-a",
		Version:          "1.0.0",
		Decision:         "DECISION_ALLOW",
		EventType:        "artifact",
		RequestedAt:      "2026-01-03T00:00:00Z",
		ProjectTokenHash: "hash-a",
	}))
	require.NoError(t, w.Append(wal.Event{
		Ecosystem:        "npm",
		Package:          "pkg-b",
		Version:          "2.0.0",
		Decision:         "DECISION_ALLOW",
		EventType:        "artifact",
		RequestedAt:      "2026-01-03T00:00:01Z",
		ProjectTokenHash: "hash-b",
	}))

	recorded := make(chan []*gatewayv1.RecordUsageRequest, 2)
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		RecordUsageFn: func(events []*gatewayv1.RecordUsageRequest) (*gatewayv1.RecordUsageResponse, error) {
			recorded <- events
			if len(events) == 2 {
				return &gatewayv1.RecordUsageResponse{Recorded: 1}, nil
			}
			return &gatewayv1.RecordUsageResponse{Recorded: int32(len(events))}, nil
		},
	})

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	_, err = cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	cfg := &config.Config{
		FlushIntervalSeconds: 60,
		FlushMaxEvents:       10,
		EventRetentionHours:  48,
	}
	state := NewRuntimeState()
	state.SetControlPlaneReachable(true)
	state.SetAuthRefreshHealthy(true)

	notifyCh := make(chan struct{}, 1)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		runUsageStreamManager(ctx, w, cl, cfg, state, notifyCh)
	}()
	notifyCh <- struct{}{}

	select {
	case events := <-recorded:
		require.Len(t, events, 2)
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for usage replay")
	}
	select {
	case events := <-recorded:
		require.Len(t, events, 1)
		assert.Equal(t, "pkg-b", events[0].Package)
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for replayed tail event")
	}

	require.Eventually(t, func() bool {
		records, err := w.UndeliveredRecords()
		return err == nil && len(records) == 0
	}, 5*time.Second, 50*time.Millisecond)

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for stream manager shutdown")
	}
}

func TestRunUsageStreamManager_TypedRecordFailurePreservesUndeliveredRecords(t *testing.T) {
	dir := t.TempDir()
	w, err := wal.New(filepath.Join(dir, "events.ndjson"), filepath.Join(dir, "events.checkpoint"))
	require.NoError(t, err)

	payload, err := json.Marshal(wal.PackageLatestMetadata{
		Ecosystem:         "npm",
		Package:           "left-pad",
		LatestVersion:     "1.3.0",
		LatestPublishedAt: "2026-01-02T00:00:00Z",
		ObservedAt:        "2026-01-03T00:00:00Z",
		CacheStatus:       "refresh",
	})
	require.NoError(t, err)
	require.NoError(t, w.AppendRecord(wal.Record{
		SchemaVersion: wal.SchemaVersionV1,
		RecordType:    wal.RecordTypePackageLatestMetadata,
		RecordedAt:    "2026-01-03T00:00:00Z",
		Payload:       payload,
	}))

	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		RecordPackageLatestMetadataFn: func(req *gatewayv1.RecordPackageLatestMetadataRequest) (*gatewayv1.RecordPackageLatestMetadataResponse, error) {
			return nil, assert.AnError
		},
	})

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	_, err = cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	cfg := &config.Config{
		FlushIntervalSeconds: 1,
		FlushMaxEvents:       10,
		EventRetentionHours:  48,
	}
	state := NewRuntimeState()
	state.SetControlPlaneReachable(true)
	state.SetAuthRefreshHealthy(true)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		runUsageStreamManager(ctx, w, cl, cfg, state, make(chan struct{}, 1))
	}()

	require.Eventually(t, func() bool {
		records, err := w.UndeliveredRecords()
		return err == nil && len(records) == 1
	}, 5*time.Second, 50*time.Millisecond)

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for stream manager shutdown")
	}
}

func TestRunUsageStreamManager_StreamCloseFailurePreservesUsageRecords(t *testing.T) {
	dir := t.TempDir()
	w, err := wal.New(filepath.Join(dir, "events.ndjson"), filepath.Join(dir, "events.checkpoint"))
	require.NoError(t, err)
	require.NoError(t, w.Append(wal.Event{
		Ecosystem:        "npm",
		Package:          "pkg-a",
		Version:          "1.0.0",
		Decision:         "DECISION_ALLOW",
		EventType:        "artifact",
		RequestedAt:      "2026-01-03T00:00:00Z",
		ProjectTokenHash: "hash-a",
	}))

	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		RecordUsageFn: func(events []*gatewayv1.RecordUsageRequest) (*gatewayv1.RecordUsageResponse, error) {
			return nil, assert.AnError
		},
	})

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	_, err = cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	cfg := &config.Config{
		FlushIntervalSeconds: 60,
		FlushMaxEvents:       10,
		EventRetentionHours:  48,
	}
	state := NewRuntimeState()
	state.SetControlPlaneReachable(true)
	state.SetAuthRefreshHealthy(true)

	notifyCh := make(chan struct{}, 1)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		runUsageStreamManager(ctx, w, cl, cfg, state, notifyCh)
	}()
	notifyCh <- struct{}{}

	require.Eventually(t, func() bool {
		records, err := w.UndeliveredRecords()
		return err == nil && len(records) == 1
	}, 5*time.Second, 50*time.Millisecond)

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for stream manager shutdown")
	}
}

func TestRunUsageStreamManager_FlushesPendingEventsOnShutdown(t *testing.T) {
	dir := t.TempDir()
	walPath := filepath.Join(dir, "events.ndjson")
	checkpointPath := filepath.Join(dir, "events.checkpoint")

	w, err := wal.New(walPath, checkpointPath)
	require.NoError(t, err)
	require.NoError(t, w.Append(wal.Event{
		Ecosystem:        "npm",
		Package:          "left-pad",
		Version:          "1.0.0",
		Decision:         "DECISION_ALLOW",
		EventType:        "artifact",
		RequestedAt:      "2026-01-03T00:00:01Z",
		ProjectTokenHash: "hash-1",
	}))

	recordedCh := make(chan struct{}, 1)
	cpSrv := testutil.MakeMockCP(t, &testutil.MockCPHandler{
		RecordUsageFn: func(events []*gatewayv1.RecordUsageRequest) (*gatewayv1.RecordUsageResponse, error) {
			if len(events) == 1 && events[0].Package == "left-pad" {
				recordedCh <- struct{}{}
			}
			return &gatewayv1.RecordUsageResponse{Recorded: int32(len(events))}, nil
		},
	})

	cl := client.New(cpSrv.URL, "cxp_test", "test-proxy")
	_, err = cl.ExchangeRuntimeToken(context.Background())
	require.NoError(t, err)

	cfg := &config.Config{
		FlushIntervalSeconds: 60,
		FlushMaxEvents:       10,
		EventRetentionHours:  48,
	}
	state := NewRuntimeState()
	state.SetControlPlaneReachable(true)
	state.SetAuthRefreshHealthy(true)

	notifyCh := make(chan struct{}, 1)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		runUsageStreamManager(ctx, w, cl, cfg, state, notifyCh)
	}()

	cancel()

	select {
	case <-recordedCh:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for shutdown flush")
	}

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for stream manager shutdown")
	}

	records, err := w.UndeliveredRecords()
	require.NoError(t, err)
	assert.Empty(t, records)
}
