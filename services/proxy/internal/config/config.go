// Package config loads and validates proxy configuration from environment variables.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// Config holds all runtime configuration for the proxy.
type Config struct {
	// General
	LogLevel string

	// Server
	Port                  int
	PublicBaseURL         string
	AllowedPublicBaseURLs []string
	NPMMetadataMaxBytes   int
	NPMAuditMaxBodyBytes  int
	PyPIMetadataMaxBytes  int

	// Identity
	ProxyID string

	// Control plane
	ControlPlaneURL    string
	ControlPlaneSecret string

	// Privacy
	// RedactClientIP masks the last octet of IPv4 / last 64 bits of IPv6
	// before storing client IPs. Useful for GDPR compliance in SaaS deployments.
	RedactClientIP    bool
	TrustedProxyCIDRs []string
	TrustedProxyNets  []netip.Prefix

	// Cache
	CacheTTLSeconds                         int
	TokenContextCacheTTLSeconds             int
	PackageMetadataCacheTTLSeconds          int
	PackageMetadataSignalDedupeTTLSeconds   int
	MetadataCacheStatsReportIntervalSeconds int

	// Contributor risk connector
	// ContributorPrefetchWindowDays is how far back (in days) to include npm
	// versions when building an exact-version contributor history slice.
	ContributorPrefetchWindowDays int
	ContributorEnabled            bool
	ContributorMetadataCachePath  string
	ContributorMetadataVersionCap int
	ContributorMetadataColdDays   int

	// WAL flush
	FlushIntervalSeconds int
	FlushMaxEvents       int

	// WAL storage
	EventRetentionHours int
	WALPath             string
	CheckpointPath      string
}

