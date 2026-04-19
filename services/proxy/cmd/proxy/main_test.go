package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewLogger_EmitsJSONAtConfiguredLevel(t *testing.T) {
	originalStdout := os.Stdout
	r, w, err := os.Pipe()
	require.NoError(t, err)
	os.Stdout = w
	t.Cleanup(func() {
		os.Stdout = originalStdout
	})

	logger := newLogger("debug")
	logger.Debug("hello", "service", "proxy")
	require.NoError(t, w.Close())

	var buf bytes.Buffer
	_, err = buf.ReadFrom(r)
	require.NoError(t, err)

	var payload map[string]any
	require.NoError(t, json.Unmarshal(buf.Bytes(), &payload))
	assert.Equal(t, "DEBUG", payload["level"])
	assert.Equal(t, "hello", payload["msg"])
	assert.Equal(t, "proxy", payload["service"])
}

func TestNewLogger_UsesParseLogLevel(t *testing.T) {
	logger := slog.New(slog.NewJSONHandler(&bytes.Buffer{}, &slog.HandlerOptions{Level: parseLogLevel("error")}))
	logger.InfoContext(context.Background(), "suppressed")
	logger.ErrorContext(context.Background(), "visible")

	var buf bytes.Buffer
	logger = slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: parseLogLevel("error")}))
	logger.InfoContext(context.Background(), "suppressed")
	logger.ErrorContext(context.Background(), "visible")

	assert.NotContains(t, buf.String(), "suppressed")
	assert.Contains(t, buf.String(), "visible")
}
