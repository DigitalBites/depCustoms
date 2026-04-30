package handler

import (
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"
)

func resolveEffectivePublicBaseURL(
	r *http.Request,
	configuredBaseURL string,
	allowedBaseURLs []string,
	trustedProxies []netip.Prefix,
) string {
	peerIP := remoteIPFromAddr(r.RemoteAddr)
	trustForwarded := isTrustedProxy(peerIP, trustedProxies)
	requestBaseURL := strings.TrimRight(derivePublicBaseURLFromRequest(r, trustForwarded), "/")
	chosenBaseURL, decisionSource := choosePublicBaseURL(
		strings.TrimRight(configuredBaseURL, "/"),
		allowedBaseURLs,
		requestBaseURL,
	)

	slog.Debug("public base url resolved",
		"service", "proxy",
		"decision_source", decisionSource,
		"configured_base_url", configuredBaseURL,
		"allowed_base_urls", allowedBaseURLs,
		"request_base_url", requestBaseURL,
		"resolved_base_url", chosenBaseURL,
		"trusted_proxy_peer", trustForwarded,
		"remote_addr", r.RemoteAddr,
		"host", r.Host,
		"x_forwarded_host", strings.TrimSpace(r.Header.Get("X-Forwarded-Host")),
		"x_forwarded_proto", strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")),
		"x_forwarded_port", strings.TrimSpace(r.Header.Get("X-Forwarded-Port")),
		"x_real_ip", strings.TrimSpace(r.Header.Get("X-Real-IP")),
		"x_forwarded_for", strings.TrimSpace(r.Header.Get("X-Forwarded-For")),
	)

	return chosenBaseURL
}

func choosePublicBaseURL(
	configuredBaseURL string,
	allowedBaseURLs []string,
	requestBaseURL string,
) (string, string) {
	if configuredBaseURL != "" && requestBaseURL == configuredBaseURL {
		return configuredBaseURL, "configured_match"
	}

	if len(allowedBaseURLs) > 0 {
		for _, allowedBaseURL := range allowedBaseURLs {
			if requestBaseURL == allowedBaseURL {
				return allowedBaseURL, "allowlist_match"
			}
		}
		if configuredBaseURL != "" {
			return configuredBaseURL, "configured_fallback"
		}
		return allowedBaseURLs[0], "allowlist_default"
	}

	if configuredBaseURL != "" {
		return configuredBaseURL, "configured"
	}

	return requestBaseURL, "request"
}

func derivePublicBaseURLFromRequest(r *http.Request, trustForwarded bool) string {
	scheme := "http"
	host := sanitizeHostHeaderValue(r.Host)

	if r.TLS != nil {
		scheme = "https"
	}

	if trustForwarded {
		if forwardedProto, ok := sanitizeForwardedProtoValue(r.Header.Get("X-Forwarded-Proto")); ok {
			scheme = forwardedProto
		}
		if forwardedHost, ok := sanitizeHostHeaderValueWithOK(r.Header.Get("X-Forwarded-Host")); ok {
			host = forwardedHost
		} else {
			if forwardedPort, ok := sanitizeForwardedPortValue(r.Header.Get("X-Forwarded-Port")); ok && host != "" && !hostIncludesPort(host) {
				host = fmt.Sprintf("%s:%s", host, forwardedPort)
			}
		}
	}

	if host == "" {
		host = "localhost"
	}

	return fmt.Sprintf("%s://%s", scheme, host)
}

func sanitizeForwardedProtoValue(raw string) (string, bool) {
	value := firstHeaderValue(raw)
	switch value {
	case "http", "https":
		return value, true
	default:
		return "", false
	}
}

func sanitizeForwardedPortValue(raw string) (string, bool) {
	value := firstHeaderValue(raw)
	if value == "" || len(value) > 5 {
		return "", false
	}
	port, err := strconv.Atoi(value)
	if err != nil || port < 1 || port > 65535 {
		return "", false
	}
	return value, true
}

func sanitizeHostHeaderValue(raw string) string {
	value, _ := sanitizeHostHeaderValueWithOK(raw)
	return value
}

func sanitizeHostHeaderValueWithOK(raw string) (string, bool) {
	value := firstHeaderValue(raw)
	if value == "" || len(value) > 255 || !utf8.ValidString(value) {
		return "", false
	}
	if strings.ContainsAny(value, " \t\r\n/\x00") {
		return "", false
	}

	hostOnly := value
	portOnly := ""

	if strings.HasPrefix(value, "[") {
		host, port, err := net.SplitHostPort(value)
		if err == nil {
			hostOnly = host
			portOnly = port
		} else {
			hostOnly = value
		}
	} else if host, port, err := net.SplitHostPort(value); err == nil {
		hostOnly = host
		portOnly = port
	} else if strings.Count(value, ":") > 1 {
		// Bare IPv6 literal without port.
		hostOnly = value
	}

	if portOnly != "" {
		if _, ok := sanitizeForwardedPortValue(portOnly); !ok {
			return "", false
		}
	}

	if strings.HasPrefix(hostOnly, "[") && strings.HasSuffix(hostOnly, "]") {
		hostOnly = strings.TrimPrefix(strings.TrimSuffix(hostOnly, "]"), "[")
	}

	if hostOnly == "" {
		return "", false
	}

	if ip, err := netip.ParseAddr(hostOnly); err == nil {
		if portOnly != "" {
			if ip.Is6() {
				return fmt.Sprintf("[%s]:%s", ip.String(), portOnly), true
			}
			return fmt.Sprintf("%s:%s", ip.String(), portOnly), true
		}
		return ip.String(), true
	}

	parsedURL, err := url.Parse("http://" + value)
	if err != nil || parsedURL.Host != value || parsedURL.Hostname() == "" {
		return "", false
	}
	return value, true
}

func hostIncludesPort(host string) bool {
	if strings.HasPrefix(host, "[") {
		return strings.Contains(host, "]:")
	}
	return strings.Count(host, ":") == 1
}

func firstHeaderValue(raw string) string {
	value := strings.TrimSpace(strings.Split(raw, ",")[0])
	return strings.ToLower(value)
}
