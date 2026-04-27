package handler

import (
	"encoding/json"
	"log/slog"
	"time"

	"github.com/getcustoms/proxy/internal/metadata"
	"github.com/getcustoms/proxy/internal/wal"
)

type walEventInputs struct {
	req           PackageRequest
	traceID       string
	requestID     string
	requestCtx    policyRequestContext
	decision      string
	serve         serveResult
	decisionPath  string
	decisionCache bool
	durationMs    int64
	tenantID      string
	projectID     string
}

func (e *engine) makeWALEvent(in walEventInputs) wal.Event {
	return wal.Event{
		Ecosystem:        in.requestCtx.ecosystem,
		Package:          in.req.Package,
		Version:          in.requestCtx.event.version,
		Decision:         in.decision,
		EventType:        in.requestCtx.event.eventType,
		DecisionCache:    in.decisionCache,
		RequestedAt:      time.Now().UTC().Format(time.RFC3339),
		ProjectTokenHash: in.requestCtx.projectTokenHash,
		TraceID:          in.traceID,
		RequestID:        in.requestID,
		TenantID:         in.tenantID,
		ProjectID:        in.projectID,
		ServeMode:        in.serve.serveMode,
		BytesTransferred: in.serve.bytesTransferred,
		ClientIP:         in.requestCtx.clientIP,
		DurationMs:       in.durationMs,
		DecisionPath:     in.decisionPath,
	}
}

func (e *engine) emitUsedVersionMetadata(req PackageRequest) {
	if e.deps.WAL == nil || e.deps.PackageMetadataCache == nil {
		return
	}
	if e.resolver.Ecosystem() != "npm" || !req.IsArtifact || req.Version == "" {
		return
	}

	key := metadata.CacheKey{
		Ecosystem: e.resolver.Ecosystem(),
		Package:   req.Package,
	}
	summary, state, found := e.deps.PackageMetadataCache.Get(key)
	if !found {
		state = metadata.LookupStateMiss
	}

	payload := wal.PackageUsedVersionMetadata{
		Ecosystem:   key.Ecosystem,
		Package:     key.Package,
		UsedVersion: req.Version,
		ObservedAt:  time.Now().UTC().Format(time.RFC3339),
		CacheStatus: string(state),
	}
	if found {
		payload.UsedVersionPublishedAt = summary.VersionPublishTimes[req.Version]
		payload.LatestVersion = summary.LatestVersion
		payload.LatestPublishedAt = summary.LatestPublishedAt
	}

	fingerprint := usedVersionMetadataFingerprint(payload)
	if e.deps.SignalDedupe != nil && !e.deps.SignalDedupe.ShouldEmit(fingerprint) {
		return
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		slog.Warn("failed to marshal package used-version metadata",
			"service", "proxy",
			"ecosystem", payload.Ecosystem,
			"package", payload.Package,
			"version", payload.UsedVersion,
			"error", err.Error(),
		)
		return
	}

	appendWALRecordAsync(e.deps.WAL, wal.Record{
		SchemaVersion: wal.SchemaVersionV1,
		RecordType:    wal.RecordTypePackageUsedVersionMetadata,
		RecordedAt:    payload.ObservedAt,
		Payload:       raw,
	})
}

func usedVersionMetadataFingerprint(payload wal.PackageUsedVersionMetadata) string {
	return fingerprintParts(
		payload.Ecosystem,
		payload.Package,
		payload.UsedVersion,
		payload.UsedVersionPublishedAt,
		payload.CacheStatus,
		payload.LatestVersion,
		payload.LatestPublishedAt,
	)
}

// appendWAL appends a WAL event and logs any write failure.
func appendWAL(w *wal.WAL, event wal.Event) {
	if err := w.Append(event); err != nil {
		slog.Error("WAL append failed", "service", "proxy", "error", err.Error())
	}
}

// appendWALRecordAsync enqueues a typed WAL record for background persistence.
// Freshness signals are advisory-only and must not delay metadata responses.
func appendWALRecordAsync(w *wal.WAL, record wal.Record) {
	if w == nil {
		return
	}
	if w.EnqueueAdvisoryRecord(record) {
		return
	}
	slog.Warn("WAL advisory record queue full; dropping record",
		"service", "proxy",
		"record_type", record.RecordType,
	)
}
