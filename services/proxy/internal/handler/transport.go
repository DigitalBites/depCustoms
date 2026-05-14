package handler

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// writeError writes the canonical JSON error envelope. It is a package-level
// function so resolver implementations can call it from OnProxyMetadata without
// holding a reference to the engine.
func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"error": map[string]interface{}{
			"code":    code,
			"message": message,
			"detail":  nil,
		},
	})
}

// streamResponse forwards an upstream HTTP response to the client, copying
// Content-Type and Content-Length headers before streaming the body.
// Returns the number of bytes copied so callers can record bytes_transferred.
// The caller is responsible for closing resp.Body.
func streamResponse(w http.ResponseWriter, resp *http.Response) (int64, error) {
	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	if cl := resp.Header.Get("Content-Length"); cl != "" {
		w.Header().Set("Content-Length", cl)
	}
	w.WriteHeader(http.StatusOK)
	return io.Copy(w, resp.Body)
}

// extractProjectToken extracts the project token from supported package-manager
// auth schemes. npm continues to use Bearer; pip commonly sends Basic auth
// with the token as the username and an empty password.
func extractProjectToken(r *http.Request) string {
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if auth == "" {
		return ""
	}

	scheme, value, ok := strings.Cut(auth, " ")
	if !ok || value == "" {
		return ""
	}

	switch strings.ToLower(scheme) {
	case "bearer":
		return strings.TrimSpace(value)
	case "basic":
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(value))
		if err != nil {
			return ""
		}
		username, password, ok := strings.Cut(string(decoded), ":")
		if !ok || username == "" || password != "" {
			return ""
		}
		return username
	}

	return ""
}

// generateTraceparent creates a W3C traceparent header value with a random
// 128-bit trace ID and 64-bit span ID.
// Format: 00-<32 hex chars>-<16 hex chars>-01
func generateTraceparent() string {
	var traceBytes [16]byte
	var spanBytes [8]byte
	_, _ = rand.Read(traceBytes[:])
	_, _ = rand.Read(spanBytes[:])
	return fmt.Sprintf("00-%s-%s-01",
		hex.EncodeToString(traceBytes[:]),
		hex.EncodeToString(spanBytes[:]),
	)
}

func hashProjectToken(token string) string {
	return fingerprintParts(token)
}
