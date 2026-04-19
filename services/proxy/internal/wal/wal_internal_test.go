package wal

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEnqueueAdvisoryRecord_AppendsInBackground(t *testing.T) {
	dir := t.TempDir()
	w, err := New(filepath.Join(dir, "events.ndjson"), filepath.Join(dir, "events.checkpoint"))
	require.NoError(t, err)

	record := Record{
		SchemaVersion: SchemaVersionV1,
		RecordType:    RecordTypePackageLatestMetadata,
		RecordedAt:    "2026-01-01T00:00:00Z",
		Payload:       json.RawMessage(`{"ecosystem":"npm","package":"left-pad"}`),
	}

	require.True(t, w.EnqueueAdvisoryRecord(record))

	require.Eventually(t, func() bool {
		records, err := w.UndeliveredRecords()
		if err != nil || len(records) != 1 {
			return false
		}
		return records[0].RecordType == RecordTypePackageLatestMetadata
	}, 2*time.Second, 20*time.Millisecond)
}

func TestEnqueueAdvisoryRecord_NilWALReturnsFalse(t *testing.T) {
	var w *WAL
	assert.False(t, w.EnqueueAdvisoryRecord(Record{}))
}

func TestUsageEventFromRecord(t *testing.T) {
	record := newUsageEventRecord(Event{
		Ecosystem:        "npm",
		Package:          "lodash",
		Version:          "4.17.21",
		Decision:         "DECISION_ALLOW",
		EventType:        "artifact",
		RequestedAt:      "2026-01-01T00:00:00Z",
		ProjectTokenHash: "hash",
	})

	event, ok := UsageEventFromRecord(record)
	assert.True(t, ok)
	assert.Equal(t, "lodash", event.Package)

	_, ok = UsageEventFromRecord(Record{RecordType: RecordTypePackageLatestMetadata})
	assert.False(t, ok)
}

func TestRecordTimestamp(t *testing.T) {
	recordedAt := "2026-01-03T00:00:00Z"
	record := Record{
		SchemaVersion: SchemaVersionV1,
		RecordType:    RecordTypePackageLatestMetadata,
		RecordedAt:    recordedAt,
		Payload:       json.RawMessage(`{"ecosystem":"npm","package":"left-pad"}`),
	}

	ts, ok := recordTimestamp(record)
	require.True(t, ok)
	assert.Equal(t, recordedAt, ts.UTC().Format(time.RFC3339))

	usageRecord := newUsageEventRecord(Event{
		Ecosystem:        "npm",
		Package:          "lodash",
		Version:          "4.17.21",
		Decision:         "DECISION_ALLOW",
		EventType:        "artifact",
		RequestedAt:      "2026-01-04T00:00:00Z",
		ProjectTokenHash: "hash",
	})
	usageRecord.RecordedAt = ""

	ts, ok = recordTimestamp(usageRecord)
	require.True(t, ok)
	assert.Equal(t, "2026-01-04T00:00:00Z", ts.UTC().Format(time.RFC3339))

	_, ok = recordTimestamp(Record{RecordType: RecordTypePackageLatestMetadata, RecordedAt: "not-a-time"})
	assert.False(t, ok)
}

func TestDecodeRecordLine_LegacyAndInvalidCases(t *testing.T) {
	legacyRaw := []byte(`{"ecosystem":"npm","package":"lodash","version":"4.17.21","decision":"allow","event_type":"artifact","requested_at":"2026-01-01T00:00:00Z","project_token_hash":"hash"}`)
	record, err := decodeRecordLine(legacyRaw)
	require.NoError(t, err)
	assert.Equal(t, RecordTypeUsageEvent, record.RecordType)
	assert.Equal(t, SchemaVersionV1, record.SchemaVersion)

	missingFieldsRaw := []byte(`{"ecosystem":"npm"}`)
	_, err = decodeRecordLine(missingFieldsRaw)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "record missing required identity fields")

	_, err = decodeRecordLine([]byte(`not-json`))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid JSON record")
}

func TestWriteCheckpointReturnsErrorWhenParentIsInvalid(t *testing.T) {
	dir := t.TempDir()
	blocker := filepath.Join(dir, "blocker")
	require.NoError(t, os.WriteFile(blocker, []byte("x"), 0o600))

	w := &WAL{checkpointPath: filepath.Join(blocker, "events.checkpoint")}

	err := w.writeCheckpoint(12)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "write checkpoint tmp")
}

func TestDecodeRecordLine_FillsRecordedAtFromPayloadTimestamp(t *testing.T) {
	raw := []byte(`{"schema_version":1,"record_type":"usage_event","payload":{"ecosystem":"npm","package":"lodash","version":"4.17.21","decision":"allow","event_type":"artifact","requested_at":"2026-01-01T00:00:00Z","project_token_hash":"hash"}}`)

	record, err := decodeRecordLine(raw)
	require.NoError(t, err)
	assert.Equal(t, "2026-01-01T00:00:00Z", record.RecordedAt)
}

func TestRunAdvisoryRecordWriter_LogsAppendFailure(t *testing.T) {
	var logBuf bytes.Buffer
	prev := slog.Default()
	logger := slog.New(slog.NewTextHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelError}))
	slog.SetDefault(logger)
	defer slog.SetDefault(prev)

	dir := t.TempDir()
	w, err := New(filepath.Join(dir, "events.ndjson"), filepath.Join(dir, "events.checkpoint"))
	require.NoError(t, err)
	require.NoError(t, w.file.Close())

	record := Record{
		SchemaVersion: SchemaVersionV1,
		RecordType:    RecordTypePackageLatestMetadata,
		RecordedAt:    "2026-01-01T00:00:00Z",
		Payload:       json.RawMessage(`{"ecosystem":"npm","package":"left-pad"}`),
	}

	require.True(t, w.EnqueueAdvisoryRecord(record))
	require.Eventually(t, func() bool {
		return strings.Contains(logBuf.String(), "WAL advisory record append failed")
	}, 2*time.Second, 20*time.Millisecond)
}
