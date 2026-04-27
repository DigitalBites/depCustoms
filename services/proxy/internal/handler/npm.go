package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/netip"
	"sort"
	"strings"
	"time"

	"github.com/getcustoms/proxy/internal/cache"
	"github.com/getcustoms/proxy/internal/client"
	"github.com/getcustoms/proxy/internal/config"
	"github.com/getcustoms/proxy/internal/metadata"
	"github.com/getcustoms/proxy/internal/tokenctx"
	"github.com/getcustoms/proxy/internal/wal"
)

const npmDefaultUpstream = "https://registry.npmjs.org"

// npmResolver implements EcosystemResolver for the npm registry.
// It holds only npm-specific state: the upstream registry URL and an HTTP
// client for artifact fetches. All shared policy logic lives in engine.
type npmResolver struct {
	upstreamRegistry              string
	publicBaseURL                 string
	trustedProxyNets              []netip.Prefix
	metadataMaxSize               int
	auditMaxBodyBytes             int
	httpClient                    *http.Client
	metadataCache                 *metadata.Cache
	contributorCache              *metadata.ContributorCache
	signalDedupe                  *metadata.SignalDedupe
	wal                           *wal.WAL
	contributorEnabled            bool
	contributorPrefetchWindowDays int
}

// NewNPMProxy constructs an http.Handler that proxies npm registry traffic
// through the Customs policy engine.
func NewNPMProxy(
	c *cache.Cache,
	cl *client.Client,
	cfg *config.Config,
	w *wal.WAL,
	metadataCache *metadata.Cache,
	contributorCache *metadata.ContributorCache,
	signalDedupe *metadata.SignalDedupe,
) http.Handler {
	return NewNPMProxyWithTokenContext(
		c,
		cl,
		cfg,
		w,
		nil,
		metadataCache,
		contributorCache,
		signalDedupe,
	)
}

func NewNPMProxyWithTokenContext(
	c *cache.Cache,
	cl *client.Client,
	cfg *config.Config,
	w *wal.WAL,
	tokenContextCache *tokenctx.Cache,
	metadataCache *metadata.Cache,
	contributorCache *metadata.ContributorCache,
	signalDedupe *metadata.SignalDedupe,
) http.Handler {
	return newEngine(c, tokenContextCache, metadataCache, contributorCache, signalDedupe, cl, cfg, w, &npmResolver{
		upstreamRegistry:              npmDefaultUpstream,
		publicBaseURL:                 cfg.PublicBaseURL,
		trustedProxyNets:              cfg.TrustedProxyNets,
		metadataMaxSize:               cfg.NPMMetadataMaxBytes,
		auditMaxBodyBytes:             cfg.NPMAuditMaxBodyBytes,
		httpClient:                    &http.Client{Timeout: 30 * time.Second},
		metadataCache:                 metadataCache,
		contributorCache:              contributorCache,
		signalDedupe:                  signalDedupe,
		wal:                           w,
		contributorEnabled:            cfg.ContributorEnabled,
		contributorPrefetchWindowDays: cfg.ContributorPrefetchWindowDays,
	})
}

// Ecosystem returns the ecosystem label used in cache keys, WAL events, and
// control-plane calls.
func (h *npmResolver) Ecosystem() string { return "npm" }

