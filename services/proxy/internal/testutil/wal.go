package testutil

import (
	"path/filepath"
	"testing"

	"github.com/getcustoms/proxy/internal/wal"
	"github.com/stretchr/testify/require"
)

// MakeTempWAL opens a new WAL in t.TempDir() and registers t.Cleanup to
// remove it. Each test gets fully isolated WAL files.
func MakeTempWAL(t *testing.T) *wal.WAL {
	t.Helper()
	dir := t.TempDir()
	w, err := wal.New(
		filepath.Join(dir, "events.ndjson"),
		filepath.Join(dir, "events.checkpoint"),
	)
	require.NoError(t, err)
	return w
}
