package metadata

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/getcustoms/proxy/internal/wal"
)

// MetadataRPC is the subset of client.Client used by the foreground submitter.
// Defining it here keeps the metadata package free of a hard dependency on the
// concrete RPC client and makes the submitter trivially testable.
type MetadataRPC interface {
	RecordPackageLatestMetadata(ctx context.Context, msg wal.PackageLatestMetadata) error
	RecordPackageUsedVersionMetadata(ctx context.Context, msg wal.PackageUsedVersionMetadata) error
}

// Submitter performs foreground metadata RPCs with a bounded timeout and
// records control-plane acknowledgements so identical payloads are not
// resubmitted on subsequent requests.
type Submitter struct {
	rpc         MetadataRPC
	acks        *AckCache
	waitTimeout time.Duration
}

// NewSubmitter wires a foreground metadata submitter. waitTimeout bounds each
// individual RPC; a non-positive value disables the timeout (caller context
// still applies).
func NewSubmitter(rpc MetadataRPC, acks *AckCache, waitTimeout time.Duration) *Submitter {
	return &Submitter{rpc: rpc, acks: acks, waitTimeout: waitTimeout}
}

// SubmitLatest submits a package-latest metadata record. Returns nil and skips
// the RPC when the same fingerprint was acknowledged recently.
func (s *Submitter) SubmitLatest(ctx context.Context, msg wal.PackageLatestMetadata) error {
	if msg.Ecosystem == "" || msg.Package == "" {
		return errors.New("metadata: ecosystem and package are required")
	}
	key := AckKey{Ecosystem: msg.Ecosystem, Package: msg.Package}
	fingerprint := fingerprintLatest(msg)
	if s.acks.IsAcked(key, fingerprint) {
		return nil
	}

	callCtx, cancel := s.boundedContext(ctx)
	defer cancel()

	if err := s.rpc.RecordPackageLatestMetadata(callCtx, msg); err != nil {
		return fmt.Errorf("metadata: submit latest: %w", err)
	}
	s.acks.RecordAck(key, fingerprint)
	return nil
}

// SubmitUsedVersion submits a package-used-version metadata record. Returns
// nil and skips the RPC when the same fingerprint was acknowledged recently.
func (s *Submitter) SubmitUsedVersion(ctx context.Context, msg wal.PackageUsedVersionMetadata) error {
	if msg.Ecosystem == "" || msg.Package == "" || msg.UsedVersion == "" {
		return errors.New("metadata: ecosystem, package, and used_version are required")
	}
	key := AckKey{Ecosystem: msg.Ecosystem, Package: msg.Package, Version: msg.UsedVersion}
	fingerprint := fingerprintUsedVersion(msg)
	if s.acks.IsAcked(key, fingerprint) {
		return nil
	}

	callCtx, cancel := s.boundedContext(ctx)
	defer cancel()

	if err := s.rpc.RecordPackageUsedVersionMetadata(callCtx, msg); err != nil {
		return fmt.Errorf("metadata: submit used version: %w", err)
	}
	s.acks.RecordAck(key, fingerprint)
	return nil
}

func (s *Submitter) boundedContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if s.waitTimeout <= 0 {
		return context.WithCancel(ctx)
	}
	return context.WithTimeout(ctx, s.waitTimeout)
}

func fingerprintLatest(msg wal.PackageLatestMetadata) string {
	return fingerprintFields(
		msg.Ecosystem,
		msg.Package,
		msg.LatestVersion,
		msg.LatestPublishedAt,
	)
}

func fingerprintUsedVersion(msg wal.PackageUsedVersionMetadata) string {
	return fingerprintFields(
		msg.Ecosystem,
		msg.Package,
		msg.UsedVersion,
		msg.UsedVersionPublishedAt,
		msg.LatestVersion,
		msg.LatestPublishedAt,
	)
}

func fingerprintFields(parts ...string) string {
	h := sha256.Sum256([]byte(strings.Join(parts, "\x1f")))
	return hex.EncodeToString(h[:16])
}
