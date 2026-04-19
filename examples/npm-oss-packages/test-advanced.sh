#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=./.helper.sh
source "${SCRIPT_DIR}/.helper.sh"

cleanup_demo_artifacts() {
  rm -rf "${DATA_DIR}/node_modules" "${DATA_DIR}/package-lock.json" "${DATA_DIR}/package.json"
}

trap cleanup_demo_artifacts EXIT

ensure_demo_setup

PASS=0
BLOCKED=0
ERROR=0

blocked() { echo "[BLOCKED] $1 - proxy enforced policy (E403)"; ((BLOCKED++)); }
pass()    { echo "[PASS]    $1 - allowed through"; ((PASS++)); }
error()   { echo "[ERROR]   $1 - unexpected failure (not a proxy block)"; ((ERROR++)); }

reset_package_json() {
  cat > package.json <<'EOF'
{
  "name": "customs-test",
  "version": "1.0.0",
  "private": true
}
EOF
  rm -rf node_modules package-lock.json
}

run_install() {
  local label="$1"
  shift
  reset_package_json
  local output
  local exit_code
  set +e
  output=$(npm install "$@" --save-dev 2>&1)
  exit_code=$?
  set -e

  if [[ ${exit_code} -eq 0 ]]; then
    pass "$label"
  elif echo "$output" | grep -q "code E403"; then
    blocked "$label"
  else
    error "$label"
    echo "$output" | grep -E "npm error code|npm error 403" | head -3 | sed 's/^/          /'
  fi
  rm -rf node_modules package-lock.json package.json
}

cd "${DATA_DIR}"
print_registry_banner

npm cache clean --force > /dev/null 2>&1

echo "--- Direct dependency tests ---"
echo ""

run_install \
  "serialize-javascript@2.1.1  (HIGH CVE - RCE via RegExp.flags)" \
  serialize-javascript@2.1.1

run_install \
  "lodash@4.17.15              (HIGH CVE - ReDoS)" \
  lodash@4.17.15

run_install \
  "minimist@0.2.0              (CRITICAL CVE - prototype pollution)" \
  minimist@0.2.0

run_install \
  "node-serialize@0.0.4        (CRITICAL CVE - RCE via IIFE, no fix exists)" \
  node-serialize@0.0.4

echo ""
echo "--- Transitive dependency tests ---"
echo ""

run_install \
  "webpack@4                   (transitive serialize-javascript - user asked for webpack, not serialize-javascript)" \
  webpack@4 --legacy-peer-deps

run_install \
  "mocha@5.2.0                 (transitive minimist@0.0.8 - test runner as attack surface)" \
  mocha@5.2.0

run_install \
  "mkdirp@0.5.1                (transitive minimist@0.0.8 - two levels deep)" \
  mkdirp@0.5.1

run_install \
  "handlebars@4.5.2            (CRITICAL - prototype pollution -> RCE, CVE-2019-19919)" \
  handlebars@4.5.2

echo ""
echo "============================================================"
echo "  Results"
echo "  BLOCKED (proxy enforced policy): $BLOCKED"
echo "  PASS    (allowed through):       $PASS"
echo "  ERROR   (unexpected failure):    $ERROR"
echo "============================================================"
echo ""
