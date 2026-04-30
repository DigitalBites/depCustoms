#!/usr/bin/env sh
set -eu

: "${API_PORT:=3000}"

wget -qO- "http://127.0.0.1:${API_PORT}/healthz" >/dev/null
