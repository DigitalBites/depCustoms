// Package handler implements per-ecosystem reverse-proxy HTTP handlers.
package handler

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/getcustoms/proxy/internal/cache"
	"github.com/getcustoms/proxy/internal/client"
	"github.com/getcustoms/proxy/internal/config"
	"github.com/getcustoms/proxy/internal/metadata"
	"github.com/getcustoms/proxy/internal/tokenctx"
	"github.com/getcustoms/proxy/internal/wal"
	"github.com/google/uuid"
)

// PackageRequest carries the parsed identity of an inbound package request.
// IsArtifact=true means the engine should enforce policy; false means it should
// proxy the metadata/index page directly.
// ArtifactKey is an opaque value set by the resolver's ParseRequest and passed
// back unchanged to OnServeAllowed. npm preserves the original requested
// tarball path so upstream delivery does not depend on reconstructing filenames
// from parsed versions; pypi sets it to the filename/path fragment it needs.
type PackageRequest struct {
	Package      string
	Version      string
	IsArtifact   bool
	ArtifactKey  string
	BypassPolicy bool
}

// ServeMode string constants mirror the proto ServeMode enum names.
// Defined here so all resolvers and client.go reference a single source of truth
// rather than repeating raw string literals that could silently drift from the proto.
const (
	ServeModeRedirect = "SERVE_MODE_REDIRECT"
	ServeModePull     = "SERVE_MODE_PULL"
)

// ServeOutcome carries the result of OnServeAllowed back to the engine so it
// can be recorded in the WAL. Using a struct rather than multiple return values
// allows future fields (e.g. upstream latency, HTTP status) to be added without
// changing the EcosystemResolver interface again.
type ServeOutcome struct {
	ServeMode        string // "SERVE_MODE_REDIRECT" | "SERVE_MODE_PULL"
	BytesTransferred int64  // 0 for redirects; actual bytes copied for pulls
	// Failed is true when the resolver attempted delivery but the upstream was
	// unreachable or returned an error. The policy decision was ALLOW; only the
	// upstream delivery failed. The engine records source="upstream_error" so
	// operators can distinguish policy blocks from infrastructure failures.
	Failed bool
}

// EcosystemResolver is implemented by each ecosystem-specific type and provides
// the engine with all ecosystem knowledge. engine.go never needs to change when
// a new ecosystem is added.
type EcosystemResolver interface {
	// Ecosystem returns the lowercase ecosystem name used in cache keys, WAL
	// events, and control-plane calls (e.g. "npm", "pypi").
	Ecosystem() string

	// ParseRequest extracts package identity from the inbound request.
	// Returns a zero PackageRequest (Package == "") if the path cannot be parsed.
	ParseRequest(r *http.Request) PackageRequest

	// OnServeAllowed delivers an artifact to the client after a policy ALLOW.
	// serveMode mirrors the proto ServeMode enum string (e.g. "SERVE_MODE_REDIRECT").
	// req is the same PackageRequest returned by ParseRequest.
	// Returns a ServeOutcome so the engine can record serve_mode and bytes_transferred
	// in the WAL after the response has been sent.
	OnServeAllowed(w http.ResponseWriter, r *http.Request, req PackageRequest, serveMode string) ServeOutcome

	// OnProxyMetadata handles the non-artifact path (package index/metadata page).
	// No policy is enforced; the engine delegates immediately.
	// Returns true when the upstream metadata fetch/rewrite succeeded.
	OnProxyMetadata(w http.ResponseWriter, r *http.Request, pkg string) bool
}

// engine is the shared policy enforcement core. It implements http.Handler and
// drives the full request lifecycle: parse → enforce → serve.
// Ecosystem-specific behaviour is delegated entirely to the EcosystemResolver.
type engine struct {
	cache                *cache.Cache
	tokenContextCache    *tokenctx.Cache
	packageMetadataCache *metadata.Cache
	contributorCache     *metadata.ContributorCache
	signalDedupe         *metadata.SignalDedupe
	client               *client.Client
	cfg                  *config.Config
	wal                  *wal.WAL
	resolver             EcosystemResolver
}

type eventClass struct {
	eventType string
	version   string
}

