package handler

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/getcustoms/proxy/internal/cache"
	"github.com/getcustoms/proxy/internal/client"
	"github.com/getcustoms/proxy/internal/metadata"
	"github.com/getcustoms/proxy/internal/taxonomy"
	"github.com/google/uuid"
)

func (e *engine) handlePolicyRequest(
	w http.ResponseWriter,
	r *http.Request,
	req PackageRequest,
	projectToken string,
	requestID string,
	traceID string,
	event eventClass,
	onAllow func(string) serveResult,
) {
	ctx := r.Context()
	requestCtx := e.newPolicyRequestContext(r, req, projectToken, event)

	if entry, ok := e.deps.DecisionCache.Get(requestCtx.key); ok {
		e.servePolicyResult(w, r, req, traceID, requestID, requestCtx, entry, taxonomy.DecisionPathCacheHit, true, onAllow)
		return
	}

	var contributorContext *client.ContributorCheckContext
	if e.resolver.Ecosystem() == "npm" && req.Version != "" && e.deps.ContributorCache != nil {
		if slice, ok := e.deps.ContributorCache.BuildSlice(
			metadata.CacheKey{
				Ecosystem: requestCtx.ecosystem,
				Package:   req.Package,
			},
			req.Version,
			e.cfg.ContributorPrefetchWindowDays,
		); ok {
			versions := make([]client.ContributorCheckVersion, 0, len(slice.Versions))
			for _, version := range slice.Versions {
				versions = append(versions, client.ContributorCheckVersion{
					Version:           version.Version,
					PublishedAt:       version.PublishedAt,
					Publisher:         version.Publisher,
					Maintainers:       version.Maintainers,
					HasInstallScripts: version.HasInstallScripts,
					HasAttestation:    version.HasAttestation,
					RawPayloadJSON:    version.RawPayloadJSON,
				})
			}
			contributorContext = &client.ContributorCheckContext{
				RequestedVersion:               slice.RequestedVersion,
				RequestedVersionPublishedAt:    slice.RequestedVersionPublishedAt,
				SliceExtractedAt:               slice.ExtractedAt,
				SliceWindowDays:                int32(slice.WindowDays),
				SliceHistoryComplete:           slice.HistoryComplete,
				SliceOldestIncludedPublishedAt: slice.OldestIncludedPublishedAt,
				PackageMetadataFingerprint:     slice.PackageMetadataFingerprint,
				SliceFingerprint:               slice.SliceFingerprint,
				Versions:                       versions,
			}
		} else {
			slog.Warn("contributor metadata unavailable for request-path context",
				"service", "proxy",
				"ecosystem", requestCtx.ecosystem,
				"package", req.Package,
				"version", req.Version,
				"reason", "contributor_cache_miss_or_incomplete",
			)
		}
	}

	resp, err := e.deps.ControlPlane.Check(ctx, client.CheckRequest{
		ProxyID:            e.cfg.ProxyID,
		ProjectToken:       projectToken,
		Ecosystem:          requestCtx.ecosystem,
		Package:            req.Package,
		Version:            event.version,
		TraceID:            traceID,
		RequestID:          requestID,
		SpanID:             uuid.New().String(),
		ClientIP:           requestCtx.clientIP,
		ContributorContext: contributorContext,
	})
	if err != nil {
		e.handleControlPlaneUnavailable(w, req, traceID, requestID, requestCtx, err)
		return
	}

	entry := cache.CacheEntry{
		Decision:        resp.Decision,
		Reason:          resp.Reason,
		CacheTTLSeconds: resp.CacheTTLSeconds,
		CachedAt:        time.Now(),
		ServeMode:       resp.ServeMode,
		TenantID:        resp.TenantID,
		ProjectID:       resp.ProjectID,
	}
	if e.deps.TokenContextCache != nil {
		e.deps.TokenContextCache.Set(requestCtx.projectTokenHash, resp.TenantID, resp.ProjectID)
	}
	e.deps.DecisionCache.Set(requestCtx.key, entry)
	e.servePolicyResult(w, r, req, traceID, requestID, requestCtx, entry, taxonomy.DecisionPathCheck, false, onAllow)
}

