package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/getcustoms/proxy/internal/config"
	proxyruntime "github.com/getcustoms/proxy/internal/runtime"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("configuration error", "service", "proxy", "error", err.Error())
		os.Exit(1)
	}

	slog.SetDefault(newLogger(cfg.LogLevel))

	slog.Info("starting Customs proxy",
		"service", "proxy",
		"port", cfg.Port,
		"proxy_id", cfg.ProxyID,
	)
	slog.Info("startup_config", "service", "proxy", "config", cfg)

	deps, err := proxyruntime.BuildDependencies(cfg)
	if err != nil {
		slog.Error("failed to open WAL", "service", "proxy", "error", err.Error())
		os.Exit(1)
	}

	state := proxyruntime.NewRuntimeState()
	initCtx, initCancel := context.WithTimeout(context.Background(), 5*time.Second)
	if err := proxyruntime.InitializeControlPlaneAuth(initCtx, deps.ControlPlane, state); err != nil {
		initCancel()
		slog.Error("failed to initialize control plane auth", "service", "proxy", "error", err.Error())
		os.Exit(1)
	}
	initCancel()

	srv := proxyruntime.BuildHTTPServer(cfg, deps, state)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	proxyruntime.StartBackgroundWorkers(ctx, cfg, deps, state)

	go func() {
		slog.Info("proxy listening",
			"service", "proxy",
			"port", cfg.Port,
			"proxy_id", cfg.ProxyID,
		)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "service", "proxy", "error", err.Error())
			os.Exit(1)
		}
	}()

	<-ctx.Done()

	slog.Info("shutting down proxy", "service", "proxy")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("graceful shutdown failed", "service", "proxy", "error", err.Error())
		os.Exit(1)
	}

	proxyruntime.RecordStopped(deps.ControlPlane)
	slog.Info("proxy stopped cleanly", "service", "proxy")
}

func newLogger(level string) *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: parseLogLevel(level),
	}))
}

func parseLogLevel(level string) slog.Level {
	switch level {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
