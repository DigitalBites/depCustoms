package tokenctx

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

// clock returns a (now, advance) pair that the tests use in place of the
// real wall clock so TTL behavior is deterministic.
func clock(base time.Time) (func() time.Time, func(time.Duration)) {
	var mu sync.Mutex
	current := base
	return func() time.Time {
			mu.Lock()
			defer mu.Unlock()
			return current
		}, func(d time.Duration) {
			mu.Lock()
			current = current.Add(d)
			mu.Unlock()
		}
}

func TestSetAndGet(t *testing.T) {
	c := New(5 * time.Minute)

	c.Set("hash-1", "tenant-1", "project-1")

	entry, ok := c.Get("hash-1")
	assert.True(t, ok)
	assert.Equal(t, "tenant-1", entry.TenantID)
	assert.Equal(t, "project-1", entry.ProjectID)
	assert.False(t, entry.CachedAt.IsZero())
}

func TestSetRejectsIncompleteIdentity(t *testing.T) {
	c := New(5 * time.Minute)

	c.Set("", "tenant-1", "project-1")
	c.Set("hash-1", "", "project-1")

	_, ok := c.Get("hash-1")
	assert.False(t, ok)
}

func TestGetExpiredEntryReturnsMiss(t *testing.T) {
	now, advance := clock(time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
	c := newWithClock(5*time.Minute, now)

	c.Set("hash-1", "tenant-1", "project-1")
	advance(10 * time.Minute)

	entry, ok := c.Get("hash-1")
	assert.False(t, ok)
	assert.Equal(t, Entry{}, entry)
}

func TestMaxEntriesEvictsOldest(t *testing.T) {
	now, advance := clock(time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC))
	c := newWithClock(5*time.Minute, now)
	c.Set("oldest", "tenant-1", "project-1")

	advance(time.Minute)
	for i := range 1000 {
		c.Set(string(rune(i+1000)), "tenant-1", "project-1")
	}

	_, ok := c.Get("oldest")
	assert.False(t, ok)
}
