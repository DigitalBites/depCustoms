#!/usr/bin/env bash
set -Eeuo pipefail

readonly AUTH_PID_FILE="/tmp/customs-auth.pid"
readonly API_PID_FILE="/tmp/customs-api.pid"
readonly PROXY_PID_FILE="/tmp/customs-proxy.pid"
readonly DASHBOARD_PID_FILE="/tmp/customs-dashboard.pid"
readonly BOOTSTRAP_ENV_FILE="/tmp/customs-bootstrap.env"

log() {
  printf '[all-in-one] %s\n' "$*"
}

extract_search_path() {
  local url="$1"
  if [[ "$url" =~ (^|[?\&])search_path=([^&#]+) ]]; then
    local search_path="${BASH_REMATCH[2]}"
    printf '%s\n' "${search_path%%,*}"
    return 0
  fi
  return 1
}

append_search_path() {
  local url="$1"
  local schema="$2"
  if [[ "$url" == *"search_path="* ]]; then
    printf '%s\n' "$url"
    return
  fi
  if [[ "$url" == *\?* ]]; then
    printf '%s&search_path=%s\n' "$url" "$schema"
  else
    printf '%s?search_path=%s\n' "$url" "$schema"
  fi
}

cleanup() {
  local code=$?
  for pid_file in "$DASHBOARD_PID_FILE" "$PROXY_PID_FILE" "$API_PID_FILE" "$AUTH_PID_FILE"; do
    if [[ -f "$pid_file" ]]; then
      local pid
      pid="$(cat "$pid_file")"
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
      fi
    fi
  done
  wait || true
  exit "$code"
}

trap cleanup INT TERM EXIT

: "${DEPLOYMENT_MODE:=all_in_one}"
: "${BOOTSTRAP_MODE:=bundled}"
: "${BOOTSTRAP_ALLOW_SECRET_GENERATION:=true}"
: "${BOOTSTRAP_DATA_DIR:=/app/data}"
: "${BOOTSTRAP_SETUP_GOTRUE:=true}"
: "${BOOTSTRAP_SETUP_FIRST_TENANT:=true}"
: "${BOOTSTRAP_SETUP_FIRST_PROXY:=true}"
: "${BOOTSTRAP_SETUP_DEFAULT_POLICIES:=true}"
: "${BOOTSTRAP_DEFAULT_TENANT_NAME:=default-first-tenant}"
: "${BOOTSTRAP_DEFAULT_PROXY_NAME:=bundled-proxy}"
: "${API_PORT:=3000}"
: "${DASHBOARD_PORT:=3001}"
: "${GOTRUE_PORT:=9999}"
: "${PROXY_PORT:=8080}"
: "${PROXY_ENABLED:=true}"
: "${AUTH_PROXY_ENABLED:=true}"
: "${DASHBOARD_API_PROXY_ENABLED:=true}"
: "${ALL_IN_ONE_CADDY_HTTPS_HOST:=localhost}"
: "${ALL_IN_ONE_CADDY_HTTPS_PORT:=443}"
: "${ALL_IN_ONE_PUBLIC_ORIGIN:=}"

: "${GOTRUE_URL:=http://127.0.0.1:${GOTRUE_PORT}}"
: "${API_INTERNAL_URL:=http://127.0.0.1:${API_PORT}}"
: "${PROXY_CONTROL_PLANE_URL:=http://127.0.0.1:${API_PORT}}"

: "${GOTRUE_API_HOST:=0.0.0.0}"
: "${GOTRUE_DB_DRIVER:=postgres}"
: "${GOTRUE_DISABLE_SIGNUP:=false}"
: "${GOTRUE_JWT_ADMIN_ROLES:=service_role}"
: "${GOTRUE_JWT_AUD:=authenticated}"
: "${GOTRUE_JWT_EXP:=3600}"
: "${GOTRUE_SESSIONS_INACTIVITY_TIMEOUT:=2h}"
: "${GOTRUE_SESSIONS_TIMEBOX:=10h}"
: "${GOTRUE_EXTERNAL_EMAIL_ENABLED:=true}"
: "${GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED:=false}"
: "${GOTRUE_OAUTH_SERVER_ENABLED:=true}"
: "${GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION:=true}"
: "${GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH:=/auth/oauth/authorize}"
: "${GOTRUE_MAILER_AUTOCONFIRM:=true}"
: "${GOTRUE_MAILER_URLPATHS_INVITE:=/auth/v1/verify}"
: "${GOTRUE_MAILER_URLPATHS_CONFIRMATION:=/auth/v1/verify}"
: "${GOTRUE_MAILER_URLPATHS_RECOVERY:=/auth/v1/verify}"
: "${GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE:=/auth/v1/verify}"
: "${GOTRUE_SMTP_ADMIN_EMAIL:=admin@example.com}"
: "${GOTRUE_SMTP_HOST:=mail}"
: "${GOTRUE_SMTP_PORT:=2500}"
: "${GOTRUE_SMTP_USER:=}"
: "${GOTRUE_SMTP_PASS:=}"
: "${GOTRUE_SMTP_SENDER_NAME:=Customs}"
: "${GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED:=true}"
: "${GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI:=http://127.0.0.1:${API_PORT}/internal/auth/token-hook}"
: "${PROXY_NPM_METADATA_MAX_BYTES:=100048576}"
: "${PROXY_PYPI_METADATA_MAX_BYTES:=2097152}"
: "${CONNECTOR_OSV_CACHE_TTL_SECONDS:=604800}"
: "${API_REQUEST_BODY_LIMIT_BYTES:=50048576}"
: "${API_RECORD_USAGE_MAX_EVENTS:=1000}"

build_public_https_origin() {
  local host="$1"
  local port="$2"
  if [[ "$port" == "443" ]]; then
    printf 'https://%s\n' "$host"
  else
    printf 'https://%s:%s\n' "$host" "$port"
  fi
}

if [[ -z "${ALL_IN_ONE_PUBLIC_ORIGIN}" ]]; then
  export ALL_IN_ONE_PUBLIC_ORIGIN
  ALL_IN_ONE_PUBLIC_ORIGIN="$(build_public_https_origin "${ALL_IN_ONE_CADDY_HTTPS_HOST}" "${ALL_IN_ONE_CADDY_HTTPS_PORT}")"
fi

if [[ -n "${ALL_IN_ONE_PUBLIC_ORIGIN}" ]]; then
  if [[ -z "${AUTH_URL:-}" ]]; then
    export AUTH_URL="${ALL_IN_ONE_PUBLIC_ORIGIN}"
  fi
  if [[ -z "${GOTRUE_SITE_URL:-}" ]]; then
    export GOTRUE_SITE_URL="${ALL_IN_ONE_PUBLIC_ORIGIN}"
  fi
  if [[ -z "${GOTRUE_API_EXTERNAL_URL:-}" ]]; then
    export GOTRUE_API_EXTERNAL_URL="${ALL_IN_ONE_PUBLIC_ORIGIN}"
  fi
fi

: "${AUTH_URL:=http://127.0.0.1:${API_PORT}}"
: "${GOTRUE_API_EXTERNAL_URL:=http://localhost:${API_PORT}}"
: "${GOTRUE_SITE_URL:=http://localhost:${DASHBOARD_PORT}}"

if [[ -z "${GOTRUE_URI_ALLOW_LIST:-}" ]]; then
  export GOTRUE_URI_ALLOW_LIST="${GOTRUE_SITE_URL},${GOTRUE_API_EXTERNAL_URL}"
fi

if [[ -z "${GOTRUE_DB_SCHEMA:-}" ]]; then
  if [[ -n "${GOTRUE_DB_DATABASE_URL:-}" ]]; then
    if parsed_schema="$(extract_search_path "${GOTRUE_DB_DATABASE_URL}")"; then
      export GOTRUE_DB_SCHEMA="${parsed_schema}"
    else
      export GOTRUE_DB_SCHEMA="auth"
    fi
  else
    export GOTRUE_DB_SCHEMA="auth"
  fi
fi

if [[ -z "${GOTRUE_DB_DATABASE_URL:-}" && -n "${DATABASE_URL:-}" ]]; then
  export GOTRUE_DB_DATABASE_URL
  GOTRUE_DB_DATABASE_URL="$(append_search_path "$DATABASE_URL" "$GOTRUE_DB_SCHEMA")"
fi

if [[ -z "${API_CORS_ORIGIN:-}" ]]; then
  export API_CORS_ORIGIN="${GOTRUE_SITE_URL}"
fi

if [[ -z "${PROXY_WAL_PATH:-}" ]]; then
  export PROXY_WAL_PATH="/app/data/events.ndjson"
fi

if [[ -z "${PROXY_CHECKPOINT_PATH:-}" ]]; then
  export PROXY_CHECKPOINT_PATH="/app/data/events.checkpoint"
fi

if [[ -z "${NEXT_PUBLIC_AUTH_URL:-}" ]]; then
  if [[ -n "${ALL_IN_ONE_PUBLIC_ORIGIN}" ]]; then
    export NEXT_PUBLIC_AUTH_URL="${ALL_IN_ONE_PUBLIC_ORIGIN}"
  else
    export NEXT_PUBLIC_AUTH_URL="${GOTRUE_SITE_URL}"
  fi
fi

if [[ -z "${NEXT_PUBLIC_API_URL:-}" ]]; then
  if [[ -n "${ALL_IN_ONE_PUBLIC_ORIGIN}" ]]; then
    export NEXT_PUBLIC_API_URL="${ALL_IN_ONE_PUBLIC_ORIGIN}"
  elif [[ "${DASHBOARD_API_PROXY_ENABLED}" == "true" ]]; then
    export NEXT_PUBLIC_API_URL="${GOTRUE_SITE_URL}"
  else
    export NEXT_PUBLIC_API_URL="${GOTRUE_API_EXTERNAL_URL}"
  fi
fi

run_bootstrap() {
  log "running bundled bootstrap"
  node /app/api/dist/bin/all-in-one-bootstrap.js > "$BOOTSTRAP_ENV_FILE"
  # shellcheck disable=SC1090
  source "$BOOTSTRAP_ENV_FILE"
  if [[ -z "${NEXT_PUBLIC_GOTRUE_ANON_KEY:-}" && -n "${GOTRUE_ANON_KEY:-}" ]]; then
    export NEXT_PUBLIC_GOTRUE_ANON_KEY="${GOTRUE_ANON_KEY}"
  fi
  rm -f "$BOOTSTRAP_ENV_FILE"
}

run_api_db_push() {
  log "running API schema push"
  (
    cd /app/api
    node dist/bin/all-in-one-db-push.js
  )
}

run_bundled_init() {
  log "running bundled bootstrap initialization"
  node /app/api/dist/bin/all-in-one-init.js
}

ensure_gotrue_schema() {
  log "ensuring GoTrue schema ${GOTRUE_DB_SCHEMA} exists"
  (
    cd /app/api
    node dist/bin/all-in-one-ensure-gotrue-schema.js
  )
}

wait_for_http() {
  local url="$1"
  local name="$2"
  local attempts="${3:-60}"

  for ((i=1; i<=attempts; i++)); do
    if wget -qO- "$url" >/dev/null 2>&1; then
      log "$name is ready at $url"
      return 0
    fi
    sleep 1
  done

  log "$name failed readiness check at $url"
  return 1
}

start_auth() {
  log "starting GoTrue on port ${GOTRUE_PORT}"
  env \
    PORT="${GOTRUE_PORT}" \
    GOTRUE_API_HOST="${GOTRUE_API_HOST}" \
    API_EXTERNAL_URL="${GOTRUE_API_EXTERNAL_URL}" \
    GOTRUE_SITE_URL="${GOTRUE_SITE_URL}" \
    GOTRUE_URI_ALLOW_LIST="${GOTRUE_URI_ALLOW_LIST}" \
    GOTRUE_DB_DRIVER="${GOTRUE_DB_DRIVER}" \
    GOTRUE_DB_DATABASE_URL="${GOTRUE_DB_DATABASE_URL}" \
    GOTRUE_DISABLE_SIGNUP="${GOTRUE_DISABLE_SIGNUP}" \
    GOTRUE_JWT_ADMIN_ROLES="${GOTRUE_JWT_ADMIN_ROLES}" \
    GOTRUE_JWT_AUD="${GOTRUE_JWT_AUD}" \
    GOTRUE_JWT_EXP="${GOTRUE_JWT_EXP}" \
    GOTRUE_JWT_SECRET="${GOTRUE_JWT_SECRET}" \
    GOTRUE_JWT_KEYS="${GOTRUE_JWT_KEYS}" \
    GOTRUE_SESSIONS_INACTIVITY_TIMEOUT="${GOTRUE_SESSIONS_INACTIVITY_TIMEOUT}" \
    GOTRUE_SESSIONS_TIMEBOX="${GOTRUE_SESSIONS_TIMEBOX}" \
    GOTRUE_EXTERNAL_EMAIL_ENABLED="${GOTRUE_EXTERNAL_EMAIL_ENABLED}" \
    GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED="${GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED}" \
    GOTRUE_OAUTH_SERVER_ENABLED="${GOTRUE_OAUTH_SERVER_ENABLED}" \
    GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION="${GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION}" \
    GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH="${GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH}" \
    GOTRUE_MAILER_AUTOCONFIRM="${GOTRUE_MAILER_AUTOCONFIRM}" \
    GOTRUE_MAILER_URLPATHS_INVITE="${GOTRUE_MAILER_URLPATHS_INVITE}" \
    GOTRUE_MAILER_URLPATHS_CONFIRMATION="${GOTRUE_MAILER_URLPATHS_CONFIRMATION}" \
    GOTRUE_MAILER_URLPATHS_RECOVERY="${GOTRUE_MAILER_URLPATHS_RECOVERY}" \
    GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE="${GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE}" \
    GOTRUE_SMTP_ADMIN_EMAIL="${GOTRUE_SMTP_ADMIN_EMAIL}" \
    GOTRUE_SMTP_HOST="${GOTRUE_SMTP_HOST}" \
    GOTRUE_SMTP_PORT="${GOTRUE_SMTP_PORT}" \
    GOTRUE_SMTP_USER="${GOTRUE_SMTP_USER}" \
    GOTRUE_SMTP_PASS="${GOTRUE_SMTP_PASS}" \
    GOTRUE_SMTP_SENDER_NAME="${GOTRUE_SMTP_SENDER_NAME}" \
    GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED="${GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED}" \
    GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI="${GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI}" \
    GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS="${GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS}" \
    /app/bin/auth &
  echo $! > "$AUTH_PID_FILE"
  wait_for_http "http://127.0.0.1:${GOTRUE_PORT}/health" "gotrue"
}

start_api() {
  log "starting API on port ${API_PORT}"
  (
    cd /app/api
    env \
      PORT="${API_PORT}" \
      AUTH_URL="${AUTH_URL}" \
      GOTRUE_URL="${GOTRUE_URL}" \
      node dist/index.js
  ) &
  echo $! > "$API_PID_FILE"
  wait_for_http "http://127.0.0.1:${API_PORT}/healthz" "api"
}

start_proxy() {
  if [[ "${PROXY_ENABLED}" != "true" ]]; then
    log "proxy disabled; skipping startup"
    return 0
  fi
  if [[ -z "${PROXY_ID:-}" || -z "${PROXY_CONTROL_PLANE_SECRET:-}" || "${PROXY_CONTROL_PLANE_SECRET}" == "replace-me" ]]; then
    log "proxy enabled but PROXY_ID/PROXY_CONTROL_PLANE_SECRET is not configured"
    return 1
  fi
  log "starting proxy on port ${PROXY_PORT}"
  env \
    PROXY_PORT="${PROXY_PORT}" \
    PROXY_CONTROL_PLANE_URL="${PROXY_CONTROL_PLANE_URL}" \
    /app/bin/proxy &
  echo $! > "$PROXY_PID_FILE"
  wait_for_http "http://127.0.0.1:${PROXY_PORT}/healthz" "proxy"
}

start_dashboard() {
  log "starting dashboard on port ${DASHBOARD_PORT}"
  (
    cd /app/dashboard
    env \
      PORT="${DASHBOARD_PORT}" \
      PUBLIC_ORIGIN="${ALL_IN_ONE_PUBLIC_ORIGIN:-}" \
      AUTH_URL="${API_INTERNAL_URL}" \
      API_INTERNAL_URL="${API_INTERNAL_URL}" \
      /app/dashboard/node_modules/.bin/next start -p "${DASHBOARD_PORT}"
  ) &
  echo $! > "$DASHBOARD_PID_FILE"
  wait_for_http "http://127.0.0.1:${DASHBOARD_PORT}" "dashboard"
}

run_bootstrap
run_api_db_push
run_bundled_init
ensure_gotrue_schema
start_auth
start_api
start_proxy
start_dashboard

log "all services started"

wait_targets=(
  "$(cat "$AUTH_PID_FILE")"
  "$(cat "$API_PID_FILE")"
  "$(cat "$DASHBOARD_PID_FILE")"
)

if [[ -f "$PROXY_PID_FILE" ]]; then
  wait_targets+=("$(cat "$PROXY_PID_FILE")")
fi

wait -n "${wait_targets[@]}"
log "one managed process exited; shutting down"
exit 1
