// Package bounded contains small helpers for fixed-size in-memory maps.
package bounded

import "time"

const DefaultMaxEntries = 1000

// EnforceMaxEntries removes expired entries first, then removes oldest entries
// until store has at most max entries. The caller must hold any required lock.
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
