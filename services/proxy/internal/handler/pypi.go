package handler

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/netip"
	"regexp"
	"strings"
	"time"

	"github.com/getcustoms/proxy/internal/config"
)

const (
	pypiDefaultUpstream = "https://pypi.org"
	pypiFilesHost       = "https://files.pythonhosted.org"
)

// downloadURLPattern matches PyPI simple-index download URLs so they can be
// rewritten to route through the proxy.
// e.g. https://files.pythonhosted.org/packages/.../requests-2.31.0.tar.gz
var downloadURLPattern = regexp.MustCompile(
	`href="(https://files\.pythonhosted\.org/packages/[^"]+)"`,
)

// pypiResolver implements EcosystemResolver for the PyPI registry.
// It holds only PyPI-specific state: the upstream registry URL and an HTTP
// client for artifact fetches. All shared policy logic lives in engine.
type pypiResolver struct {
	upstreamRegistry      string
	publicBaseURL         string
	allowedPublicBaseURLs []string
	trustedProxyNets      []netip.Prefix
	metadataMaxSize       int
	httpClient            *http.Client
}

// NewPyPIProxy constructs an http.Handler that proxies PyPI traffic through
// the Customs policy engine.
func NewPyPIProxy(deps Dependencies, cfg *config.Config) http.Handler {
	return newEngine(deps, cfg, &pypiResolver{
		upstreamRegistry:      pypiDefaultUpstream,
		publicBaseURL:         cfg.PublicBaseURL,
		allowedPublicBaseURLs: cfg.AllowedPublicBaseURLs,
		trustedProxyNets:      cfg.TrustedProxyNets,
		metadataMaxSize:       cfg.PyPIMetadataMaxBytes,
		httpClient:            &http.Client{Timeout: 30 * time.Second},
	})
}

// Ecosystem returns the ecosystem label used in cache keys, WAL events, and
// control-plane calls.
func (h *pypiResolver) Ecosystem() string { return "pypi" }

// ParseRequest extracts the package identity from a PyPI proxy request.
//
// Supported patterns:
//   - /pypi/simple/{pkg}/                          → metadata
//   - /pypi/packages/{hash}/{hash}/{hash}/{file}   → artifact
func (h *pypiResolver) ParseRequest(r *http.Request) PackageRequest {
	path := strings.TrimPrefix(r.URL.Path, "/pypi")
	path = strings.TrimPrefix(path, "/")

	pkg, version, filename, isDownload := extractPackageFromPath(path)
	if pkg == "" {
		return PackageRequest{}
	}
	return PackageRequest{
		Package:     pkg,
		Version:     version,
		IsArtifact:  isDownload,
		ArtifactKey: filename, // passed back to OnServeAllowed for redirect/pull
	}
}

// OnServeAllowed delivers an allowed PyPI artifact to the client.
// Returns a ServeOutcome so the engine can record serve_mode and bytes_transferred.
func (h *pypiResolver) OnServeAllowed(w http.ResponseWriter, r *http.Request, req PackageRequest, serveMode string) ServeOutcome {
	if serveMode == ServeModePull {
		return h.pullFromFiles(w, r)
	}
	h.redirectToFiles(w, r)
	return ServeOutcome{ServeMode: ServeModeRedirect}
}

// OnProxyMetadata fetches the PyPI simple index HTML page for a package and
// rewrites download URLs to route through the proxy for policy enforcement.
func (h *pypiResolver) OnProxyMetadata(w http.ResponseWriter, r *http.Request, pkg string) bool {
	upstreamURL := fmt.Sprintf("%s/simple/%s/", h.upstreamRegistry, pkg)
	resp, ok := fetchMetadataResponse(w, h.httpClient, upstreamURL, pkg, "upstream PyPI unreachable")
	if !ok {
		return false
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	htmlBytes, err := io.ReadAll(io.LimitReader(resp.Body, int64(h.metadataMaxSize+1)))
	if err != nil {
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "failed to read upstream response")
		return false
	}
	if len(htmlBytes) > h.metadataMaxSize {
		slog.Warn("pypi metadata exceeded size limit",
			"service", "proxy",
			"package", pkg,
			"size_bytes", len(htmlBytes),
			"limit_bytes", h.metadataMaxSize,
		)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "upstream response exceeded metadata size limit")
		return false
	}

	// Rewrite download links to route through the proxy.
	proxyBase := resolveEffectivePublicBaseURL(r, h.publicBaseURL, h.allowedPublicBaseURLs, h.trustedProxyNets) + "/pypi/packages"
	rewritten := downloadURLPattern.ReplaceAllStringFunc(string(htmlBytes), func(match string) string {
		sub := downloadURLPattern.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		origURL := sub[1]
		newURL := strings.ReplaceAll(origURL, pypiFilesHost+"/packages", proxyBase)
		return fmt.Sprintf(`href="%s"`, newURL)
	})

	w.Header().Set("Content-Type", "text/html")
	_, _ = w.Write([]byte(rewritten))
	return true
}

