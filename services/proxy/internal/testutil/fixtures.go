package testutil

import (
	gatewayv1 "github.com/getcustoms/proxy/gen/customs/v1"
)

// CannedAllow returns a CheckResponse indicating the package is allowed.
func CannedAllow(tenantID, projectID string, ttlSeconds int32) *gatewayv1.CheckResponse {
	return &gatewayv1.CheckResponse{
		Decision:        gatewayv1.Decision_DECISION_ALLOW,
		Reason:          "policy_rule",
		Detail:          "allowed by test fixture",
		CacheTtlSeconds: ttlSeconds,
		ServeMode:       gatewayv1.ServeMode_SERVE_MODE_REDIRECT,
		TenantId:        tenantID,
		ProjectId:       projectID,
	}
}

// CannedBlock returns a CheckResponse indicating the package is blocked.
func CannedBlock(reason string) *gatewayv1.CheckResponse {
	return &gatewayv1.CheckResponse{
		Decision:        gatewayv1.Decision_DECISION_BLOCK,
		Reason:          reason,
		Detail:          "blocked by test fixture",
		CacheTtlSeconds: 300,
		ServeMode:       gatewayv1.ServeMode_SERVE_MODE_UNSPECIFIED,
	}
}

// CannedPingOK returns the response a Ping call receives when proxy credentials
// are valid. The empty project token causes an invalid_token reason, which is
// the expected success signal for Ping.
func CannedPingOK() *gatewayv1.CheckResponse {
	return &gatewayv1.CheckResponse{
		Decision: gatewayv1.Decision_DECISION_BLOCK,
		Reason:   "invalid_token",
	}
}

// CannedPingUnregistered returns the response that causes Ping to fail fast
// with an "unregistered proxy" error.
func CannedPingUnregistered() *gatewayv1.CheckResponse {
	return &gatewayv1.CheckResponse{
		Decision: gatewayv1.Decision_DECISION_BLOCK,
		Reason:   "unregistered_proxy",
	}
}

// CannedPingInvalidSecret returns the response that causes Ping to fail fast
// with an "invalid proxy secret" error.
func CannedPingInvalidSecret() *gatewayv1.CheckResponse {
	return &gatewayv1.CheckResponse{
		Decision: gatewayv1.Decision_DECISION_BLOCK,
		Reason:   "invalid_proxy_secret",
	}
}