// ParseRequest extracts the package identity from an npm registry request.
//
// Supported patterns:
//   - /{pkg}/-/{pkg}-{version}.tgz          → artifact
//   - /@{scope}/{pkg}/-/{pkg}-{version}.tgz → artifact (scoped)
//   - /{pkg}                                → metadata
//   - /@{scope}/{pkg}                       → metadata (scoped)
func (h *npmResolver) ParseRequest(r *http.Request) PackageRequest {
	if isNPMSecurityEndpoint(r.URL.Path) {
		slog.Debug("npm request parsed",
			"service", "proxy",
			"path", r.URL.Path,
			"package", strings.TrimPrefix(r.URL.Path, "/"),
			"version", "",
			"is_artifact", false,
			"bypass_policy", true,
		)
		return PackageRequest{
			Package:      strings.TrimPrefix(r.URL.Path, "/"),
			IsArtifact:   false,
			BypassPolicy: true,
		}
	}

	pkg, version, isTarball := extractPackageVersion(r.URL.Path)
	if pkg == "" {
		slog.Debug("npm request parse miss",
			"service", "proxy",
			"path", r.URL.Path,
		)
		return PackageRequest{}
	}

	slog.Debug("npm request parsed",
		"service", "proxy",
		"path", r.URL.Path,
		"package", pkg,
		"version", version,
		"is_artifact", isTarball,
		"bypass_policy", false,
	)
	return PackageRequest{
		Package:     pkg,
		Version:     version,
		IsArtifact:  isTarball,
		ArtifactKey: strings.TrimPrefix(r.URL.Path, "/"),
	}
}

// OnServeAllowed delivers an allowed npm artifact to the client.
// Returns a ServeOutcome so the engine can record serve_mode and bytes_transferred.
func (h *npmResolver) OnServeAllowed(w http.ResponseWriter, r *http.Request, req PackageRequest, serveMode string) ServeOutcome {
	if serveMode == ServeModePull {
		return h.pullFromUpstream(w, req.ArtifactKey)
	}
	h.redirectToUpstream(w, r, req.ArtifactKey)
	return ServeOutcome{ServeMode: ServeModeRedirect}
}

// OnProxyMetadata fetches package metadata from npm and rewrites tarball URLs
// so they route through the proxy for policy enforcement.
func (h *npmResolver) OnProxyMetadata(w http.ResponseWriter, r *http.Request, pkg string) bool {
	if isNPMSecurityEndpointPath(pkg) {
		upstreamURL := fmt.Sprintf("%s/%s", h.upstreamRegistry, pkg)
		return proxyPassthroughRequest(w, h.httpClient, r, upstreamURL, int64(h.auditMaxBodyBytes))
	}

	upstreamURL := fmt.Sprintf("%s/%s", h.upstreamRegistry, pkg)
	resp, ok := fetchMetadataResponse(w, h.httpClient, upstreamURL, pkg, "upstream registry unreachable")
	if !ok {
		return false
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	var packument map[string]interface{}
	limitedBody := io.LimitReader(resp.Body, int64(h.metadataMaxSize+1))
	metadataBytes, err := io.ReadAll(limitedBody)
	if err != nil {
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "failed to read upstream response")
		return false
	}
	if len(metadataBytes) > h.metadataMaxSize {
		slog.Warn("npm metadata exceeded size limit",
			"service", "proxy",
			"package", pkg,
			"size_bytes", len(metadataBytes),
			"limit_bytes", h.metadataMaxSize,
		)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "upstream response exceeded metadata size limit")
		return false
	}
	if err := json.Unmarshal(metadataBytes, &packument); err != nil {
		if h.metadataCache != nil {
			h.metadataCache.RecordParseFailure("npm")
		}
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "failed to parse upstream response")
		return false
	}

	// Rewrite tarball URLs so they pass through the proxy for policy enforcement.
	rewriteBaseURL := resolveEffectivePublicBaseURL(r, h.publicBaseURL, h.trustedProxyNets)
	rewriteTarballURLs(packument, h.upstreamRegistry, rewriteBaseURL)

	fetchedAt := time.Now().UTC()
	if summary, reason, ok := extractNPMMetadataSummary(pkg, packument, fetchedAt); ok {
		if h.metadataCache != nil {
			h.metadataCache.Set(metadata.CacheKey{Ecosystem: "npm", Package: pkg}, summary)
		}
		h.appendLatestMetadataSignal(summary)
	} else {
		if h.metadataCache != nil {
			h.metadataCache.RecordParseFailure("npm")
		}
		slog.Warn("npm metadata extraction skipped",
			"service", "proxy",
			"package", pkg,
			"reason", reason,
		)
	}

	if h.contributorEnabled {
		h.syncPackageContributorMetadata(pkg, packument, fetchedAt)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(packument)
	return true
}

