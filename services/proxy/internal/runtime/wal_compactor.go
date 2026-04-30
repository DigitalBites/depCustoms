package proxyruntime

import (
	"log/slog"

	"github.com/getcustoms/proxy/internal/wal"
)

func compactWAL(w *wal.WAL, retentionHours int) {
	if err := w.Compact(retentionHours); err != nil {
		slog.Error("WAL compact failed", "service", "proxy", "error", err.Error())
	}
}