// Load reads configuration from environment variables and returns a validated Config.
// Returns an error if any required variable is absent.
func Load() (*Config, error) {
	cfg := &Config{
		LogLevel:              getEnv("LOG_LEVEL", "info"),
		PublicBaseURL:         os.Getenv("PROXY_PUBLIC_BASE_URL"),
		AllowedPublicBaseURLs: splitCSV(os.Getenv("PROXY_ALLOWED_PUBLIC_BASE_URLS")),
		ProxyID:               os.Getenv("PROXY_ID"),
		ControlPlaneURL:       os.Getenv("PROXY_CONTROL_PLANE_URL"),
		ControlPlaneSecret:    os.Getenv("PROXY_CONTROL_PLANE_SECRET"),
		RedactClientIP:        os.Getenv("PROXY_REDACT_CLIENT_IP") == "true",
		TrustedProxyCIDRs:     splitCSV(os.Getenv("PROXY_TRUSTED_PROXY_CIDRS")),
		WALPath:               getEnv("PROXY_WAL_PATH", "./data/events.ndjson"),
		CheckpointPath:        getEnv("PROXY_CHECKPOINT_PATH", "./data/events.checkpoint"),
		ContributorMetadataCachePath: getEnv(
			"PROXY_CONTRIBUTOR_METADATA_CACHE_PATH",
			"./data/contributor_metadata_cache.json",
		),
	}

	var errs []error

	port, err := getEnvInt("PROXY_PORT", 8080)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.Port = port
	}
	npmMetadataMaxBytes, err := getEnvInt("PROXY_NPM_METADATA_MAX_BYTES", 32<<20)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.NPMMetadataMaxBytes = npmMetadataMaxBytes
	}
	npmAuditMaxBodyBytes, err := getEnvInt("PROXY_NPM_AUDIT_MAX_BODY_BYTES", 5<<20)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.NPMAuditMaxBodyBytes = npmAuditMaxBodyBytes
	}
	pypiMetadataMaxBytes, err := getEnvInt("PROXY_PYPI_METADATA_MAX_BYTES", 2<<20)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.PyPIMetadataMaxBytes = pypiMetadataMaxBytes
	}
	cacheTTLSeconds, err := getEnvInt("PROXY_CACHE_TTL_SECONDS", 300)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.CacheTTLSeconds = cacheTTLSeconds
	}
	tokenContextCacheTTLSeconds, err := getEnvInt("PROXY_TOKEN_CONTEXT_CACHE_TTL_SECONDS", 900)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.TokenContextCacheTTLSeconds = tokenContextCacheTTLSeconds
	}
	packageMetadataCacheTTLSeconds, err := getEnvInt("PROXY_PACKAGE_METADATA_CACHE_TTL_SECONDS", 300)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.PackageMetadataCacheTTLSeconds = packageMetadataCacheTTLSeconds
	}
	packageMetadataSignalDedupeTTLSeconds, err := getEnvInt("PROXY_PACKAGE_METADATA_SIGNAL_DEDUPE_TTL_SECONDS", 300)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.PackageMetadataSignalDedupeTTLSeconds = packageMetadataSignalDedupeTTLSeconds
	}
	metadataCacheStatsReportIntervalSeconds, err := getEnvInt("PROXY_METADATA_CACHE_STATS_REPORT_INTERVAL_SECONDS", 60)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.MetadataCacheStatsReportIntervalSeconds = metadataCacheStatsReportIntervalSeconds
	}
	contributorPrefetchWindowDays, err := getEnvInt("PROXY_CONNECTOR_CONTRIBUTOR_PREFETCH_WINDOW_DAYS", 90)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.ContributorPrefetchWindowDays = contributorPrefetchWindowDays
	}
	cfg.ContributorEnabled = getEnv("PROXY_CONNECTOR_CONTRIBUTOR_ENABLED", "true") != "false"
	contributorMetadataVersionCap, err := getEnvInt("PROXY_CONTRIBUTOR_METADATA_VERSION_CAP", 250)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.ContributorMetadataVersionCap = contributorMetadataVersionCap
	}
	contributorMetadataColdDays, err := getEnvInt("PROXY_CONTRIBUTOR_METADATA_COLD_DAYS", 45)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.ContributorMetadataColdDays = contributorMetadataColdDays
	}

	flushIntervalSeconds, err := getEnvInt("PROXY_FLUSH_INTERVAL_SECONDS", 10)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.FlushIntervalSeconds = flushIntervalSeconds
	}
	flushMaxEvents, err := getEnvInt("PROXY_FLUSH_MAX_EVENTS", 100)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.FlushMaxEvents = flushMaxEvents
	}
	eventRetentionHours, err := getEnvInt("PROXY_EVENT_RETENTION_HOURS", 48)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.EventRetentionHours = eventRetentionHours
	}

	if cfg.ProxyID == "" {
		errs = append(errs, errors.New("PROXY_ID is required (generate with: uuidgen)"))
	}
	if cfg.ControlPlaneURL == "" {
		errs = append(errs, errors.New("PROXY_CONTROL_PLANE_URL is required"))
	}
	if cfg.ControlPlaneSecret == "" {
		errs = append(errs, errors.New("PROXY_CONTROL_PLANE_SECRET is required"))
	}
	if cfg.Port <= 0 || cfg.Port > 65535 {
		errs = append(errs, errors.New("PROXY_PORT must be between 1 and 65535"))
	}
	if cfg.NPMMetadataMaxBytes <= 0 {
		errs = append(errs, errors.New("PROXY_NPM_METADATA_MAX_BYTES must be greater than 0"))
	}
	if cfg.NPMAuditMaxBodyBytes <= 0 {
		errs = append(errs, errors.New("PROXY_NPM_AUDIT_MAX_BODY_BYTES must be greater than 0"))
	}
	if cfg.PyPIMetadataMaxBytes <= 0 {
		errs = append(errs, errors.New("PROXY_PYPI_METADATA_MAX_BYTES must be greater than 0"))
	}
	if cfg.CacheTTLSeconds <= 0 {
		errs = append(errs, errors.New("PROXY_CACHE_TTL_SECONDS must be greater than 0"))
	}
	if cfg.TokenContextCacheTTLSeconds <= 0 {
		errs = append(errs, errors.New("PROXY_TOKEN_CONTEXT_CACHE_TTL_SECONDS must be greater than 0"))
	}
	if cfg.PackageMetadataCacheTTLSeconds <= 0 {
		errs = append(errs, errors.New("PROXY_PACKAGE_METADATA_CACHE_TTL_SECONDS must be greater than 0"))
	}
	if cfg.PackageMetadataSignalDedupeTTLSeconds <= 0 {
		errs = append(errs, errors.New("PROXY_PACKAGE_METADATA_SIGNAL_DEDUPE_TTL_SECONDS must be greater than 0"))
	}
	if cfg.MetadataCacheStatsReportIntervalSeconds <= 0 {
		errs = append(errs, errors.New("PROXY_METADATA_CACHE_STATS_REPORT_INTERVAL_SECONDS must be greater than 0"))
	}
	if cfg.FlushIntervalSeconds <= 0 {
		errs = append(errs, errors.New("PROXY_FLUSH_INTERVAL_SECONDS must be greater than 0"))
	}
	if cfg.ContributorMetadataVersionCap <= 0 {
		errs = append(errs, errors.New("PROXY_CONTRIBUTOR_METADATA_VERSION_CAP must be greater than 0"))
	}
	if cfg.ContributorMetadataColdDays <= 0 {
		errs = append(errs, errors.New("PROXY_CONTRIBUTOR_METADATA_COLD_DAYS must be greater than 0"))
	}
	if cfg.FlushMaxEvents <= 0 {
		errs = append(errs, errors.New("PROXY_FLUSH_MAX_EVENTS must be greater than 0"))
	}
	if cfg.EventRetentionHours <= 0 {
		errs = append(errs, errors.New("PROXY_EVENT_RETENTION_HOURS must be greater than 0"))
	}
	if cfg.PublicBaseURL != "" {
		publicBaseURL, err := normalizePublicBaseURL(cfg.PublicBaseURL)
		if err != nil {
			errs = append(errs, fmt.Errorf("PROXY_PUBLIC_BASE_URL is invalid: %w", err))
		} else {
			cfg.PublicBaseURL = publicBaseURL
		}
	}
	if len(cfg.AllowedPublicBaseURLs) > 0 {
		allowedPublicBaseURLs, err := normalizePublicBaseURLs(cfg.AllowedPublicBaseURLs)
		if err != nil {
			errs = append(errs, fmt.Errorf("PROXY_ALLOWED_PUBLIC_BASE_URLS is invalid: %w", err))
		} else {
			cfg.AllowedPublicBaseURLs = allowedPublicBaseURLs
		}
	}

	trustedProxyNets, err := parseTrustedProxyCIDRs(cfg.TrustedProxyCIDRs)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.TrustedProxyNets = trustedProxyNets
	}

	if len(errs) > 0 {
		msg := "proxy configuration errors:\n"
		for _, e := range errs {
			msg += fmt.Sprintf("  - %s\n", e.Error())
		}
		return nil, errors.New(msg)
	}

	return cfg, nil
}

