package taxonomy

const (
	RequestEventTypeMetadata      = "metadata"
	RequestEventTypeArtifact      = "artifact"
	RequestEventTypeUpstreamError = "upstream_error"
	RequestEventTypeProxyRequest  = "proxy_request"
)

var RequestEventTypes = []string{
	RequestEventTypeMetadata,
	RequestEventTypeArtifact,
	RequestEventTypeUpstreamError,
	RequestEventTypeProxyRequest,
}

const (
	DecisionPathCacheHit                = "cache_hit"
	DecisionPathCheck                   = "check"
	DecisionPathControlPlaneUnavailable = "control_plane_unavailable"
	DecisionPathBypass                  = "bypass"
)

var DecisionPaths = []string{
	DecisionPathCacheHit,
	DecisionPathCheck,
	DecisionPathControlPlaneUnavailable,
	DecisionPathBypass,
}

const (
	ServeModeRedirect = "SERVE_MODE_REDIRECT"
	ServeModePull     = "SERVE_MODE_PULL"
)

var ServeModes = []string{
	ServeModeRedirect,
	ServeModePull,
}

const (
	MetadataCacheStatusHit     = "hit"
	MetadataCacheStatusMiss    = "miss"
	MetadataCacheStatusStale   = "stale"
	MetadataCacheStatusRefresh = "refresh"
)

var MetadataCacheStatuses = []string{
	MetadataCacheStatusHit,
	MetadataCacheStatusMiss,
	MetadataCacheStatusStale,
	MetadataCacheStatusRefresh,
}

const (
	ProxyStatusEventTypeProxyServiceRunning     = "proxy_service_running"
	ProxyStatusEventTypeProxyServiceStopped     = "proxy_service_stopped"
	ProxyStatusEventTypeControlPlaneUnavailable = "control_plane_unavailable"
	ProxyStatusEventTypeControlPlaneAvailable   = "control_plane_available"
	ProxyStatusEventTypeTokenExchangeAttempt    = "token_exchange_attempt"
	ProxyStatusEventTypeTokenIssued             = "token_issued"
	ProxyStatusEventTypeTokenExchangeFailed     = "token_exchange_failed"
	ProxyStatusEventTypeProxyDisabled           = "proxy_disabled"
	ProxyStatusEventTypeProxyEnabled            = "proxy_enabled"
	ProxyStatusEventTypeSecretRotated           = "secret_rotated"
	ProxyStatusEventTypeProxyRevoked            = "proxy_revoked"
)

var ProxyStatusEventTypes = []string{
	ProxyStatusEventTypeProxyServiceRunning,
	ProxyStatusEventTypeProxyServiceStopped,
	ProxyStatusEventTypeControlPlaneUnavailable,
	ProxyStatusEventTypeControlPlaneAvailable,
	ProxyStatusEventTypeTokenExchangeAttempt,
	ProxyStatusEventTypeTokenIssued,
	ProxyStatusEventTypeTokenExchangeFailed,
	ProxyStatusEventTypeProxyDisabled,
	ProxyStatusEventTypeProxyEnabled,
	ProxyStatusEventTypeSecretRotated,
	ProxyStatusEventTypeProxyRevoked,
}
