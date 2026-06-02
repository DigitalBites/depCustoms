package handler

import (
	"encoding/json"
	"log/slog"
	"time"

	"github.com/getcustoms/proxy/internal/metadata"
	"github.com/getcustoms/proxy/internal/pkgmeta"
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
		Ecosystem:           in.requestCtx.ecosystem,
		Package:             in.req.Package,
		Version:             in.requestCtx.event.version,
		Decision:            in.decision,
		EventType:           in.requestCtx.event.eventType,
		DecisionCache:       in.decisionCache,
		RequestedAt:         time.Now().UTC().Format(time.RFC3339),
		ProjectTokenHash:    in.requestCtx.projectTokenHash,
		TraceID:             in.traceID,
		RequestID:           in.requestID,
		TenantID:            in.tenantID,
		ProjectID:           in.projectID,
		ServeMode:           in.serve.serveMode,
		BytesTransferred:    in.serve.bytesTransferred,
		ClientIP:            in.requestCtx.clientIP,
		DurationMs:          in.durationMs,
		DecisionPath:        in.decisionPath,
		RequestedRef:        in.req.RequestedRef,
		ResolvedRef:         in.req.ResolvedRef,
		RefResolutionSource: in.req.RefResolutionSource,
		RelatedVersions:     walRelatedVersions(in.req.RelatedVersions),
	}
}

func walRelatedVersions(values []PackageVersionRelatedVersion) []wal.PackageVersionRelatedVersion {
	if len(values) == 0 {
		return nil
	}
	related := make([]wal.PackageVersionRelatedVersion, 0, len(values))
	for _, value := range values {
		related = append(related, wal.PackageVersionRelatedVersion{
			Version:          value.Version,
			VersionKind:      value.VersionKind,
			ArtifactKind:     value.ArtifactKind,
			DisplayRole:      value.DisplayRole,
			RelationshipType: value.RelationshipType,
			MediaType:        value.MediaType,
			SizeBytes:        value.SizeBytes,
			PlatformOS:       value.PlatformOS,
			PlatformArch:     value.PlatformArch,
			PlatformVariant:  value.PlatformVariant,
			MetadataJSON:     value.MetadataJSON,
		})
	}
	return related
}

func (e *engine) emitUsedVersionMetadata(req PackageRequest) {
	if e.deps.WAL == nil || e.deps.PackageMetadataCache == nil {
		return
	}
	if !req.IsArtifact || req.Version == "" {
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

func emitLatestMetadataSignal(w *wal.WAL, dedupe *metadata.SignalDedupe, summary metadata.Summary) {
	if w == nil {
		return
	}

	fingerprint := pkgmeta.LatestMetadataFingerprint(summary)
	if dedupe != nil && !dedupe.ShouldEmit(fingerprint) {
		return
	}

	record, err := pkgmeta.NewLatestMetadataRecord(summary)
	if err != nil {
		slog.Warn("failed to marshal package latest metadata",
			"service", "proxy",
			"ecosystem", summary.Ecosystem,
			"package", summary.Package,
			"error", err.Error(),
		)
		return
	}

	appendWALRecordAsync(w, record)
}

// appendWAL appends a WAL event using buffered durability. A nil WAL or failed
// write is returned to the caller so audit-dependent paths can fail closed.
func appendWAL(w *wal.WAL, event wal.Event) error {
	if w == nil {
		return errWALUnavailable
	}
	if err := w.Append(event); err != nil {
		return err
	}
	return nil
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
