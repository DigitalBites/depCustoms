#!/usr/bin/env sh
set -eu

: "${API_PORT:=3000}"
: "${DASHBOARD_PORT:=3001}"
: "${GOTRUE_PORT:=9999}"
: "${PROXY_PORT:=8080}"
: "${PROXY_ENABLED:=false}"

wget -qO- "http://127.0.0.1:${GOTRUE_PORT}/health" >/dev/null
wget -qO- "http://127.0.0.1:${API_PORT}/healthz" >/dev/null
if [ "${PROXY_ENABLED}" = "true" ]; then
  wget -qO- "http://127.0.0.1:${PROXY_PORT}/healthz" >/dev/null
fi
wget -qO- "http://127.0.0.1:${DASHBOARD_PORT}" >/dev/null