func (e *engine) newPolicyRequestContext(
	r *http.Request,
	req PackageRequest,
	projectToken string,
	event eventClass,
) policyRequestContext {
	projectTokenHash := hashProjectToken(projectToken)
	ecosystem := e.resolver.Ecosystem()
	return policyRequestContext{
		requestStart:     time.Now(),
		ecosystem:        ecosystem,
		projectTokenHash: projectTokenHash,
		clientIP:         clientIP(r, e.cfg.RedactClientIP, e.cfg.TrustedProxyNets),
		key: cache.CacheKey{
			ProjectTokenHash: projectTokenHash,
			Ecosystem:        ecosystem,
			Package:          req.Package,
			Version:          event.version,
		},
		event: event,
	}
}

func (e *engine) servePolicyResult(
	w http.ResponseWriter,
	r *http.Request,
	req PackageRequest,
	traceID string,
	requestID string,
	requestCtx policyRequestContext,
	entry cache.CacheEntry,
	decisionPath string,
	decisionCache bool,
	onAllow func(string) serveResult,
) {
	if entry.Decision == "DECISION_BLOCK" {
		durationMs := time.Since(requestCtx.requestStart).Milliseconds()
		e.logPolicyResult(req, traceID, requestCtx, "block", decisionPath, durationMs, serveResult{})
		appendWAL(e.deps.WAL, e.makeWALEvent(walEventInputs{
			req:           req,
			traceID:       traceID,
			requestID:     requestID,
			requestCtx:    requestCtx,
			decision:      entry.Decision,
			decisionPath:  decisionPath,
			decisionCache: decisionCache,
			durationMs:    durationMs,
			tenantID:      entry.TenantID,
			projectID:     entry.ProjectID,
		}))
		writeError(w, http.StatusForbidden, "POLICY_BLOCK", entry.Reason)
		e.emitUsedVersionMetadata(req)
		return
	}

	allow := onAllow(entry.ServeMode)
	durationMs := time.Since(requestCtx.requestStart).Milliseconds()
	eventType := requestCtx.event.eventType
	if allow.failed && eventType == taxonomy.RequestEventTypeArtifact {
		eventType = taxonomy.RequestEventTypeUpstreamError
	}
	logCtx := requestCtx
	logCtx.event.eventType = eventType
	e.logPolicyResult(req, traceID, logCtx, "allow", decisionPath, durationMs, allow)
	appendWAL(e.deps.WAL, e.makeWALEvent(walEventInputs{
		req:           req,
		traceID:       traceID,
		requestID:     requestID,
		requestCtx:    logCtx,
		decision:      entry.Decision,
		serve:         allow,
		decisionPath:  decisionPath,
		decisionCache: decisionCache,
		durationMs:    durationMs,
		tenantID:      entry.TenantID,
		projectID:     entry.ProjectID,
	}))
	e.emitUsedVersionMetadata(req)
}

func (e *engine) handleControlPlaneUnavailable(
	w http.ResponseWriter,
	req PackageRequest,
	traceID string,
	requestID string,
	requestCtx policyRequestContext,
	err error,
) {
	durationMs := time.Since(requestCtx.requestStart).Milliseconds()
	logAttrs := []any{
		"service", "proxy",
		"decision", "block",
		"decision_path", taxonomy.DecisionPathControlPlaneUnavailable,
		"duration_ms", durationMs,
		"error", err.Error(),
	}
	logAttrs = e.appendRequestLogAttrs(logAttrs, req, traceID, requestCtx)
	slog.Error("request evaluated", logAttrs...)

	entry := cache.CacheEntry{}
	if e.deps.TokenContextCache != nil {
		if cached, ok := e.deps.TokenContextCache.Get(requestCtx.projectTokenHash); ok {
			entry.TenantID = cached.TenantID
			entry.ProjectID = cached.ProjectID
		}
	}
	appendWAL(e.deps.WAL, e.makeWALEvent(walEventInputs{
		req:          req,
		traceID:      traceID,
		requestID:    requestID,
		requestCtx:   requestCtx,
		decision:     "DECISION_BLOCK",
		decisionPath: taxonomy.DecisionPathControlPlaneUnavailable,
		durationMs:   durationMs,
		tenantID:     entry.TenantID,
		projectID:    entry.ProjectID,
	}))
	writeError(w, http.StatusServiceUnavailable, "CONTROL_PLANE_UNAVAILABLE", "control plane unreachable")
	e.emitUsedVersionMetadata(req)
}
