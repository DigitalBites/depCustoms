package proxyruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/getcustoms/proxy/internal/cache"
	"github.com/getcustoms/proxy/internal/client"
	"github.com/getcustoms/proxy/internal/config"
	"github.com/getcustoms/proxy/internal/handler"
	"github.com/getcustoms/proxy/internal/metadata"
	"github.com/getcustoms/proxy/internal/tokenctx"
	"github.com/getcustoms/proxy/internal/wal"
)

var exitProcess = os.Exit

// Dependencies groups the long-lived runtime collaborators shared across the
// HTTP handlers and background workers.
type Dependencies struct {
	DecisionCache        *cache.Cache
	TokenContextCache    *tokenctx.Cache
	PackageMetadataCache *metadata.Cache
	ContributorCache     *metadata.ContributorCache
	SignalDedupe         *metadata.SignalDedupe
	WAL                  *wal.WAL
	ControlPlane         *client.Client
}

// BuildDependencies constructs the core runtime dependencies for the proxy.
func BuildDependencies(cfg *config.Config) (*Dependencies, error) {
	w, err := wal.New(cfg.WALPath, cfg.CheckpointPath)
	if err != nil {
		return nil, err
	}

	return &Dependencies{
		DecisionCache:        cache.New(),
		TokenContextCache:    tokenctx.New(time.Duration(cfg.TokenContextCacheTTLSeconds) * time.Second),
		PackageMetadataCache: metadata.NewCache(time.Duration(cfg.PackageMetadataCacheTTLSeconds) * time.Second),
		ContributorCache: func() *metadata.ContributorCache {
			cache, cacheErr := metadata.NewContributorCache(
				cfg.ContributorMetadataCachePath,
				cfg.ContributorMetadataVersionCap,
				cfg.ContributorMetadataColdDays,
			)
			if cacheErr != nil {
				err = cacheErr
				return nil
			}
			return cache
		}(),
		SignalDedupe: metadata.NewSignalDedupe(time.Duration(cfg.PackageMetadataSignalDedupeTTLSeconds) * time.Second),
		WAL:          w,
		ControlPlane: client.New(cfg.ControlPlaneURL, cfg.ControlPlaneSecret, cfg.ProxyID),
	}, err
}

// BuildHTTPServer wires the ecosystem handlers and health endpoint into a
// hardened net/http server.
func BuildHTTPServer(cfg *config.Config, deps *Dependencies, state *RuntimeState) *http.Server {
	npmHandler := handler.NewNPMProxyWithTokenContext(
		deps.DecisionCache,
		deps.ControlPlane,
		cfg,
		deps.WAL,
		deps.TokenContextCache,
		deps.PackageMetadataCache,
		deps.ContributorCache,
		deps.SignalDedupe,
	)
	pypiHandler := handler.NewPyPIProxyWithTokenContext(deps.DecisionCache, deps.ControlPlane, cfg, deps.WAL, deps.TokenContextCache)

	mux := http.NewServeMux()
	mux.Handle("/pypi/", pypiHandler)
	mux.Handle("/", npmHandler)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if state.ControlPlaneReachable() && state.AuthRefreshHealthy() {
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
			return
		}

		reason := "control_plane_unreachable"
		if state.ControlPlaneReachable() && !state.AuthRefreshHealthy() {
			reason = "token_refresh_failed"
		}
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status": "degraded",
			"reason": reason,
		})
	})

	return &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           mux,
		ErrorLog:          log.New(&serverErrorLogWriter{}, "", 0),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
}

// InitializeControlPlaneAuth performs the initial bootstrap exchange before the
// proxy starts serving requests.
func InitializeControlPlaneAuth(ctx context.Context, cl *client.Client, state *RuntimeState) error {
	cl.SetRuntimeTokenRefresher(func(refreshCtx context.Context, reason string) error {
		return exchangeRuntimeToken(refreshCtx, cl, state, reason)
	})

	if err := exchangeRuntimeToken(ctx, cl, state, "startup"); err != nil {
		if authErr, ok := err.(*client.BootstrapAuthError); ok && authErr.Permanent() {
			return err
		}

		slog.Warn("initial control plane auth unavailable; starting degraded and retrying in background",
			"service", "proxy",
			"error", err.Error(),
		)
		return nil
	}
	recordProxyStatusEvent(cl, "proxy_service_running")
	return nil
}

