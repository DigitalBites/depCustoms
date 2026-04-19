#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROUTES_DIR="$ROOT/src/routes"

violations=0

check_pattern() {
  local pattern="$1"
  local description="$2"
  local output

  output="$(rg -n "$pattern" "$ROUTES_DIR" \
    -g '!sse.ts' \
    -g '!internal.ts' \
    -g '!auth.ts' || true)"

  if [[ -n "$output" ]]; then
    echo "Validation regression: $description"
    echo "$output"
    echo
    violations=1
  fi
}

check_pattern 'parseInt\(c\.req\.query' 'manual query parsing should use shared query schemas'
check_pattern 'c\.req\.query\(' 'raw query reads should use zValidator("query", ...) except approved protocol handlers'

if [[ "$violations" -ne 0 ]]; then
  exit 1
fi

echo "Route validation checks passed."
