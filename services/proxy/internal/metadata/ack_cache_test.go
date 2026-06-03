package metadata

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestAckCacheHitAndMiss(t *testing.T) {
	c := NewAckCache(5 * time.Minute)
	key := AckKey{Ecosystem: "npm", Package: "vite", Version: "7.1.0"}

	assert.False(t, c.IsAcked(key, "fp-1"))

	c.RecordAck(key, "fp-1")
	assert.True(t, c.IsAcked(key, "fp-1"))
	assert.False(t, c.IsAcked(key, "fp-2"))
}

func TestAckCacheIgnoresEmptyFingerprint(t *testing.T) {
	c := NewAckCache(5 * time.Minute)
	key := AckKey{Ecosystem: "npm", Package: "vite"}

	c.RecordAck(key, "")
	assert.False(t, c.IsAcked(key, ""))
	assert.False(t, c.IsAcked(key, "fp-1"))
}

func TestAckCacheExpiry(t *testing.T) {
	base := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	current := base
	now := func() time.Time { return current }
	c := newAckCacheWithClock(5*time.Minute, now)

	key := AckKey{Ecosystem: "pypi", Package: "requests", Version: "2.32.0"}
	c.RecordAck(key, "fp-1")
	assert.True(t, c.IsAcked(key, "fp-1"))

	current = current.Add(10 * time.Minute)
	assert.False(t, c.IsAcked(key, "fp-1"))
}

func TestAckCacheOverwritesFingerprint(t *testing.T) {
	c := NewAckCache(5 * time.Minute)
	key := AckKey{Ecosystem: "npm", Package: "vite", Version: "7.1.0"}

	c.RecordAck(key, "fp-1")
	c.RecordAck(key, "fp-2")

	assert.False(t, c.IsAcked(key, "fp-1"))
	assert.True(t, c.IsAcked(key, "fp-2"))
}
