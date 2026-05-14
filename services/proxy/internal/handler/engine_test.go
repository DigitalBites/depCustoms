package handler

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ---------------------------------------------------------------------------
// clientIP extraction
// ---------------------------------------------------------------------------

func TestClientIPFromXRealIP(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "127.0.0.1:12345"
	r.Header.Set("X-Real-IP", "  1.2.3.4  ")
	got := clientIP(r, false, []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32")})
	assert.Equal(t, "1.2.3.4", got)
}

func TestClientIPFromXForwardedFor(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "10.0.0.10:12345"
	r.Header.Set("X-Forwarded-For", "1.2.3.4, 10.0.0.1, 172.16.0.1")
	got := clientIP(r, false, []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")})
	assert.Equal(t, "1.2.3.4", got)
}

func TestClientIPInvalidForwardedHeaderFallsBackToRemoteAddr(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "10.0.0.10:12345"
	r.Header.Set("X-Real-IP", "not-an-ip")
	got := clientIP(r, false, []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")})
	assert.Equal(t, "10.0.0.10", got)
}

func TestClientIPFallbackRemoteAddr(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "5.6.7.8:12345"
	got := clientIP(r, false, nil)
	assert.Equal(t, "5.6.7.8", got)
}

func TestClientIPRemoteAddrNoPort(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "5.6.7.8"
	got := clientIP(r, false, nil)
	assert.Equal(t, "5.6.7.8", got)
}

func TestClientIPIgnoresForwardedHeadersFromUntrustedPeer(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "203.0.113.9:12345"
	r.Header.Set("X-Real-IP", "1.2.3.4")
	r.Header.Set("X-Forwarded-For", "1.2.3.4, 10.0.0.1")
	got := clientIP(r, false, []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")})
	assert.Equal(t, "203.0.113.9", got)
}

// ---------------------------------------------------------------------------
// redactIP
// ---------------------------------------------------------------------------

func TestRedactIPv4(t *testing.T) {
	assert.Equal(t, "1.2.3.0", redactIP("1.2.3.4"))
}

func TestRedactIPv4Zeros(t *testing.T) {
	assert.Equal(t, "192.168.0.0", redactIP("192.168.0.255"))
}

func TestRedactIPv6(t *testing.T) {
	// Should zero the last 64 bits (bytes 8–15), keeping the /64 network prefix
	result := redactIP("2001:db8:1:2:dead:beef:1234:5678")
	// Bytes 8–15 should be zero: ::
	assert.True(t,
		strings.HasSuffix(result, "::") || strings.Contains(result, "2001:db8:1:2::"),
		"expected last 64 bits zeroed, got: %s", result,
	)
}

func TestRedactIPv4MappedIPv6(t *testing.T) {
	// ::ffff:1.2.3.4 — treated as IPv4 via To4(), last octet zeroed
	result := redactIP("::ffff:1.2.3.4")
	assert.Equal(t, "1.2.3.0", result)
}

func TestRedactIPUnparseable(t *testing.T) {
	// Malformed input returned unchanged
	assert.Equal(t, "not-an-ip", redactIP("not-an-ip"))
}

func TestRedactIPWithRedactFlag(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "127.0.0.1:12345"
	r.Header.Set("X-Real-IP", "1.2.3.4")
	got := clientIP(r, true, []netip.Prefix{netip.MustParsePrefix("127.0.0.1/32")}) // redact=true
	assert.Equal(t, "1.2.3.0", got)
}

// ---------------------------------------------------------------------------
// extractProjectToken
// ---------------------------------------------------------------------------

func TestExtractProjectToken_Bearer(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer abc123")
	assert.Equal(t, "abc123", extractProjectToken(r))
}

func TestExtractProjectToken_BasicUsernameToken(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Basic Y2h0X3Rva2VuOg==")
	assert.Equal(t, "cht_token", extractProjectToken(r))
}

func TestExtractProjectToken_Missing(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	assert.Equal(t, "", extractProjectToken(r))
}

func TestExtractProjectToken_BasicPasswordRejected(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Basic dXNlcjpwYXNz")
	assert.Equal(t, "", extractProjectToken(r))
}

func TestExtractProjectToken_InvalidBasicRejected(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Basic not-base64")
	assert.Equal(t, "", extractProjectToken(r))
}

// ---------------------------------------------------------------------------
// writeError
// ---------------------------------------------------------------------------

func TestWriteError_JSON(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusForbidden, "policy_blocked", "Package blocked by CVE policy")
	res := w.Result()
	assert.Equal(t, http.StatusForbidden, res.StatusCode)
	assert.Contains(t, w.Body.String(), `"policy_blocked"`)
	assert.Contains(t, w.Body.String(), `"Package blocked by CVE policy"`)
}

func TestServeHTTP_NoResolver(t *testing.T) {
	// An engine with nil resolver should 404 any request gracefully
	// This indirectly tests that ServeHTTP handles nil resolver by panicking
	// or returning 404. We skip this since resolver is required at construction.
	t.Skip("resolver is required at construction via NewNPMProxy/NewPyPIProxy")
}

// writeError shape
func TestWriteError_HasCodeAndMessage(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, 403, "test_code", "test message")
	body := w.Body.String()
	require.Contains(t, body, `"code"`)
	require.Contains(t, body, `"message"`)
	require.Contains(t, body, `"test_code"`)
	require.Contains(t, body, `"test message"`)
}
