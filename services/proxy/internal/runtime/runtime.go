package proxyruntime

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/getcustoms/proxy/internal/cache"
	"github.com/getcustoms/proxy/internal/client"
	"github.com/getcustoms/proxy/internal/config"
	"github.com/getcustoms/proxy/internal/handler"
	"github.com/getcustoms/proxy/internal/metadata"
	"github.com/getcustoms/proxy/internal/pkgmeta"
	"github.com/getcustoms/proxy/internal/taxonomy"
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
	MetadataAckCache     *metadata.AckCache
	MetadataSubmitter    *metadata.Submitter
	DockerHubLookup      *pkgmeta.DockerHubTagLookup
	WAL                  *wal.WAL
	ControlPlane         *client.Client
}

// BuildDependencies constructs the core runtime dependencies for the proxy.
func BuildDependencies(cfg *config.Config) (*Dependencies, error) {
	w, err := wal.New(cfg.WALPath, cfg.CheckpointPath)
	if err != nil {
		return nil, err
	}

	controlPlane := client.New(cfg.ControlPlaneURL, cfg.ControlPlaneSecret, cfg.ProxyID)
	ackCache := metadata.NewAckCache(time.Duration(cfg.MetadataAckCacheTTLSeconds) * time.Second)
	submitter := metadata.NewSubmitter(
		controlPlane,
		ackCache,
		time.Duration(cfg.MetadataWaitTimeoutMs)*time.Millisecond,
	)
	dockerHubLookup := &pkgmeta.DockerHubTagLookup{
		Client: &http.Client{Timeout: time.Duration(cfg.MetadataWaitTimeoutMs) * time.Millisecond},
	}
	deps := &Dependencies{
		DecisionCache:        cache.New(),
		TokenContextCache:    tokenctx.New(time.Duration(cfg.TokenContextCacheTTLSeconds) * time.Second),
		PackageMetadataCache: metadata.NewCache(time.Duration(cfg.PackageMetadataCacheTTLSeconds) * time.Second),
		SignalDedupe:         metadata.NewSignalDedupe(time.Duration(cfg.PackageMetadataSignalDedupeTTLSeconds) * time.Second),
		MetadataAckCache:     ackCache,
		MetadataSubmitter:    submitter,
		DockerHubLookup:      dockerHubLookup,
		WAL:                  w,
		ControlPlane:         controlPlane,
	}

	contributorCache, err := metadata.NewContributorCache(
		cfg.ContributorMetadataCachePath,
		cfg.ContributorMetadataVersionCap,
		cfg.ContributorMetadataColdDays,
	)
	if err != nil {
		return deps, err
	}
	deps.ContributorCache = contributorCache

	return deps, nil
}

// BuildHTTPServer wires the ecosystem handlers and health endpoint into a
// hardened net/http server.
func BuildHTTPServer(cfg *config.Config, deps *Dependencies, state *RuntimeState) *http.Server {
	handlerDeps := handler.Dependencies{
		DecisionCache:        deps.DecisionCache,
		TokenContextCache:    deps.TokenContextCache,
		PackageMetadataCache: deps.PackageMetadataCache,
		ContributorCache:     deps.ContributorCache,
		SignalDedupe:         deps.SignalDedupe,
		MetadataSubmitter:    deps.MetadataSubmitter,
		DockerHubLookup:      deps.DockerHubLookup,
		ControlPlane:         deps.ControlPlane,
		WAL:                  deps.WAL,
	}

	mux := http.NewServeMux()
	if cfg.EcosystemEnabled("docker") {
		mux.Handle("/v2/", handler.NewDockerProxy(handlerDeps, cfg))
	} else {
		mux.HandleFunc("/v2/", disabledEcosystemHandler("docker"))
	}
	if cfg.EcosystemEnabled("pypi") {
		mux.Handle("/pypi/", handler.NewPyPIProxy(handlerDeps, cfg))
	} else {
		mux.HandleFunc("/pypi/", disabledEcosystemHandler("pypi"))
	}
	if cfg.EcosystemEnabled("npm") {
		mux.Handle("/", handler.NewNPMProxy(handlerDeps, cfg))
	} else {
		mux.HandleFunc("/", disabledEcosystemHandler("npm"))
	}
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

func disabledEcosystemHandler(ecosystem string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{
				"code":    "ecosystem_disabled",
				"message": ecosystem + " proxy support is not enabled",
				"detail":  nil,
			},
		})
	}
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
	recordProxyStatusEvent(cl, taxonomy.ProxyStatusEventTypeProxyServiceStopped)
}

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
