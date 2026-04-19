// Package client provides a ConnectRPC client for the Customs control-plane GatewayService.
package client

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"connectrpc.com/connect"
	customsv1 "github.com/getcustoms/proxy/gen/customs/v1"
	"github.com/getcustoms/proxy/gen/customs/v1/customsv1connect"
	"github.com/getcustoms/proxy/internal/wal"
)

// CheckRequest carries the inputs for a policy check.
type CheckRequest struct {
	ProxyID            string
	ProjectToken       string
	Ecosystem          string
	Package            string
	Version            string
	TraceID            string
	RequestID          string
	SpanID             string
	ClientIP           string
	ContributorContext *ContributorCheckContext
}

type ContributorCheckVersion struct {
	Version           string
	PublishedAt       string
	Publisher         string
	Maintainers       []string
	HasInstallScripts bool
	HasAttestation    bool
	RawPayloadJSON    string
}

type ContributorCheckContext struct {
	RequestedVersion               string
	RequestedVersionPublishedAt    string
	SliceExtractedAt               string
	SliceWindowDays                int32
	SliceHistoryComplete           bool
	SliceOldestIncludedPublishedAt string
	PackageMetadataFingerprint     string
	SliceFingerprint               string
	Versions                       []ContributorCheckVersion
}

// CheckResponse carries the policy decision returned by the control plane.
type CheckResponse struct {
	Decision        string // "DECISION_ALLOW" | "DECISION_BLOCK"
	Reason          string
	Detail          string
	CacheTTLSeconds int32
	// ServeMode mirrors the proto ServeMode enum name (e.g. "SERVE_MODE_REDIRECT").
	// Only meaningful when Decision is DECISION_ALLOW.
	ServeMode string
	// TenantID and ProjectID are returned by the control plane so the proxy
	// can populate WAL events without a separate lookup.
	TenantID  string
	ProjectID string
}

// MetadataCacheStats carries aggregate metadata-cache telemetry for one ecosystem.
type MetadataCacheStats struct {
	Ecosystem       string
	Hits            int64
	Misses          int64
	StaleHits       int64
	Refreshes       int64
	ParseFailures   int64
	StoreFailures   int64
	WindowStartedAt string
	WindowEndedAt   string
}

// Client wraps a ConnectRPC GatewayServiceClient with proxy authentication.
type Client struct {
	httpClient  *http.Client
	svc         customsv1connect.GatewayServiceClient
	baseURL     string
	proxySecret string
	proxyID     string

	mu                    sync.RWMutex
	runtimeToken          string
	expiresAt             time.Time
	refreshAfter          time.Time
	runtimeTokenRefresher func(context.Context, string) error
}

type tokenExchangeResponse struct {
	AccessToken  string `json:"access_token"`
	ExpiresAt    string `json:"expires_at"`
	RefreshAfter string `json:"refresh_after"`
}

type BootstrapAuthError struct {
	StatusCode int
	Code       string
	Message    string
}

type UnsupportedWALRecordTypeError struct {
	RecordType string
}

// RuntimePing verifies the normal RPC path using the current runtime token.
// Any clean Check response counts as success, even if the empty project token
// is blocked with reason "invalid_token".
func (c *Client) RuntimePing(ctx context.Context) error {
	connectReq := connect.NewRequest(&customsv1.CheckRequest{})
	if err := c.ensureRuntimeToken(ctx); err != nil {
		return err
	}
	if err := c.setRuntimeAuthHeader(connectReq.Header()); err != nil {
		return err
	}
	_, err := c.svc.Check(ctx, connectReq)
	if err != nil {
		return fmt.Errorf("client: runtime ping: %w", err)
	}
	return nil
}

func (e *BootstrapAuthError) Error() string {
	if e == nil {
		return ""
	}
	if e.Code != "" {
		return fmt.Sprintf("bootstrap auth failed: %s (%s)", e.Message, e.Code)
	}
	return fmt.Sprintf("bootstrap auth failed: %s", e.Message)
}

func (e *UnsupportedWALRecordTypeError) Error() string {
	if e == nil {
		return ""
	}
	return fmt.Sprintf("client: unsupported WAL record type %q", e.RecordType)
}

func IsUnsupportedWALRecordType(err error) bool {
	var target *UnsupportedWALRecordTypeError
	return errors.As(err, &target)
}

