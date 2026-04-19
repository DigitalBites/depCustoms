package metadata

import (
	"sync"
	"time"
)

// CacheStatsWindow is an aggregate reporting window for one ecosystem.
type CacheStatsWindow struct {
	Ecosystem     string
	Hits          int64
	Misses        int64
	StaleHits     int64
	Refreshes     int64
	ParseFailures int64
	StoreFailures int64
	WindowStarted time.Time
	WindowEnded   time.Time
}

type cacheStatCounters struct {
	hits          int64
	misses        int64
	staleHits     int64
	refreshes     int64
	parseFailures int64
	storeFailures int64
}

// StatsCollector tracks aggregate metadata-cache telemetry by ecosystem.
type StatsCollector struct {
	mu            sync.Mutex
	windowStarted time.Time
	now           func() time.Time
	counters      map[string]*cacheStatCounters
}

func newStatsCollector() *StatsCollector {
	return &StatsCollector{
		windowStarted: time.Now(),
		now:           time.Now,
		counters:      make(map[string]*cacheStatCounters),
	}
}

func (s *StatsCollector) counter(ecosystem string) *cacheStatCounters {
	current, ok := s.counters[ecosystem]
	if ok {
		return current
	}
	current = &cacheStatCounters{}
	s.counters[ecosystem] = current
	return current
}

func (s *StatsCollector) RecordLookup(ecosystem string, state LookupState) {
	s.mu.Lock()
	defer s.mu.Unlock()

	current := s.counter(ecosystem)
	switch state {
	case LookupStateHit:
		current.hits++
	case LookupStateMiss:
		current.misses++
	case LookupStateStale:
		current.staleHits++
	}
}

func (s *StatsCollector) RecordRefresh(ecosystem string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.counter(ecosystem).refreshes++
}

func (s *StatsCollector) RecordParseFailure(ecosystem string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.counter(ecosystem).parseFailures++
}

func (s *StatsCollector) RecordStoreFailure(ecosystem string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.counter(ecosystem).storeFailures++
}

func (s *StatsCollector) SnapshotAndReset() []CacheStatsWindow {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.now()
	started := s.windowStarted
	windows := make([]CacheStatsWindow, 0, len(s.counters))
	for ecosystem, counts := range s.counters {
		if counts.hits == 0 &&
			counts.misses == 0 &&
			counts.staleHits == 0 &&
			counts.refreshes == 0 &&
			counts.parseFailures == 0 &&
			counts.storeFailures == 0 {
			continue
		}
		windows = append(windows, CacheStatsWindow{
			Ecosystem:     ecosystem,
			Hits:          counts.hits,
			Misses:        counts.misses,
			StaleHits:     counts.staleHits,
			Refreshes:     counts.refreshes,
			ParseFailures: counts.parseFailures,
			StoreFailures: counts.storeFailures,
			WindowStarted: started,
			WindowEnded:   now,
		})
	}

	s.counters = make(map[string]*cacheStatCounters)
	s.windowStarted = now
	return windows
}

func (s *StatsCollector) Restore(windows []CacheStatsWindow) {
	if len(windows) == 0 {
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for _, window := range windows {
		current := s.counter(window.Ecosystem)
		current.hits += window.Hits
		current.misses += window.Misses
		current.staleHits += window.StaleHits
		current.refreshes += window.Refreshes
		current.parseFailures += window.ParseFailures
		current.storeFailures += window.StoreFailures

		if s.windowStarted.IsZero() || window.WindowStarted.Before(s.windowStarted) {
			s.windowStarted = window.WindowStarted
		}
	}
}
