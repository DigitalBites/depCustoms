package metadata

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type ContributorVersion struct {
	Version           string   `json:"version"`
	PublishedAt       string   `json:"published_at"`
	Publisher         string   `json:"publisher,omitempty"`
	Maintainers       []string `json:"maintainers,omitempty"`
	HasInstallScripts bool     `json:"has_install_scripts"`
	HasAttestation    bool     `json:"has_attestation"`
	RawPayloadJSON    string   `json:"raw_payload_json,omitempty"`
}

type ContributorPackage struct {
	Ecosystem                 string               `json:"ecosystem"`
	Package                   string               `json:"package"`
	Fingerprint               string               `json:"fingerprint,omitempty"`
	ExtractedAt               string               `json:"extracted_at"`
	LatestVersion             string               `json:"latest_version,omitempty"`
	LatestPublishedAt         string               `json:"latest_published_at,omitempty"`
	HistoryComplete           bool                 `json:"history_complete"`
	OldestIncludedPublishedAt string               `json:"oldest_included_published_at,omitempty"`
	Versions                  []ContributorVersion `json:"versions"`
	LastAccessedAt            string               `json:"last_accessed_at"`
}

type ContributorSlice struct {
	RequestedVersion            string
	RequestedVersionPublishedAt string
	ExtractedAt                 string
	WindowDays                  int
	HistoryComplete             bool
	OldestIncludedPublishedAt   string
	PackageMetadataFingerprint  string
	SliceFingerprint            string
	Versions                    []ContributorVersion
}

type contributorSnapshotEntry struct {
	Ecosystem string             `json:"ecosystem"`
	Package   string             `json:"package"`
	Data      ContributorPackage `json:"data"`
}

type contributorSnapshot struct {
	Packages []contributorSnapshotEntry `json:"packages"`
}

type ContributorCache struct {
	mu         sync.RWMutex
	store      map[CacheKey]ContributorPackage
	path       string
	versionCap int
	coldAfter  time.Duration
	now        func() time.Time
}

func NewContributorCache(path string, versionCap int, coldDays int) (*ContributorCache, error) {
	c := &ContributorCache{
		store:      make(map[CacheKey]ContributorPackage),
		path:       path,
		versionCap: versionCap,
		coldAfter:  time.Duration(coldDays) * 24 * time.Hour,
		now:        time.Now,
	}
	if err := c.load(); err != nil {
		return nil, err
	}
	go c.evictLoop()
	return c, nil
}

func (c *ContributorCache) Get(key CacheKey) (ContributorPackage, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	current, ok := c.store[key]
	if !ok {
		return ContributorPackage{}, false
	}
	current.LastAccessedAt = c.now().UTC().Format(time.RFC3339)
	c.store[key] = current
	return cloneContributorPackage(current), true
}

func (c *ContributorCache) Set(key CacheKey, pkg ContributorPackage) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	pkg.LastAccessedAt = c.now().UTC().Format(time.RFC3339)
	pkg.Versions = retainNewestVersions(pkg.Versions, c.versionCap)
	c.store[key] = cloneContributorPackage(pkg)
	return c.persistLocked()
}

func (c *ContributorCache) BuildSlice(
	key CacheKey,
	requestedVersion string,
	windowDays int,
) (ContributorSlice, bool) {
	pkg, ok := c.Get(key)
	if !ok {
		return ContributorSlice{}, false
	}
	requested, requestedAt, ok := findRequestedVersion(pkg.Versions, requestedVersion)
	if !ok {
		return ContributorSlice{}, false
	}
	windowStart := requestedAt.Add(-time.Duration(windowDays) * 24 * time.Hour)
	var anchor *ContributorVersion
	var included []ContributorVersion
	for i := range pkg.Versions {
		version := pkg.Versions[i]
		publishedAt, err := time.Parse(time.RFC3339, version.PublishedAt)
		if err != nil {
			continue
		}
		if publishedAt.After(requestedAt) {
			continue
		}
		if publishedAt.Before(windowStart) {
			anchor = &version
			continue
		}
		included = append(included, version)
	}
	if anchor != nil {
		included = append([]ContributorVersion{*anchor}, included...)
	}
	if len(included) == 0 {
		included = append(included, requested)
	}
	oldestIncluded := ""
	if len(included) > 0 {
		oldestIncluded = included[0].PublishedAt
	}
	return ContributorSlice{
		RequestedVersion:            requestedVersion,
		RequestedVersionPublishedAt: requested.PublishedAt,
		ExtractedAt:                 c.now().UTC().Format(time.RFC3339),
		WindowDays:                  windowDays,
		HistoryComplete:             pkg.HistoryComplete,
		OldestIncludedPublishedAt:   oldestIncluded,
		PackageMetadataFingerprint:  pkg.Fingerprint,
		SliceFingerprint: contributorSliceFingerprint(
			key.Ecosystem,
			key.Package,
			requestedVersion,
			windowDays,
			included,
		),
		Versions: included,
	}, true
}

