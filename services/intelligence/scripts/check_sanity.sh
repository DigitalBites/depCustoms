#!/bin/sh

set -eu

BASE_URL="${INTELLIGENCE_BASE_URL:-http://localhost:8001}"
CASES_PATH="${INTELLIGENCE_CASES_PATH:-evaluation/npm_sanity_cases.json}"
BEARER_TOKEN="${INTELLIGENCE_BEARER_TOKEN:-}"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required for scripts/check_sanity.sh" >&2
  exit 1
fi

if [ ! -f "$CASES_PATH" ]; then
  echo "error: cases file not found: $CASES_PATH" >&2
  exit 1
fi

run_check() {
  label="$1"
  payload="$2"
  response_file="$(mktemp)"

  printf '\n== %s ==\n' "$label"
  printf '%s\n' "$payload" | jq .
  if [ -n "$BEARER_TOKEN" ]; then
    http_code="$(
      curl -sS \
        -o "$response_file" \
        -w '%{http_code}' \
        "${BASE_URL}/check" \
        -H 'Content-Type: application/json' \
        -H "Authorization: Bearer ${BEARER_TOKEN}" \
        -d "$payload"
    )"
  else
    http_code="$(
      curl -sS \
        -o "$response_file" \
        -w '%{http_code}' \
        "${BASE_URL}/check" \
        -H 'Content-Type: application/json' \
        -d "$payload"
    )"
  fi
  if jq . "$response_file" 2>/dev/null; then
    :
  else
    printf 'non-JSON response (HTTP %s):\n' "$http_code" >&2
    sed -n '1,120p' "$response_file" >&2
    rm -f "$response_file"
    return 1
  fi
  rm -f "$response_file"
}

jq -c '.[] | {label: .label, payload: {ecosystem: .ecosystem, package: .package, description: .description}}' "$CASES_PATH" |
while IFS= read -r case_json; do
  label=$(printf '%s' "$case_json" | jq -r '.label')
  payload=$(printf '%s' "$case_json" | jq -c '.payload')
  run_check "$label" "$payload"
done
