package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/getcustoms/proxy/internal/metadata"
	"github.com/getcustoms/proxy/internal/pkgmeta"
	"github.com/getcustoms/proxy/internal/testutil"
	"github.com/getcustoms/proxy/internal/wal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// extractPackageFromPath receives the path with /pypi prefix already stripped.

func TestPypiParse_SimpleIndex(t *testing.T) {
	pkg, version, filename, isDownload := extractPackageFromPath("simple/requests/")
	assert.Equal(t, "requests", pkg)
	assert.Equal(t, "", version)
	assert.Equal(t, "", filename)
	assert.False(t, isDownload)
}

func TestPypiParse_SimpleIndexNoTrailingSlash(t *testing.T) {
	pkg, _, _, isDownload := extractPackageFromPath("simple/requests")
	assert.Equal(t, "requests", pkg)
	assert.False(t, isDownload)
}

func TestPypiParse_ArtifactWheelFile(t *testing.T) {
	pkg, version, fname, isDownload := extractPackageFromPath(
		"packages/xx/yy/zz/requests-2.28.2-py3-none-any.whl",
	)
	assert.Equal(t, "requests", pkg)
	assert.Equal(t, "2.28.2", version)
	assert.Equal(t, "requests-2.28.2-py3-none-any.whl", fname)
	assert.True(t, isDownload)
}

func TestPypiParse_ArtifactWheelMetadataSidecar(t *testing.T) {
	pkg, version, fname, isDownload := extractPackageFromPath(
		"packages/xx/yy/zz/urllib3-1.25.8-py2.py3-none-any.whl.metadata",
	)
	assert.Equal(t, "urllib3", pkg)
	assert.Equal(t, "1.25.8", version)
	assert.Equal(t, "urllib3-1.25.8-py2.py3-none-any.whl.metadata", fname)
	assert.True(t, isDownload)
}

func TestPypiParse_ArtifactSdistMetadataSidecar(t *testing.T) {
	pkg, version, fname, isDownload := extractPackageFromPath(
		"packages/xx/yy/zz/requests-2.28.2.tar.gz.metadata",
	)
	assert.Equal(t, "requests", pkg)
	assert.Equal(t, "2.28.2", version)
	assert.Equal(t, "requests-2.28.2.tar.gz.metadata", fname)
	assert.True(t, isDownload)
}

func TestPypiParse_ArtifactTarGz(t *testing.T) {
	pkg, version, fname, isDownload := extractPackageFromPath(
		"packages/xx/yy/zz/requests-2.28.2.tar.gz",
	)
	assert.Equal(t, "requests", pkg)
	assert.Equal(t, "2.28.2", version)
	assert.Equal(t, "requests-2.28.2.tar.gz", fname)
	assert.True(t, isDownload)
}

func TestPypiParse_ArtifactZip(t *testing.T) {
	pkg, version, _, isDownload := extractPackageFromPath(
		"packages/xx/yy/zz/flask-3.0.0.zip",
	)
	assert.Equal(t, "flask", pkg)
	assert.Equal(t, "3.0.0", version)
	assert.True(t, isDownload)
}

func TestPypiParse_ArtifactTarGzWithHyphenatedPackageName(t *testing.T) {
	pkg, version, fname, isDownload := extractPackageFromPath(
		"packages/xx/yy/zz/my-package-name-2.28.2.tar.gz",
	)
	assert.Equal(t, "my-package-name", pkg)
	assert.Equal(t, "2.28.2", version)
	assert.Equal(t, "my-package-name-2.28.2.tar.gz", fname)
	assert.True(t, isDownload)
}

func TestPypiParse_ArtifactWheelWithBuildTag(t *testing.T) {
	pkg, version, fname, isDownload := extractPackageFromPath(
		"packages/xx/yy/zz/my-package-2.28.2-1-py3-none-any.whl",
	)
	assert.Equal(t, "my-package", pkg)
	assert.Equal(t, "2.28.2", version)
	assert.Equal(t, "my-package-2.28.2-1-py3-none-any.whl", fname)
	assert.True(t, isDownload)
}