func (e *BootstrapAuthError) Permanent() bool {
	if e == nil {
		return false
	}
	switch e.Code {
	case "PROXY_DISABLED", "PROXY_REVOKED", "INVALID_PROXY_SECRET", "UNREGISTERED_PROXY":
		return true
	default:
		return e.StatusCode >= 400 && e.StatusCode < 500
	}
}

// New creates a Client backed by an HTTP/2-capable transport.
func New(baseURL, proxySecret, proxyID string) *Client {
	transport := &http.Transport{
		TLSClientConfig:     &tls.Config{MinVersion: tls.VersionTLS12},
		MaxIdleConnsPerHost: 10,
		IdleConnTimeout:     90 * time.Second,
	}
	httpClient := &http.Client{
		Transport: transport,
		Timeout:   10 * time.Second,
	}
	baseURL = strings.TrimRight(baseURL, "/")
	return &Client{
		httpClient:  httpClient,
		svc:         customsv1connect.NewGatewayServiceClient(httpClient, baseURL),
		baseURL:     baseURL,
		proxySecret: proxySecret,
		proxyID:     proxyID,
	}
}

// Ping verifies that the control plane is reachable and the bootstrap
// credentials can mint a runtime JWT.
func (c *Client) Ping(ctx context.Context) error {
	_, err := c.ExchangeRuntimeToken(ctx)
	return err
}

// ExchangeRuntimeToken calls the control plane bootstrap endpoint, stores the
// returned runtime token in memory, and returns the server-provided refresh
// timestamp.
func (c *Client) ExchangeRuntimeToken(ctx context.Context) (time.Time, error) {
	tokenURL, err := url.JoinPath(c.baseURL, "/internal/v1/proxy/token")
	if err != nil {
		return time.Time{}, fmt.Errorf("client: token url: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, nil)
	if err != nil {
		return time.Time{}, fmt.Errorf("client: token request: %w", err)
	}
	req.Header.Set("x-proxy-id", c.proxyID)
	req.Header.Set("x-proxy-secret", c.proxySecret)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return time.Time{}, fmt.Errorf("client: token exchange: %w", err)
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
		var parsed struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(body, &parsed)
		return time.Time{}, &BootstrapAuthError{
			StatusCode: resp.StatusCode,
			Code:       parsed.Error.Code,
			Message:    parsed.Error.Message,
		}
	}

	var payload tokenExchangeResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return time.Time{}, fmt.Errorf("client: token exchange decode: %w", err)
	}

	expiresAt, err := time.Parse(time.RFC3339, payload.ExpiresAt)
	if err != nil {
		return time.Time{}, fmt.Errorf("client: parse expires_at: %w", err)
	}
	refreshAfter, err := time.Parse(time.RFC3339, payload.RefreshAfter)
	if err != nil {
		return time.Time{}, fmt.Errorf("client: parse refresh_after: %w", err)
	}

	c.mu.Lock()
	c.runtimeToken = payload.AccessToken
	c.expiresAt = expiresAt
	c.refreshAfter = refreshAfter
	c.mu.Unlock()

	return refreshAfter, nil
}

func (c *Client) RefreshAfter() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.refreshAfter
}

func (c *Client) ExpiresAt() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.expiresAt
}

func (c *Client) TokenExpired(now time.Time) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.runtimeToken == "" || !c.expiresAt.After(now)
}

func (c *Client) SetRuntimeTokenRefresher(refresher func(context.Context, string) error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.runtimeTokenRefresher = refresher
}

func (c *Client) refreshRuntimeToken(ctx context.Context, reason string) error {
	c.mu.RLock()
	refresher := c.runtimeTokenRefresher
	c.mu.RUnlock()

	if refresher != nil {
		return refresher(ctx, reason)
	}

	_, err := c.ExchangeRuntimeToken(ctx)
	return err
}

func (c *Client) ensureRuntimeToken(ctx context.Context) error {
	now := time.Now()

	c.mu.RLock()
	tokenPresent := c.runtimeToken != ""
	expiresAt := c.expiresAt
	refreshAfter := c.refreshAfter
	c.mu.RUnlock()

	if !tokenPresent || !expiresAt.After(now) {
		return c.refreshRuntimeToken(ctx, "request")
	}

	if !refreshAfter.IsZero() && !now.Before(refreshAfter) {
		if err := c.refreshRuntimeToken(ctx, "request"); err != nil {
			if authErr, ok := err.(*BootstrapAuthError); ok && authErr.Permanent() {
				return err
			}
			// Continue using the still-valid token. Runtime owns degraded-state tracking.
			return nil
		}
	}

	return nil
}

