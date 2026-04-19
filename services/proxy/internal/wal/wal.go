// Package wal implements a write-ahead log for durable, at-least-once delivery
// of proxy-originated outbound records to the Customs control plane.
//
// Records are appended as newline-delimited JSON (NDJSON) to a flat file.
// A separate checkpoint file records the byte offset up to which records have
// been successfully delivered. On restart the proxy replays only undelivered
// records, giving it durability across crashes and network partitions.
package wal

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	SchemaVersionV1 = 1

	RecordTypeUsageEvent                 = "usage_event"
	RecordTypePackageLatestMetadata      = "package_latest_metadata"
	RecordTypePackageUsedVersionMetadata = "package_used_version_metadata"
	RecordTypePackageContributorMetadata = "package_contributor_metadata"

	advisoryRecordQueueSize = 256
	maxRecordLineBytes      = 16 << 20
)

// Event is the legacy usage-event payload written to the WAL.
// Fields added after the initial implementation use omitempty so that WAL files
// written by older proxy versions deserialise cleanly — missing fields default
// to Go's zero value (empty string / 0).
type Event struct {
	Ecosystem string `json:"ecosystem"`
	Package   string `json:"package"`
	Version   string `json:"version"`
	Decision  string `json:"decision"`
	// EventType classifies the kind of request: "artifact" | "metadata" | "upstream_error".
	// Replaces the old Source string ("cache", "check", "control_plane_unavailable", etc.).
	// Source is now fixed per writer and not carried in the WAL.
	EventType string `json:"event_type"`
	// DecisionCache is true when the decision was served from the proxy cache.
	DecisionCache    bool   `json:"decision_cache,omitempty"`
	RequestedAt      string `json:"requested_at"` // ISO 8601 UTC
	ProjectTokenHash string `json:"project_token_hash"`
	TraceID          string `json:"trace_id"`
	RequestID        string `json:"request_id"`
	TenantID         string `json:"tenant_id"`
	ProjectID        string `json:"project_id"`
	ServeMode        string `json:"serve_mode,omitempty"`        // empty for BLOCK events
	BytesTransferred int64  `json:"bytes_transferred,omitempty"` // 0 for redirect/block
	ClientIP         string `json:"client_ip,omitempty"`         // IP of the package manager client
	// DurationMs is the total proxy-side request latency in milliseconds.
	DurationMs int64 `json:"duration_ms,omitempty"`
	// DecisionPath describes how the decision was reached:
	//   "cache_hit"                 — served from proxy-local cache
	//   "check"                     — fresh control-plane RPC
	//   "control_plane_unavailable" — cache miss + control plane unreachable (fail-closed)
	DecisionPath string `json:"decision_path,omitempty"`
}

// Record is the generalized typed envelope stored in the WAL.
type Record struct {
	SchemaVersion int             `json:"schema_version"`
	RecordType    string          `json:"record_type"`
	RecordedAt    string          `json:"recorded_at"`
	Payload       json.RawMessage `json:"payload"`
}

// UsageEventRecord is a typed view over a usage-event record.
type UsageEventRecord struct {
	Record
	Event Event
}

// PackageLatestMetadata is the WAL payload for package-level freshness learned
// from a metadata request.
type PackageLatestMetadata struct {
	Ecosystem         string `json:"ecosystem"`
	Package           string `json:"package"`
	LatestVersion     string `json:"latest_version"`
	LatestPublishedAt string `json:"latest_published_at,omitempty"`
	ObservedAt        string `json:"observed_at"`
	CacheStatus       string `json:"cache_status,omitempty"`
}

// PackageContributorVersion is the normalized per-version contributor payload
// extracted from a package metadata response.
type PackageContributorVersion struct {
	Version           string   `json:"version"`
	PublishedAt       string   `json:"published_at"`        // ISO 8601 UTC
	Publisher         string   `json:"publisher,omitempty"` // empty when absent from manifest
	Maintainers       []string `json:"maintainers,omitempty"`
	HasInstallScripts bool     `json:"has_install_scripts"`
	HasAttestation    bool     `json:"has_attestation"`
	RawPayloadJSON    string   `json:"raw_payload_json,omitempty"`
}

// PackageContributorMetadata is the WAL payload for package contributor metadata
// observed on the metadata path.
type PackageContributorMetadata struct {
	Ecosystem                 string                      `json:"ecosystem"`
	Package                   string                      `json:"package"`
	ExtractedAt               string                      `json:"extracted_at"` // ISO 8601 UTC
	Fingerprint               string                      `json:"fingerprint,omitempty"`
	LatestVersion             string                      `json:"latest_version,omitempty"`
	LatestPublishedAt         string                      `json:"latest_published_at,omitempty"`
	HistoryComplete           bool                        `json:"history_complete"`
	OldestIncludedPublishedAt string                      `json:"oldest_included_published_at,omitempty"`
	Versions                  []PackageContributorVersion `json:"versions"`
}

