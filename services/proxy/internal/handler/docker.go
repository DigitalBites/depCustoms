package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/getcustoms/proxy/internal/config"
	"github.com/getcustoms/proxy/internal/taxonomy"
)

const (
	dockerHubDisplayRegistry = "hub.docker.io"
	dockerHubNetworkRegistry = "registry-1.docker.io"
	dockerMaxManifestBytes   = 16 << 20

	dockerRefSourceManifestDigestHeader = "manifest_digest_header"
	dockerRefSourceRequestDigest        = "request_digest"
	dockerRefSourceUnresolvedTag        = "unresolved_tag_fallback"

	dockerVersionKindDigest    = "digest"
	dockerArtifactKindManifest = "docker_manifest"
	dockerArtifactKindBlob     = "docker_blob"
	dockerDisplayRoleChild     = "child"
	dockerDisplayRoleInternal  = "internal"
	dockerRelationshipIndex    = "index_manifest"
	dockerRelationshipConfig   = "manifest_config"
	dockerRelationshipLayer    = "manifest_layer"
	dockerDescriptorKindIndex  = "index_manifest"
	dockerDescriptorKindConfig = "config"
	dockerDescriptorKindLayer  = "layer"
)

type dockerResolver struct {
	cfg           dockerConfig
	httpClient    *http.Client
	tokenCache    *dockerTokenCache
	blobAllow     *dockerBlobAllowCache
	preparedByReq sync.Map // map[*http.Request]dockerPreparedResponse
}

type dockerConfig struct {
	allowedUpstreams              []string
	allowPrivateUpstreams         bool
	upstreamRequestTimeoutSeconds int
	authTokenTTLSeconds           int
	manifestAllowCacheTTLSeconds  int
}

type dockerRequestKind string

const (
	dockerKindPing     dockerRequestKind = "ping"
	dockerKindManifest dockerRequestKind = "manifest"
	dockerKindBlob     dockerRequestKind = "blob"
)

type dockerParsedRequest struct {
	kind            dockerRequestKind
	displayRegistry string
	networkRegistry string
	repository      string
	reference       string
	isDigest        bool
	blobDigest      string
}

type dockerPreparedResponse struct {
	parsed         dockerParsedRequest
	statusCode     int
	header         http.Header
	body           []byte
	manifestDigest string
}

type dockerTokenCache struct {
	mu      sync.Mutex
	entries map[string]dockerTokenEntry
}

type dockerTokenEntry struct {
	token     string
	issuedAt  time.Time
	expiresIn time.Duration
}

type dockerBlobAllowCache struct {
	mu      sync.Mutex
	ttl     time.Duration
	entries map[string]dockerBlobAllowEntry
}

type dockerBlobAllowEntry struct {
	manifestDigest string
	requestedTag   string
	mediaType      string
	sizeBytes      int64
	allowedAt      time.Time
}