// StartBackgroundWorkers launches the control-plane health probe and WAL usage
// delivery manager. It returns the notify channel registered with the WAL.
func StartBackgroundWorkers(
	ctx context.Context,
	cfg *config.Config,
	deps *Dependencies,
	state *RuntimeState,
) chan struct{} {
	notifyCh := make(chan struct{}, 1)
	deps.WAL.SetNotify(notifyCh)

	go runProtectedWorker("probe_control_plane_health", false, func() {
		probeControlPlaneHealth(ctx, deps.ControlPlane, state)
	})
	go runProtectedWorker("refresh_runtime_token_loop", true, func() {
		refreshRuntimeTokenLoop(ctx, deps.ControlPlane, state)
	})
	go runProtectedWorker("usage_stream_manager", true, func() {
		runUsageStreamManager(ctx, deps.WAL, deps.ControlPlane, cfg, state, notifyCh)
	})
	go runProtectedWorker("metadata_cache_stats_reporter", false, func() {
		runMetadataCacheStatsReporter(ctx, deps.PackageMetadataCache, deps.ControlPlane, cfg, state)
	})

	return notifyCh
}

// RecordStopped best-effort records that the proxy process is stopping.
func RecordStopped(cl *client.Client) {
	recordProxyStatusEvent(cl, "proxy_service_stopped")
}

type serverErrorLogWriter struct{}

func runProtectedWorker(name string, failFast bool, fn func()) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("background worker panic",
				"service", "proxy",
				"worker", name,
				"panic", r,
			)
			if failFast {
				exitProcess(1)
			}
		}
	}()

	fn()
}

func (w *serverErrorLogWriter) Write(p []byte) (int, error) {
	msg := strings.TrimSpace(string(p))
	level := slog.LevelWarn
	attrs := []any{
		"service", "proxy",
		"error", msg,
	}

	switch {
	case strings.Contains(msg, "request header too large"):
		attrs = append(attrs, "failure_type", "request_header_too_large")
	case strings.Contains(msg, "timeout reading request headers"):
		attrs = append(attrs, "failure_type", "read_header_timeout")
	case strings.Contains(msg, "TLS handshake error"):
		attrs = append(attrs, "failure_type", "tls_handshake_error")
	default:
		level = slog.LevelInfo
		attrs = append(attrs, "failure_type", "server_runtime")
	}

	slog.Log(context.Background(), level, "http server runtime event", attrs...)
	return len(p), nil
}

var _ io.Writer = (*serverErrorLogWriter)(nil)

// probeControlPlaneHealth continuously monitors control-plane connectivity and
// updates the shared health flag.
func probeControlPlaneHealth(ctx context.Context, cl *client.Client, state *RuntimeState) {
	const (
		initialBackoff  = 1 * time.Second
		maxBackoff      = 30 * time.Second
		heartbeatPeriod = 30 * time.Second
		pingTimeout     = 5 * time.Second
		statusTimeout   = 5 * time.Second
	)

	ping := func() bool {
		pCtx, cancel := context.WithTimeout(ctx, pingTimeout)
		defer cancel()
		return cl.RuntimePing(pCtx) == nil
	}

	backoff := initialBackoff
	everConnected := state.ControlPlaneReachable()

	for {
		if state.ControlPlaneReachable() {
			select {
			case <-ctx.Done():
				return
			case <-time.After(heartbeatPeriod):
			}

			if !ping() {
				state.SetControlPlaneReachable(false)
				backoff = initialBackoff
				slog.Warn("control plane unreachable — serving cache hits only; fresh requests will be blocked",
					"service", "proxy",
					"retry_in", backoff.String(),
				)
				go recordProxyStatusEvent(cl, "control_plane_unavailable")
			}
			continue
		}

		if ping() {
			state.SetControlPlaneReachable(true)
			if !everConnected {
				everConnected = true
				slog.Info("control plane connected", "service", "proxy")
				go recordProxyStatusEvent(cl, "proxy_service_running")
			} else {
				slog.Info("control plane reconnected — resuming normal operation", "service", "proxy")
				go recordProxyStatusEvent(cl, "control_plane_available")
			}
			backoff = initialBackoff
			continue
		}

		slog.Warn("control plane unreachable — serving cache hits only; fresh requests will be blocked",
			"service", "proxy",
			"retry_in", backoff.String(),
		)

		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}

		backoff *= 2
		if backoff > maxBackoff {
			backoff = maxBackoff
		}
	}
}

