package pkgmeta

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/getcustoms/proxy/internal/metadata"
	"github.com/getcustoms/proxy/internal/taxonomy"
)

const (
	PyPIJSONSource     = "pypi_json"
	PyPISimpleV1Source = "pypi_simple_v1"

	pypiSimpleV1Accept      = "application/vnd.pypi.simple.v1+json"
	pypiSimpleV1ContentType = "application/vnd.pypi.simple.v1+json"
)

type PyPIAdapter struct {
	BaseURL      string
	Client       *http.Client
	MaxBodyBytes int64
	Now          func() time.Time
}

func (a *PyPIAdapter) Ecosystem() string { return taxonomy.EcosystemPyPI }

func (a *PyPIAdapter) FetchSummary(ctx context.Context, pkg string) (metadata.Summary, error) {
	baseURL := strings.TrimRight(a.BaseURL, "/")
	if baseURL == "" {
		baseURL = "https://pypi.org"
	}
	client := a.Client
	if client == nil {
		client = http.DefaultClient
	}
	maxBodyBytes := a.MaxBodyBytes
	if maxBodyBytes <= 0 {
		maxBodyBytes = 8 << 20
	}
	now := time.Now
	if a.Now != nil {
		now = a.Now
	}

	if summary, ok, err := a.fetchSimpleV1Summary(ctx, client, baseURL, pkg, maxBodyBytes, now); ok {
		return summary, err
	}

	return a.fetchJSONSummary(ctx, client, baseURL, pkg, maxBodyBytes, now)
}

// fetchSimpleV1Summary requests the simple index in PEP 691 JSON form. Upload
// times for release files are carried inline, avoiding the separate
// /pypi/{pkg}/json hop. Returns ok=false when upstream did not honour the
// JSON accept and the caller should fall back.
func (a *PyPIAdapter) fetchSimpleV1Summary(ctx context.Context, client *http.Client, baseURL, pkg string, maxBodyBytes int64, now func() time.Time) (metadata.Summary, bool, error) {
	reqURL := fmt.Sprintf("%s/simple/%s/", baseURL, url.PathEscape(pkg))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return metadata.Summary{}, true, err
	}
	req.Header.Set("Accept", pypiSimpleV1Accept)

	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		slog.Warn("pypi simple v1 metadata request failed",
			"service", "proxy",
			"ecosystem", taxonomy.EcosystemPyPI,
			"package", pkg,
			"duration_ms", time.Since(start).Milliseconds(),
			"error", err.Error(),
		)
		return metadata.Summary{}, false, nil
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		slog.Debug("pypi simple v1 metadata unavailable; falling back to json",
			"service", "proxy",
			"ecosystem", taxonomy.EcosystemPyPI,
			"package", pkg,
			"status", resp.StatusCode,
		)
		return metadata.Summary{}, false, nil
	}

	if !strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), pypiSimpleV1ContentType) {
		slog.Debug("pypi simple v1 not served; falling back to json",
			"service", "proxy",
			"ecosystem", taxonomy.EcosystemPyPI,
			"package", pkg,
			"upstream_content_type", resp.Header.Get("Content-Type"),
		)
		return metadata.Summary{}, false, nil
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes+1))
	if err != nil {
		slog.Warn("pypi simple v1 metadata read failed",
			"service", "proxy",
			"ecosystem", taxonomy.EcosystemPyPI,
			"package", pkg,
			"duration_ms", time.Since(start).Milliseconds(),
			"error", err.Error(),
		)
		return metadata.Summary{}, false, nil
	}
	if int64(len(body)) > maxBodyBytes {
		slog.Warn("pypi simple v1 metadata exceeded size limit",
			"service", "proxy",
			"ecosystem", taxonomy.EcosystemPyPI,
			"package", pkg,
			"size_bytes", len(body),
			"limit_bytes", maxBodyBytes,
		)
		return metadata.Summary{}, true, fmt.Errorf("pypi_simple_v1_too_large")
	}

	summary, err := ParsePyPISimpleV1Summary(pkg, body, now().UTC())
	if err != nil {
		slog.Warn("pypi simple v1 metadata parse failed; falling back to json",
			"service", "proxy",
			"ecosystem", taxonomy.EcosystemPyPI,
			"package", pkg,
			"error", err.Error(),
		)
		return metadata.Summary{}, false, nil
	}

	slog.Debug("pypi simple v1 metadata request completed",
		"service", "proxy",
		"ecosystem", taxonomy.EcosystemPyPI,
		"package", pkg,
		"duration_ms", time.Since(start).Milliseconds(),
		"size_bytes", len(body),
		"version_count", len(summary.VersionPublishTimes),
		"latest_version", summary.LatestVersion,
	)
	return summary, true, nil
}