// redirectToFiles issues a 302 redirect to the canonical files.pythonhosted.org URL.
// The artifact path is reconstructed from the request URL, preserving the full
// hash-directory structure that PyPI uses for content addressing.
func (h *pypiResolver) redirectToFiles(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/pypi/packages")
	filesURL := pypiFilesHost + "/packages" + path
	http.Redirect(w, r, filesURL, http.StatusFound)
}

// pullFromFiles fetches the package artifact from files.pythonhosted.org and
// streams it directly to the client without a redirect.
// Returns a ServeOutcome with the actual bytes transferred.
func (h *pypiResolver) pullFromFiles(w http.ResponseWriter, r *http.Request) ServeOutcome {
	path := strings.TrimPrefix(r.URL.Path, "/pypi/packages")
	filesURL := pypiFilesHost + "/packages" + path
	return pullArtifactFromURL(w, h.httpClient, filesURL, "upstream PyPI unreachable")
}

// extractPackageFromPath parses paths under the PyPI proxy mount point.
//
// Supported patterns:
//   - simple/{pkg}/                              → isDownload=false
//   - packages/{hash}/{hash}/{hash}/{filename}   → isDownload=true
//
// For downloads the package name and version are derived from the filename.
// e.g. requests-2.31.0-py3-none-any.whl → pkg=requests, version=2.31.0
func extractPackageFromPath(path string) (pkg, version, filename string, isDownload bool) {
	if strings.HasPrefix(path, "simple/") {
		rest := strings.TrimPrefix(path, "simple/")
		rest = strings.TrimSuffix(rest, "/")
		parts := strings.SplitN(rest, "/", 2)
		if len(parts) >= 1 && parts[0] != "" {
			return parts[0], "", "", false
		}
		return "", "", "", false
	}

	if strings.HasPrefix(path, "packages/") {
		parts := strings.Split(path, "/")
		if len(parts) < 2 {
			return "", "", "", false
		}
		fname := parts[len(parts)-1]
		if fname == "" {
			return "", "", "", false
		}
		pkg, version = parseFilename(fname)
		if pkg == "" || version == "" {
			return "", "", "", false
		}
		return pkg, version, fname, true
	}

	return "", "", "", false
}

// parseFilename extracts package name and version from a distribution filename.
//
// Handles:
//   - wheel:  {name}-{version}-{python}-{abi}-{platform}.whl
//   - sdist:  {name}-{version}.tar.gz  or  {name}-{version}.zip
func parseFilename(filename string) (pkg, version string) {
	if strings.HasSuffix(filename, ".whl") {
		return parseWheelFilename(strings.TrimSuffix(filename, ".whl"))
	}

	base := filename
	for _, suffix := range []string{".whl", ".tar.gz", ".zip", ".tar.bz2", ".egg"} {
		if strings.HasSuffix(base, suffix) {
			base = strings.TrimSuffix(base, suffix)
			break
		}
	}

	idx := strings.LastIndex(base, "-")
	if idx > 0 && idx < len(base)-1 {
		return base[:idx], base[idx+1:]
	}
	return base, ""
}

func parseWheelFilename(base string) (pkg, version string) {
	parts := strings.Split(base, "-")
	if len(parts) < 5 {
		return base, ""
	}

	versionIndex := len(parts) - 4
	if len(parts) >= 6 && looksLikeWheelBuildTag(parts[len(parts)-4]) {
		versionIndex = len(parts) - 5
	}
	if versionIndex <= 0 || versionIndex >= len(parts) {
		return base, ""
	}
	return strings.Join(parts[:versionIndex], "-"), parts[versionIndex]
}

func looksLikeWheelBuildTag(part string) bool {
	if part == "" {
		return false
	}
	return part[0] >= '0' && part[0] <= '9'
}

// Ensure pypiResolver satisfies EcosystemResolver at compile time.
var _ EcosystemResolver = (*pypiResolver)(nil)