func (c *Client) runtimeTokenValue() (string, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.runtimeToken == "" {
		return "", fmt.Errorf("client: runtime token is not initialized")
	}
	return c.runtimeToken, nil
}

func (c *Client) setRuntimeAuthHeader(header http.Header) error {
	token, err := c.runtimeTokenValue()
	if err != nil {
		return err
	}
	header.Set("Authorization", "Bearer "+token)
	return nil
}

// Check calls GatewayService.Check and returns the policy decision.
func (c *Client) Check(ctx context.Context, req CheckRequest) (CheckResponse, error) {
	checkReq := &customsv1.CheckRequest{
		ProjectToken: req.ProjectToken,
		Ecosystem:    req.Ecosystem,
		Package:      req.Package,
		Version:      req.Version,
		TraceId:      req.TraceID,
		RequestId:    req.RequestID,
		SpanId:       req.SpanID,
		ClientIp:     req.ClientIP,
	}
	if req.ContributorContext != nil {
		versions := make([]*customsv1.PackageContributorVersionEntry, 0, len(req.ContributorContext.Versions))
		for _, version := range req.ContributorContext.Versions {
			versions = append(versions, &customsv1.PackageContributorVersionEntry{
				Version:           version.Version,
				PublishedAt:       version.PublishedAt,
				Publisher:         version.Publisher,
				Maintainers:       version.Maintainers,
				HasInstallScripts: version.HasInstallScripts,
				HasAttestation:    version.HasAttestation,
				RawPayloadJson:    version.RawPayloadJSON,
			})
		}
		checkReq.ContributorContext = &customsv1.ContributorCheckContext{
			RequestedVersion:               req.ContributorContext.RequestedVersion,
			RequestedVersionPublishedAt:    req.ContributorContext.RequestedVersionPublishedAt,
			SliceExtractedAt:               req.ContributorContext.SliceExtractedAt,
			SliceWindowDays:                req.ContributorContext.SliceWindowDays,
			SliceHistoryComplete:           req.ContributorContext.SliceHistoryComplete,
			SliceOldestIncludedPublishedAt: req.ContributorContext.SliceOldestIncludedPublishedAt,
			PackageMetadataFingerprint:     req.ContributorContext.PackageMetadataFingerprint,
			SliceFingerprint:               req.ContributorContext.SliceFingerprint,
			Versions:                       versions,
		}
	}
	connectReq := connect.NewRequest(checkReq)
	if err := c.ensureRuntimeToken(ctx); err != nil {
		return CheckResponse{}, err
	}
	if err := c.setRuntimeAuthHeader(connectReq.Header()); err != nil {
		return CheckResponse{}, err
	}

	resp, err := c.svc.Check(ctx, connectReq)
	if err != nil {
		return CheckResponse{}, fmt.Errorf("client: Check RPC: %w", err)
	}

	decision := "DECISION_ALLOW"
	if resp.Msg.Decision == customsv1.Decision_DECISION_BLOCK {
		decision = "DECISION_BLOCK"
	}

	serveMode := resp.Msg.ServeMode.String()
	if resp.Msg.ServeMode == customsv1.ServeMode_SERVE_MODE_UNSPECIFIED {
		serveMode = "SERVE_MODE_REDIRECT"
	}

	return CheckResponse{
		Decision:        decision,
		Reason:          resp.Msg.Reason,
		Detail:          resp.Msg.Detail,
		CacheTTLSeconds: resp.Msg.CacheTtlSeconds,
		ServeMode:       serveMode,
		TenantID:        resp.Msg.TenantId,
		ProjectID:       resp.Msg.ProjectId,
	}, nil
}

// parseEventType maps an EventType string from the WAL to the proto enum value.
func parseEventType(s string) customsv1.EventType {
	switch s {
	case "metadata":
		return customsv1.EventType_EVENT_TYPE_METADATA
	case "artifact":
		return customsv1.EventType_EVENT_TYPE_ARTIFACT
	case "upstream_error":
		return customsv1.EventType_EVENT_TYPE_UPSTREAM_ERROR
	default:
		return customsv1.EventType_EVENT_TYPE_UNSPECIFIED
	}
}