type policyRequestContext struct {
	requestStart     time.Time
	ecosystem        string
	projectTokenHash string
	clientIP         string
	key              cache.CacheKey
	event            eventClass
}

type serveResult struct {
	serveMode        string
	bytesTransferred int64
	upstreamSuccess  *bool
	failed           bool
}

type serveAction struct {
	onAllow func(string) serveResult
}

func newEngine(
	c *cache.Cache,
	tokenContextCache *tokenctx.Cache,
	packageMetadataCache *metadata.Cache,
	contributorCache *metadata.ContributorCache,
	signalDedupe *metadata.SignalDedupe,
	cl *client.Client,
	cfg *config.Config,
	w *wal.WAL,
	resolver EcosystemResolver,
) *engine {
	return &engine{
		cache:                c,
		tokenContextCache:    tokenContextCache,
		packageMetadataCache: packageMetadataCache,
		contributorCache:     contributorCache,
		signalDedupe:         signalDedupe,
		client:               cl,
		cfg:                  cfg,
		wal:                  w,
		resolver:             resolver,
	}
}

// ServeHTTP is the single entry point for all ecosystem traffic routed to this
// engine. It parses the request, validates the bearer token (required for all
// paths — metadata and artifact alike), then dispatches to the appropriate handler.
func (e *engine) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Generate correlation IDs and set response headers here, before any early
	// return, so every response (404, 401, 403, 503) carries traceable headers.
	requestID := uuid.New().String()
	traceID := r.Header.Get("traceparent")
	if traceID == "" {
		// Generate a W3C traceparent when the client does not provide one.
		// Format: 00-<traceId 32 hex>-<spanId 16 hex>-01
		traceID = generateTraceparent()
	}
	w.Header().Set("X-Customs-Request-Id", requestID)
	w.Header().Set("X-Customs-Trace-Id", traceID)

	req := e.resolver.ParseRequest(r)
	if req.Package == "" {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "could not parse package from path")
		return
	}

	projectToken := extractBearerToken(r)
	if projectToken == "" {
		writeError(w, http.StatusUnauthorized, "MISSING_TOKEN", "Authorization: Bearer token required")
		return
	}

	if req.BypassPolicy {
		start := time.Now()
		upstreamSuccess := e.resolver.OnProxyMetadata(w, r, req.Package)
		durationMs := time.Since(start).Milliseconds()
		slog.Info("request evaluated",
			"service", "proxy",
			"decision", "allow",
			"decision_path", "bypass",
			"duration_ms", durationMs,
			"event_type", "metadata",
			"ecosystem", e.resolver.Ecosystem(),
			"package", req.Package,
			"trace_id", traceID,
			"upstream_success", upstreamSuccess,
		)
		return
	}

	if !req.IsArtifact {
		e.enforceMetadata(w, r, req, projectToken, requestID, traceID)
		return
	}

	e.enforce(w, r, req, projectToken, requestID, traceID)
}

// enforce runs the full policy pipeline for an artifact download:
//  1. Check the local cache — on hit, serve then write a WAL event.
//  2. On cache miss, call the control plane.
//  3. On control-plane error, fail closed (503) and write a WAL event.
//  4. On a valid response, populate the cache, serve, then write a WAL event.
//
// WAL ordering: BLOCK and control-plane-unavailable events are written before
// the HTTP response (original audit guarantee). ALLOW events are written after
// OnServeAllowed returns so that bytes_transferred reflects actual bytes sent.
// If upstream delivery fails (outcome.Failed), the event is still written with
// source="upstream_error" so operators can identify infrastructure failures
// that are distinct from policy blocks.
func (e *engine) enforce(
	w http.ResponseWriter,
	r *http.Request,
	req PackageRequest,
	projectToken string,
	requestID string,
	traceID string,
) {
	e.handlePolicyRequest(
		w,
		r,
		req,
		projectToken,
		requestID,
		traceID,
		eventClass{eventType: "artifact", version: req.Version},
		serveAction{
			onAllow: func(serveMode string) serveResult {
				outcome := e.resolver.OnServeAllowed(w, r, req, serveMode)
				return serveResult{
					serveMode:        outcome.ServeMode,
					bytesTransferred: outcome.BytesTransferred,
					failed:           outcome.Failed,
				}
			},
		},
	)
}

