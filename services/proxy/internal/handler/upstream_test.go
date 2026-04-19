package handler

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSanitizePassthroughHeaders_StripsSensitiveHeadersCaseInsensitively(t *testing.T) {
	input := http.Header{
		"Authorization":       {"Bearer token"},
		"Proxy-Authorization": {"Basic abc"},
		"cOnNection":          {"keep-alive"},
		"X-Forwarded-For":     {"1.2.3.4"},
		"User-Agent":          {"npm/10"},
		"Accept":              {"application/json"},
	}

	output, inbound, forwarded, dropped := sanitizePassthroughHeaders(input)

	assert.Equal(t, []string{
		"Accept",
		"Authorization",
		"Proxy-Authorization",
		"User-Agent",
		"X-Forwarded-For",
		"cOnNection",
	}, inbound)
	assert.Equal(t, []string{"Accept", "User-Agent"}, forwarded)
	assert.Equal(t, []string{
		"Authorization",
		"Proxy-Authorization",
		"X-Forwarded-For",
		"cOnNection",
	}, dropped)
	assert.Equal(t, http.Header{
		"Accept":     {"application/json"},
		"User-Agent": {"npm/10"},
	}, output)
}
