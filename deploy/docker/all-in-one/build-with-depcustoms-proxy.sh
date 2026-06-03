#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

find_repo_root() {
  local dir="$SCRIPT_DIR"

  while [ "$dir" != "/" ]; do
    if [ -d "${dir}/.git" ]; then
      printf '%s' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done

  return 1
}

REPO_ROOT="$(find_repo_root || true)"
if [ -z "$REPO_ROOT" ]; then
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
fi

cd "$SCRIPT_DIR"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  compose_cmd=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  compose_cmd=(docker-compose)
else
  echo "Docker Compose was not found. Install Docker Compose v2 or docker-compose." >&2
  exit 1
fi

if command -v docker >/dev/null 2>&1 && ! docker buildx version >/dev/null 2>&1; then
  echo "Docker buildx was not found." >&2
  echo "BuildKit secrets require the Docker buildx plugin." >&2
  echo "Install buildx or use Docker Desktop, then rerun this script." >&2
  exit 1
fi

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1
export CUSTOMS_BUILD_NPMRC="${CUSTOMS_BUILD_NPMRC:-${REPO_ROOT}/.customs-demo/npmrc}"
export CUSTOMS_BUILD_PIP_CONF="${CUSTOMS_BUILD_PIP_CONF:-${REPO_ROOT}/.customs-demo/pip.conf}"

if [ ! -f "$CUSTOMS_BUILD_NPMRC" ]; then
  echo "npm build config was not found: ${CUSTOMS_BUILD_NPMRC}" >&2
  echo "Run ./setup-depcustoms-build-proxy.sh first, or set CUSTOMS_BUILD_NPMRC." >&2
  exit 1
fi

if [ ! -f "$CUSTOMS_BUILD_PIP_CONF" ]; then
  echo "pip build config was not found: ${CUSTOMS_BUILD_PIP_CONF}" >&2
  echo "Run ./setup-depcustoms-build-proxy.sh first, or set CUSTOMS_BUILD_PIP_CONF." >&2
  exit 1
fi

exec "${compose_cmd[@]}" \
  -f docker-compose.yml \
  -f docker-compose.depcustoms-build.yml \
  build "$@"
