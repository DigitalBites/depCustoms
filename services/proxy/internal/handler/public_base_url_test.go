package handler

import "testing"

import "github.com/stretchr/testify/assert"

func TestSanitizeForwardedProtoValue(t *testing.T) {
	value, ok := sanitizeForwardedProtoValue("https")
	assert.True(t, ok)
	assert.Equal(t, "https", value)

	_, ok = sanitizeForwardedProtoValue("javascript")
	assert.False(t, ok)
}

func TestSanitizeForwardedPortValue(t *testing.T) {
	value, ok := sanitizeForwardedPortValue("8443")
	assert.True(t, ok)
	assert.Equal(t, "8443", value)

	_, ok = sanitizeForwardedPortValue("999999")
	assert.False(t, ok)
}

func TestSanitizeHostHeaderValueWithOK(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
		valid bool
	}{
		{name: "hostname", input: "packages.example.test", want: "packages.example.test", valid: true},
		{name: "hostname with port", input: "packages.example.test:8442", want: "packages.example.test:8442", valid: true},
		{name: "ipv4 with port", input: "192.168.64.2:8080", want: "192.168.64.2:8080", valid: true},
		{name: "ipv6 with port", input: "[2001:db8::1]:8442", want: "[2001:db8::1]:8442", valid: true},
		{name: "invalid slash", input: "packages.example.test/path", valid: false},
		{name: "invalid spaces", input: "packages example test", valid: false},
		{name: "invalid control", input: "packages.example.test\nx", valid: false},
		{name: "invalid port", input: "packages.example.test:999999", valid: false},
		{name: "header list uses first", input: "packages.example.test,evil.test", want: "packages.example.test", valid: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := sanitizeHostHeaderValueWithOK(tt.input)
			assert.Equal(t, tt.valid, ok)
			assert.Equal(t, tt.want, got)
		})
	}
}
