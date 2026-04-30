package proxyruntime

import (
	"context"
	"log/slog"
	"time"

	"github.com/getcustoms/proxy/internal/client"
)

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
