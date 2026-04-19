package tokenctx

import (
	"sync"
	"time"
)

type Entry struct {
	TenantID  string
	ProjectID string
	CachedAt  time.Time
}

type Cache struct {
	mu    sync.RWMutex
	ttl   time.Duration
	store map[string]Entry
	now   func() time.Time
}

func New(ttl time.Duration) *Cache {
	c := &Cache{
		ttl:   ttl,
		store: make(map[string]Entry),
		now:   time.Now,
	}
	go c.evictLoop()
	return c
}

func (c *Cache) Get(projectTokenHash string) (Entry, bool) {
	c.mu.RLock()
	entry, ok := c.store[projectTokenHash]
	c.mu.RUnlock()
	if !ok || c.isExpired(entry) {
		return Entry{}, false
	}
	return entry, true
}

func (c *Cache) Set(projectTokenHash, tenantID, projectID string) {
	if projectTokenHash == "" || tenantID == "" {
		return
	}
	c.mu.Lock()
	c.store[projectTokenHash] = Entry{
		TenantID:  tenantID,
		ProjectID: projectID,
		CachedAt:  c.now(),
	}
	c.mu.Unlock()
}

func (c *Cache) isExpired(entry Entry) bool {
	return c.now().Sub(entry.CachedAt) > c.ttl
}

func (c *Cache) evictLoop() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		c.mu.Lock()
		for key, entry := range c.store {
			if c.isExpired(entry) {
				delete(c.store, key)
			}
		}
		c.mu.Unlock()
	}
}
