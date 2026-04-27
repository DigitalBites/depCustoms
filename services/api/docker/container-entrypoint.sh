#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '[api-container] %s\n' "$*"
}

: "${API_PORT:=3000}"
: "${BOOTSTRAP_MODE:=bundled}"
: "${BOOTSTRAP_SETUP_GOTRUE:=true}"
: "${BOOTSTRAP_SETUP_FIRST_TENANT:=true}"
: "${BOOTSTRAP_SETUP_FIRST_PROXY:=false}"
: "${BOOTSTRAP_SETUP_DEFAULT_POLICIES:=true}"
: "${GOTRUE_DB_SCHEMA:=auth}"

if [[ -z "${API_CORS_ORIGIN:-}" && -n "${GOTRUE_SITE_URL:-}" ]]; then
  export API_CORS_ORIGIN="${GOTRUE_SITE_URL}"
fi

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    printf '[api-container] missing required environment variable: %s\n' "$name" >&2
    exit 1
  fi
}

validate_required_env() {
  require_env "DATABASE_URL"
  require_env "AUTH_URL"
  require_env "GOTRUE_URL"
  require_env "GOTRUE_ANON_KEY"
  require_env "GOTRUE_SERVICE_ROLE_KEY"
  require_env "GOTRUE_HOOK_SECRET"
  require_env "GOTRUE_DB_DATABASE_URL"
  require_env "INTERNAL_SERVICE_JWT_PRIVATE_JWK"
}

validate_bootstrap_env() {
  if [[ "${BOOTSTRAP_MODE}" != "bundled" ]]; then
    return
  fi

  if [[ "${BOOTSTRAP_SETUP_FIRST_PROXY}" == "true" ]]; then
    require_env "BOOTSTRAP_PROXY_ID"
    require_env "BOOTSTRAP_PROXY_KEY"
  fi
}

run_api_db_push() {
  log "running API schema push"
  (
    cd /app/api
    node dist/bin/bundled-db-push.js
  )
}

run_bundled_init() {
  log "running bundled bootstrap initialization"
  node /app/api/dist/bin/bundled-init.js
}

ensure_gotrue_schema() {
  log "ensuring GoTrue schema ${GOTRUE_DB_SCHEMA} exists"
  (
    cd /app/api
    node dist/bin/bundled-ensure-gotrue-schema.js
  )
}

validate_required_env
validate_bootstrap_env
run_api_db_push
run_bundled_init
ensure_gotrue_schema

log "starting API on port ${API_PORT}"
cd /app/api
exec env PORT="${API_PORT}" node dist/index.js
