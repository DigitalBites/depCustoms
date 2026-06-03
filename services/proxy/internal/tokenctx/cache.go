package tokenctx

import (
	"time"

	"github.com/getcustoms/proxy/internal/proxycache"
)

type Entry struct {
	TenantID  string
	ProjectID string
	CachedAt  time.Time
}

type Cache struct {
	inner *proxycache.Cache[string, Entry]
	now   func() time.Time
}

func New(ttl time.Duration) *Cache {
	return newWithClock(ttl, time.Now)
}

// newWithClock is the testing seam — production callers go through New.
func newWithClock(ttl time.Duration, now func() time.Time) *Cache {
	return &Cache{
		inner: proxycache.New[string, Entry](
			proxycache.WithStaticTTL[string, Entry](ttl),
			proxycache.WithClock[string, Entry](now),
		),
		now: now,
	}
}

func (c *Cache) Get(projectTokenHash string) (Entry, bool) {
	return c.inner.Get(projectTokenHash)
}

func (c *Cache) Set(projectTokenHash, tenantID, projectID string) {
	if projectTokenHash == "" || tenantID == "" {
		return
	}
	c.inner.Set(projectTokenHash, Entry{
		TenantID:  tenantID,
		ProjectID: projectID,
		CachedAt:  c.now(),
	})
}