// parseServeMode maps a ServeMode string from the WAL to the proto enum value.
// Unrecognised or empty strings (BLOCK events) map to SERVE_MODE_UNSPECIFIED.
func parseServeMode(s string) customsv1.ServeMode {
	switch s {
	case "SERVE_MODE_REDIRECT":
		return customsv1.ServeMode_SERVE_MODE_REDIRECT
	case "SERVE_MODE_PULL":
		return customsv1.ServeMode_SERVE_MODE_PULL
	default:
		return customsv1.ServeMode_SERVE_MODE_UNSPECIFIED
	}
}

func parseMetadataCacheStatus(s string) customsv1.MetadataCacheStatus {
	switch s {
	case "hit":
		return customsv1.MetadataCacheStatus_METADATA_CACHE_STATUS_HIT
	case "miss":
		return customsv1.MetadataCacheStatus_METADATA_CACHE_STATUS_MISS
	case "stale":
		return customsv1.MetadataCacheStatus_METADATA_CACHE_STATUS_STALE
	case "refresh":
		return customsv1.MetadataCacheStatus_METADATA_CACHE_STATUS_REFRESH
	default:
		return customsv1.MetadataCacheStatus_METADATA_CACHE_STATUS_UNSPECIFIED
	}
}

// RecordProxyStatus calls GatewayService.RecordProxyStatus to report a proxy lifecycle event.
// The proxy IP is derived by the control plane from the incoming connection — it is not
// supplied here because a proxy running in a container would report its internal IP.
func (c *Client) RecordProxyStatus(ctx context.Context, eventType string) error {
	connectReq := connect.NewRequest(&customsv1.RecordProxyStatusRequest{
		Event: &customsv1.ProxyStatusEvent{
			EventType: eventType,
		},
	})
	if err := c.ensureRuntimeToken(ctx); err != nil {
		return err
	}
	if err := c.setRuntimeAuthHeader(connectReq.Header()); err != nil {
		return err
	}

	_, err := c.svc.RecordProxyStatus(ctx, connectReq)
	if err != nil {
		return fmt.Errorf("client: RecordProxyStatus RPC: %w", err)
	}
	return nil
}

// RecordPackageLatestMetadata records package-level freshness observed during a metadata request.
func (c *Client) RecordPackageLatestMetadata(ctx context.Context, msg wal.PackageLatestMetadata) error {
	connectReq := connect.NewRequest(&customsv1.RecordPackageLatestMetadataRequest{
		Ecosystem:         msg.Ecosystem,
		Package:           msg.Package,
		LatestVersion:     msg.LatestVersion,
		LatestPublishedAt: msg.LatestPublishedAt,
		ObservedAt:        msg.ObservedAt,
		CacheStatus:       parseMetadataCacheStatus(msg.CacheStatus),
	})
	if err := c.ensureRuntimeToken(ctx); err != nil {
		return err
	}
	if err := c.setRuntimeAuthHeader(connectReq.Header()); err != nil {
		return err
	}
	if _, err := c.svc.RecordPackageLatestMetadata(ctx, connectReq); err != nil {
		return fmt.Errorf("client: RecordPackageLatestMetadata RPC: %w", err)
	}
	return nil
}

// RecordPackageUsedVersionMetadata records version-specific freshness observed during an artifact request.
func (c *Client) RecordPackageUsedVersionMetadata(ctx context.Context, msg wal.PackageUsedVersionMetadata) error {
	connectReq := connect.NewRequest(&customsv1.RecordPackageUsedVersionMetadataRequest{
		Ecosystem:              msg.Ecosystem,
		Package:                msg.Package,
		UsedVersion:            msg.UsedVersion,
		UsedVersionPublishedAt: msg.UsedVersionPublishedAt,
		ObservedAt:             msg.ObservedAt,
		CacheStatus:            parseMetadataCacheStatus(msg.CacheStatus),
		LatestVersion:          msg.LatestVersion,
		LatestPublishedAt:      msg.LatestPublishedAt,
	})
	if err := c.ensureRuntimeToken(ctx); err != nil {
		return err
	}
	if err := c.setRuntimeAuthHeader(connectReq.Header()); err != nil {
		return err
	}
	if _, err := c.svc.RecordPackageUsedVersionMetadata(ctx, connectReq); err != nil {
		return fmt.Errorf("client: RecordPackageUsedVersionMetadata RPC: %w", err)
	}
	return nil
}