// PackageUsedVersionMetadata is the WAL payload for version-specific freshness
// context attached to an artifact request.
type PackageUsedVersionMetadata struct {
	Ecosystem              string `json:"ecosystem"`
	Package                string `json:"package"`
	UsedVersion            string `json:"used_version"`
	UsedVersionPublishedAt string `json:"used_version_published_at,omitempty"`
	ObservedAt             string `json:"observed_at"`
	CacheStatus            string `json:"cache_status,omitempty"`
	LatestVersion          string `json:"latest_version,omitempty"`
	LatestPublishedAt      string `json:"latest_published_at,omitempty"`
}

// WAL manages the append-only outbound log and its delivery checkpoint.
type WAL struct {
	mu             sync.Mutex
	file           *os.File
	walPath        string
	checkpointPath string
	// checkpointOffset is the byte offset up to which records are known delivered.
	checkpointOffset int64
	// notify is an optional channel signaled (non-blocking) after each Append.
	// Used by the stream manager to trigger immediate delivery.
	notify chan struct{}
	// advisoryQueue buffers best-effort durable messages that should not block
	// request handling. A single writer goroutine serializes disk I/O.
	advisoryQueue chan Record
}

type walSnapshot struct {
	walPath          string
	checkpointOffset int64
	size             int64
}

// SetNotify registers a channel that receives a non-blocking signal after each
// successful Append. The channel should be buffered (capacity >= 1) so Append
// never blocks. Only one goroutine should consume from the channel.
func (w *WAL) SetNotify(ch chan struct{}) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.notify = ch
}

// New opens (or creates) the WAL file and reads the existing checkpoint.
func New(walPath, checkpointPath string) (*WAL, error) {
	for _, p := range []string{walPath, checkpointPath} {
		if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
			return nil, fmt.Errorf("wal: create directory for %s: %w", p, err)
		}
	}

	f, err := os.OpenFile(walPath, os.O_CREATE|os.O_RDWR|os.O_APPEND, 0o600)
	if err != nil {
		return nil, fmt.Errorf("wal: open %s: %w", walPath, err)
	}

	w := &WAL{
		file:           f,
		walPath:        walPath,
		checkpointPath: checkpointPath,
		advisoryQueue:  make(chan Record, advisoryRecordQueueSize),
	}

	if offset, err := w.readCheckpoint(); err == nil {
		w.checkpointOffset = offset
	}

	go w.runAdvisoryRecordWriter()

	return w, nil
}

// Append preserves the legacy usage-event append path.
func (w *WAL) Append(event Event) error {
	return w.AppendRecord(newUsageEventRecord(event))
}

// AppendRecord serialises a typed outbound record and writes it as a single line
// to the WAL. It syncs the file after each write to guarantee durability.
func (w *WAL) AppendRecord(record Record) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	data, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("wal: marshal record: %w", err)
	}
	data = append(data, '\n')

	if _, err := w.file.Write(data); err != nil {
		return fmt.Errorf("wal: write: %w", err)
	}
	if err := w.file.Sync(); err != nil {
		return fmt.Errorf("wal: sync: %w", err)
	}

	if w.notify != nil {
		select {
		case w.notify <- struct{}{}:
		default:
		}
	}

	return nil
}

// EnqueueAdvisoryRecord queues an advisory-only record for background WAL
// persistence. Returns false when the bounded queue is full.
func (w *WAL) EnqueueAdvisoryRecord(record Record) bool {
	if w == nil {
		return false
	}

	select {
	case w.advisoryQueue <- record:
		return true
	default:
		return false
	}
}

// UndeliveredRecords reads all records after the current checkpoint offset.
// The returned slice is ordered oldest-first.
func (w *WAL) UndeliveredRecords() ([]Record, error) {
	snapshot, err := w.snapshot()
	if err != nil {
		return nil, err
	}
	return readRecordsFromPathOffset(snapshot.walPath, snapshot.checkpointOffset)
}

// UndeliveredEvents preserves the legacy usage-event read path by filtering
// typed records down to usage_event payloads only.
func (w *WAL) UndeliveredEvents() ([]Event, error) {
	records, err := w.UndeliveredRecords()
	if err != nil {
		return nil, err
	}

	events := make([]Event, 0, len(records))
	for _, record := range records {
		usage, ok := decodeUsageEventRecord(record)
		if !ok {
			continue
		}
		events = append(events, usage.Event)
	}
	return events, nil
}

