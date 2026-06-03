package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"time"

	"github.com/getcustoms/proxy/internal/metadata"
	"github.com/getcustoms/proxy/internal/pkgmeta"
	"github.com/getcustoms/proxy/internal/taxonomy"
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

// ensureUsedVersionMetadataReady is the foreground metadata readiness step that
// runs immediately before Check on an artifact cache miss. The proxy submits
// whatever used-version metadata it has cached so the control plane catalog is
// up-to-date for the current Check decision. On submit failure or timeout the
// record is enqueued on the advisory WAL queue as backfill — the current Check
// proceeds with whatever catalog data exists and rule conditions handle null.
func (e *engine) ensureUsedVersionMetadataReady(
	ctx context.Context,
	req PackageRequest,
	requestCtx policyRequestContext,
) {
	if !req.IsArtifact || req.Version == "" {
		return
	}
	if e.deps.MetadataSubmitter == nil {
		return
	}

	payload := e.buildUsedVersionMetadataPayload(ctx, req, requestCtx.ecosystem)

	if err := e.deps.MetadataSubmitter.SubmitUsedVersion(ctx, payload); err != nil {
		slog.Warn("metadata readiness submit failed; enqueuing WAL backfill",
			"service", "proxy",
			"ecosystem", payload.Ecosystem,
			"package", payload.Package,
			"version", payload.UsedVersion,
			"error", err.Error(),
		)
		e.enqueueUsedVersionMetadataBackfill(payload)
	}
}

// enqueueUsedVersionMetadataBackfill writes a used-version metadata record to
// the advisory WAL queue. Used as the failure path for the readiness step so
// the catalog still converges on the next request.
func (e *engine) enqueueUsedVersionMetadataBackfill(payload wal.PackageUsedVersionMetadata) {
	if e.deps.WAL == nil {
		return
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

// buildUsedVersionMetadataPayload assembles the used-version submission from
// whatever package metadata the proxy currently has cached. Missing fields are
// left empty — the API persists null and rule conditions decide what null means.
//
// For Docker Hub images, a cache miss for the resolved digest triggers a
// foreground Hub lookup which is then folded into the shared metadata cache so
// repeat artifact pulls for the same digest skip the upstream hop.
func (e *engine) buildUsedVersionMetadataPayload(ctx context.Context, req PackageRequest, ecosystem string) wal.PackageUsedVersionMetadata {
	payload := wal.PackageUsedVersionMetadata{
		Ecosystem:   ecosystem,
		Package:     req.Package,
		UsedVersion: req.Version,
		ObservedAt:  time.Now().UTC().Format(time.RFC3339),
		CacheStatus: string(metadata.LookupStateMiss),
	}
	if e.deps.PackageMetadataCache == nil {
		return payload
	}

	key := metadata.CacheKey{Ecosystem: ecosystem, Package: req.Package}
	summary, state, found := e.deps.PackageMetadataCache.Get(key)

	if ecosystem == taxonomy.EcosystemDocker {
		summary, state, found = e.ensureDockerHubSummary(ctx, req, key, summary, state, found)
	}

	if !found {
		return payload
	}
	payload.CacheStatus = string(state)
	payload.UsedVersionPublishedAt = summary.VersionPublishTimes[req.Version]
	payload.LatestVersion = summary.LatestVersion
	payload.LatestPublishedAt = summary.LatestPublishedAt
	return payload
}

// ensureDockerHubSummary fills in the publish time for the resolved digest by
// calling Docker Hub when the shared metadata.Cache hasn't seen it yet, then
// writes the merged summary back so subsequent artifact pulls for the same
// digest are served from cache. Skips raw-digest requests and non-Hub registries.
func (e *engine) ensureDockerHubSummary(
	ctx context.Context,
	req PackageRequest,
	key metadata.CacheKey,
	summary metadata.Summary,
	state metadata.LookupState,
	found bool,
) (metadata.Summary, metadata.LookupState, bool) {
	if e.deps.DockerHubLookup == nil {
		return summary, state, found
	}
	const hubPrefix = "hub.docker.io/"
	repo, ok := strings.CutPrefix(req.Package, hubPrefix)
	if !ok || repo == "" {
		return summary, state, found
	}
	tag := req.RequestedRef
	if tag == "" || strings.HasPrefix(tag, "sha256:") {
		return summary, state, found
	}
	if found {
		if _, known := summary.VersionPublishTimes[req.Version]; known {
			return summary, state, true
		}
	}

	publishedAt, err := e.deps.DockerHubLookup.FetchVerifiedPublishTime(ctx, repo, tag, req.Version)
	if err != nil {
		return summary, state, found
	}

	if !found {
		summary = metadata.Summary{
			Ecosystem: key.Ecosystem,
			Package:   key.Package,
			Source:    pkgmeta.DockerHubSource,
		}
	}
	if summary.VersionPublishTimes == nil {
		summary.VersionPublishTimes = make(map[string]string, 1)
	}
	summary.VersionPublishTimes[req.Version] = publishedAt
	summary.FetchedAt = time.Now()
	e.deps.PackageMetadataCache.Set(key, summary)
	return summary, metadata.LookupStateHit, true
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

// emitLatestMetadataSignal pushes the latest-version freshness summary to the
// control plane via foreground RPC when a submitter is wired, and falls back
// to the advisory WAL queue if no submitter is configured or the RPC fails.
func emitLatestMetadataSignal(w *wal.WAL, dedupe *metadata.SignalDedupe, submitter *metadata.Submitter, summary metadata.Summary) {
	if submitter != nil {
		payload := wal.PackageLatestMetadata{
			Ecosystem:         summary.Ecosystem,
			Package:           summary.Package,
			LatestVersion:     summary.LatestVersion,
			LatestPublishedAt: summary.LatestPublishedAt,
			ObservedAt:        time.Now().UTC().Format(time.RFC3339),
		}
		if err := submitter.SubmitLatest(context.Background(), payload); err == nil {
			return
		} else {
			slog.Warn("package latest metadata submit failed; falling back to WAL",
				"service", "proxy",
				"ecosystem", summary.Ecosystem,
				"package", summary.Package,
				"error", err.Error(),
			)
		}
	}

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
