#!/bin/sh

set -eu

BASE_URL="${INTELLIGENCE_BASE_URL:-}"
CASES_PATH="${INTELLIGENCE_CASES_PATH:-evaluation/npm_sanity_cases.json}"
BEARER_TOKEN_ENV="${INTELLIGENCE_BEARER_TOKEN_ENV:-INTELLIGENCE_BEARER_TOKEN}"
BEARER_TOKEN="$(printenv "$BEARER_TOKEN_ENV" 2>/dev/null || true)"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required for scripts/check_sanity.sh" >&2
  exit 1
fi

if [ -z "$BASE_URL" ]; then
  echo "error: missing INTELLIGENCE_BASE_URL" >&2
  echo "hint: export INTELLIGENCE_BASE_URL=http://localhost:8001" >&2
  exit 1
fi

if [ -z "$BEARER_TOKEN" ]; then
  echo "error: missing bearer token env var: $BEARER_TOKEN_ENV" >&2
  echo "hint: export $BEARER_TOKEN_ENV=<token>" >&2
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
  http_code="$(
    curl -sS \
      -o "$response_file" \
      -w '%{http_code}' \
      "${BASE_URL}/check" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer ${BEARER_TOKEN}" \
      -d "$payload"
  )"
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