func (h *npmResolver) appendLatestMetadataSignal(summary metadata.Summary) {
	if h.wal == nil {
		return
	}

	fingerprint := latestMetadataFingerprint(summary)
	if h.signalDedupe != nil && !h.signalDedupe.ShouldEmit(fingerprint) {
		return
	}

	payload, err := json.Marshal(wal.PackageLatestMetadata{
		Ecosystem:         summary.Ecosystem,
		Package:           summary.Package,
		LatestVersion:     summary.LatestVersion,
		LatestPublishedAt: summary.LatestPublishedAt,
		ObservedAt:        summary.FetchedAt.UTC().Format(time.RFC3339),
		CacheStatus:       "refresh",
	})
	if err != nil {
		slog.Warn("failed to marshal package latest metadata",
			"service", "proxy",
			"package", summary.Package,
			"error", err.Error(),
		)
		return
	}

	appendWALRecordAsync(h.wal, wal.Record{
		SchemaVersion: wal.SchemaVersionV1,
		RecordType:    wal.RecordTypePackageLatestMetadata,
		RecordedAt:    summary.FetchedAt.UTC().Format(time.RFC3339),
		Payload:       payload,
	})
}

// syncPackageContributorMetadata normalizes contributor metadata from the npm
// packument, updates the proxy-local contributor cache, and appends a package
// contributor metadata record for backend historical capture.
func (h *npmResolver) syncPackageContributorMetadata(pkg string, packument map[string]interface{}, fetchedAt time.Time) {
	if h.contributorCache == nil {
		return
	}

	versions, ok := normalizeContributorVersions(pkg, packument)
	if !ok || len(versions) == 0 {
		return
	}

	extractedAt := fetchedAt.Format(time.RFC3339)
	latestVersion, latestPublishedAt := extractLatestVersionMetadata(packument)
	oldestIncludedPublishedAt := versions[0].PublishedAt
	fingerprint := packageContributorFingerprint("npm", pkg, latestVersion, latestPublishedAt, oldestIncludedPublishedAt, false, versions)

	if err := h.contributorCache.Set(metadata.CacheKey{Ecosystem: "npm", Package: pkg}, metadata.ContributorPackage{
		Ecosystem:                 "npm",
		Package:                   pkg,
		Fingerprint:               fingerprint,
		ExtractedAt:               extractedAt,
		LatestVersion:             latestVersion,
		LatestPublishedAt:         latestPublishedAt,
		HistoryComplete:           false,
		OldestIncludedPublishedAt: oldestIncludedPublishedAt,
		Versions:                  versions,
	}); err != nil {
		slog.Warn("failed to persist contributor metadata cache",
			"service", "proxy",
			"package", pkg,
			"error", err.Error(),
		)
	}

	if h.wal == nil {
		return
	}
	if h.signalDedupe != nil && !h.signalDedupe.ShouldEmit(fingerprint) {
		return
	}

	payload, err := json.Marshal(wal.PackageContributorMetadata{
		Ecosystem:                 "npm",
		Package:                   pkg,
		ExtractedAt:               extractedAt,
		Fingerprint:               fingerprint,
		LatestVersion:             latestVersion,
		LatestPublishedAt:         latestPublishedAt,
		HistoryComplete:           false,
		OldestIncludedPublishedAt: oldestIncludedPublishedAt,
		Versions:                  toWALContributorVersions(versions),
	})
	if err != nil {
		slog.Warn("failed to marshal package contributor metadata",
			"service", "proxy",
			"package", pkg,
			"error", err.Error(),
		)
		return
	}

	appendWALRecordAsync(h.wal, wal.Record{
		SchemaVersion: wal.SchemaVersionV1,
		RecordType:    wal.RecordTypePackageContributorMetadata,
		RecordedAt:    extractedAt,
		Payload:       payload,
	})
}

