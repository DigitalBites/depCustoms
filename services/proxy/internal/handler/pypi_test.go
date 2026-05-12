package handler

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"

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