func NewDockerProxy(deps Dependencies, cfg *config.Config) http.Handler {
	timeout := time.Duration(cfg.DockerUpstreamRequestTimeoutSeconds) * time.Second
	return newEngine(deps, cfg, &dockerResolver{
		cfg: dockerConfig{
			allowedUpstreams:              cfg.DockerAllowedUpstreams,
			allowPrivateUpstreams:         cfg.DockerAllowPrivateUpstreams,
			upstreamRequestTimeoutSeconds: cfg.DockerUpstreamRequestTimeoutSeconds,
			authTokenTTLSeconds:           cfg.DockerAuthTokenTTLSeconds,
			manifestAllowCacheTTLSeconds:  cfg.DockerManifestAllowCacheTTLSeconds,
		},
		httpClient: &http.Client{
			Timeout: timeout,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		tokenCache: &dockerTokenCache{entries: make(map[string]dockerTokenEntry)},
		blobAllow: &dockerBlobAllowCache{
			ttl:     time.Duration(cfg.DockerManifestAllowCacheTTLSeconds) * time.Second,
			entries: make(map[string]dockerBlobAllowEntry),
		},
	})
}

func (h *dockerResolver) Ecosystem() string { return taxonomy.EcosystemDocker }

func (h *dockerResolver) ParseRequest(r *http.Request) PackageRequest {
	if isDockerWriteMethod(r.Method) && strings.HasPrefix(r.URL.Path, "/v2/") {
		return PackageRequest{
			Package:      "unsupported-write",
			BypassPolicy: true,
		}
	}
	parsed, ok := parseDockerRequestPath(r.URL.Path)
	if !ok {
		return PackageRequest{}
	}
	if parsed.kind == dockerKindPing {
		return PackageRequest{
			Package:      "registry-api",
			BypassPolicy: true,
		}
	}
	pkg := parsed.displayRegistry + "/" + parsed.repository
	ref := parsed.reference
	if parsed.kind == dockerKindBlob {
		ref = parsed.blobDigest
	}
	return PackageRequest{
		Package:      pkg,
		Version:      ref,
		IsArtifact:   true,
		ArtifactKey:  string(parsed.kind),
		RequestedRef: ref,
	}
}

func (h *dockerResolver) WriteAuthChallenge(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("WWW-Authenticate", `Basic realm="Customs Docker Registry"`)
	writeDockerError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required", nil)
}

func (h *dockerResolver) OnProxyMetadata(w http.ResponseWriter, _ *http.Request, pkg string) bool {
	if pkg == "unsupported-write" {
		writeDockerError(w, http.StatusMethodNotAllowed, "UNSUPPORTED", "Docker push/write operations are not supported", nil)
		return false
	}
	if w.Header().Get("Docker-Distribution-API-Version") == "" {
		w.Header().Set("Docker-Distribution-API-Version", "registry/2.0")
	}
	returnDockerPing(w)
	return true
}

func returnDockerPing(w http.ResponseWriter) {
	w.Header().Set("Docker-Distribution-API-Version", "registry/2.0")
	w.WriteHeader(http.StatusOK)
}

func (h *dockerResolver) PreparePolicyRequest(w http.ResponseWriter, r *http.Request, req PackageRequest, projectToken string) (PackageRequest, bool) {
	parsed, ok := parseDockerRequestPath(r.URL.Path)
	if !ok {
		writeDockerError(w, http.StatusNotFound, "NAME_UNKNOWN", "could not parse Docker repository from path", nil)
		return req, false
	}
	if parsed.kind == dockerKindPing {
		return req, true
	}
	if !h.upstreamAllowed(parsed.networkRegistry, parsed.displayRegistry) {
		writeDockerError(w, http.StatusForbidden, "DENIED", "upstream registry is not allowed", parsed.displayRegistry)
		return req, false
	}
	if !h.cfg.allowPrivateUpstreams && !publicHostAllowed(parsed.networkRegistry) {
		writeDockerError(w, http.StatusForbidden, "DENIED", "upstream registry resolved to a private or reserved address", parsed.displayRegistry)
		return req, false
	}

	switch parsed.kind {
	case dockerKindManifest:
		return h.prepareManifestRequest(w, r, req, parsed)
	case dockerKindBlob:
		return h.prepareBlobRequest(w, req, parsed, projectToken)
	default:
		writeDockerError(w, http.StatusNotFound, "UNSUPPORTED", "unsupported Docker registry operation", nil)
		return req, false
	}
}

func (h *dockerResolver) prepareManifestRequest(w http.ResponseWriter, r *http.Request, req PackageRequest, parsed dockerParsedRequest) (PackageRequest, bool) {
	resp, body, err := h.fetchUpstream(r.Context(), r.Method, parsed, r.Header.Get("Accept"), "")
	if err != nil {
		writeDockerError(w, http.StatusBadGateway, "UNAVAILABLE", "upstream registry request failed", err.Error())
		return req, false
	}
	if resp.StatusCode >= 400 {
		writeDockerError(w, resp.StatusCode, dockerErrorCodeForStatus(resp.StatusCode), "upstream registry rejected manifest request", nil)
		return req, false
	}

	manifestDigest := resp.Header.Get("Docker-Content-Digest")
	source := dockerRefSourceManifestDigestHeader
	if parsed.isDigest {
		manifestDigest = parsed.reference
		source = dockerRefSourceRequestDigest
	}
	if manifestDigest == "" {
		manifestDigest = parsed.reference
		source = dockerRefSourceUnresolvedTag
		slog.Warn("docker manifest digest unavailable; using requested reference",
			"service", "proxy",
			"ecosystem", h.Ecosystem(),
			"package", req.Package,
			"requested_ref", parsed.reference,
			"ref_resolution_source", source,
		)
	}

	req.Version = manifestDigest
	req.RequestedRef = parsed.reference
	req.ResolvedRef = manifestDigest
	req.RefResolutionSource = source
	req.RelatedVersions = buildDockerRelatedVersions(resp.Header.Get("Content-Type"), body)
	h.preparedByReq.Store(r, dockerPreparedResponse{
		parsed:         parsed,
		statusCode:     resp.StatusCode,
		header:         resp.Header.Clone(),
		body:           body,
		manifestDigest: manifestDigest,
	})
	return req, true
}

func (h *dockerResolver) prepareBlobRequest(w http.ResponseWriter, req PackageRequest, parsed dockerParsedRequest, projectToken string) (PackageRequest, bool) {
	entry, ok := h.blobAllow.Get(hashProjectToken(projectToken), parsed.displayRegistry, parsed.networkRegistry, parsed.repository, parsed.blobDigest)
	if !ok {
		writeDockerError(w, http.StatusForbidden, "DENIED", "blob was not referenced by an allowed manifest", parsed.blobDigest)
		return req, false
	}
	req.Version = entry.manifestDigest
	req.RequestedRef = entry.requestedTag
	req.ResolvedRef = entry.manifestDigest
	req.RefResolutionSource = dockerRefSourceManifestDigestHeader
	return req, true
}

func (h *dockerResolver) OnServeAllowed(w http.ResponseWriter, r *http.Request, req PackageRequest, _ string) ServeOutcome {
	parsed, ok := parseDockerRequestPath(r.URL.Path)
	if !ok {
		writeDockerError(w, http.StatusNotFound, "NAME_UNKNOWN", "could not parse Docker repository from path", nil)
		return ServeOutcome{ServeMode: ServeModePull, Failed: true}
	}

	switch parsed.kind {
	case dockerKindManifest:
		return h.serveManifest(w, r, req, parsed)
	case dockerKindBlob:
		return h.serveBlob(w, r, parsed)
	default:
		writeDockerError(w, http.StatusNotFound, "UNSUPPORTED", "unsupported Docker registry operation", nil)
		return ServeOutcome{ServeMode: ServeModePull, Failed: true}
	}
}

func (h *dockerResolver) serveManifest(w http.ResponseWriter, r *http.Request, req PackageRequest, parsed dockerParsedRequest) ServeOutcome {
	var prepared dockerPreparedResponse
	if value, ok := h.preparedByReq.LoadAndDelete(r); ok {
		prepared = value.(dockerPreparedResponse)
	} else {
		resp, body, err := h.fetchUpstream(r.Context(), r.Method, parsed, r.Header.Get("Accept"), "")
		if err != nil {
			writeDockerError(w, http.StatusBadGateway, "UNAVAILABLE", "upstream registry request failed", err.Error())
			return ServeOutcome{ServeMode: ServeModePull, Failed: true}
		}
		prepared = dockerPreparedResponse{
			parsed:         parsed,
			statusCode:     resp.StatusCode,
			header:         resp.Header.Clone(),
			body:           body,
			manifestDigest: req.Version,
		}
	}

	if r.Method == http.MethodGet && prepared.statusCode >= 200 && prepared.statusCode < 300 {
		h.rememberManifestBlobs(hashProjectToken(extractProjectToken(r)), prepared.parsed, prepared.manifestDigest, req.RequestedRef, prepared.header.Get("Content-Type"), prepared.body)
	}
	n, err := writeDockerResponse(w, r.Method, prepared.statusCode, prepared.header, bytes.NewReader(prepared.body))
	if err != nil {
		return ServeOutcome{ServeMode: ServeModePull, BytesTransferred: n, Failed: true}
	}
	return ServeOutcome{ServeMode: ServeModePull, BytesTransferred: n}
}

func (h *dockerResolver) serveBlob(w http.ResponseWriter, r *http.Request, parsed dockerParsedRequest) ServeOutcome {
	resp, err := h.fetchUpstreamStream(r.Context(), r.Method, parsed, "", r.Header.Get("Range"))
	if err != nil {
		writeDockerError(w, http.StatusBadGateway, "UNAVAILABLE", "upstream registry request failed", err.Error())
		return ServeOutcome{ServeMode: ServeModePull, Failed: true}
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode >= 400 {
		writeDockerError(w, resp.StatusCode, dockerErrorCodeForStatus(resp.StatusCode), "upstream registry rejected blob request", nil)
		return ServeOutcome{ServeMode: ServeModePull, Failed: true}
	}
	n, err := writeDockerResponse(w, r.Method, resp.StatusCode, resp.Header, resp.Body)
	if err != nil {
		return ServeOutcome{ServeMode: ServeModePull, BytesTransferred: n, Failed: true}
	}
	return ServeOutcome{ServeMode: ServeModePull, BytesTransferred: n}
}

func (h *dockerResolver) fetchUpstream(ctx context.Context, method string, parsed dockerParsedRequest, accept string, rangeHeader string) (*http.Response, []byte, error) {
	upstreamURL := parsed.upstreamURL()
	req, err := http.NewRequestWithContext(ctx, method, upstreamURL, nil)
	if err != nil {
		return nil, nil, err
	}
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	resp, body, err := h.doUpstream(req, parsed)
	if err != nil || resp.StatusCode != http.StatusUnauthorized {
		return resp, body, err
	}
	challenge, ok := parseDockerBearerChallenge(resp.Header.Get("WWW-Authenticate"))
	if !ok {
		return resp, body, nil
	}
	token, err := h.tokenForChallenge(ctx, parsed, challenge)
	if err != nil {
		return nil, nil, err
	}
	retryReq, err := http.NewRequestWithContext(ctx, method, upstreamURL, nil)
	if err != nil {
		return nil, nil, err
	}
	if accept != "" {
		retryReq.Header.Set("Accept", accept)
	}
	if rangeHeader != "" {
		retryReq.Header.Set("Range", rangeHeader)
	}
	retryReq.Header.Set("Authorization", "Bearer "+token)
	return h.doUpstream(retryReq, parsed)
}

func (h *dockerResolver) fetchUpstreamStream(ctx context.Context, method string, parsed dockerParsedRequest, accept string, rangeHeader string) (*http.Response, error) {
	upstreamURL := parsed.upstreamURL()
	req, err := http.NewRequestWithContext(ctx, method, upstreamURL, nil)
	if err != nil {
		return nil, err
	}
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	resp, err := h.httpClient.Do(req)
	if err != nil || resp.StatusCode != http.StatusUnauthorized {
		return resp, err
	}
	challenge, ok := parseDockerBearerChallenge(resp.Header.Get("WWW-Authenticate"))
	_ = resp.Body.Close()
	if !ok {
		return resp, nil
	}
	token, err := h.tokenForChallenge(ctx, parsed, challenge)
	if err != nil {
		return nil, err
	}
	retryReq, err := http.NewRequestWithContext(ctx, method, upstreamURL, nil)
	if err != nil {
		return nil, err
	}
	if accept != "" {
		retryReq.Header.Set("Accept", accept)
	}
	if rangeHeader != "" {
		retryReq.Header.Set("Range", rangeHeader)
	}
	retryReq.Header.Set("Authorization", "Bearer "+token)
	return h.httpClient.Do(retryReq)
}

func (h *dockerResolver) doUpstream(req *http.Request, parsed dockerParsedRequest) (*http.Response, []byte, error) {
	resp, err := h.httpClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	limit := int64(dockerMaxManifestBytes)
	if parsed.kind == dockerKindBlob {
		limit = 1<<63 - 1
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit))
	if err != nil {
		return nil, nil, err
	}
	if parsed.kind != dockerKindBlob && len(body) >= dockerMaxManifestBytes {
		return nil, nil, errors.New("upstream manifest exceeded size limit")
	}
	return resp, body, nil
}

func (h *dockerResolver) tokenForChallenge(ctx context.Context, parsed dockerParsedRequest, challenge dockerBearerChallenge) (string, error) {
	scope := fmt.Sprintf("repository:%s:pull", parsed.repository)
	cacheKey := parsed.networkRegistry + "|" + challenge.service + "|" + scope
	if token, ok := h.tokenCache.Get(cacheKey, time.Duration(h.cfg.authTokenTTLSeconds)*time.Second); ok {
		return token, nil
	}
	realmURL, err := url.Parse(challenge.realm)
	if err != nil {
		return "", err
	}
	q := realmURL.Query()
	if challenge.service != "" {
		q.Set("service", challenge.service)
	}
	q.Set("scope", scope)
	realmURL.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, realmURL.String(), nil)
	if err != nil {
		return "", err
	}
	resp, err := h.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("upstream token request returned %d", resp.StatusCode)
	}
	var payload struct {
		Token       string `json:"token"`
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
		return "", err
	}
	token := payload.Token
	if token == "" {
		token = payload.AccessToken
	}
	if token == "" {
		return "", errors.New("upstream token response did not include a token")
	}
	expiresIn := time.Duration(payload.ExpiresIn) * time.Second
	if expiresIn <= 0 || expiresIn > time.Duration(h.cfg.authTokenTTLSeconds)*time.Second {
		expiresIn = time.Duration(h.cfg.authTokenTTLSeconds) * time.Second
	}
	h.tokenCache.Set(cacheKey, token, expiresIn)
	return token, nil
}