func refreshRuntimeTokenLoop(ctx context.Context, cl *client.Client, state *RuntimeState) {
	const (
		minWait        = 1 * time.Second
		initialBackoff = 1 * time.Second
		maxBackoff     = 30 * time.Second
		refreshTimeout = 5 * time.Second
	)
	backoff := initialBackoff

	for {
		refreshAt := cl.RefreshAfter()
		wait := minWait
		if cl.TokenExpired(time.Now()) {
			wait = backoff
		} else if !refreshAt.IsZero() {
			wait = time.Until(refreshAt)
			if wait < minWait {
				wait = minWait
			}
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}

		refreshCtx, cancel := context.WithTimeout(ctx, refreshTimeout)
		err := exchangeRuntimeToken(refreshCtx, cl, state, "refresh")
		cancel()
		if err == nil {
			backoff = initialBackoff
			continue
		}

		if authErr, ok := err.(*client.BootstrapAuthError); ok {
			if authErr.Permanent() {
				slog.Error("bootstrap credentials rejected; proxy cannot continue",
					"service", "proxy",
					"error", authErr.Error(),
				)
				exitProcess(1)
			}

			if cl.TokenExpired(time.Now()) {
				slog.Warn("runtime token unavailable; retrying bootstrap exchange",
					"service", "proxy",
					"retry_in", backoff.String(),
				)
				backoff *= 2
				if backoff > maxBackoff {
					backoff = maxBackoff
				}
			}
			continue
		}

		if cl.TokenExpired(time.Now()) {
			slog.Error("runtime token expired while refresh is failing; fresh requests will fail closed",
				"service", "proxy",
			)
			slog.Warn("runtime token unavailable; retrying bootstrap exchange",
				"service", "proxy",
				"retry_in", backoff.String(),
			)
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		}
	}
}

func exchangeRuntimeToken(ctx context.Context, cl *client.Client, state *RuntimeState, reason string) error {
	slog.Info("requesting control plane runtime token",
		"service", "proxy",
		"reason", reason,
	)

	if _, err := cl.ExchangeRuntimeToken(ctx); err != nil {
		if authErr, ok := err.(*client.BootstrapAuthError); ok {
			state.SetControlPlaneReachable(true)
			state.SetAuthRefreshHealthy(false)
			slog.Error("control plane runtime token request failed",
				"service", "proxy",
				"reason", reason,
				"error", authErr.Error(),
				"status_code", authErr.StatusCode,
				"code", authErr.Code,
			)
			return err
		}

		state.SetControlPlaneReachable(false)
		state.SetAuthRefreshHealthy(false)
		slog.Warn("control plane runtime token request failed — continuing with current token while valid",
			"service", "proxy",
			"reason", reason,
			"error", err.Error(),
		)
		return err
	}

	state.SetControlPlaneReachable(true)
	state.SetAuthRefreshHealthy(true)
	slog.Info("control plane runtime token acquired",
		"service", "proxy",
		"reason", reason,
		"refresh_after", cl.RefreshAfter().Format(time.RFC3339),
	)
	return nil
}

func recordProxyStatusEvent(cl *client.Client, eventType string) {
	statusCtx, statusCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer statusCancel()
	if err := cl.RecordProxyStatus(statusCtx, eventType); err != nil {
		slog.Warn("failed to record proxy status event",
			"service", "proxy",
			"event_type", eventType,
			"error", err.Error(),
		)
	}
}

