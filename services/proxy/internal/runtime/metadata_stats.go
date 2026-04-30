package proxyruntime

import (
	"context"
	"log/slog"
	"time"

	"github.com/getcustoms/proxy/internal/client"
	"github.com/getcustoms/proxy/internal/config"
	"github.com/getcustoms/proxy/internal/metadata"
)

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
			err := cl.RecordMetadataCacheStats(statsCtx, window)
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
