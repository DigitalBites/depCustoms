package handler

import (
	"regexp"
	"strings"

	"github.com/getcustoms/proxy/internal/taxonomy"
)

var pypiNormalizePattern = regexp.MustCompile(`[-_.]+`)

func canonicalEcosystem(ecosystem string) string {
	return strings.ToLower(strings.TrimSpace(ecosystem))
}

func canonicalPackageName(ecosystem, packageName string) string {
	canonicalEco := canonicalEcosystem(ecosystem)
	trimmed := strings.ToLower(strings.TrimSpace(packageName))
	if canonicalEco == taxonomy.EcosystemPyPI {
		return pypiNormalizePattern.ReplaceAllString(trimmed, "-")
	}
	return trimmed
}

func canonicalPackageVersion(version string) string {
	return strings.TrimSpace(version)
}

func canonicalPackageRequest(ecosystem string, req PackageRequest) PackageRequest {
	req.Package = canonicalPackageName(ecosystem, req.Package)
	req.Version = canonicalPackageVersion(req.Version)
	return req
}