// RecordMetadataCacheStats records aggregate metadata-cache telemetry for one ecosystem.
func (c *Client) RecordMetadataCacheStats(ctx context.Context, msg MetadataCacheStats) error {
	connectReq := connect.NewRequest(&customsv1.RecordMetadataCacheStatsRequest{
		Ecosystem:       msg.Ecosystem,
		Hits:            msg.Hits,
		Misses:          msg.Misses,
		StaleHits:       msg.StaleHits,
		Refreshes:       msg.Refreshes,
		ParseFailures:   msg.ParseFailures,
		StoreFailures:   msg.StoreFailures,
		WindowStartedAt: msg.WindowStartedAt,
		WindowEndedAt:   msg.WindowEndedAt,
	})
	if err := c.ensureRuntimeToken(ctx); err != nil {
		return err
	}
	if err := c.setRuntimeAuthHeader(connectReq.Header()); err != nil {
		return err
	}
	if _, err := c.svc.RecordMetadataCacheStats(ctx, connectReq); err != nil {
		return fmt.Errorf("client: RecordMetadataCacheStats RPC: %w", err)
	}
	return nil
}

// EventStream wraps a single client-streaming RecordUsage call.
// Call Send for each WAL event, then CloseAndReceive once to close the stream
// and retrieve the server-acknowledged count.
// The proxy advances the WAL checkpoint after a successful CloseAndReceive,
// guaranteeing at-least-once delivery: events sent but not yet ACKed will be
// replayed if the stream fails before CloseAndReceive returns.
type EventStream struct {
	stream *connect.ClientStreamForClient[customsv1.RecordUsageRequest, customsv1.RecordUsageResponse]
	sent   int
	err    error
}

// OpenEventStream opens a new client-streaming RecordUsage call.
// Auth headers are set immediately so they are included with the stream open.
// The stream stays open until CloseAndReceive is called (or the context is cancelled).
func (c *Client) OpenEventStream(ctx context.Context) *EventStream {
	stream := c.svc.RecordUsage(ctx)
	if err := c.ensureRuntimeToken(ctx); err != nil {
		return &EventStream{err: err}
	}
	if err := c.setRuntimeAuthHeader(stream.RequestHeader()); err != nil {
		return &EventStream{err: err}
	}
	return &EventStream{stream: stream}
}

// Send serialises a WAL event and sends it on the open stream.
func (s *EventStream) Send(e wal.Event) error {
	if s.err != nil {
		return s.err
	}
	if err := s.stream.Send(walEventToProto(e)); err != nil {
		return fmt.Errorf("client: stream send: %w", err)
	}
	s.sent++
	return nil
}

// Sent returns the number of events sent on this stream (not yet ACKed).
func (s *EventStream) Sent() int { return s.sent }

// CloseAndReceive closes the send side of the stream and waits for the server
// response. Returns the number of events the server recorded.
func (s *EventStream) CloseAndReceive() (int32, error) {
	if s.err != nil {
		return 0, s.err
	}
	resp, err := s.stream.CloseAndReceive()
	if err != nil {
		return 0, fmt.Errorf("client: stream close: %w", err)
	}
	return resp.Msg.Recorded, nil
}

// walEventToProto converts a wal.Event to its proto representation.
func walEventToProto(e wal.Event) *customsv1.RecordUsageRequest {
	decision := customsv1.Decision_DECISION_ALLOW
	if e.Decision == "DECISION_BLOCK" {
		decision = customsv1.Decision_DECISION_BLOCK
	}
	return &customsv1.RecordUsageRequest{
		Ecosystem:        e.Ecosystem,
		Package:          e.Package,
		Version:          e.Version,
		Decision:         decision,
		RequestedAt:      e.RequestedAt,
		ProjectTokenHash: e.ProjectTokenHash,
		TraceId:          e.TraceID,
		RequestId:        e.RequestID,
		TenantId:         e.TenantID,
		ProjectId:        e.ProjectID,
		ServeMode:        parseServeMode(e.ServeMode),
		BytesTransferred: e.BytesTransferred,
		ClientIp:         e.ClientIP,
		EventType:        parseEventType(e.EventType),
		DecisionCache:    e.DecisionCache,
		DurationMs:       e.DurationMs,
		DecisionPath:     e.DecisionPath,
	}
}

