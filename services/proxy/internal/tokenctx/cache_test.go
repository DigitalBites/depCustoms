package tokenctx

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

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
	c := New(5 * time.Minute)
	now := time.Now()
	c.now = func() time.Time { return now }
	c.store["hash-1"] = Entry{
		TenantID:  "tenant-1",
		ProjectID: "project-1",
		CachedAt:  now.Add(-10 * time.Minute),
	}

	entry, ok := c.Get("hash-1")
	assert.False(t, ok)
	assert.Equal(t, Entry{}, entry)
}

func TestIsExpired(t *testing.T) {
	c := New(5 * time.Minute)
	now := time.Now()
	c.now = func() time.Time { return now }

	assert.False(t, c.isExpired(Entry{CachedAt: now.Add(-4 * time.Minute)}))
	assert.True(t, c.isExpired(Entry{CachedAt: now.Add(-6 * time.Minute)}))
}