// MarkDelivered advances the checkpoint by the number of bytes consumed by the
// delivered records and persists the new offset to disk.
//
// count is the number of records that were successfully delivered. The byte
// count is recomputed by re-reading those records from the checkpoint position.
func (w *WAL) MarkDelivered(count int) error {
	if count == 0 {
		return nil
	}

	w.mu.Lock()
	defer w.mu.Unlock()

	if _, err := w.file.Seek(w.checkpointOffset, io.SeekStart); err != nil {
		return fmt.Errorf("wal: seek for mark: %w", err)
	}

	var bytesRead int64
	scanner := newRecordScanner(w.file)
	for i := 0; i < count && scanner.Scan(); i++ {
		bytesRead += int64(len(scanner.Bytes())) + 1
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("wal: scan for mark: %w", err)
	}

	w.checkpointOffset += bytesRead
	return w.writeCheckpoint(w.checkpointOffset)
}

// Compact rewrites the WAL, retaining only undelivered records and delivered
// records newer than retentionHours. It performs an atomic rename so the file is
// never in a partially-written state from the reader's perspective.
func (w *WAL) Compact(retentionHours int) error {
	cutoff := time.Now().UTC().Add(-time.Duration(retentionHours) * time.Hour)
	snapshot, err := w.snapshot()
	if err != nil {
		return err
	}

	type indexedRecord struct {
		raw       []byte
		offset    int64
		delivered bool
		record    Record
	}

	var (
		entries []indexedRecord
		offset  int64
	)
	file, err := os.Open(snapshot.walPath)
	if err != nil {
		return fmt.Errorf("wal: compact open snapshot: %w", err)
	}
	defer func() {
		_ = file.Close()
	}()

	scanner := newRecordScanner(io.LimitReader(file, snapshot.size))
	var (
		skippedCount int
		firstSkipped int64
		firstErr     string
	)
	for scanner.Scan() {
		raw := append([]byte(nil), scanner.Bytes()...)
		lineLen := int64(len(raw)) + 1
		record, err := decodeRecordLine(raw)
		if err != nil {
			if skippedCount == 0 {
				firstSkipped = offset
				firstErr = err.Error()
			}
			skippedCount++
			offset += lineLen
			continue
		}

		entries = append(entries, indexedRecord{
			raw:       raw,
			offset:    offset,
			delivered: offset < snapshot.checkpointOffset,
			record:    record,
		})
		offset += lineLen
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("wal: compact scan: %w", err)
	}
	logSkippedRecords(snapshot.walPath, skippedCount, firstSkipped, firstErr, "compact")

	tmpPath := snapshot.walPath + ".tmp"
	tmp, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("wal: compact create tmp: %w", err)
	}

	var newCheckpointOffset int64
	for _, entry := range entries {
		keep := !entry.delivered
		if entry.delivered {
			if recordedAt, ok := recordTimestamp(entry.record); ok && recordedAt.After(cutoff) {
				keep = true
			}
		}
		if !keep {
			continue
		}
		if entry.delivered {
			newCheckpointOffset += int64(len(entry.raw)) + 1
		}
		if _, err := tmp.Write(append(entry.raw, '\n')); err != nil {
			_ = tmp.Close()
			_ = os.Remove(tmpPath)
			return fmt.Errorf("wal: compact write: %w", err)
		}
	}

	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("wal: compact sync: %w", err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("wal: compact close tmp: %w", err)
	}
	w.mu.Lock()
	defer w.mu.Unlock()

	currentInfo, err := w.file.Stat()
	if err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("wal: compact stat current: %w", err)
	}
	if w.checkpointOffset != snapshot.checkpointOffset || currentInfo.Size() != snapshot.size {
		_ = os.Remove(tmpPath)
		return nil
	}

	if err := os.Rename(tmpPath, w.walPath); err != nil {
		return fmt.Errorf("wal: compact rename: %w", err)
	}

	newFile, err := os.OpenFile(w.walPath, os.O_RDWR|os.O_APPEND, 0o600)
	if err != nil {
		return fmt.Errorf("wal: compact reopen: %w", err)
	}
	_ = w.file.Close()
	w.file = newFile
	w.checkpointOffset = newCheckpointOffset

	return w.writeCheckpoint(w.checkpointOffset)
}

func (w *WAL) snapshot() (walSnapshot, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	info, err := w.file.Stat()
	if err != nil {
		return walSnapshot{}, fmt.Errorf("wal: stat: %w", err)
	}
	return walSnapshot{
		walPath:          w.walPath,
		checkpointOffset: w.checkpointOffset,
		size:             info.Size(),
	}, nil
}

