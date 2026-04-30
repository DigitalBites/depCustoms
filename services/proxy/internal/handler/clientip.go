package handler

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// clientIP extracts the best-available client IP from a request.
// It only honors forwarding headers when the immediate socket peer belongs to
// an explicitly trusted proxy CIDR. Otherwise it falls back to RemoteAddr.
// If redact is true, the last octet of IPv4 is zeroed and the last 64 bits
// of IPv6 are zeroed before returning (GDPR/CCPA anonymisation).
// Returns an empty string if no IP can be determined — never errors.
func clientIP(r *http.Request, redact bool, trustedProxies []netip.Prefix) string {
	ip := remoteIPFromAddr(r.RemoteAddr)
	if isTrustedProxy(ip, trustedProxies) {
		forwardedCandidates := []string{
			r.Header.Get("Cf-Connecting-Ip"),
			r.Header.Get("X-Real-Ip"),
			r.Header.Get("X-Forwarded-For"),
			r.Header.Get("Forwarded"),
		}
		for _, candidate := range forwardedCandidates {
			if parsed, ok := parseLiteralIP(candidate); ok {
				ip = parsed
				break
			}
		}
	}
	if ip == "" {
		return ""
	}
	if redact {
		return redactIP(ip)
	}
	return ip
}

func parseLiteralIP(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}

	if strings.Contains(raw, ",") {
		parts := strings.Split(raw, ",")
		for _, part := range parts {
			if ip, ok := parseLiteralIP(part); ok {
				return ip, true
			}
		}
		return "", false
	}

	if strings.Contains(strings.ToLower(raw), "for=") {
		for _, segment := range strings.Split(raw, ";") {
			segment = strings.TrimSpace(segment)
			if !strings.HasPrefix(strings.ToLower(segment), "for=") {
				continue
			}
			value := strings.TrimPrefix(segment, "for=")
			value = strings.TrimPrefix(value, "For=")
			return parseLiteralIP(strings.Trim(value, `"`))
		}
		return "", false
	}

	raw = strings.Trim(raw, "[]")
	addr, err := netip.ParseAddr(raw)
	if err != nil {
		return "", false
	}
	return addr.String(), true
}

func remoteIPFromAddr(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return remoteAddr
	}
	return host
}

func isTrustedProxy(ip string, trustedProxies []netip.Prefix) bool {
	if len(trustedProxies) == 0 {
		return false
	}

	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return false
	}

	for _, prefix := range trustedProxies {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

// redactIP anonymises an IP address for privacy compliance.
// IPv4: zeroes the last octet (192.168.1.42 → 192.168.1.0), keeping 24 bits.
// IPv6: zeroes the last 64 bits (interface identifier), keeping the top 64 bits
// (the /64 network prefix). This is the standard GDPR-compliant boundary —
// it removes host identity while preserving subnet-level attribution for abuse
// detection (e.g. 2001:db8:1:2::dead:beef → 2001:db8:1:2::).
// Returns the original string if parsing fails.
func redactIP(ip string) string {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return ip
	}

	if v4 := parsed.To4(); v4 != nil {
		v4[3] = 0
		return v4.String()
	}

	v6 := parsed.To16()
	for i := 8; i < 16; i++ {
		v6[i] = 0
	}
	return v6.String()
}
