package pkgmeta

import (
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