func (h *dockerResolver) rememberManifestBlobs(projectTokenHash string, parsed dockerParsedRequest, manifestDigest, requestedRef, contentType string, body []byte) {
	if len(body) == 0 {
		return
	}
	descriptors := extractDockerDescriptors(contentType, body)
	for _, descriptor := range descriptors {
		h.blobAllow.Set(projectTokenHash, parsed.displayRegistry, parsed.networkRegistry, parsed.repository, descriptor.digest, dockerBlobAllowEntry{
			manifestDigest: manifestDigest,
			requestedTag:   requestedRef,
			mediaType:      descriptor.mediaType,
			sizeBytes:      descriptor.size,
			allowedAt:      time.Now().UTC(),
		})
	}
}

func parseDockerRequestPath(path string) (dockerParsedRequest, bool) {
	if path == "/v2" || path == "/v2/" {
		return dockerParsedRequest{kind: dockerKindPing}, true
	}
	rest := strings.TrimPrefix(path, "/v2/")
	if rest == path || rest == "" {
		return dockerParsedRequest{}, false
	}

	var repoPath, ref string
	var kind dockerRequestKind
	if before, after, ok := strings.Cut(rest, "/manifests/"); ok {
		repoPath, ref, kind = before, after, dockerKindManifest
	} else if before, after, ok := strings.Cut(rest, "/blobs/"); ok {
		repoPath, ref, kind = before, after, dockerKindBlob
	} else {
		return dockerParsedRequest{}, false
	}
	if repoPath == "" || ref == "" {
		return dockerParsedRequest{}, false
	}
	display, network, repo := normalizeDockerRepository(repoPath)
	if repo == "" {
		return dockerParsedRequest{}, false
	}
	parsed := dockerParsedRequest{
		kind:            kind,
		displayRegistry: display,
		networkRegistry: network,
		repository:      repo,
		reference:       ref,
		isDigest:        strings.HasPrefix(ref, "sha256:"),
	}
	if kind == dockerKindBlob {
		parsed.blobDigest = ref
	}
	return parsed, true
}