// normalizeContributorVersions extracts normalized per-version contributor
// metadata from an npm packument.
func normalizeContributorVersions(
	pkg string,
	packument map[string]interface{},
) ([]metadata.ContributorVersion, bool) {
	rawVersions, ok := packument["versions"].(map[string]interface{})
	if !ok {
		return nil, false
	}
	rawTimes, _ := packument["time"].(map[string]interface{})

	var result []metadata.ContributorVersion

	for version, rawEntry := range rawVersions {
		entry, ok := rawEntry.(map[string]interface{})
		if !ok {
			continue
		}

		publishedAt := ""
		if rawTimes != nil {
			if ts, ok := rawTimes[version].(string); ok {
				if _, err := time.Parse(time.RFC3339, ts); err == nil {
					publishedAt = ts
				}
			}
		}
		if publishedAt == "" {
			continue
		}

		// Publisher (_npmUser.name)
		publisher := ""
		if npmUser, ok := entry["_npmUser"].(map[string]interface{}); ok {
			if name, ok := npmUser["name"].(string); ok {
				publisher = name
			}
		}
		if publisher == "" {
			slog.Debug("contributor_signal_unavailable",
				"service", "proxy",
				"component", "proxy",
				"ecosystem", "npm",
				"package", pkg,
				"version", version,
				"field", "publisher",
				"reason", "not_in_manifest",
			)
		}

		// Maintainers
		var maintainers []string
		if rawMaintainers, ok := entry["maintainers"].([]interface{}); ok {
			for _, m := range rawMaintainers {
				if mMap, ok := m.(map[string]interface{}); ok {
					if name, ok := mMap["name"].(string); ok && name != "" {
						maintainers = append(maintainers, name)
					}
				}
			}
		}

		// Install scripts
		hasInstallScripts := false
		if scripts, ok := entry["scripts"].(map[string]interface{}); ok {
			_, hasPreinstall := scripts["preinstall"]
			_, hasPostinstall := scripts["postinstall"]
			_, hasInstall := scripts["install"]
			hasInstallScripts = hasPreinstall || hasPostinstall || hasInstall
		}

		// Provenance / Sigstore attestation
		hasAttestation := false
		if dist, ok := entry["dist"].(map[string]interface{}); ok {
			_, hasAttestation = dist["attestations"]
		}

		rawPayloadJSON := ""
		if rawPayload, err := json.Marshal(map[string]any{
			"_npmUser":    entry["_npmUser"],
			"maintainers": entry["maintainers"],
			"scripts":     entry["scripts"],
			"dist": map[string]any{
				"attestations": distAttestations(entry),
			},
		}); err == nil {
			rawPayloadJSON = string(rawPayload)
		}

		result = append(result, metadata.ContributorVersion{
			Version:           version,
			PublishedAt:       publishedAt,
			Publisher:         publisher,
			Maintainers:       maintainers,
			HasInstallScripts: hasInstallScripts,
			HasAttestation:    hasAttestation,
			RawPayloadJSON:    rawPayloadJSON,
		})
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].PublishedAt < result[j].PublishedAt
	})

	return result, true
}

func extractLatestVersionMetadata(packument map[string]interface{}) (string, string) {
	distTags, ok := packument["dist-tags"].(map[string]interface{})
	if !ok {
		return "", ""
	}
	latestVersion, _ := distTags["latest"].(string)
	if latestVersion == "" {
		return "", ""
	}

	rawTimes, _ := packument["time"].(map[string]interface{})
	if rawTimes == nil {
		return latestVersion, ""
	}
	latestPublishedAt, _ := rawTimes[latestVersion].(string)
	return latestVersion, latestPublishedAt
}