// runUsageStreamManager replays typed WAL records to the control plane in WAL order.
// Usage events continue to use the RecordUsage client stream in batched segments;
// other durable proxy-originated records are dispatched to their dedicated RPCs.
func runUsageStreamManager(
	ctx context.Context,
	w *wal.WAL,
	cl *client.Client,
	cfg *config.Config,
	state *RuntimeState,
	notifyCh <-chan struct{},
) {
	ticker := time.NewTicker(time.Duration(cfg.FlushIntervalSeconds) * time.Second)
	defer ticker.Stop()

	flushPendingRecords := func(flushCtx context.Context) {
		if !state.ControlPlaneReachable() {
			return
		}

		records, err := w.UndeliveredRecords()
		if err != nil {
			slog.Error("WAL read failed", "service", "proxy", "error", err.Error())
			return
		}
		if len(records) == 0 {
			return
		}

		deliveredCount := 0
		for i := 0; i < len(records); {
			record := records[i]
			if record.RecordType == wal.RecordTypeUsageEvent {
				streamCtx, streamCancel := context.WithCancel(flushCtx)
				stream := cl.OpenEventStream(streamCtx)
				if stream.Sent() == 0 {
					slog.Info("event stream opened", "service", "proxy")
				}

				start := i
				batchCount := 0
				for i < len(records) && batchCount < cfg.FlushMaxEvents {
					event, ok := wal.UsageEventFromRecord(records[i])
					if !ok {
						break
					}
					if err := stream.Send(event); err != nil {
						slog.Error("event stream send failed — unACKed events will be replayed",
							"service", "proxy",
							"error", err.Error(),
							"events_in_flight", batchCount,
						)
						streamCancel()
						if deliveredCount > 0 {
							if markErr := w.MarkDelivered(deliveredCount); markErr != nil {
								slog.Error("WAL mark delivered failed", "service", "proxy", "error", markErr.Error())
							} else {
								compactWAL(w, cfg.EventRetentionHours)
							}
						}
						return
					}
					batchCount++
					i++
				}

				count, closeErr := stream.CloseAndReceive()
				streamCancel()
				if closeErr != nil {
					slog.Error("event stream close failed — unACKed events will be replayed",
						"service", "proxy",
						"error", closeErr.Error(),
						"events_in_flight", batchCount,
					)
					if deliveredCount > 0 {
						if markErr := w.MarkDelivered(deliveredCount); markErr != nil {
							slog.Error("WAL mark delivered failed", "service", "proxy", "error", markErr.Error())
						} else {
							compactWAL(w, cfg.EventRetentionHours)
						}
					}
					return
				}
				if int(count) != batchCount {
					slog.Error("event stream acknowledged an unexpected count",
						"service", "proxy",
						"expected", batchCount,
						"recorded", count,
					)
					i = start + int(count)
				}
				deliveredCount += int(count)
				if count > 0 {
					slog.Info("event stream recycled",
						"service", "proxy",
						"recorded", count,
					)
				}
				continue
			}

			if err := cl.RecordWALRecord(flushCtx, record); err != nil {
				if client.IsUnsupportedWALRecordType(err) {
					slog.Warn("skipping unsupported WAL record type during replay",
						"service", "proxy",
						"record_type", record.RecordType,
						"schema_version", record.SchemaVersion,
					)
					deliveredCount++
					i++
					continue
				}
				slog.Error("durable proxy message send failed — unACKed records will be replayed",
					"service", "proxy",
					"record_type", record.RecordType,
					"error", err.Error(),
				)
				if deliveredCount > 0 {
					if markErr := w.MarkDelivered(deliveredCount); markErr != nil {
						slog.Error("WAL mark delivered failed", "service", "proxy", "error", markErr.Error())
					} else {
						compactWAL(w, cfg.EventRetentionHours)
					}
				}
				return
			}
			deliveredCount++
			i++
		}

		if deliveredCount == 0 {
			return
		}
		if err := w.MarkDelivered(deliveredCount); err != nil {
			slog.Error("WAL mark delivered failed", "service", "proxy", "error", err.Error())
			return
		}
		compactWAL(w, cfg.EventRetentionHours)
	}

	for {
		select {
		case <-ctx.Done():
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			flushPendingRecords(shutdownCtx)
			cancel()
			return

		case <-ticker.C:
			flushPendingRecords(ctx)

		case <-notifyCh:
			flushPendingRecords(ctx)
		}
	}
}

func compactWAL(w *wal.WAL, retentionHours int) {
	if err := w.Compact(retentionHours); err != nil {
		slog.Error("WAL compact failed", "service", "proxy", "error", err.Error())
	}
}

func runMetadataCacheStatsReporter(
	ctx context.Context,
	cache *metadata.Cache,
	cl *client.Client,
	cfg *config.Config,
	state *RuntimeState,
) {
	if cache == nil {
		return
	}

	ticker := time.NewTicker(time.Duration(cfg.MetadataCacheStatsReportIntervalSeconds) * time.Second)
	defer ticker.Stop()

	flush := func() {
		if !state.ControlPlaneReachable() {
			return
		}

		windows := cache.SnapshotStatsAndReset()
		if len(windows) == 0 {
			return
		}

		for i, window := range windows {
			statsCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := cl.RecordMetadataCacheStats(statsCtx, client.MetadataCacheStats{
				Ecosystem:       window.Ecosystem,
				Hits:            window.Hits,
				Misses:          window.Misses,
				StaleHits:       window.StaleHits,
				Refreshes:       window.Refreshes,
				ParseFailures:   window.ParseFailures,
				StoreFailures:   window.StoreFailures,
				WindowStartedAt: window.WindowStarted.UTC().Format(time.RFC3339),
				WindowEndedAt:   window.WindowEnded.UTC().Format(time.RFC3339),
			})
			cancel()
			if err != nil {
				cache.RestoreStats(windows[i:])
				slog.Warn("metadata cache stats report failed",
					"service", "proxy",
					"ecosystem", window.Ecosystem,
					"error", err.Error(),
				)
				return
			}

			slog.Info("metadata cache stats reported",
				"service", "proxy",
				"ecosystem", window.Ecosystem,
				"hits", window.Hits,
				"misses", window.Misses,
				"stale_hits", window.StaleHits,
				"refreshes", window.Refreshes,
				"parse_failures", window.ParseFailures,
				"store_failures", window.StoreFailures,
			)
		}
	}

	for {
		select {
		case <-ctx.Done():
			flush()
			return
		case <-ticker.C:
			flush()
		}
	}
}