func TestPypiParse_UnrecognisedPath(t *testing.T) {
	pkg, _, _, isDownload := extractPackageFromPath("notpypi/foo")
	assert.Empty(t, pkg)
	assert.False(t, isDownload)
}

func TestPypiParse_EmptyPath(t *testing.T) {
	pkg, _, _, isDownload := extractPackageFromPath("")
	assert.Empty(t, pkg)
	assert.False(t, isDownload)
}

func TestPypiParse_MalformedArtifactFilenameFailsClosed(t *testing.T) {
	pkg, version, filename, isDownload := extractPackageFromPath(
		"packages/xx/yy/zz/artifact.tgz",
	)
	assert.Empty(t, pkg)
	assert.Empty(t, version)
	assert.Empty(t, filename)
	assert.False(t, isDownload)
}

func TestPypiParseRequest_CanonicalizesPackageIdentity(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/pypi/simple/My_Pkg.Name/", nil)
	resolver := &pypiResolver{}

	parsed := resolver.ParseRequest(req)

	assert.Equal(t, "my-pkg-name", parsed.Package)
	assert.Equal(t, "", parsed.Version)
	assert.False(t, parsed.IsArtifact)
}

func TestPypiParseRequest_CanonicalizesArtifactPackageIdentity(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/pypi/packages/xx/yy/zz/My_Pkg.Name-1.0.0-py3-none-any.whl", nil)
	resolver := &pypiResolver{}

	parsed := resolver.ParseRequest(req)

	assert.Equal(t, "my-pkg-name", parsed.Package)
	assert.Equal(t, "1.0.0", parsed.Version)
	assert.Equal(t, "My_Pkg.Name-1.0.0-py3-none-any.whl", parsed.ArtifactKey)
	assert.True(t, parsed.IsArtifact)
}

func TestPypiParseRequest_CanonicalizesWheelMetadataSidecarIdentity(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/pypi/packages/xx/yy/zz/urllib3-1.25.8-py2.py3-none-any.whl.metadata", nil)
	resolver := &pypiResolver{}

	parsed := resolver.ParseRequest(req)

	assert.Equal(t, "urllib3", parsed.Package)
	assert.Equal(t, "1.25.8", parsed.Version)
	assert.Equal(t, "urllib3-1.25.8-py2.py3-none-any.whl.metadata", parsed.ArtifactKey)
	assert.True(t, parsed.IsArtifact)
}

func TestPypiDownloadRewriteUsesConfiguredPublicBaseURL(t *testing.T) {
	html := `<a href="https://files.pythonhosted.org/packages/aa/bb/cc/requests-2.31.0.tar.gz">download</a>`
	proxyBase := "https://proxy.example.com/pypi/packages"

	rewritten := downloadURLPattern.ReplaceAllStringFunc(html, func(match string) string {
		sub := downloadURLPattern.FindStringSubmatch(match)
		require.Len(t, sub, 2)
		newURL := strings.ReplaceAll(sub[1], pypiFilesHost+"/packages", proxyBase)
		return `href="` + newURL + `"`
	})

	assert.Contains(t, rewritten, `href="https://proxy.example.com/pypi/packages/aa/bb/cc/requests-2.31.0.tar.gz"`)
}

func TestPypiMetadataReturnsTrueOnSuccess(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`<a href="https://files.pythonhosted.org/packages/aa/bb/cc/requests-2.31.0.tar.gz">download</a>`))
	}))
	defer upstream.Close()

	resolver := &pypiResolver{
		upstreamRegistry: upstream.URL,
		publicBaseURL:    "https://proxy.example.com",
		metadataMaxSize:  2 << 20,
		httpClient:       upstream.Client(),
	}

	req := httptest.NewRequest(http.MethodGet, "/pypi/simple/requests/", nil)
	rec := httptest.NewRecorder()
	ok := resolver.OnProxyMetadata(rec, req, "requests")

	assert.True(t, ok)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `href="https://proxy.example.com/pypi/packages/aa/bb/cc/requests-2.31.0.tar.gz"`)
}