// enforceMetadata runs policy enforcement for non-artifact requests (package
// index / metadata pages). The flow mirrors enforce() but calls OnProxyMetadata
// on ALLOW instead of OnServeAllowed; no bytes are transferred by the proxy.
func (e *engine) enforceMetadata(
	w http.ResponseWriter,
	r *http.Request,
	req PackageRequest,
	projectToken string,
	requestID string,
	traceID string,
) {
	e.handlePolicyRequest(
		w,
		r,
		req,
		projectToken,
		requestID,
		traceID,
		eventClass{eventType: "metadata", version: ""},
		serveAction{
			onAllow: func(string) serveResult {
				upstreamSuccess := e.resolver.OnProxyMetadata(w, r, req.Package)
				return serveResult{
					upstreamSuccess: &upstreamSuccess,
				}
			},
		},
	)
}

func (e *engine) handlePolicyRequest(
	w http.ResponseWriter,
	r *http.Request,
	req PackageRequest,
	projectToken string,
	requestID string,
	traceID string,
	event eventClass,
	action serveAction,
) {
	ctx := r.Context()
	requestCtx := e.newPolicyRequestContext(r, req, projectToken, event)

	if entry, ok := e.cache.Get(requestCtx.key); ok {
		e.servePolicyResult(w, r, req, traceID, requestID, requestCtx, entry, "cache_hit", true, action)
		return
	}

	var contributorContext *client.ContributorCheckContext
	if e.resolver.Ecosystem() == "npm" && req.Version != "" && e.contributorCache != nil {
		if slice, ok := e.contributorCache.BuildSlice(
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

	resp, err := e.client.Check(ctx, client.CheckRequest{
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
	if e.tokenContextCache != nil {
		e.tokenContextCache.Set(requestCtx.projectTokenHash, resp.TenantID, resp.ProjectID)
	}
	e.cache.Set(requestCtx.key, entry)
	e.servePolicyResult(w, r, req, traceID, requestID, requestCtx, entry, "check", false, action)
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

func (e *engine) makeWALEvent(
	req PackageRequest,
	traceID string,
	requestID string,
	requestCtx policyRequestContext,
	decision string,
	serveMode string,
	decisionPath string,
	bytesTransferred int64,
	decisionCache bool,
	durationMs int64,
	entry cache.CacheEntry,
) wal.Event {
	return wal.Event{
		Ecosystem:        requestCtx.ecosystem,
		Package:          req.Package,
		Version:          requestCtx.event.version,
		Decision:         decision,
		EventType:        requestCtx.event.eventType,
		DecisionCache:    decisionCache,
		RequestedAt:      time.Now().UTC().Format(time.RFC3339),
		ProjectTokenHash: requestCtx.projectTokenHash,
		TraceID:          traceID,
		RequestID:        requestID,
		TenantID:         entry.TenantID,
		ProjectID:        entry.ProjectID,
		ServeMode:        serveMode,
		BytesTransferred: bytesTransferred,
		ClientIP:         requestCtx.clientIP,
		DurationMs:       durationMs,
		DecisionPath:     decisionPath,
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
	action serveAction,
) {
	if entry.Decision == "DECISION_BLOCK" {
		durationMs := time.Since(requestCtx.requestStart).Milliseconds()
		e.logPolicyResult(req, traceID, requestCtx, "block", decisionPath, durationMs, serveResult{})
		appendWAL(e.wal, e.makeWALEvent(req, traceID, requestID, requestCtx, entry.Decision, "", decisionPath, 0, decisionCache, durationMs, entry))
		writeError(w, http.StatusForbidden, "POLICY_BLOCK", entry.Reason)
		e.emitUsedVersionMetadata(req)
		return
	}

	allow := action.onAllow(entry.ServeMode)
	durationMs := time.Since(requestCtx.requestStart).Milliseconds()
	eventType := requestCtx.event.eventType
	if allow.failed && eventType == "artifact" {
		eventType = "upstream_error"
	}
	logCtx := requestCtx
	logCtx.event.eventType = eventType
	e.logPolicyResult(req, traceID, logCtx, "allow", decisionPath, durationMs, allow)
	appendWAL(e.wal, e.makeWALEvent(req, traceID, requestID, logCtx, entry.Decision, allow.serveMode, decisionPath, allow.bytesTransferred, decisionCache, durationMs, entry))
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
		"decision_path", "control_plane_unavailable",
		"duration_ms", durationMs,
		"error", err.Error(),
	}
	logAttrs = e.appendRequestLogAttrs(logAttrs, req, traceID, requestCtx)
	slog.Error("request evaluated", logAttrs...)

	entry := cache.CacheEntry{}
	if e.tokenContextCache != nil {
		if cached, ok := e.tokenContextCache.Get(requestCtx.projectTokenHash); ok {
			entry.TenantID = cached.TenantID
			entry.ProjectID = cached.ProjectID
		}
	}
	appendWAL(e.wal, e.makeWALEvent(req, traceID, requestID, requestCtx, "DECISION_BLOCK", "", "control_plane_unavailable", 0, false, durationMs, entry))
	writeError(w, http.StatusServiceUnavailable, "CONTROL_PLANE_UNAVAILABLE", "control plane unreachable")
	e.emitUsedVersionMetadata(req)
}

func (e *engine) emitUsedVersionMetadata(req PackageRequest) {
	if e.wal == nil || e.packageMetadataCache == nil {
		return
	}
	if e.resolver.Ecosystem() != "npm" || !req.IsArtifact || req.Version == "" {
		return
	}

	key := metadata.CacheKey{
		Ecosystem: e.resolver.Ecosystem(),
		Package:   req.Package,
	}
	summary, state, found := e.packageMetadataCache.Get(key)
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
	if e.signalDedupe != nil && !e.signalDedupe.ShouldEmit(fingerprint) {
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

	appendWALRecordAsync(e.wal, wal.Record{
		SchemaVersion: wal.SchemaVersionV1,
		RecordType:    wal.RecordTypePackageUsedVersionMetadata,
		RecordedAt:    payload.ObservedAt,
		Payload:       raw,
	})
}

func usedVersionMetadataFingerprint(payload wal.PackageUsedVersionMetadata) string {
	return strings.Join([]string{
		payload.Ecosystem,
		payload.Package,
		payload.UsedVersion,
		payload.UsedVersionPublishedAt,
		payload.CacheStatus,
		payload.LatestVersion,
		payload.LatestPublishedAt,
	}, "|")
}

func (e *engine) logPolicyResult(
	req PackageRequest,
	traceID string,
	requestCtx policyRequestContext,
	decision string,
	decisionPath string,
	durationMs int64,
	serve serveResult,
) {
	logAttrs := []any{
		"service", "proxy",
		"decision", decision,
		"decision_path", decisionPath,
		"duration_ms", durationMs,
	}
	logAttrs = e.appendRequestLogAttrs(logAttrs, req, traceID, requestCtx)
	if decision == "allow" {
		if serve.serveMode != "" {
			logAttrs = append(logAttrs, "serve_mode", serve.serveMode)
		}
		if serve.bytesTransferred > 0 || requestCtx.event.eventType == "artifact" {
			logAttrs = append(logAttrs, "bytes_transferred", serve.bytesTransferred)
		}
		if serve.upstreamSuccess != nil {
			logAttrs = append(logAttrs, "upstream_success", *serve.upstreamSuccess)
		}
	}
	slog.Info("request evaluated", logAttrs...)
}

func (e *engine) appendRequestLogAttrs(
	attrs []any,
	req PackageRequest,
	traceID string,
	requestCtx policyRequestContext,
) []any {
	if requestCtx.event.eventType == "metadata" {
		attrs = append(attrs, "event_type", "metadata")
	}
	attrs = append(attrs,
		"ecosystem", requestCtx.ecosystem,
		"package", req.Package,
	)
	if requestCtx.event.version != "" {
		attrs = append(attrs, "version", requestCtx.event.version)
	}
	attrs = append(attrs, "trace_id", traceID)
	return attrs
}

// clientIP extracts the best-available client IP from a request.
// It only honors forwarding headers when the immediate socket peer belongs to
// an explicitly trusted proxy CIDR. Otherwise it falls back to RemoteAddr.
// If redact is true, the last octet of IPv4 is zeroed and the last 64 bits
// of IPv6 are zeroed before returning (GDPR/CCPA anonymisation).
// Returns an empty string if no IP can be determined — never errors.
func clientIP(r *http.Request, redact bool, trustedProxies []netip.Prefix) string {
	ip := remoteIPFromAddr(r.RemoteAddr)
	if isTrustedProxy(ip, trustedProxies) {
		if v := strings.TrimSpace(r.Header.Get("X-Real-IP")); v != "" {
			if parsed, ok := parseLiteralIP(v); ok {
				ip = parsed
			}
		} else if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.SplitN(xff, ",", 2)
			if parsed, ok := parseLiteralIP(strings.TrimSpace(parts[0])); ok {
				ip = parsed
			}
		}
	}

	if ip == "" || !redact {
		return ip
	}

	return redactIP(ip)
}

func parseLiteralIP(value string) (string, bool) {
	addr, err := netip.ParseAddr(value)
	if err != nil {
		return "", false
	}
	return addr.String(), true
}

func remoteIPFromAddr(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return remoteAddr
	}
	return host
}

func isTrustedProxy(ip string, trustedProxies []netip.Prefix) bool {
	if len(trustedProxies) == 0 {
		return false
	}

	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return false
	}

	for _, prefix := range trustedProxies {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

// redactIP anonymises an IP address for privacy compliance.
// IPv4: zeroes the last octet (192.168.1.42 → 192.168.1.0), keeping 24 bits.
// IPv6: zeroes the last 64 bits (interface identifier), keeping the top 64 bits
// (the /64 network prefix). This is the standard GDPR-compliant boundary —
// it removes host identity while preserving subnet-level attribution for abuse
// detection (e.g. 2001:db8:1:2::dead:beef → 2001:db8:1:2::).
// Returns the original string if parsing fails.
func redactIP(ip string) string {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return ip
	}

	if v4 := parsed.To4(); v4 != nil {
		v4[3] = 0
		return v4.String()
	}

	// IPv6 — zero the last 8 bytes (64 bits), keep the first 8 bytes (64 bits)
	v6 := parsed.To16()
	for i := 8; i < 16; i++ {
		v6[i] = 0
	}
	return v6.String()
}

// writeError writes the canonical JSON error envelope. It is a package-level
// function so resolver implementations can call it from OnProxyMetadata without
// holding a reference to the engine.
func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"error": map[string]interface{}{
			"code":    code,
			"message": message,
			"detail":  nil,
		},
	})
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

// streamResponse forwards an upstream HTTP response to the client, copying
// Content-Type and Content-Length headers before streaming the body.
// Returns the number of bytes copied so callers can record bytes_transferred.
// The caller is responsible for closing resp.Body.
func streamResponse(w http.ResponseWriter, resp *http.Response) (int64, error) {
	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	if cl := resp.Header.Get("Content-Length"); cl != "" {
		w.Header().Set("Content-Length", cl)
	}
	w.WriteHeader(http.StatusOK)
	return io.Copy(w, resp.Body)
}

// extractBearerToken extracts the token from an Authorization: Bearer header.
// Returns an empty string if the header is absent or not in Bearer format.
func extractBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return ""
}

// generateTraceparent creates a W3C traceparent header value with a random
// 128-bit trace ID and 64-bit span ID.
// Format: 00-<32 hex chars>-<16 hex chars>-01
func generateTraceparent() string {
	var traceBytes [16]byte
	var spanBytes [8]byte
	_, _ = rand.Read(traceBytes[:])
	_, _ = rand.Read(spanBytes[:])
	return fmt.Sprintf("00-%s-%s-01",
		hex.EncodeToString(traceBytes[:]),
		hex.EncodeToString(spanBytes[:]),
	)
}

func hashProjectToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// Ensure engine satisfies http.Handler at compile time.
var _ http.Handler = (*engine)(nil)
