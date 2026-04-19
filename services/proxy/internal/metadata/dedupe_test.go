package metadata

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestSignalDedupeSuppressesRepeatedFingerprintWithinTTL(t *testing.T) {
	d := NewSignalDedupe(5 * time.Minute)
	base := time.Date(2026, 4, 8, 22, 0, 0, 0, time.UTC)
	d.now = func() time.Time { return base }

	assert.True(t, d.ShouldEmit("npm|lodash|latest|4.17.21"))
	assert.False(t, d.ShouldEmit("npm|lodash|latest|4.17.21"))

	base = base.Add(6 * time.Minute)
	assert.True(t, d.ShouldEmit("npm|lodash|latest|4.17.21"))
}