func walRecordToLatestMetadata(record wal.Record) (wal.PackageLatestMetadata, error) {
	if record.RecordType != wal.RecordTypePackageLatestMetadata {
		return wal.PackageLatestMetadata{}, fmt.Errorf("client: unexpected record type %q", record.RecordType)
	}
	var payload wal.PackageLatestMetadata
	if err := json.Unmarshal(record.Payload, &payload); err != nil {
		return wal.PackageLatestMetadata{}, fmt.Errorf("client: decode package latest metadata: %w", err)
	}
	return payload, nil
}

func walRecordToUsedVersionMetadata(record wal.Record) (wal.PackageUsedVersionMetadata, error) {
	if record.RecordType != wal.RecordTypePackageUsedVersionMetadata {
		return wal.PackageUsedVersionMetadata{}, fmt.Errorf("client: unexpected record type %q", record.RecordType)
	}
	var payload wal.PackageUsedVersionMetadata
	if err := json.Unmarshal(record.Payload, &payload); err != nil {
		return wal.PackageUsedVersionMetadata{}, fmt.Errorf("client: decode package used-version metadata: %w", err)
	}
	return payload, nil
}

// RecordPackageContributorMetadata forwards normalized package contributor metadata to the control plane.
func (c *Client) RecordPackageContributorMetadata(ctx context.Context, msg wal.PackageContributorMetadata) error {
	versions := make([]*customsv1.PackageContributorVersionEntry, 0, len(msg.Versions))
	for _, v := range msg.Versions {
		versions = append(versions, &customsv1.PackageContributorVersionEntry{
			Version:           v.Version,
			PublishedAt:       v.PublishedAt,
			Publisher:         v.Publisher,
			Maintainers:       v.Maintainers,
			HasInstallScripts: v.HasInstallScripts,
			HasAttestation:    v.HasAttestation,
			RawPayloadJson:    v.RawPayloadJSON,
		})
	}
	connectReq := connect.NewRequest(&customsv1.RecordPackageContributorMetadataRequest{
		Ecosystem:                 msg.Ecosystem,
		Package:                   msg.Package,
		ExtractedAt:               msg.ExtractedAt,
		Versions:                  versions,
		Fingerprint:               msg.Fingerprint,
		LatestVersion:             msg.LatestVersion,
		LatestPublishedAt:         msg.LatestPublishedAt,
		HistoryComplete:           msg.HistoryComplete,
		OldestIncludedPublishedAt: msg.OldestIncludedPublishedAt,
	})
	if err := c.ensureRuntimeToken(ctx); err != nil {
		return err
	}
	if err := c.setRuntimeAuthHeader(connectReq.Header()); err != nil {
		return err
	}
	if _, err := c.svc.RecordPackageContributorMetadata(ctx, connectReq); err != nil {
		return fmt.Errorf("client: RecordPackageContributorMetadata RPC: %w", err)
	}
	return nil
}

func walRecordToPackageContributorMetadata(record wal.Record) (wal.PackageContributorMetadata, error) {
	if record.RecordType != wal.RecordTypePackageContributorMetadata {
		return wal.PackageContributorMetadata{}, fmt.Errorf("client: unexpected record type %q", record.RecordType)
	}
	var payload wal.PackageContributorMetadata
	if err := json.Unmarshal(record.Payload, &payload); err != nil {
		return wal.PackageContributorMetadata{}, fmt.Errorf("client: decode package contributor metadata: %w", err)
	}
	return payload, nil
}

// RecordWALRecord dispatches a typed WAL record to the corresponding control-plane RPC.
func (c *Client) RecordWALRecord(ctx context.Context, record wal.Record) error {
	switch record.RecordType {
	case wal.RecordTypePackageLatestMetadata:
		msg, err := walRecordToLatestMetadata(record)
		if err != nil {
			return err
		}
		return c.RecordPackageLatestMetadata(ctx, msg)
	case wal.RecordTypePackageUsedVersionMetadata:
		msg, err := walRecordToUsedVersionMetadata(record)
		if err != nil {
			return err
		}
		return c.RecordPackageUsedVersionMetadata(ctx, msg)
	case wal.RecordTypePackageContributorMetadata:
		msg, err := walRecordToPackageContributorMetadata(record)
		if err != nil {
			return err
		}
		return c.RecordPackageContributorMetadata(ctx, msg)
	default:
		return &UnsupportedWALRecordTypeError{RecordType: record.RecordType}
	}
}
