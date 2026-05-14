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

const PyPIJSONSource = "pypi_json"

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