// LogValue implements slog.LogValuer so a single slog.Info("startup_config", "config", cfg)
// call emits the full configuration as a structured group. Sensitive fields are
// summarized without leaking secret material.
func (c *Config) LogValue() slog.Value {
	return slog.GroupValue(
		slog.Group("general",
			slog.String("log_level", c.LogLevel),
		),
		slog.Group("server",
			slog.Int("port", c.Port),
			slog.String("public_base_url", c.PublicBaseURL),
			slog.Any("allowed_public_base_urls", c.AllowedPublicBaseURLs),
			slog.Int("npm_metadata_max_bytes", c.NPMMetadataMaxBytes),
			slog.Int("npm_audit_max_body_bytes", c.NPMAuditMaxBodyBytes),
			slog.Int("pypi_metadata_max_bytes", c.PyPIMetadataMaxBytes),
		),
		slog.Group("identity",
			slog.String("proxy_id", c.ProxyID),
		),
		slog.Group("control_plane",
			slog.String("url", c.ControlPlaneURL),
			slog.Bool("secret_configured", c.ControlPlaneSecret != ""),
		),
		slog.Group("cache",
			slog.Int("ttl_seconds", c.CacheTTLSeconds),
			slog.Int("token_context_cache_ttl_seconds", c.TokenContextCacheTTLSeconds),
			slog.Int("package_metadata_ttl_seconds", c.PackageMetadataCacheTTLSeconds),
			slog.Int("package_metadata_signal_dedupe_ttl_seconds", c.PackageMetadataSignalDedupeTTLSeconds),
			slog.Int("metadata_cache_stats_report_interval_seconds", c.MetadataCacheStatsReportIntervalSeconds),
			slog.String("contributor_metadata_cache_path", c.ContributorMetadataCachePath),
			slog.Int("contributor_metadata_version_cap", c.ContributorMetadataVersionCap),
			slog.Int("contributor_metadata_cold_days", c.ContributorMetadataColdDays),
		),
		slog.Group("wal",
			slog.Int("flush_interval_seconds", c.FlushIntervalSeconds),
			slog.Int("flush_max_events", c.FlushMaxEvents),
			slog.Int("event_retention_hours", c.EventRetentionHours),
			slog.String("path", c.WALPath),
			slog.String("checkpoint_path", c.CheckpointPath),
		),
		slog.Group("privacy",
			slog.Bool("redact_client_ip", c.RedactClientIP),
			slog.Any("trusted_proxy_cidrs", c.TrustedProxyCIDRs),
		),
	)
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) (int, error) {
	v := os.Getenv(key)
	if v == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("%s must be a valid integer", key)
	}
	return n, nil
}

func normalizePublicBaseURL(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", errors.New("scheme must be http or https")
	}
	if u.Host == "" {
		return "", errors.New("host is required")
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("query strings and fragments are not allowed")
	}

	u.Host = strings.ToLower(u.Host)
	u.Path = strings.TrimRight(u.Path, "/")
	return u.String(), nil
}

func normalizePublicBaseURLs(values []string) ([]string, error) {
	normalized := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))

	for _, value := range values {
		next, err := normalizePublicBaseURL(value)
		if err != nil {
			return nil, err
		}
		if _, ok := seen[next]; ok {
			continue
		}
		seen[next] = struct{}{}
		normalized = append(normalized, next)
	}

	return normalized, nil
}

func splitCSV(raw string) []string {
	if raw == "" {
		return nil
	}

	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func parseTrustedProxyCIDRs(values []string) ([]netip.Prefix, error) {
	if len(values) == 0 {
		return nil, nil
	}

	prefixes := make([]netip.Prefix, 0, len(values))
	for _, value := range values {
		prefix, err := netip.ParsePrefix(value)
		if err != nil {
			return nil, fmt.Errorf("PROXY_TRUSTED_PROXY_CIDRS contains invalid CIDR %q", value)
		}
		prefixes = append(prefixes, prefix.Masked())
	}
	return prefixes, nil
}
