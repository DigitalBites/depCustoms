package handler

import "log/slog"

func (e *engine) logPolicyResult(
	req PackageRequest,
	traceID string,
	requestCtx policyRequestContext,
	decision string,
	decisionPath string,
	durationMs int64,
	serve serveResult,
) {
	logAttrs := []any{
		"service", "proxy",
		"decision", decision,
		"decision_path", decisionPath,
		"duration_ms", durationMs,
	}
	logAttrs = e.appendRequestLogAttrs(logAttrs, req, traceID, requestCtx)
	if decision == "allow" {
		if serve.serveMode != "" {
			logAttrs = append(logAttrs, "serve_mode", serve.serveMode)
		}
		if serve.bytesTransferred > 0 || requestCtx.event.eventType == "artifact" {
			logAttrs = append(logAttrs, "bytes_transferred", serve.bytesTransferred)
		}
		if serve.upstreamSuccess != nil {
			logAttrs = append(logAttrs, "upstream_success", *serve.upstreamSuccess)
		}
	}
	slog.Info("request evaluated", logAttrs...)
}

func (e *engine) appendRequestLogAttrs(
	attrs []any,
	req PackageRequest,
	traceID string,
	requestCtx policyRequestContext,
) []any {
	if requestCtx.event.eventType == "metadata" {
		attrs = append(attrs, "event_type", "metadata")
	}
	attrs = append(attrs,
		"ecosystem", requestCtx.ecosystem,
		"package", req.Package,
	)
	if requestCtx.event.version != "" {
		attrs = append(attrs, "version", requestCtx.event.version)
	}
	attrs = append(attrs, "trace_id", traceID)
	return attrs
}
