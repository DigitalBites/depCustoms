package proxyruntime

import (
	"context"
	"log/slog"
	"time"

	"github.com/getcustoms/proxy/internal/client"
	"github.com/getcustoms/proxy/internal/taxonomy"
)

// probeControlPlaneHealth continuously monitors control-plane connectivity and
// updates the shared health flag.
func probeControlPlaneHealth(ctx context.Context, cl *client.Client, state *RuntimeState) {
	const (
		initialBackoff  = 1 * time.Second
		maxBackoff      = 30 * time.Second
		heartbeatPeriod = 30 * time.Second
		pingTimeout     = 5 * time.Second
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
				go recordProxyStatusEvent(cl, taxonomy.ProxyStatusEventTypeControlPlaneUnavailable)
			}
			continue
		}

		if ping() {
			state.SetControlPlaneReachable(true)
			if !everConnected {
				everConnected = true
				slog.Info("control plane connected", "service", "proxy")
				go recordProxyStatusEvent(cl, taxonomy.ProxyStatusEventTypeProxyServiceRunning)
			} else {
				slog.Info("control plane reconnected — resuming normal operation", "service", "proxy")
				go recordProxyStatusEvent(cl, taxonomy.ProxyStatusEventTypeControlPlaneAvailable)
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