func (c *ContributorCache) load() error {
	if c.path == "" {
		return nil
	}
	raw, err := os.ReadFile(c.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var snapshot contributorSnapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return err
	}
	if snapshot.Packages != nil {
		c.store = make(map[CacheKey]ContributorPackage, len(snapshot.Packages))
		for _, entry := range snapshot.Packages {
			c.store[CacheKey{Ecosystem: entry.Ecosystem, Package: entry.Package}] = entry.Data
		}
	}
	return nil
}

func (c *ContributorCache) persistLocked() error {
	if c.path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(c.path), 0o700); err != nil {
		return err
	}
	entries := make([]contributorSnapshotEntry, 0, len(c.store))
	for key, pkg := range c.store {
		entries = append(entries, contributorSnapshotEntry{
			Ecosystem: key.Ecosystem,
			Package:   key.Package,
			Data:      pkg,
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Ecosystem == entries[j].Ecosystem {
			return entries[i].Package < entries[j].Package
		}
		return entries[i].Ecosystem < entries[j].Ecosystem
	})

	payload, err := json.Marshal(contributorSnapshot{Packages: entries})
	if err != nil {
		return err
	}
	tmpPath := c.path + ".tmp"
	if err := os.WriteFile(tmpPath, payload, 0o600); err != nil {
		return err
	}
	return os.Rename(tmpPath, c.path)
}

func (c *ContributorCache) evictLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		now := c.now()
		c.mu.Lock()
		changed := false
		for key, pkg := range c.store {
			lastAccessed, err := time.Parse(time.RFC3339, pkg.LastAccessedAt)
			if err != nil || now.Sub(lastAccessed) > c.coldAfter {
				delete(c.store, key)
				changed = true
			}
		}
		if changed {
			_ = c.persistLocked()
		}
		c.mu.Unlock()
	}
}

func retainNewestVersions(versions []ContributorVersion, cap int) []ContributorVersion {
	if len(versions) <= cap {
		return sortContributorVersions(versions)
	}
	sorted := sortContributorVersions(versions)
	return sorted[len(sorted)-cap:]
}

func sortContributorVersions(versions []ContributorVersion) []ContributorVersion {
	cloned := append([]ContributorVersion(nil), versions...)
	sort.Slice(cloned, func(i, j int) bool {
		return cloned[i].PublishedAt < cloned[j].PublishedAt
	})
	return cloned
}

func cloneContributorPackage(pkg ContributorPackage) ContributorPackage {
	cloned := pkg
	cloned.Versions = append([]ContributorVersion(nil), pkg.Versions...)
	for i := range cloned.Versions {
		cloned.Versions[i].Maintainers = append([]string(nil), pkg.Versions[i].Maintainers...)
	}
	return cloned
}

func findRequestedVersion(
	versions []ContributorVersion,
	requestedVersion string,
) (ContributorVersion, time.Time, bool) {
	for _, version := range versions {
		if version.Version != requestedVersion {
			continue
		}
		publishedAt, err := time.Parse(time.RFC3339, version.PublishedAt)
		if err != nil {
			return ContributorVersion{}, time.Time{}, false
		}
		return version, publishedAt, true
	}
	return ContributorVersion{}, time.Time{}, false
}

func contributorSliceFingerprint(
	ecosystem string,
	pkg string,
	requestedVersion string,
	windowDays int,
	versions []ContributorVersion,
) string {
	var builder strings.Builder
	builder.WriteString(ecosystem)
	builder.WriteString("|")
	builder.WriteString(pkg)
	builder.WriteString("|")
	builder.WriteString(requestedVersion)
	builder.WriteString("|")
	fmt.Fprintf(&builder, "%d", windowDays)
	for _, version := range versions {
		builder.WriteString("|")
		builder.WriteString(version.Version)
		builder.WriteString("|")
		builder.WriteString(version.PublishedAt)
		builder.WriteString("|")
		builder.WriteString(version.Publisher)
		builder.WriteString("|")
		builder.WriteString(strings.Join(version.Maintainers, ","))
		builder.WriteString("|")
		builder.WriteString(version.RawPayloadJSON)
	}
	sum := sha256.Sum256([]byte(builder.String()))
	return hex.EncodeToString(sum[:])
}
