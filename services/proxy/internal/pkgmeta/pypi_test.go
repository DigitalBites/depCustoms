package pkgmeta

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParsePyPIJSONSummary(t *testing.T) {
	body := []byte(`{
		"info": {"name": "Requests", "version": "2.32.3"},
		"releases": {
			"2.32.2": [
				{"upload_time_iso_8601": "2024-05-20T09:00:00Z"}
			],
			"2.32.3": [
				{"upload_time_iso_8601": "2024-05-21T12:00:00Z"},
				{"upload_time_iso_8601": "2024-05-21T10:00:00Z"}
			]
		}
	}`)
	fetchedAt := time.Date(2026, 5, 13, 6, 0, 0, 0, time.UTC)

	summary, err := ParsePyPIJSONSummary("requests", body, fetchedAt)

	require.NoError(t, err)
	assert.Equal(t, "pypi", summary.Ecosystem)
	assert.Equal(t, "requests", summary.Package)
	assert.Equal(t, "2.32.3", summary.LatestVersion)
	assert.Equal(t, "2024-05-21T10:00:00Z", summary.LatestPublishedAt)
	assert.Equal(t, "2024-05-20T09:00:00Z", summary.VersionPublishTimes["2.32.2"])
	assert.Equal(t, "2024-05-21T10:00:00Z", summary.VersionPublishTimes["2.32.3"])
	assert.Equal(t, PyPIJSONSource, summary.Source)
	assert.Equal(t, fetchedAt, summary.FetchedAt)
}

func TestParsePyPIJSONSummarySkipsInvalidTimestamps(t *testing.T) {
	body := []byte(`{
		"info": {"name": "example", "version": "1.0.0"},
		"releases": {
			"1.0.0": [
				{"upload_time_iso_8601": "not-a-date"},
				{"upload_time_iso_8601": "2024-01-02T03:04:05Z"}
			],
			"1.1.0": []
		}
	}`)

	summary, err := ParsePyPIJSONSummary("example", body, time.Now())

	require.NoError(t, err)
	assert.Equal(t, "2024-01-02T03:04:05Z", summary.LatestPublishedAt)
	assert.Equal(t, map[string]string{"1.0.0": "2024-01-02T03:04:05Z"}, summary.VersionPublishTimes)
}

func TestParsePyPIJSONSummaryAllowsMissingLatestTimestamp(t *testing.T) {
	body := []byte(`{
		"info": {"name": "example", "version": "2.0.0"},
		"releases": {
			"1.0.0": [{"upload_time_iso_8601": "2024-01-02T03:04:05Z"}]
		}
	}`)

	summary, err := ParsePyPIJSONSummary("example", body, time.Now())

	require.NoError(t, err)
	assert.Equal(t, "2.0.0", summary.LatestVersion)
	assert.Empty(t, summary.LatestPublishedAt)
	assert.Equal(t, "2024-01-02T03:04:05Z", summary.VersionPublishTimes["1.0.0"])
}

func TestParsePyPISimpleV1Summary(t *testing.T) {
	body := []byte(`{
		"name": "requests",
		"files": [
			{"filename": "requests-2.32.2.tar.gz", "upload-time": "2024-05-20T09:00:00Z"},
			{"filename": "requests-2.32.3-py3-none-any.whl", "upload-time": "2024-05-21T12:00:00Z"},
			{"filename": "requests-2.32.3.tar.gz", "upload-time": "2024-05-21T10:00:00Z"}
		],
		"versions": ["2.32.2", "2.32.3"]
	}`)
	fetchedAt := time.Date(2026, 5, 13, 6, 0, 0, 0, time.UTC)

	summary, err := ParsePyPISimpleV1Summary("requests", body, fetchedAt)

	require.NoError(t, err)
	assert.Equal(t, "pypi", summary.Ecosystem)
	assert.Equal(t, "requests", summary.Package)
	assert.Equal(t, "2.32.3", summary.LatestVersion)
	assert.Equal(t, "2024-05-21T12:00:00Z", summary.LatestPublishedAt)
	assert.Equal(t, "2024-05-20T09:00:00Z", summary.VersionPublishTimes["2.32.2"])
	assert.Equal(t, "2024-05-21T10:00:00Z", summary.VersionPublishTimes["2.32.3"])
	assert.Equal(t, PyPISimpleV1Source, summary.Source)
	assert.Equal(t, fetchedAt, summary.FetchedAt)
}

func TestParsePyPISimpleV1SummaryHandlesNormalizedNames(t *testing.T) {
	body := []byte(`{
		"name": "zope-interface",
		"files": [
			{"filename": "zope.interface-6.0.tar.gz", "upload-time": "2024-01-02T03:04:05Z"}
		]
	}`)

	summary, err := ParsePyPISimpleV1Summary("zope-interface", body, time.Now())

	require.NoError(t, err)
	assert.Equal(t, "6.0", summary.LatestVersion)
	assert.Equal(t, "2024-01-02T03:04:05Z", summary.VersionPublishTimes["6.0"])
}

func TestPyPIAdapterPrefersSimpleV1(t *testing.T) {
	var simpleCalls, jsonCalls int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/simple/") {
			simpleCalls++
			assert.Contains(t, r.Header.Get("Accept"), "application/vnd.pypi.simple.v1+json")
			w.Header().Set("Content-Type", "application/vnd.pypi.simple.v1+json")
			_, _ = w.Write([]byte(`{
				"name": "requests",
				"files": [
					{"filename": "requests-2.32.3.tar.gz", "upload-time": "2024-05-21T10:00:00Z"}
				]
			}`))
			return
		}
		jsonCalls++
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer upstream.Close()

	adapter := &PyPIAdapter{BaseURL: upstream.URL, Client: upstream.Client()}
	summary, err := adapter.FetchSummary(context.Background(), "requests")

	require.NoError(t, err)
	assert.Equal(t, PyPISimpleV1Source, summary.Source)
	assert.Equal(t, "2.32.3", summary.LatestVersion)
	assert.Equal(t, "2024-05-21T10:00:00Z", summary.LatestPublishedAt)
	assert.Equal(t, 1, simpleCalls)
	assert.Equal(t, 0, jsonCalls)
}

func TestPyPIAdapterFallsBackToJSONWhenSimpleV1Unavailable(t *testing.T) {
	var simpleCalls, jsonCalls int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/simple/") {
			simpleCalls++
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte(`<html></html>`))
			return
		}
		jsonCalls++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"info": {"name": "Requests", "version": "2.32.3"},
			"releases": {"2.32.3": [{"upload_time_iso_8601": "2024-05-21T10:00:00Z"}]}
		}`))
	}))
	defer upstream.Close()

	adapter := &PyPIAdapter{BaseURL: upstream.URL, Client: upstream.Client()}
	summary, err := adapter.FetchSummary(context.Background(), "requests")

	require.NoError(t, err)
	assert.Equal(t, PyPIJSONSource, summary.Source)
	assert.Equal(t, "2.32.3", summary.LatestVersion)
	assert.Equal(t, 1, simpleCalls)
	assert.Equal(t, 1, jsonCalls)
}

func TestPyPIAdapterFetchSummaryRejectsOversizedJSON(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(strings.Repeat("x", 33)))
	}))
	defer upstream.Close()

	adapter := &PyPIAdapter{
		BaseURL:      upstream.URL,
		Client:       upstream.Client(),
		MaxBodyBytes: 32,
	}

	_, err := adapter.FetchSummary(context.Background(), "requests")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "pypi_json_too_large")
}
