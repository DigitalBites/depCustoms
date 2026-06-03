package pkgmeta

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/getcustoms/proxy/internal/taxonomy"
)

const (
	DockerHubSource = "docker_hub_tag"

	dockerHubDefaultBaseURL  = "https://hub.docker.com"
	dockerHubMaxResponseSize = 1 << 20
)

// DockerHubTagLookup fetches Docker Hub tag metadata and lifts publish time
// only when the response's digest can be matched against a caller-supplied
// expected digest. Mismatches return an empty publish time so the rule's
// null-handling takes over (per feature-rules-data-wait.md §Docker).
//
// Memoization is handled by the shared metadata.Cache at the call site — this
// type is a stateless network adapter.
type DockerHubTagLookup struct {
	BaseURL      string
	Client       *http.Client
	MaxBodyBytes int64
}

// FetchVerifiedPublishTime returns the tag's `last_updated` timestamp when the
// tag response's digest (top-level or one of the per-platform images) matches
// expectedDigest. On any mismatch, missing field, or transport error the
// function returns an empty string and a nil error — the caller must treat the
// publish time as unknown and let the rule's condition handle null.
//
// Returns a non-nil error only when the caller passed obviously invalid input
// (empty repository / tag / expectedDigest) — those are programmer bugs.
func (l *DockerHubTagLookup) FetchVerifiedPublishTime(ctx context.Context, repository, tag, expectedDigest string) (string, error) {
	if repository == "" || tag == "" || expectedDigest == "" {
		return "", fmt.Errorf("docker_hub_lookup: empty repository, tag, or expectedDigest")
	}

	baseURL := strings.TrimRight(l.BaseURL, "/")
	if baseURL == "" {
		baseURL = dockerHubDefaultBaseURL
	}
	client := l.Client
	if client == nil {
		client = http.DefaultClient
	}
	maxBody := l.MaxBodyBytes
	if maxBody <= 0 {
		maxBody = dockerHubMaxResponseSize
	}

	reqURL := fmt.Sprintf("%s/v2/repositories/%s/tags/%s", baseURL, repository, tag)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return "", nil
	}
	req.Header.Set("Accept", "application/json")

	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		slog.Warn("docker hub tag metadata request failed",
			"service", "proxy",
			"ecosystem", taxonomy.EcosystemDocker,
			"repository", repository,
			"tag", tag,
			"duration_ms", time.Since(start).Milliseconds(),
			"error", err.Error(),
		)
		return "", nil
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		slog.Debug("docker hub tag metadata unavailable",
			"service", "proxy",
			"ecosystem", taxonomy.EcosystemDocker,
			"repository", repository,
			"tag", tag,
			"status", resp.StatusCode,
		)
		return "", nil
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		slog.Warn("docker hub tag metadata read failed",
			"service", "proxy",
			"ecosystem", taxonomy.EcosystemDocker,
			"repository", repository,
			"tag", tag,
			"error", err.Error(),
		)
		return "", nil
	}
	if int64(len(body)) > maxBody {
		slog.Warn("docker hub tag metadata exceeded size limit",
			"service", "proxy",
			"ecosystem", taxonomy.EcosystemDocker,
			"repository", repository,
			"tag", tag,
			"size_bytes", len(body),
			"limit_bytes", maxBody,
		)
		return "", nil
	}

	publishedAt, ok := ParseDockerHubVerifiedPublishTime(body, expectedDigest)
	if !ok {
		slog.Debug("docker hub tag digest mismatch; publish time withheld",
			"service", "proxy",
			"ecosystem", taxonomy.EcosystemDocker,
			"repository", repository,
			"tag", tag,
			"expected_digest", expectedDigest,
		)
		return "", nil
	}

	slog.Debug("docker hub tag metadata verified",
		"service", "proxy",
		"ecosystem", taxonomy.EcosystemDocker,
		"repository", repository,
		"tag", tag,
		"duration_ms", time.Since(start).Milliseconds(),
		"published_at", publishedAt,
	)
	return publishedAt, nil
}

type dockerHubTagResponse struct {
	Digest      string `json:"digest"`
	LastUpdated string `json:"last_updated"`
	Images      []struct {
		Digest string `json:"digest"`
	} `json:"images"`
}

// ParseDockerHubVerifiedPublishTime returns the tag's normalized last_updated
// timestamp iff expectedDigest matches the tag's top-level digest or any of the
// per-platform image digests. Otherwise returns ("", false).
func ParseDockerHubVerifiedPublishTime(body []byte, expectedDigest string) (string, bool) {
	var doc dockerHubTagResponse
	if err := json.Unmarshal(body, &doc); err != nil {
		return "", false
	}
	if doc.LastUpdated == "" {
		return "", false
	}

	expected := strings.ToLower(strings.TrimSpace(expectedDigest))
	matched := strings.EqualFold(strings.TrimSpace(doc.Digest), expected)
	if !matched {
		for _, image := range doc.Images {
			if strings.EqualFold(strings.TrimSpace(image.Digest), expected) {
				matched = true
				break
			}
		}
	}
	if !matched {
		return "", false
	}

	parsed, err := time.Parse(time.RFC3339, doc.LastUpdated)
	if err != nil {
		// Docker Hub sometimes returns sub-second precision past RFC3339Nano.
		// Try the fractional form as a fallback.
		parsed, err = time.Parse(time.RFC3339Nano, doc.LastUpdated)
		if err != nil {
			return "", false
		}
	}
	return parsed.UTC().Format(time.RFC3339), true
}
