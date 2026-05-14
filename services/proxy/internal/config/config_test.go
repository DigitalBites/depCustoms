package config_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/getcustoms/proxy/internal/config"
)

func setEnv(t *testing.T, pairs ...string) {
	t.Helper()
	for i := 0; i < len(pairs)-1; i += 2 {
		t.Setenv(pairs[i], pairs[i+1])
	}
}

func validEnv(t *testing.T) {
	t.Helper()
	setEnv(t,
		"PROXY_ID", "test-proxy-id",
		"PROXY_CONTROL_PLANE_URL", "http://localhost:9090",
		"PROXY_CONTROL_PLANE_SECRET", "cxp_abc123",
		"PROXY_PUBLIC_BASE_URL", "https://proxy.example.com",
	)
}

func TestRequiredFieldsMissing(t *testing.T) {
	// Unset all env vars by setting them to empty so Load detects them as missing
	t.Setenv("PROXY_ID", "")
	t.Setenv("PROXY_CONTROL_PLANE_URL", "")
	t.Setenv("PROXY_CONTROL_PLANE_SECRET", "")

	_, err := config.Load()
	require.Error(t, err)

	errMsg := err.Error()
	assert.Contains(t, errMsg, "PROXY_ID")
	assert.Contains(t, errMsg, "PROXY_CONTROL_PLANE_URL")
	assert.Contains(t, errMsg, "PROXY_CONTROL_PLANE_SECRET")
}

func TestDefaultValues(t *testing.T) {
	validEnv(t)

	cfg, err := config.Load()
	require.NoError(t, err)

	assert.Equal(t, 8080, cfg.Port)
	assert.Equal(t, 32<<20, cfg.PackageMetadataMaxBytes)
	assert.Equal(t, 32<<20, cfg.NPMMetadataMaxBytes)
	assert.Equal(t, 5<<20, cfg.NPMAuditMaxBodyBytes)
	assert.Equal(t, 32<<20, cfg.PyPIMetadataMaxBytes)
	assert.Equal(t, 300, cfg.CacheTTLSeconds)
	assert.Equal(t, 900, cfg.TokenContextCacheTTLSeconds)
	assert.Equal(t, 300, cfg.PackageMetadataCacheTTLSeconds)
	assert.Equal(t, 300, cfg.PackageMetadataSignalDedupeTTLSeconds)
	assert.Equal(t, 60, cfg.MetadataCacheStatsReportIntervalSeconds)
	assert.Equal(t, 10, cfg.FlushIntervalSeconds)
	assert.Equal(t, 100, cfg.FlushMaxEvents)
	assert.Equal(t, 48, cfg.EventRetentionHours)
	assert.Equal(t, false, cfg.RedactClientIP)
	assert.Equal(t, "info", cfg.LogLevel)
}

func TestContributorEnvUsesPrefixedNames(t *testing.T) {
	validEnv(t)
	t.Setenv("PROXY_CONNECTOR_CONTRIBUTOR_ENABLED", "false")
	t.Setenv("PROXY_CONNECTOR_CONTRIBUTOR_PREFETCH_WINDOW_DAYS", "45")

	cfg, err := config.Load()
	require.NoError(t, err)

	assert.False(t, cfg.ContributorEnabled)
	assert.Equal(t, 45, cfg.ContributorPrefetchWindowDays)
}

func TestContributorEnvLegacyNamesAreIgnored(t *testing.T) {
	validEnv(t)
	t.Setenv("CONNECTOR_CONTRIBUTOR_ENABLED", "false")
	t.Setenv("CONNECTOR_CONTRIBUTOR_PREFETCH_WINDOW_DAYS", "30")

	cfg, err := config.Load()
	require.NoError(t, err)

	assert.True(t, cfg.ContributorEnabled)
	assert.Equal(t, 90, cfg.ContributorPrefetchWindowDays)
}

func TestRedactClientIPParsing(t *testing.T) {
	validEnv(t)

	t.Run("true enables redaction", func(t *testing.T) {
		t.Setenv("PROXY_REDACT_CLIENT_IP", "true")
		cfg, err := config.Load()
		require.NoError(t, err)
		assert.True(t, cfg.RedactClientIP)
	})

	t.Run("false disables redaction", func(t *testing.T) {
		t.Setenv("PROXY_REDACT_CLIENT_IP", "false")
		cfg, err := config.Load()
		require.NoError(t, err)
		assert.False(t, cfg.RedactClientIP)
	})

	t.Run("1 is not treated as true", func(t *testing.T) {
		t.Setenv("PROXY_REDACT_CLIENT_IP", "1")
		cfg, err := config.Load()
		require.NoError(t, err)
		assert.False(t, cfg.RedactClientIP)
	})
}

func TestProxyIDPopulated(t *testing.T) {
	validEnv(t)
	cfg, err := config.Load()
	require.NoError(t, err)
	assert.Equal(t, "test-proxy-id", cfg.ProxyID)
}

func TestControlPlaneURLPopulated(t *testing.T) {
	validEnv(t)
	cfg, err := config.Load()
	require.NoError(t, err)
	assert.Equal(t, "http://localhost:9090", cfg.ControlPlaneURL)
}