func isDockerWriteMethod(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func normalizeDockerRepository(repoPath string) (displayRegistry, networkRegistry, repository string) {
	parts := strings.Split(repoPath, "/")
	first := parts[0]
	if first == "docker.io" || first == dockerHubDisplayRegistry {
		displayRegistry = dockerHubDisplayRegistry
		networkRegistry = dockerHubNetworkRegistry
		repository = strings.Join(parts[1:], "/")
	} else if strings.Contains(first, ".") || strings.Contains(first, ":") || first == "localhost" {
		displayRegistry = strings.ToLower(first)
		networkRegistry = displayRegistry
		repository = strings.Join(parts[1:], "/")
	} else {
		displayRegistry = dockerHubDisplayRegistry
		networkRegistry = dockerHubNetworkRegistry
		repository = repoPath
	}
	if displayRegistry == dockerHubDisplayRegistry && !strings.Contains(repository, "/") && repository != "" {
		repository = "library/" + repository
	}
	return displayRegistry, networkRegistry, repository
}

func (p dockerParsedRequest) upstreamURL() string {
	escapedRepo := strings.Join(strings.Split(p.repository, "/"), "/")
	switch p.kind {
	case dockerKindBlob:
		return fmt.Sprintf("https://%s/v2/%s/blobs/%s", p.networkRegistry, escapedRepo, p.blobDigest)
	default:
		return fmt.Sprintf("https://%s/v2/%s/manifests/%s", p.networkRegistry, escapedRepo, p.reference)
	}
}

func (h *dockerResolver) upstreamAllowed(networkRegistry, displayRegistry string) bool {
	for _, allowed := range h.cfg.allowedUpstreams {
		allowed = strings.ToLower(strings.TrimSpace(allowed))
		if allowed == "*" || allowed == strings.ToLower(displayRegistry) || allowed == strings.ToLower(networkRegistry) {
			return true
		}
	}
	return false
}

func publicHostAllowed(host string) bool {
	hostOnly := host
	if h, _, err := net.SplitHostPort(host); err == nil {
		hostOnly = h
	}
	ips, err := net.LookupIP(hostOnly)
	if err != nil || len(ips) == 0 {
		return false
	}
	for _, ip := range ips {
		addr, ok := netip.AddrFromSlice(ip)
		if !ok || !addr.IsValid() || !addr.IsGlobalUnicast() || addr.IsPrivate() || addr.IsLoopback() || addr.IsLinkLocalUnicast() {
			return false
		}
	}
	return true
}

type dockerBearerChallenge struct {
	realm   string
	service string
}

func parseDockerBearerChallenge(header string) (dockerBearerChallenge, bool) {
	if !strings.HasPrefix(strings.ToLower(header), "bearer ") {
		return dockerBearerChallenge{}, false
	}
	rest := strings.TrimSpace(header[len("Bearer "):])
	challenge := dockerBearerChallenge{}
	for _, part := range strings.Split(rest, ",") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			continue
		}
		value = strings.Trim(value, `"`)
		switch strings.ToLower(key) {
		case "realm":
			challenge.realm = value
		case "service":
			challenge.service = value
		}
	}
	return challenge, challenge.realm != ""
}

