package handler

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sort"
	"strings"
)

var passthroughStripHeaders = map[string]struct{}{
	"authorization":       {},
	"proxy-authorization": {},
	"connection":          {},
	"proxy-connection":    {},
	"keep-alive":          {},
	"te":                  {},
	"trailer":             {},
	"transfer-encoding":   {},
	"upgrade":             {},
	"forwarded":           {},
	"x-forwarded-for":     {},
	"x-forwarded-host":    {},
	"x-forwarded-proto":   {},
	"x-real-ip":           {},
	"host":                {},
}

func fetchMetadataResponse(
	w http.ResponseWriter,
	httpClient *http.Client,
	upstreamURL string,
	pkg string,
	unreachableMessage string,
) (*http.Response, bool) {
	resp, err := httpClient.Get(upstreamURL)
	if err != nil {
		slog.Error("upstream fetch failed",
			"service", "proxy",
			"url", upstreamURL,
			"error", err.Error(),
		)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", unreachableMessage)
		return nil, false
	}

	if resp.StatusCode == http.StatusNotFound {
		defer func() {
			_ = resp.Body.Close()
		}()
		writeError(w, http.StatusNotFound, "NOT_FOUND", fmt.Sprintf("package %q not found", pkg))
		return nil, false
	}
	if resp.StatusCode != http.StatusOK {
		defer func() {
			_ = resp.Body.Close()
		}()
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR",
			fmt.Sprintf("upstream returned %d", resp.StatusCode))
		return nil, false
	}

	return resp, true
}

func pullArtifactFromURL(
	w http.ResponseWriter,
	httpClient *http.Client,
	upstreamURL string,
	unreachableMessage string,
) ServeOutcome {
	resp, err := httpClient.Get(upstreamURL)
	if err != nil {
		slog.Error("upstream pull failed",
			"service", "proxy",
			"url", upstreamURL,
			"error", err.Error(),
		)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", unreachableMessage)
		return ServeOutcome{ServeMode: ServeModePull, Failed: true}
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	if resp.StatusCode != http.StatusOK {
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR",
			fmt.Sprintf("upstream returned %d", resp.StatusCode))
		return ServeOutcome{ServeMode: ServeModePull, Failed: true}
	}

	n, err := streamResponse(w, resp)
	if err != nil {
		slog.Warn("artifact stream interrupted",
			"service", "proxy",
			"url", upstreamURL,
			"bytes_transferred", n,
			"error", err.Error(),
		)
		return ServeOutcome{ServeMode: ServeModePull, BytesTransferred: n, Failed: true}
	}
	return ServeOutcome{ServeMode: ServeModePull, BytesTransferred: n}
}

func proxyPassthroughRequest(
	w http.ResponseWriter,
	httpClient *http.Client,
	originalReq *http.Request,
	upstreamURL string,
	maxBodyBytes int64,
) bool {
	bodyReader, contentLength, ok := boundedPassthroughBody(w, originalReq, maxBodyBytes)
	if !ok {
		return false
	}

	req, err := http.NewRequestWithContext(
		originalReq.Context(),
		originalReq.Method,
		upstreamURL,
		bodyReader,
	)
	if err != nil {
		slog.Error("upstream passthrough request build failed",
			"service", "proxy",
			"url", upstreamURL,
			"error", err.Error(),
		)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "failed to build upstream request")
		return false
	}
	req.ContentLength = contentLength

	inboundHeaders := []string(nil)
	outboundHeaders := []string(nil)
	droppedHeaders := []string(nil)
	req.Header, inboundHeaders, outboundHeaders, droppedHeaders = sanitizePassthroughHeaders(originalReq.Header)
	slog.Debug("upstream passthrough header policy applied",
		"service", "proxy",
		"url", upstreamURL,
		"inbound_headers", inboundHeaders,
		"forwarded_headers", outboundHeaders,
		"dropped_headers", droppedHeaders,
		"drop_reason", "passthrough_header_policy",
	)

	resp, err := httpClient.Do(req)
	if err != nil {
		slog.Error("upstream passthrough failed",
			"service", "proxy",
			"url", upstreamURL,
			"error", err.Error(),
		)
		writeError(w, http.StatusBadGateway, "UPSTREAM_ERROR", "upstream request failed")
		return false
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	for key := range w.Header() {
		w.Header().Del(key)
	}
	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(resp.StatusCode)

	if _, err := io.Copy(w, resp.Body); err != nil {
		slog.Warn("upstream passthrough response interrupted",
			"service", "proxy",
			"url", upstreamURL,
			"error", err.Error(),
		)
		return false
	}

	return resp.StatusCode < 500
}

func boundedPassthroughBody(w http.ResponseWriter, req *http.Request, maxBodyBytes int64) (io.Reader, int64, bool) {
	if req.Body == nil {
		return nil, 0, true
	}
	if maxBodyBytes <= 0 {
		return req.Body, req.ContentLength, true
	}

	limitedBody := http.MaxBytesReader(w, req.Body, maxBodyBytes)
	defer func() {
		_ = limitedBody.Close()
	}()

	body, err := io.ReadAll(limitedBody)
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			slog.Warn("upstream passthrough request body exceeded size limit",
				"service", "proxy",
				"path", req.URL.Path,
				"limit_bytes", maxBodyBytes,
			)
			writeError(
				w,
				http.StatusRequestEntityTooLarge,
				"REQUEST_TOO_LARGE",
				fmt.Sprintf("request body exceeded %d bytes limit", maxBodyBytes),
			)
			return nil, 0, false
		}

		slog.Warn("upstream passthrough request body read failed",
			"service", "proxy",
			"path", req.URL.Path,
			"error", err.Error(),
		)
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "failed to read request body")
		return nil, 0, false
	}

	return bytes.NewReader(body), int64(len(body)), true
}

func sanitizePassthroughHeaders(input http.Header) (http.Header, []string, []string, []string) {
	output := make(http.Header, len(input))
	inbound := make([]string, 0, len(input))
	forwarded := make([]string, 0, len(input))
	dropped := make([]string, 0, len(input))

	for key, values := range input {
		inbound = append(inbound, key)
		if _, strip := passthroughStripHeaders[strings.ToLower(key)]; strip {
			dropped = append(dropped, key)
			continue
		}
		output[key] = append([]string(nil), values...)
		forwarded = append(forwarded, key)
	}

	sort.Strings(inbound)
	sort.Strings(forwarded)
	sort.Strings(dropped)
	return output, inbound, forwarded, dropped
}