func TestPublicBaseURLNormalized(t *testing.T) {
	validEnv(t)
	t.Setenv("PROXY_PUBLIC_BASE_URL", "https://proxy.example.com/")

	cfg, err := config.Load()
	require.NoError(t, err)
	assert.Equal(t, "https://proxy.example.com", cfg.PublicBaseURL)
}

func TestPublicBaseURLOptional(t *testing.T) {
	validEnv(t)
	t.Setenv("PROXY_PUBLIC_BASE_URL", "")

	cfg, err := config.Load()
	require.NoError(t, err)
	assert.Equal(t, "", cfg.PublicBaseURL)
}

func TestAllowedPublicBaseURLsNormalized(t *testing.T) {
	validEnv(t)
	t.Setenv(
		"PROXY_ALLOWED_PUBLIC_BASE_URLS",
		"https://proxy.example.com/,https://Packages.EXAMPLE.test:8442/,https://proxy.example.com/",
	)

	cfg, err := config.Load()
	require.NoError(t, err)
	assert.Equal(t, []string{
		"https://proxy.example.com",
		"https://packages.example.test:8442",
	}, cfg.AllowedPublicBaseURLs)
}

func TestAllowedPublicBaseURLsInvalid(t *testing.T) {
	validEnv(t)
	t.Setenv("PROXY_ALLOWED_PUBLIC_BASE_URLS", "javascript://bad")

	_, err := config.Load()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "PROXY_ALLOWED_PUBLIC_BASE_URLS")
}

func TestTrustedProxyCIDRsParsing(t *testing.T) {
	validEnv(t)
	t.Setenv("PROXY_TRUSTED_PROXY_CIDRS", "127.0.0.1/32, 10.0.0.0/8")

	cfg, err := config.Load()
	require.NoError(t, err)
	assert.Equal(t, []string{"127.0.0.1/32", "10.0.0.0/8"}, cfg.TrustedProxyCIDRs)
	require.Len(t, cfg.TrustedProxyNets, 2)
}

func TestTrustedProxyCIDRsInvalid(t *testing.T) {
	validEnv(t)
	t.Setenv("PROXY_TRUSTED_PROXY_CIDRS", "not-a-cidr")

	_, err := config.Load()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "PROXY_TRUSTED_PROXY_CIDRS")
}

func TestNumericConfigInvalidFailsFast(t *testing.T) {
	validEnv(t)
	t.Setenv("PROXY_FLUSH_INTERVAL_SECONDS", "not-a-number")

	_, err := config.Load()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "PROXY_FLUSH_INTERVAL_SECONDS")
}

func TestNumericConfigOutOfRangeFailsFast(t *testing.T) {
	validEnv(t)
	t.Setenv("PROXY_FLUSH_MAX_EVENTS", "0")

	_, err := config.Load()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "PROXY_FLUSH_MAX_EVENTS")
}

func TestMetadataTTLConfigOutOfRangeFailsFast(t *testing.T) {
	validEnv(t)
	t.Setenv("PROXY_PACKAGE_METADATA_CACHE_TTL_SECONDS", "0")
	t.Setenv("PROXY_TOKEN_CONTEXT_CACHE_TTL_SECONDS", "-1")
	t.Setenv("PROXY_PACKAGE_METADATA_SIGNAL_DEDUPE_TTL_SECONDS", "-1")
	t.Setenv("PROXY_METADATA_CACHE_STATS_REPORT_INTERVAL_SECONDS", "0")

	_, err := config.Load()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "PROXY_PACKAGE_METADATA_CACHE_TTL_SECONDS")
	assert.Contains(t, err.Error(), "PROXY_TOKEN_CONTEXT_CACHE_TTL_SECONDS")
	assert.Contains(t, err.Error(), "PROXY_PACKAGE_METADATA_SIGNAL_DEDUPE_TTL_SECONDS")
	assert.Contains(t, err.Error(), "PROXY_METADATA_CACHE_STATS_REPORT_INTERVAL_SECONDS")
}

func TestMetadataLimitsOutOfRangeFailFast(t *testing.T) {
	validEnv(t)
	t.Setenv("PROXY_PACKAGE_METADATA_MAX_BYTES", "0")
	t.Setenv("PROXY_NPM_AUDIT_MAX_BODY_BYTES", "-1")

	_, err := config.Load()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "PROXY_PACKAGE_METADATA_MAX_BYTES")
	assert.Contains(t, err.Error(), "PROXY_NPM_AUDIT_MAX_BODY_BYTES")
}

func TestLegacyNPMMetadataLimitAppliesToAllPackageMetadata(t *testing.T) {
	validEnv(t)
	t.Setenv("PROXY_NPM_METADATA_MAX_BYTES", "1048576")

	cfg, err := config.Load()
	require.NoError(t, err)

	assert.Equal(t, 1048576, cfg.PackageMetadataMaxBytes)
	assert.Equal(t, 1048576, cfg.NPMMetadataMaxBytes)
	assert.Equal(t, 1048576, cfg.PyPIMetadataMaxBytes)
}
