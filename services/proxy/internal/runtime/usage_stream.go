package proxyruntime

import (
	"context"
	"log/slog"
	"time"

	"github.com/getcustoms/proxy/internal/client"
	"github.com/getcustoms/proxy/internal/config"
	"github.com/getcustoms/proxy/internal/wal"
)

// runUsageStreamManager replays typed WAL records to the control plane in WAL order.
// Usage events continue to use the RecordUsage client stream in batched segments;
// other durable proxy-originated records are dispatched to their dedicated RPCs.
func runUsageStreamManager(
	ctx context.Context,
	w *wal.WAL,
	cl *client.Client,
	cfg *config.Config,
	state *RuntimeState,
	notifyCh <-chan struct{},
) {
	ticker := time.NewTicker(time.Duration(cfg.FlushIntervalSeconds) * time.Second)
	defer ticker.Stop()

	flushPendingRecords := func(flushCtx context.Context) {
		if !state.ControlPlaneReachable() {
			return
		}

		records, err := w.UndeliveredRecords()
		if err != nil {
			slog.Error("WAL read failed", "service", "proxy", "error", err.Error())
			return
		}
		if len(records) == 0 {
			return
		}

		deliveredCount := 0
		for i := 0; i < len(records); {
			record := records[i]
			if record.RecordType == wal.RecordTypeUsageEvent {
				delivered, ok := sendUsageRecordBatch(flushCtx, cl, cfg, records, &i)
				deliveredCount += delivered
				if ok {
					continue
				}
				markDeliveredRecords(w, cfg.EventRetentionHours, deliveredCount)
				return
			}

			if err := cl.RecordWALRecord(flushCtx, record); err != nil {
				if client.IsUnsupportedWALRecordType(err) {
					slog.Warn("skipping unsupported WAL record type during replay",
						"service", "proxy",
						"record_type", record.RecordType,
						"schema_version", record.SchemaVersion,
					)
					deliveredCount++
					i++
					continue
				}
				slog.Error("durable proxy message send failed — unACKed records will be replayed",
					"service", "proxy",
					"record_type", record.RecordType,
					"error", err.Error(),
				)
				markDeliveredRecords(w, cfg.EventRetentionHours, deliveredCount)
				return
			}
			deliveredCount++
			i++
		}

		markDeliveredRecords(w, cfg.EventRetentionHours, deliveredCount)
	}

	for {
		select {
		case <-ctx.Done():
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			flushPendingRecords(shutdownCtx)
			cancel()
			return
		case <-ticker.C:
			flushPendingRecords(ctx)
		case <-notifyCh:
			flushPendingRecords(ctx)
		}
	}
}

func sendUsageRecordBatch(
	flushCtx context.Context,
	cl *client.Client,
	cfg *config.Config,
	records []wal.Record,
	index *int,
) (int, bool) {
	streamCtx, streamCancel := context.WithCancel(flushCtx)
	stream := cl.OpenEventStream(streamCtx)
	if stream.Sent() == 0 {
		slog.Info("event stream opened", "service", "proxy")
	}

	start := *index
	batchCount := 0
	for *index < len(records) && batchCount < cfg.FlushMaxEvents {
		event, ok := wal.UsageEventFromRecord(records[*index])
		if !ok {
			break
		}
		if err := stream.Send(event); err != nil {
			slog.Error("event stream send failed — unACKed events will be replayed",
				"service", "proxy",
				"error", err.Error(),
				"events_in_flight", batchCount,
			)
			streamCancel()
			return 0, false
		}
		batchCount++
		*index++
	}

	count, closeErr := stream.CloseAndReceive()
	streamCancel()
	if closeErr != nil {
		slog.Error("event stream close failed — unACKed events will be replayed",
			"service", "proxy",
			"error", closeErr.Error(),
			"events_in_flight", batchCount,
		)
		return 0, false
	}
	if int(count) != batchCount {
		slog.Error("event stream acknowledged an unexpected count",
			"service", "proxy",
			"expected", batchCount,
			"recorded", count,
		)
		*index = start + int(count)
	}
	if count > 0 {
		slog.Info("event stream recycled",
			"service", "proxy",
			"recorded", count,
		)
	}
	return int(count), true
}

func markDeliveredRecords(w *wal.WAL, retentionHours int, deliveredCount int) {
	if deliveredCount == 0 {
		return
	}
	if err := w.MarkDelivered(deliveredCount); err != nil {
		slog.Error("WAL mark delivered failed", "service", "proxy", "error", err.Error())
		return
	}
	compactWAL(w, retentionHours)
}
