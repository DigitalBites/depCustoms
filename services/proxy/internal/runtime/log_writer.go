package proxyruntime

import (
	"context"
	"io"
	"log/slog"
	"strings"
)

type serverErrorLogWriter struct{}

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
