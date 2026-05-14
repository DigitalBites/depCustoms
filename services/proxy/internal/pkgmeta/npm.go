package pkgmeta

import (
	"time"

	"github.com/getcustoms/proxy/internal/metadata"
	"github.com/getcustoms/proxy/internal/taxonomy"
)

func ParseNPMPackumentSummary(
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
		Ecosystem:           taxonomy.EcosystemNPM,
		Package:             pkg,
		LatestVersion:       latestVersion,
		LatestPublishedAt:   versionPublishTimes[latestVersion],
		FetchedAt:           fetchedAt.UTC(),
		Source:              "npm_packument",
		VersionPublishTimes: versionPublishTimes,
	}, "", true
}