func TestPypiMetadataPopulatesPackageMetadataCache(t *testing.T) {
	cache := metadata.NewCache(5 * time.Minute)
	walStore := testutil.MakeTempWAL(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/simple/requests/":
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte(`<a href="https://files.pythonhosted.org/packages/aa/bb/cc/requests-2.31.0.tar.gz">download</a>`))
		case "/pypi/requests/json":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
				"info": {"name": "requests", "version": "2.31.0"},
				"releases": {
					"2.31.0": [{"upload_time_iso_8601": "2023-05-22T12:00:00Z"}]
				}
			}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	resolver := &pypiResolver{
		upstreamRegistry: upstream.URL,
		publicBaseURL:    "https://proxy.example.com",
		metadataMaxSize:  2 << 20,
		httpClient:       upstream.Client(),
		freshness: &pkgmeta.Refresher{
			Adapter:           &pkgmeta.PyPIAdapter{BaseURL: upstream.URL, Client: upstream.Client()},
			Cache:             cache,
			WAL:               walStore,
			Dedupe:            metadata.NewSignalDedupe(5 * time.Minute),
			SyncTimeout:       3 * time.Second,
			BackgroundTimeout: 3 * time.Second,
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/pypi/simple/requests/", nil)
	rec := httptest.NewRecorder()
	ok := resolver.OnProxyMetadata(rec, req, "requests")

	require.True(t, ok)
	summary, state, found := cache.Get(metadata.CacheKey{Ecosystem: "pypi", Package: "requests"})
	require.True(t, found)
	assert.Equal(t, metadata.LookupStateHit, state)
	assert.Equal(t, "2.31.0", summary.LatestVersion)
	assert.Equal(t, "2023-05-22T12:00:00Z", summary.LatestPublishedAt)
	assert.Equal(t, "2023-05-22T12:00:00Z", summary.VersionPublishTimes["2.31.0"])

	require.Eventually(t, func() bool {
		records, err := walStore.UndeliveredRecords()
		if err != nil || len(records) != 1 {
			return false
		}
		if records[0].RecordType != wal.RecordTypePackageLatestMetadata {
			return false
		}
		var payload wal.PackageLatestMetadata
		if err := json.Unmarshal(records[0].Payload, &payload); err != nil {
			return false
		}
		return payload.Ecosystem == "pypi" &&
			payload.Package == "requests" &&
			payload.LatestVersion == "2.31.0" &&
			payload.LatestPublishedAt == "2023-05-22T12:00:00Z"
	}, 2*time.Second, 20*time.Millisecond)
}

func TestPypiMetadataDerivesRewriteBaseFromTrustedForwardedHeaders(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`<a href="https://files.pythonhosted.org/packages/aa/bb/cc/requests-2.31.0.tar.gz">download</a>`))
	}))
	defer upstream.Close()

	resolver := &pypiResolver{
		upstreamRegistry: upstream.URL,
		trustedProxyNets: []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")},
		metadataMaxSize:  2 << 20,
		httpClient:       upstream.Client(),
	}

	req := httptest.NewRequest(http.MethodGet, "/pypi/simple/requests/", nil)
	req.RemoteAddr = "10.0.0.5:1234"
	req.Host = "proxy:8080"
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "packages.example.test")
	rec := httptest.NewRecorder()
	ok := resolver.OnProxyMetadata(rec, req, "requests")

	assert.True(t, ok)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `href="https://packages.example.test/pypi/packages/aa/bb/cc/requests-2.31.0.tar.gz"`)
}
