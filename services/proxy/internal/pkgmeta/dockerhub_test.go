package pkgmeta

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	testDigestA = "sha256:aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111"
	testDigestB = "sha256:bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222"
)

func TestParseDockerHubVerifiedPublishTime_MatchesTopLevelDigest(t *testing.T) {
	body := []byte(`{
		"digest": "` + testDigestA + `",
		"last_updated": "2024-01-15T12:34:56Z",
		"images": []
	}`)

	publishedAt, ok := ParseDockerHubVerifiedPublishTime(body, testDigestA)

	require.True(t, ok)
	assert.Equal(t, "2024-01-15T12:34:56Z", publishedAt)
}

func TestParseDockerHubVerifiedPublishTime_MatchesImageDigest(t *testing.T) {
	body := []byte(`{
		"digest": "sha256:indexindexindex",
		"last_updated": "2024-01-15T12:34:56.789012Z",
		"images": [
			{"digest": "sha256:cccc"},
			{"digest": "` + testDigestA + `"}
		]
	}`)

	publishedAt, ok := ParseDockerHubVerifiedPublishTime(body, testDigestA)

	require.True(t, ok)
	assert.Equal(t, "2024-01-15T12:34:56Z", publishedAt)
}

func TestParseDockerHubVerifiedPublishTime_MismatchReturnsEmpty(t *testing.T) {
	body := []byte(`{
		"digest": "` + testDigestA + `",
		"last_updated": "2024-01-15T12:34:56Z",
		"images": [{"digest": "sha256:other"}]
	}`)

	_, ok := ParseDockerHubVerifiedPublishTime(body, testDigestB)

	assert.False(t, ok, "mismatched digest must yield empty publish time")
}

func TestParseDockerHubVerifiedPublishTime_RejectsMissingTimestamp(t *testing.T) {
	body := []byte(`{
		"digest": "` + testDigestA + `",
		"last_updated": "",
		"images": []
	}`)

	_, ok := ParseDockerHubVerifiedPublishTime(body, testDigestA)

	assert.False(t, ok)
}

func TestDockerHubTagLookup_ReturnsPublishTimeOnVerifiedMatch(t *testing.T) {
	hub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v2/repositories/library/redis/tags/7.0", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"digest": "` + testDigestA + `",
			"last_updated": "2024-01-15T12:34:56Z",
			"images": []
		}`))
	}))
	defer hub.Close()

	lookup := &DockerHubTagLookup{BaseURL: hub.URL, Client: hub.Client()}
	publishedAt, err := lookup.FetchVerifiedPublishTime(context.Background(), "library/redis", "7.0", testDigestA)

	require.NoError(t, err)
	assert.Equal(t, "2024-01-15T12:34:56Z", publishedAt)
}

func TestDockerHubTagLookup_MismatchedDigestReturnsEmpty(t *testing.T) {
	hub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"digest": "` + testDigestA + `",
			"last_updated": "2024-01-15T12:34:56Z",
			"images": []
		}`))
	}))
	defer hub.Close()

	lookup := &DockerHubTagLookup{BaseURL: hub.URL, Client: hub.Client()}
	publishedAt, err := lookup.FetchVerifiedPublishTime(context.Background(), "library/redis", "7.0", testDigestB)

	require.NoError(t, err)
	assert.Empty(t, publishedAt, "mismatched digest must not produce publish time")
}

func TestDockerHubTagLookup_MissingTagReturnsEmpty(t *testing.T) {
	hub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer hub.Close()

	lookup := &DockerHubTagLookup{BaseURL: hub.URL, Client: hub.Client()}
	publishedAt, err := lookup.FetchVerifiedPublishTime(context.Background(), "library/redis", "missing", testDigestA)

	require.NoError(t, err)
	assert.Empty(t, publishedAt)
}

func TestDockerHubTagLookup_OversizedResponseReturnsEmpty(t *testing.T) {
	hub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(strings.Repeat("x", 100)))
	}))
	defer hub.Close()

	lookup := &DockerHubTagLookup{BaseURL: hub.URL, Client: hub.Client(), MaxBodyBytes: 32}
	publishedAt, err := lookup.FetchVerifiedPublishTime(context.Background(), "library/redis", "7.0", testDigestA)

	require.NoError(t, err)
	assert.Empty(t, publishedAt)
}

func TestDockerHubTagLookup_RejectsEmptyInputs(t *testing.T) {
	lookup := &DockerHubTagLookup{}
	_, err := lookup.FetchVerifiedPublishTime(context.Background(), "", "7.0", testDigestA)
	require.Error(t, err)
	_, err = lookup.FetchVerifiedPublishTime(context.Background(), "library/redis", "", testDigestA)
	require.Error(t, err)
	_, err = lookup.FetchVerifiedPublishTime(context.Background(), "library/redis", "7.0", "")
	require.Error(t, err)
}