func (a *PyPIAdapter) fetchJSONSummary(ctx context.Context, client *http.Client, baseURL, pkg string, maxBodyBytes int64, now func() time.Time) (metadata.Summary, error) {
	reqURL := fmt.Sprintf("%s/pypi/%s/json", baseURL, url.PathEscape(pkg))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return metadata.Summary{}, err
	}
	req.Header.Set("Accept", "application/json")

	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		slog.Warn("pypi json metadata request failed",
			"service", "proxy",
			"ecosystem", taxonomy.EcosystemPyPI,
			"package", pkg,
			"duration_ms", time.Since(start).Milliseconds(),
			"error", err.Error(),
		)
		return metadata.Summary{}, err
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		slog.Warn("pypi json metadata request failed",
			"service", "proxy",
			"ecosystem", taxonomy.EcosystemPyPI,
			"package", pkg,
			"duration_ms", time.Since(start).Milliseconds(),
			"status", resp.StatusCode,
		)
		return metadata.Summary{}, fmt.Errorf("pypi_json_http_%d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes+1))
	if err != nil {
		slog.Warn("pypi json metadata read failed",
			"service", "proxy",
			"ecosystem", taxonomy.EcosystemPyPI,
			"package", pkg,
			"duration_ms", time.Since(start).Milliseconds(),
			"status", resp.StatusCode,
			"error", err.Error(),
		)
		return metadata.Summary{}, err
	}
	if int64(len(body)) > maxBodyBytes {
		slog.Warn("pypi json metadata exceeded size limit",
			"service", "proxy",
			"ecosystem", taxonomy.EcosystemPyPI,
			"package", pkg,
			"duration_ms", time.Since(start).Milliseconds(),
			"status", resp.StatusCode,
			"size_bytes", len(body),
			"limit_bytes", maxBodyBytes,
		)
		return metadata.Summary{}, fmt.Errorf("pypi_json_too_large")
	}

	summary, err := ParsePyPIJSONSummary(pkg, body, now().UTC())
	if err != nil {
		slog.Warn("pypi json metadata parse failed",
			"service", "proxy",
			"ecosystem", taxonomy.EcosystemPyPI,
			"package", pkg,
			"duration_ms", time.Since(start).Milliseconds(),
			"status", resp.StatusCode,
			"size_bytes", len(body),
			"error", err.Error(),
		)
		return metadata.Summary{}, err
	}

	slog.Debug("pypi json metadata request completed",
		"service", "proxy",
		"ecosystem", taxonomy.EcosystemPyPI,
		"package", pkg,
		"duration_ms", time.Since(start).Milliseconds(),
		"status", resp.StatusCode,
		"size_bytes", len(body),
		"version_count", len(summary.VersionPublishTimes),
		"latest_version", summary.LatestVersion,
	)
	return summary, nil
}

type pypiSimpleV1Document struct {
	Name  string `json:"name"`
	Files []struct {
		Filename   string `json:"filename"`
		UploadTime string `json:"upload-time"`
	} `json:"files"`
	Versions []string `json:"versions"`
}

