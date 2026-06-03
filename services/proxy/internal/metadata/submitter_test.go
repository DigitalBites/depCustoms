package metadata

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/getcustoms/proxy/internal/wal"
)

type fakeRPC struct {
	mu                sync.Mutex
	latestCalls       int
	usedVersionCalls  int
	latestErr         error
	usedVersionErr    error
	lastLatest        wal.PackageLatestMetadata
	lastUsedVersion   wal.PackageUsedVersionMetadata
	observeCtxDeadline bool
	seenDeadline      time.Time
	hadDeadline       bool
}

func (f *fakeRPC) RecordPackageLatestMetadata(ctx context.Context, msg wal.PackageLatestMetadata) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.latestCalls++
	f.lastLatest = msg
	if f.observeCtxDeadline {
		f.seenDeadline, f.hadDeadline = ctx.Deadline()
	}
	return f.latestErr
}

func (f *fakeRPC) RecordPackageUsedVersionMetadata(ctx context.Context, msg wal.PackageUsedVersionMetadata) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.usedVersionCalls++
	f.lastUsedVersion = msg
	if f.observeCtxDeadline {
		f.seenDeadline, f.hadDeadline = ctx.Deadline()
	}
	return f.usedVersionErr
}

func newSubmitterForTest(rpc MetadataRPC, timeout time.Duration) (*Submitter, *AckCache) {
	acks := NewAckCache(5 * time.Minute)
	return NewSubmitter(rpc, acks, timeout), acks
}

func TestSubmitterSubmitsAndRecordsAck(t *testing.T) {
	rpc := &fakeRPC{}
	sub, acks := newSubmitterForTest(rpc, 100*time.Millisecond)

	msg := wal.PackageUsedVersionMetadata{
		Ecosystem:              "npm",
		Package:                "vite",
		UsedVersion:            "7.1.0",
		UsedVersionPublishedAt: "2026-05-01T00:00:00Z",
	}
	require.NoError(t, sub.SubmitUsedVersion(context.Background(), msg))

	assert.Equal(t, 1, rpc.usedVersionCalls)
	assert.True(t, acks.IsAcked(
		AckKey{Ecosystem: "npm", Package: "vite", Version: "7.1.0"},
		fingerprintUsedVersion(msg),
	))
}

func TestSubmitterSkipsAlreadyAcked(t *testing.T) {
	rpc := &fakeRPC{}
	sub, _ := newSubmitterForTest(rpc, 100*time.Millisecond)

	msg := wal.PackageLatestMetadata{
		Ecosystem:         "pypi",
		Package:           "requests",
		LatestVersion:     "2.32.0",
		LatestPublishedAt: "2026-04-01T00:00:00Z",
	}
	require.NoError(t, sub.SubmitLatest(context.Background(), msg))
	require.NoError(t, sub.SubmitLatest(context.Background(), msg))

	assert.Equal(t, 1, rpc.latestCalls)
}

func TestSubmitterResubmitsOnFingerprintChange(t *testing.T) {
	rpc := &fakeRPC{}
	sub, _ := newSubmitterForTest(rpc, 100*time.Millisecond)

	msg := wal.PackageLatestMetadata{Ecosystem: "npm", Package: "vite", LatestVersion: "7.1.0"}
	require.NoError(t, sub.SubmitLatest(context.Background(), msg))

	msg.LatestVersion = "7.1.1"
	require.NoError(t, sub.SubmitLatest(context.Background(), msg))

	assert.Equal(t, 2, rpc.latestCalls)
}

func TestSubmitterReturnsErrorOnRPCFailure(t *testing.T) {
	rpcErr := errors.New("boom")
	rpc := &fakeRPC{usedVersionErr: rpcErr}
	sub, acks := newSubmitterForTest(rpc, 100*time.Millisecond)

	msg := wal.PackageUsedVersionMetadata{Ecosystem: "npm", Package: "vite", UsedVersion: "7.1.0"}
	err := sub.SubmitUsedVersion(context.Background(), msg)
	require.Error(t, err)
	assert.ErrorIs(t, err, rpcErr)

	assert.False(t, acks.IsAcked(
		AckKey{Ecosystem: "npm", Package: "vite", Version: "7.1.0"},
		fingerprintUsedVersion(msg),
	))
}

func TestSubmitterAppliesTimeout(t *testing.T) {
	rpc := &fakeRPC{observeCtxDeadline: true}
	sub, _ := newSubmitterForTest(rpc, 50*time.Millisecond)

	msg := wal.PackageLatestMetadata{Ecosystem: "npm", Package: "vite", LatestVersion: "7.1.0"}
	require.NoError(t, sub.SubmitLatest(context.Background(), msg))

	assert.True(t, rpc.hadDeadline)
	assert.WithinDuration(t, time.Now().Add(50*time.Millisecond), rpc.seenDeadline, 100*time.Millisecond)
}

func TestSubmitterRejectsIncompletePayload(t *testing.T) {
	rpc := &fakeRPC{}
	sub, _ := newSubmitterForTest(rpc, 100*time.Millisecond)

	err := sub.SubmitUsedVersion(context.Background(), wal.PackageUsedVersionMetadata{
		Ecosystem: "npm", Package: "vite",
	})
	require.Error(t, err)
	assert.Equal(t, 0, rpc.usedVersionCalls)
}
