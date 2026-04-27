package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

func fingerprintParts(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(sum[:])
}
