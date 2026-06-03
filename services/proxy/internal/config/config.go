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
	Port                    int
	EnabledEcosystems       []string
	PublicBaseURL           string
	AllowedPublicBaseURLs   []string
	PackageMetadataMaxBytes int
	NPMMetadataMaxBytes     int
	NPMAuditMaxBodyBytes    int
	PyPIMetadataMaxBytes    int

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
	// MetadataWaitTimeoutMs bounds the foreground metadata-readiness step that
	// runs before Check on cache miss. On timeout the proxy proceeds with
	// whatever catalog state exists and enqueues an advisory WAL record so
	// the catalog converges for the next request.
	MetadataWaitTimeoutMs int
	// MetadataAckCacheTTLSeconds bounds how long a control-plane ACK for a
	// metadata fingerprint suppresses re-submission. Defaults to one hour;
	// short enough to recover if the catalog row is deleted upstream, long
	// enough that repeated artifact requests for the same version never
	// re-submit.
	MetadataAckCacheTTLSeconds int
	DockerAllowedUpstreams                  []string
	DockerAllowPrivateUpstreams             bool
	DockerUpstreamRequestTimeoutSeconds     int
	DockerAuthTokenTTLSeconds               int
	DockerManifestAllowCacheTTLSeconds      int

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
		EnabledEcosystems:     splitCSV(getEnv("PROXY_ENABLED_ECOSYSTEMS", "npm,pypi,docker")),
		PublicBaseURL:         os.Getenv("PROXY_PUBLIC_BASE_URL"),
		AllowedPublicBaseURLs: splitCSV(os.Getenv("PROXY_ALLOWED_PUBLIC_BASE_URLS")),
		ProxyID:               os.Getenv("PROXY_ID"),
		ControlPlaneURL:       os.Getenv("PROXY_CONTROL_PLANE_URL"),
		ControlPlaneSecret:    os.Getenv("PROXY_CONTROL_PLANE_SECRET"),
		RedactClientIP:        os.Getenv("PROXY_REDACT_CLIENT_IP") == "true",
		TrustedProxyCIDRs:     splitCSV(os.Getenv("PROXY_TRUSTED_PROXY_CIDRS")),
		DockerAllowedUpstreams: splitCSV(getEnv(
			"PROXY_DOCKER_ALLOWED_UPSTREAMS",
			"hub.docker.io,ghcr.io,quay.io",
		)),
		DockerAllowPrivateUpstreams: os.Getenv("PROXY_DOCKER_ALLOW_PRIVATE_UPSTREAMS") == "true",
		WALPath:                     getEnv("PROXY_WAL_PATH", "./data/events.ndjson"),
		CheckpointPath:              getEnv("PROXY_CHECKPOINT_PATH", "./data/events.checkpoint"),
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
	packageMetadataMaxBytes, err := getEnvIntAny(
		[]string{"PROXY_PACKAGE_METADATA_MAX_BYTES", "PROXY_NPM_METADATA_MAX_BYTES"},
		32<<20,
	)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.PackageMetadataMaxBytes = packageMetadataMaxBytes
		cfg.NPMMetadataMaxBytes = packageMetadataMaxBytes
		cfg.PyPIMetadataMaxBytes = packageMetadataMaxBytes
	}
	npmAuditMaxBodyBytes, err := getEnvInt("PROXY_NPM_AUDIT_MAX_BODY_BYTES", 5<<20)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.NPMAuditMaxBodyBytes = npmAuditMaxBodyBytes
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
	metadataWaitTimeoutMs, err := getEnvInt("PROXY_METADATA_WAIT_TIMEOUT_MS", 800)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.MetadataWaitTimeoutMs = metadataWaitTimeoutMs
	}
	metadataAckCacheTTLSeconds, err := getEnvInt("PROXY_METADATA_ACK_CACHE_TTL_SECONDS", 3600)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.MetadataAckCacheTTLSeconds = metadataAckCacheTTLSeconds
	}
	dockerUpstreamRequestTimeoutSeconds, err := getEnvInt("PROXY_DOCKER_UPSTREAM_REQUEST_TIMEOUT_SECONDS", 30)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.DockerUpstreamRequestTimeoutSeconds = dockerUpstreamRequestTimeoutSeconds
	}
	dockerAuthTokenTTLSeconds, err := getEnvInt("PROXY_DOCKER_AUTH_TOKEN_TTL_SECONDS", 300)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.DockerAuthTokenTTLSeconds = dockerAuthTokenTTLSeconds
	}
	dockerManifestAllowCacheTTLSeconds, err := getEnvInt("PROXY_DOCKER_MANIFEST_ALLOW_CACHE_TTL_SECONDS", 300)
	if err != nil {
		errs = append(errs, err)
	} else {
		cfg.DockerManifestAllowCacheTTLSeconds = dockerManifestAllowCacheTTLSeconds
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
	if cfg.PackageMetadataMaxBytes <= 0 {
		errs = append(errs, errors.New("PROXY_PACKAGE_METADATA_MAX_BYTES must be greater than 0"))
	}
	if cfg.NPMMetadataMaxBytes <= 0 {
		errs = append(errs, errors.New("PROXY_PACKAGE_METADATA_MAX_BYTES must be greater than 0"))
	}
	if cfg.NPMAuditMaxBodyBytes <= 0 {
		errs = append(errs, errors.New("PROXY_NPM_AUDIT_MAX_BODY_BYTES must be greater than 0"))
	}
	if cfg.PyPIMetadataMaxBytes <= 0 {
		errs = append(errs, errors.New("PROXY_PACKAGE_METADATA_MAX_BYTES must be greater than 0"))
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
	if cfg.MetadataWaitTimeoutMs <= 0 {
		errs = append(errs, errors.New("PROXY_METADATA_WAIT_TIMEOUT_MS must be greater than 0"))
	}
	if cfg.MetadataAckCacheTTLSeconds <= 0 {
		errs = append(errs, errors.New("PROXY_METADATA_ACK_CACHE_TTL_SECONDS must be greater than 0"))
	}
	if cfg.DockerUpstreamRequestTimeoutSeconds <= 0 {
		errs = append(errs, errors.New("PROXY_DOCKER_UPSTREAM_REQUEST_TIMEOUT_SECONDS must be greater than 0"))
	}
	if cfg.DockerAuthTokenTTLSeconds <= 0 {
		errs = append(errs, errors.New("PROXY_DOCKER_AUTH_TOKEN_TTL_SECONDS must be greater than 0"))
	}
	if cfg.DockerManifestAllowCacheTTLSeconds <= 0 {
		errs = append(errs, errors.New("PROXY_DOCKER_MANIFEST_ALLOW_CACHE_TTL_SECONDS must be greater than 0"))
	}
	if err := validateEnabledEcosystems(cfg.EnabledEcosystems); err != nil {
		errs = append(errs, err)
	}
	if err := validateDockerAllowedUpstreams(cfg.DockerAllowedUpstreams); err != nil {
		errs = append(errs, err)
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
			slog.Any("enabled_ecosystems", c.EnabledEcosystems),
			slog.String("public_base_url", c.PublicBaseURL),
			slog.Any("allowed_public_base_urls", c.AllowedPublicBaseURLs),
			slog.Int("package_metadata_max_bytes", c.PackageMetadataMaxBytes),
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
			slog.Int("metadata_wait_timeout_ms", c.MetadataWaitTimeoutMs),
			slog.Int("metadata_ack_cache_ttl_seconds", c.MetadataAckCacheTTLSeconds),
			slog.Int("metadata_cache_stats_report_interval_seconds", c.MetadataCacheStatsReportIntervalSeconds),
			slog.Any("docker_allowed_upstreams", c.DockerAllowedUpstreams),
			slog.Bool("docker_allow_private_upstreams", c.DockerAllowPrivateUpstreams),
			slog.Int("docker_upstream_request_timeout_seconds", c.DockerUpstreamRequestTimeoutSeconds),
			slog.Int("docker_auth_token_ttl_seconds", c.DockerAuthTokenTTLSeconds),
			slog.Int("docker_manifest_allow_cache_ttl_seconds", c.DockerManifestAllowCacheTTLSeconds),
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

func getEnvIntAny(keys []string, fallback int) (int, error) {
	for _, key := range keys {
		if os.Getenv(key) == "" {
			continue
		}
		return getEnvInt(key, fallback)
	}
	return fallback, nil
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

func validateEnabledEcosystems(values []string) error {
	if len(values) == 0 {
		return errors.New("PROXY_ENABLED_ECOSYSTEMS must include at least one ecosystem")
	}
	allowed := map[string]struct{}{
		"npm":    {},
		"pypi":   {},
		"docker": {},
	}
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		ecosystem := strings.ToLower(strings.TrimSpace(value))
		if _, ok := allowed[ecosystem]; !ok {
			return fmt.Errorf("PROXY_ENABLED_ECOSYSTEMS contains unsupported ecosystem %q", value)
		}
		if _, ok := seen[ecosystem]; ok {
			return fmt.Errorf("PROXY_ENABLED_ECOSYSTEMS contains duplicate ecosystem %q", ecosystem)
		}
		seen[ecosystem] = struct{}{}
	}
	return nil
}

func validateDockerAllowedUpstreams(values []string) error {
	if len(values) == 0 {
		return errors.New("PROXY_DOCKER_ALLOWED_UPSTREAMS must include at least one host or *")
	}
	for _, value := range values {
		if value == "*" {
			if len(values) > 1 {
				return errors.New("PROXY_DOCKER_ALLOWED_UPSTREAMS cannot combine * with explicit hosts")
			}
			return nil
		}
		if strings.Contains(value, "://") || strings.Contains(value, "/") {
			return fmt.Errorf("PROXY_DOCKER_ALLOWED_UPSTREAMS contains invalid host %q", value)
		}
		if strings.TrimSpace(value) == "" {
			return errors.New("PROXY_DOCKER_ALLOWED_UPSTREAMS contains an empty host")
		}
	}
	return nil
}

func (c *Config) EcosystemEnabled(ecosystem string) bool {
	for _, enabled := range c.EnabledEcosystems {
		if strings.EqualFold(enabled, ecosystem) {
			return true
		}
	}
	return false
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