func packageContributorFingerprint(
	ecosystem string,
	pkg string,
	latestVersion string,
	latestPublishedAt string,
	oldestIncludedPublishedAt string,
	historyComplete bool,
	versions []metadata.ContributorVersion,
) string {
	var builder strings.Builder
	builder.WriteString(ecosystem)
	builder.WriteString("|")
	builder.WriteString(pkg)
	builder.WriteString("|")
	builder.WriteString(latestVersion)
	builder.WriteString("|")
	builder.WriteString(latestPublishedAt)
	builder.WriteString("|")
	builder.WriteString(oldestIncludedPublishedAt)
	builder.WriteString("|")
	if historyComplete {
		builder.WriteString("1")
	} else {
		builder.WriteString("0")
	}

	for _, version := range versions {
		builder.WriteString("|")
		builder.WriteString(version.Version)
		builder.WriteString("|")
		builder.WriteString(version.PublishedAt)
		builder.WriteString("|")
		builder.WriteString(version.Publisher)
		builder.WriteString("|")
		builder.WriteString(strings.Join(version.Maintainers, ","))
		builder.WriteString("|")
		if version.HasInstallScripts {
			builder.WriteString("1")
		} else {
			builder.WriteString("0")
		}
		builder.WriteString("|")
		if version.HasAttestation {
			builder.WriteString("1")
		} else {
			builder.WriteString("0")
		}
	}

	sum := sha256.Sum256([]byte(builder.String()))
	return hex.EncodeToString(sum[:])
}

func toWALContributorVersions(
	versions []metadata.ContributorVersion,
) []wal.PackageContributorVersion {
	result := make([]wal.PackageContributorVersion, 0, len(versions))
	for _, version := range versions {
		result = append(result, wal.PackageContributorVersion{
			Version:           version.Version,
			PublishedAt:       version.PublishedAt,
			Publisher:         version.Publisher,
			Maintainers:       version.Maintainers,
			HasInstallScripts: version.HasInstallScripts,
			HasAttestation:    version.HasAttestation,
		})
	}
	return result
}

func distAttestations(entry map[string]interface{}) interface{} {
	dist, ok := entry["dist"].(map[string]interface{})
	if !ok {
		return nil
	}
	return dist["attestations"]
}

// redirectToUpstream issues a 302 redirect using the exact tarball path the
// client requested. This avoids edge cases in npm prerelease/build metadata
// filenames where reconstructing {name}-{version}.tgz can be lossy.
func (h *npmResolver) redirectToUpstream(w http.ResponseWriter, r *http.Request, artifactPath string) {
	tarballURL := fmt.Sprintf("%s/%s", h.upstreamRegistry, artifactPath)
	http.Redirect(w, r, tarballURL, http.StatusFound)
}

// pullFromUpstream fetches the tarball from the upstream registry and streams
// it directly to the client without a redirect.
// Returns a ServeOutcome with the actual bytes transferred.
func (h *npmResolver) pullFromUpstream(w http.ResponseWriter, artifactPath string) ServeOutcome {
	tarballURL := fmt.Sprintf("%s/%s", h.upstreamRegistry, artifactPath)
	return pullArtifactFromURL(w, h.httpClient, tarballURL, "upstream registry unreachable")
}

// extractPackageVersion parses npm URL patterns.
//
// Supported patterns:
//   - /{pkg}/-/{pkg}-{version}.tgz          → isTarball=true
//   - /@{scope}/{pkg}/-/{pkg}-{version}.tgz → isTarball=true (scoped)
//   - /{pkg}                                → isTarball=false (metadata)
//   - /@{scope}/{pkg}                       → isTarball=false (scoped metadata)
func extractPackageVersion(path string) (pkg, version string, isTarball bool) {
	path = strings.TrimPrefix(path, "/")

	parts := strings.SplitN(path, "/-/", 2)
	pkg = parts[0]

	if len(parts) == 2 {
		tarball := strings.TrimSuffix(parts[1], ".tgz")
		filenamePrefix := tarballFilename(pkg) + "-"
		if !strings.HasPrefix(tarball, filenamePrefix) {
			return "", "", false
		}
		version = strings.TrimPrefix(tarball, filenamePrefix)
		if version == "" {
			return "", "", false
		}
		return pkg, version, true
	}

	return pkg, "", false
}