func (c *dockerTokenCache) Get(key string, maxTTL time.Duration) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok {
		return "", false
	}
	ttl := entry.expiresIn
	if ttl <= 0 || ttl > maxTTL {
		ttl = maxTTL
	}
	if time.Since(entry.issuedAt) >= ttl {
		delete(c.entries, key)
		return "", false
	}
	return entry.token, true
}

func (c *dockerTokenCache) Set(key, token string, expiresIn time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[key] = dockerTokenEntry{token: token, issuedAt: time.Now(), expiresIn: expiresIn}
}

func (c *dockerBlobAllowCache) key(projectTokenHash, displayRegistry, networkRegistry, repository, blobDigest string) string {
	return strings.Join([]string{projectTokenHash, displayRegistry, networkRegistry, repository, blobDigest}, "|")
}

func (c *dockerBlobAllowCache) Set(projectTokenHash, displayRegistry, networkRegistry, repository, blobDigest string, entry dockerBlobAllowEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[c.key(projectTokenHash, displayRegistry, networkRegistry, repository, blobDigest)] = entry
}

func (c *dockerBlobAllowCache) Get(projectTokenHash, displayRegistry, networkRegistry, repository, blobDigest string) (dockerBlobAllowEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	key := c.key(projectTokenHash, displayRegistry, networkRegistry, repository, blobDigest)
	entry, ok := c.entries[key]
	if !ok {
		return dockerBlobAllowEntry{}, false
	}
	if time.Since(entry.allowedAt) > c.ttl {
		delete(c.entries, key)
		return dockerBlobAllowEntry{}, false
	}
	return entry, true
}