func readRecordsFromPathOffset(walPath string, offset int64) ([]Record, error) {
	file, err := os.Open(walPath)
	if err != nil {
		return nil, fmt.Errorf("wal: open snapshot: %w", err)
	}
	defer func() {
		_ = file.Close()
	}()

	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return nil, fmt.Errorf("wal: seek to checkpoint: %w", err)
	}

	var records []Record
	scanner := newRecordScanner(file)
	var (
		skippedCount int
		firstSkipped int64
		firstErr     string
		lineOffset   = offset
	)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		lineLen := int64(len(scanner.Bytes())) + 1
		if line == "" {
			lineOffset += lineLen
			continue
		}
		record, err := decodeRecordLine([]byte(line))
		if err != nil {
			if skippedCount == 0 {
				firstSkipped = lineOffset
				firstErr = err.Error()
			}
			skippedCount++
			lineOffset += lineLen
			continue
		}
		records = append(records, record)
		lineOffset += lineLen
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("wal: scan: %w", err)
	}
	logSkippedRecords(walPath, skippedCount, firstSkipped, firstErr, "replay")
	return records, nil
}

func newUsageEventRecord(event Event) Record {
	payload, _ := json.Marshal(event)
	return Record{
		SchemaVersion: SchemaVersionV1,
		RecordType:    RecordTypeUsageEvent,
		RecordedAt:    event.RequestedAt,
		Payload:       payload,
	}
}

func newRecordScanner(r io.Reader) *bufio.Scanner {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), maxRecordLineBytes)
	return scanner
}

func decodeRecordLine(raw []byte) (Record, error) {
	var record Record
	if err := json.Unmarshal(raw, &record); err == nil && record.RecordType != "" {
		if record.SchemaVersion == 0 {
			record.SchemaVersion = SchemaVersionV1
		}
		if record.RecordedAt == "" {
			if ts, ok := recordTimestamp(record); ok {
				record.RecordedAt = ts.Format(time.RFC3339)
			}
		}
		return record, nil
	}

	var legacy Event
	if err := json.Unmarshal(raw, &legacy); err != nil {
		return Record{}, fmt.Errorf("invalid JSON record")
	}
	if legacy.Ecosystem == "" || legacy.Package == "" {
		return Record{}, fmt.Errorf("record missing required identity fields")
	}
	return newUsageEventRecord(legacy), nil
}

func decodeUsageEventRecord(record Record) (UsageEventRecord, bool) {
	if record.RecordType != RecordTypeUsageEvent {
		return UsageEventRecord{}, false
	}
	var event Event
	if err := json.Unmarshal(record.Payload, &event); err != nil {
		return UsageEventRecord{}, false
	}
	return UsageEventRecord{
		Record: record,
		Event:  event,
	}, true
}

// UsageEventFromRecord extracts a usage-event payload from a typed WAL record.
func UsageEventFromRecord(record Record) (Event, bool) {
	usage, ok := decodeUsageEventRecord(record)
	if !ok {
		return Event{}, false
	}
	return usage.Event, true
}

func recordTimestamp(record Record) (time.Time, bool) {
	if record.RecordedAt != "" {
		if t, err := time.Parse(time.RFC3339, record.RecordedAt); err == nil {
			return t, true
		}
	}

	usage, ok := decodeUsageEventRecord(record)
	if !ok {
		return time.Time{}, false
	}
	if usage.Event.RequestedAt == "" {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, usage.Event.RequestedAt)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

func (w *WAL) readCheckpoint() (int64, error) {
	data, err := os.ReadFile(w.checkpointPath)
	if err != nil {
		return 0, err
	}
	return strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
}

func (w *WAL) writeCheckpoint(offset int64) error {
	data := []byte(strconv.FormatInt(offset, 10) + "\n")
	tmpPath := w.checkpointPath + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0o600); err != nil {
		return fmt.Errorf("wal: write checkpoint tmp: %w", err)
	}
	if err := os.Rename(tmpPath, w.checkpointPath); err != nil {
		return fmt.Errorf("wal: rename checkpoint: %w", err)
	}
	return nil
}

func (w *WAL) runAdvisoryRecordWriter() {
	for record := range w.advisoryQueue {
		if err := w.AppendRecord(record); err != nil {
			slog.Error("WAL advisory record append failed",
				"service", "proxy",
				"record_type", record.RecordType,
				"error", err.Error(),
			)
		}
	}
}

func logSkippedRecords(path string, skippedCount int, firstOffset int64, firstErr string, operation string) {
	if skippedCount == 0 {
		return
	}

	slog.Warn("WAL skipped undecodable records",
		"service", "proxy",
		"operation", operation,
		"wal_path", path,
		"skipped_count", skippedCount,
		"first_offset", firstOffset,
		"first_error", firstErr,
	)
}
