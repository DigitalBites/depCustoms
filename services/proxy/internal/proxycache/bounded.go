package proxycache

import "time"

// DefaultMaxEntries is the bounded-cache default used by every proxy cache
// today. Callers override via WithMaxEntries.
const DefaultMaxEntries = 1000

// EnforceMaxEntries removes expired entries first, then removes oldest entries
// until store has at most max entries. The caller must hold any required lock.
//
// Exposed as a public helper so callers that own their own map (e.g. the
// contributor cache, which has disk-backed persistence) can apply the same
// eviction policy as the shared Cache type.
func EnforceMaxEntries[K comparable, V any](
	store map[K]V,
	max int,
	isExpired func(V) bool,
	timestamp func(V) time.Time,
) {
	if max <= 0 {
		clear(store)
		return
	}

	for len(store) > max {
		var oldestKey K
		var oldestAt time.Time
		first := true

		for key, value := range store {
			if isExpired(value) {
				delete(store, key)
				continue
			}
			at := timestamp(value)
			if first || at.Before(oldestAt) {
				oldestKey = key
				oldestAt = at
				first = false
			}
		}

		if len(store) <= max || first {
			return
		}
		delete(store, oldestKey)
	}
}