type dockerDescriptor struct {
	kind            string
	mediaType       string
	digest          string
	size            int64
	platformOS      string
	platformArch    string
	platformVariant string
}

func extractDockerDescriptors(contentType string, body []byte) []dockerDescriptor {
	var manifest struct {
		Config    *dockerDescriptorJSON  `json:"config"`
		Layers    []dockerDescriptorJSON `json:"layers"`
		Manifests []dockerDescriptorJSON `json:"manifests"`
	}
	if err := json.Unmarshal(body, &manifest); err != nil {
		return nil
	}
	descriptors := make([]dockerDescriptor, 0, 1+len(manifest.Layers)+len(manifest.Manifests))
	if manifest.Config != nil && manifest.Config.Digest != "" {
		descriptors = append(descriptors, manifest.Config.toDescriptor(dockerDescriptorKindConfig))
	}
	for _, layer := range manifest.Layers {
		if layer.Digest != "" {
			descriptors = append(descriptors, layer.toDescriptor(dockerDescriptorKindLayer))
		}
	}
	mediaType, _, _ := mime.ParseMediaType(contentType)
	if strings.Contains(mediaType, "manifest.list") || strings.Contains(mediaType, "image.index") {
		for _, childManifest := range manifest.Manifests {
			if childManifest.Digest != "" {
				descriptors = append(descriptors, childManifest.toDescriptor(dockerDescriptorKindIndex))
			}
		}
		return descriptors
	}
	return descriptors
}

