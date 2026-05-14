package pkgmeta

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"github.com/getcustoms/proxy/internal/metadata"
	"github.com/getcustoms/proxy/internal/taxonomy"
	"github.com/getcustoms/proxy/internal/wal"
)

// Adapter fetches package-manager metadata and normalizes it to the shared
// proxy freshness summary used by the metadata cache and WAL signals.
type Adapter interface {
	Ecosystem() string
	FetchSummary(ctx context.Context, pkg string) (metadata.Summary, error)
}

func LatestMetadataFingerprint(summary metadata.Summary) string {
	keys := make([]string, 0, len(summary.VersionPublishTimes))
	for version := range summary.VersionPublishTimes {
		keys = append(keys, version)
	}
	sort.Strings(keys)

	var b strings.Builder
	b.WriteString(summary.Ecosystem)
	b.WriteByte('|')
	b.WriteString(summary.Package)
	b.WriteByte('|')
	b.WriteString(summary.LatestVersion)
	b.WriteByte('|')
	b.WriteString(summary.LatestPublishedAt)
	for _, version := range keys {
		b.WriteByte('|')
		b.WriteString(version)
		b.WriteByte('=')
		b.WriteString(summary.VersionPublishTimes[version])
	}

	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:])
}

func NewLatestMetadataRecord(summary metadata.Summary) (wal.Record, error) {
	observedAt := summary.FetchedAt.UTC().Format(time.RFC3339)
	payload, err := json.Marshal(wal.PackageLatestMetadata{
		Ecosystem:         summary.Ecosystem,
		Package:           summary.Package,
		LatestVersion:     summary.LatestVersion,
		LatestPublishedAt: summary.LatestPublishedAt,
		ObservedAt:        observedAt,
		CacheStatus:       taxonomy.MetadataCacheStatusRefresh,
	})
	if err != nil {
		return wal.Record{}, err
	}

	return wal.Record{
		SchemaVersion: wal.SchemaVersionV1,
		RecordType:    wal.RecordTypePackageLatestMetadata,
		RecordedAt:    observedAt,
		Payload:       payload,
	}, nil
}
