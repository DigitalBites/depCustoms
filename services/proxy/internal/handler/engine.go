// Package handler implements per-ecosystem reverse-proxy HTTP handlers.
package handler

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/getcustoms/proxy/internal/cache"
	"github.com/getcustoms/proxy/internal/config"
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
	deps     Dependencies
	cfg      *config.Config
	resolver EcosystemResolver
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

func newEngine(deps Dependencies, cfg *config.Config, resolver EcosystemResolver) *engine {
	return &engine{
		deps:     deps,
		cfg:      cfg,
		resolver: resolver,
	}
}

// ServeHTTP is the single entry point for all ecosystem traffic routed to this
// engine. It parses the request, validates the bearer token (required for all
// paths — metadata and artifact alike), then dispatches to the appropriate handler.
func (e *engine) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestID := uuid.New().String()
	traceID := r.Header.Get("traceparent")
	if traceID == "" {
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
		func(serveMode string) serveResult {
			outcome := e.resolver.OnServeAllowed(w, r, req, serveMode)
			return serveResult{
				serveMode:        outcome.ServeMode,
				bytesTransferred: outcome.BytesTransferred,
				failed:           outcome.Failed,
			}
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
		func(string) serveResult {
			upstreamSuccess := e.resolver.OnProxyMetadata(w, r, req.Package)
			return serveResult{
				upstreamSuccess: &upstreamSuccess,
			}
		},
	)
}

var _ http.Handler = (*engine)(nil)