// ParsePyPISimpleV1Summary parses a PEP 691 simple-index JSON response. Per-file
// upload times are grouped by version (derived from the filename); the latest
// version is the one with the most recent upload time.
func ParsePyPISimpleV1Summary(pkg string, body []byte, fetchedAt time.Time) (metadata.Summary, error) {
	var doc pypiSimpleV1Document
	if err := json.Unmarshal(body, &doc); err != nil {
		return metadata.Summary{}, err
	}

	versionPublishTimes := make(map[string]string, len(doc.Versions))
	latestVersion := ""
	latestPublishedAt := ""

	for _, file := range doc.Files {
		if file.UploadTime == "" || file.Filename == "" {
			continue
		}
		version := versionFromPyPIFilename(pkg, file.Filename)
		if version == "" {
			continue
		}
		parsed, err := time.Parse(time.RFC3339, file.UploadTime)
		if err != nil {
			slog.Error("pypi simple v1 timestamp invalid",
				"service", "proxy",
				"ecosystem", taxonomy.EcosystemPyPI,
				"package", pkg,
				"version", version,
				"timestamp", file.UploadTime,
				"error", err.Error(),
			)
			continue
		}
		normalized := parsed.UTC().Format(time.RFC3339)
		if existing, ok := versionPublishTimes[version]; !ok || normalized < existing {
			versionPublishTimes[version] = normalized
		}
		if latestPublishedAt == "" || normalized > latestPublishedAt {
			latestPublishedAt = normalized
			latestVersion = version
		}
	}

	if latestVersion == "" {
		slog.Warn("pypi simple v1 latest version unavailable",
			"service", "proxy",
			"ecosystem", taxonomy.EcosystemPyPI,
			"package", pkg,
		)
	}

	return metadata.Summary{
		Ecosystem:           taxonomy.EcosystemPyPI,
		Package:             pkg,
		LatestVersion:       latestVersion,
		LatestPublishedAt:   latestPublishedAt,
		FetchedAt:           fetchedAt.UTC(),
		Source:              PyPISimpleV1Source,
		VersionPublishTimes: versionPublishTimes,
	}, nil
}

// versionFromPyPIFilename strips the package-name prefix and known archive
// suffix from a PyPI distribution filename to recover the release version.
// Wheels embed extra metadata in the filename (python tag / abi / platform) so
// the version is the field immediately after the package name.
func versionFromPyPIFilename(pkg, filename string) string {
	base := strings.TrimSuffix(filename, ".metadata")
	for _, suffix := range []string{".whl", ".tar.gz", ".tar.bz2", ".zip", ".egg"} {
		if strings.HasSuffix(base, suffix) {
			base = strings.TrimSuffix(base, suffix)
			break
		}
	}

	normalize := func(s string) string {
		return strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(s, "-", "_"), ".", "_"))
	}
	pkgNorm := normalize(pkg)

	idx := strings.Index(base, "-")
	for idx > 0 {
		prefix := base[:idx]
		if normalize(prefix) == pkgNorm {
			rest := base[idx+1:]
			if dash := strings.Index(rest, "-"); dash > 0 {
				return rest[:dash]
			}
			return rest
		}
		next := strings.Index(base[idx+1:], "-")
		if next < 0 {
			break
		}
		idx += 1 + next
	}
	return ""
}

type pypiJSONDocument struct {
	Info struct {
		Name    string `json:"name"`
		Version string `json:"version"`
	} `json:"info"`
	Releases map[string][]struct {
		UploadTimeISO8601 string `json:"upload_time_iso_8601"`
	} `json:"releases"`
}

func ParsePyPIJSONSummary(pkg string, body []byte, fetchedAt time.Time) (metadata.Summary, error) {
	var doc pypiJSONDocument
	if err := json.Unmarshal(body, &doc); err != nil {
		return metadata.Summary{}, err
	}

	versionPublishTimes := make(map[string]string, len(doc.Releases))
	for version, files := range doc.Releases {
		earliest := ""
		for _, file := range files {
			timestamp := file.UploadTimeISO8601
			if timestamp == "" {
				continue
			}
			parsed, err := time.Parse(time.RFC3339, timestamp)
			if err != nil {
				slog.Error("pypi metadata timestamp invalid",
					"service", "proxy",
					"ecosystem", taxonomy.EcosystemPyPI,
					"package", pkg,
					"version", version,
					"timestamp", timestamp,
					"error", err.Error(),
				)
				continue
			}
			normalized := parsed.UTC().Format(time.RFC3339)
			if earliest == "" || normalized < earliest {
				earliest = normalized
			}
		}
		if earliest != "" {
			versionPublishTimes[version] = earliest
		}
	}

	latestVersion := doc.Info.Version
	latestPublishedAt := versionPublishTimes[latestVersion]
	if latestVersion == "" || latestPublishedAt == "" {
		slog.Warn("pypi metadata latest version timestamp unavailable",
			"service", "proxy",
			"ecosystem", taxonomy.EcosystemPyPI,
			"package", pkg,
			"latest_version", latestVersion,
		)
	}

	return metadata.Summary{
		Ecosystem:           taxonomy.EcosystemPyPI,
		Package:             pkg,
		LatestVersion:       latestVersion,
		LatestPublishedAt:   latestPublishedAt,
		FetchedAt:           fetchedAt.UTC(),
		Source:              PyPIJSONSource,
		VersionPublishTimes: versionPublishTimes,
	}, nil
}
