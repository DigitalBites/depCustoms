package proxyruntime

import (
	"context"
	"log/slog"
	"time"

	"github.com/getcustoms/proxy/internal/client"
)

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