type dockerDescriptorJSON struct {
	MediaType string              `json:"mediaType"`
	Digest    string              `json:"digest"`
	Size      int64               `json:"size"`
	Platform  *dockerPlatformJSON `json:"platform"`
}

type dockerPlatformJSON struct {
	OS           string `json:"os"`
	Architecture string `json:"architecture"`
	Variant      string `json:"variant"`
}

func (d dockerDescriptorJSON) toDescriptor(kind string) dockerDescriptor {
	descriptor := dockerDescriptor{kind: kind, mediaType: d.MediaType, digest: d.Digest, size: d.Size}
	if d.Platform != nil {
		descriptor.platformOS = d.Platform.OS
		descriptor.platformArch = d.Platform.Architecture
		descriptor.platformVariant = d.Platform.Variant
	}
	return descriptor
}

func buildDockerRelatedVersions(contentType string, body []byte) []PackageVersionRelatedVersion {
	descriptors := extractDockerDescriptors(contentType, body)
	if len(descriptors) == 0 {
		return nil
	}
	related := make([]PackageVersionRelatedVersion, 0, len(descriptors))
	for _, descriptor := range descriptors {
		if descriptor.digest == "" {
			continue
		}
		version := PackageVersionRelatedVersion{
			Version:         descriptor.digest,
			VersionKind:     dockerVersionKindDigest,
			MediaType:       descriptor.mediaType,
			SizeBytes:       descriptor.size,
			PlatformOS:      descriptor.platformOS,
			PlatformArch:    descriptor.platformArch,
			PlatformVariant: descriptor.platformVariant,
		}
		switch descriptor.kind {
		case dockerDescriptorKindIndex:
			version.ArtifactKind = dockerArtifactKindManifest
			version.DisplayRole = dockerDisplayRoleChild
			version.RelationshipType = dockerRelationshipIndex
		case dockerDescriptorKindConfig:
			version.ArtifactKind = dockerArtifactKindBlob
			version.DisplayRole = dockerDisplayRoleInternal
			version.RelationshipType = dockerRelationshipConfig
		default:
			version.ArtifactKind = dockerArtifactKindBlob
			version.DisplayRole = dockerDisplayRoleInternal
			version.RelationshipType = dockerRelationshipLayer
		}
		if metadataJSON, err := json.Marshal(map[string]any{
			"descriptor_kind": descriptor.kind,
			"media_type":      descriptor.mediaType,
			"size_bytes":      descriptor.size,
		}); err == nil {
			version.MetadataJSON = string(metadataJSON)
		}
		related = append(related, version)
	}
	return related
}

func writeDockerResponse(w http.ResponseWriter, method string, status int, header http.Header, body io.Reader) (int64, error) {
	copyDockerHeader(w.Header(), header)
	w.WriteHeader(status)
	if method == http.MethodHead {
		return 0, nil
	}
	return io.Copy(w, body)
}

func copyDockerHeader(dst, src http.Header) {
	for _, key := range []string{
		"Content-Type",
		"Content-Length",
		"Docker-Content-Digest",
		"ETag",
		"Accept-Ranges",
		"Content-Range",
		"Range",
		"Location",
	} {
		if value := src.Get(key); value != "" {
			dst.Set(key, value)
		}
	}
	dst.Set("Docker-Distribution-API-Version", "registry/2.0")
}

func writeDockerError(w http.ResponseWriter, status int, code, message string, detail any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Docker-Distribution-API-Version", "registry/2.0")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"errors": []map[string]any{{
			"code":    code,
			"message": message,
			"detail":  detail,
		}},
	})
}

func dockerErrorCodeForStatus(status int) string {
	switch status {
	case http.StatusUnauthorized:
		return "UNAUTHORIZED"
	case http.StatusForbidden:
		return "DENIED"
	case http.StatusNotFound:
		return "NAME_UNKNOWN"
	default:
		return "UNAVAILABLE"
	}
}

var _ EcosystemResolver = (*dockerResolver)(nil)
var _ PrecheckResolver = (*dockerResolver)(nil)
var _ AuthChallengeResolver = (*dockerResolver)(nil)