// rewriteTarballURLs recursively walks a decoded JSON structure and replaces
// occurrences of upstreamHost in tarball URL strings with proxyHost.
func rewriteTarballURLs(node interface{}, upstreamHost, proxyHost string) {
	switch v := node.(type) {
	case map[string]interface{}:
		for k, val := range v {
			if strVal, ok := val.(string); ok && k == "tarball" {
				v[k] = strings.ReplaceAll(strVal, upstreamHost, proxyHost)
			} else {
				rewriteTarballURLs(val, upstreamHost, proxyHost)
			}
		}
	case []interface{}:
		for _, item := range v {
			rewriteTarballURLs(item, upstreamHost, proxyHost)
		}
	}
}

func extractNPMMetadataSummary(
	pkg string,
	packument map[string]interface{},
	fetchedAt time.Time,
) (metadata.Summary, string, bool) {
	distTags, ok := packument["dist-tags"].(map[string]interface{})
	if !ok {
		return metadata.Summary{}, "missing_dist_tags", false
	}
	latestVersion, ok := distTags["latest"].(string)
	if !ok || latestVersion == "" {
		return metadata.Summary{}, "missing_latest_dist_tag", false
	}

	versionPublishTimes := map[string]string{}
	if rawTimes, ok := packument["time"].(map[string]interface{}); ok {
		for version, rawValue := range rawTimes {
			if version == "created" || version == "modified" {
				continue
			}
			timestamp, ok := rawValue.(string)
			if !ok || timestamp == "" {
				continue
			}
			if _, err := time.Parse(time.RFC3339, timestamp); err != nil {
				continue
			}
			versionPublishTimes[version] = timestamp
		}
	}

	return metadata.Summary{
		Ecosystem:           "npm",
		Package:             pkg,
		LatestVersion:       latestVersion,
		LatestPublishedAt:   versionPublishTimes[latestVersion],
		FetchedAt:           fetchedAt.UTC(),
		Source:              "npm_packument",
		VersionPublishTimes: versionPublishTimes,
	}, "", true
}

func latestMetadataFingerprint(summary metadata.Summary) string {
	keys := make([]string, 0, len(summary.VersionPublishTimes))
	for version := range summary.VersionPublishTimes {
		keys = append(keys, version)
	}
	sort.Strings(keys)

	var b strings.Builder
	b.WriteString(summary.Ecosystem)
	b.WriteByte('|')
	b.WriteString(summary.Package)
	b.WriteByte('|')
	b.WriteString(summary.LatestVersion)
	b.WriteByte('|')
	b.WriteString(summary.LatestPublishedAt)
	for _, version := range keys {
		b.WriteByte('|')
		b.WriteString(version)
		b.WriteByte('=')
		b.WriteString(summary.VersionPublishTimes[version])
	}
	return b.String()
}

// tarballFilename returns the bare package name used in npm tarball filenames.
// For scoped packages (@scope/name) npm uses only the local part (name) in the
// filename — e.g. @discoveryjs/json-ext → json-ext-1.0.0.tgz.
func tarballFilename(pkg string) string {
	if i := strings.LastIndex(pkg, "/"); i >= 0 {
		return pkg[i+1:]
	}
	return pkg
}

func isNPMSecurityEndpoint(path string) bool {
	return isNPMSecurityEndpointPath(strings.TrimPrefix(path, "/"))
}

func isNPMSecurityEndpointPath(path string) bool {
	return strings.HasPrefix(path, "-/npm/v1/security/")
}

// Ensure npmResolver satisfies EcosystemResolver at compile time.
var _ EcosystemResolver = (*npmResolver)(nil)
