#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=""

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
  REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
fi
CONFIG_DIR="${REPO_ROOT}/.customs-demo"
NPMRC_PATH="${CONFIG_DIR}/npmrc"
PIP_CONF_PATH="${CONFIG_DIR}/pip.conf"

DEFAULT_PROXY_ORIGIN="https://proxy-demo.depcustoms.com"
DEFAULT_DOCKER_REGISTRY="proxy-demo.depcustoms.com"

prompt() {
  local label="$1"
  local default_value="$2"
  local value

  if [ -n "$default_value" ]; then
    read -r -p "${label} [${default_value}]: " value
    printf '%s' "${value:-$default_value}"
  else
    read -r -p "${label}: " value
    printf '%s' "$value"
  fi
}

prompt_secret() {
  local label="$1"
  local value

  read -r -s -p "${label}: " value
  printf '\n' >&2
  printf '%s' "$value"
}

require_nonempty() {
  local name="$1"
  local value="$2"

  if [ -z "$value" ]; then
    echo "${name} is required." >&2
    exit 1
  fi
}

main() {
  echo "Configure local Docker builds to use the depCustoms demo proxy."
  echo "This writes token-bearing files under ${CONFIG_DIR}; that directory is gitignored."
  echo

  local proxy_origin
  local proxy_scheme
  local proxy_host
  local proxy_path
  local proxy_without_scheme
  local pip_index_url
  local docker_registry
  local project_token

  proxy_origin="$(prompt "Proxy origin" "$DEFAULT_PROXY_ORIGIN")"
  docker_registry="$(prompt "Docker registry host" "$DEFAULT_DOCKER_REGISTRY")"
  project_token="$(prompt_secret "Raw project token")"

  proxy_origin="${proxy_origin%/}"
  if [[ "$proxy_origin" == https://* ]]; then
    proxy_scheme="https"
    proxy_without_scheme="${proxy_origin#https://}"
  elif [[ "$proxy_origin" == http://* ]]; then
    proxy_scheme="http"
    proxy_without_scheme="${proxy_origin#http://}"
  else
    proxy_scheme="https"
    proxy_without_scheme="$proxy_origin"
    proxy_origin="https://${proxy_origin}"
  fi
  proxy_host="${proxy_without_scheme%%/*}"
  proxy_path="${proxy_without_scheme#"$proxy_host"}"
  pip_index_url="${proxy_scheme}://${project_token}@${proxy_host}${proxy_path}/pypi/simple"

  require_nonempty "Proxy origin" "$proxy_origin"
  require_nonempty "Docker registry host" "$docker_registry"
  require_nonempty "Raw project token" "$project_token"

  mkdir -p "$CONFIG_DIR"
  chmod 700 "$CONFIG_DIR"

  cat > "$NPMRC_PATH" <<EOF
registry=${proxy_origin}
//${proxy_host}/:_authToken=${project_token}
always-auth=true
replace-registry-host=always
EOF
  chmod 600 "$NPMRC_PATH"

cat > "$PIP_CONF_PATH" <<EOF
[global]
index-url = ${pip_index_url}
disable-pip-version-check = true
EOF
  chmod 600 "$PIP_CONF_PATH"

  echo
  echo "Wrote:"
  echo "  ${NPMRC_PATH}"
  echo "  ${PIP_CONF_PATH}"
  echo

  if command -v docker >/dev/null 2>&1; then
    echo "Logging Docker in to ${docker_registry}..."
    printf '%s' "$project_token" | docker login "$docker_registry" \
      --username customs \
      --password-stdin

    if ! docker buildx version >/dev/null 2>&1; then
      echo
      echo "Warning: Docker buildx was not found."
      echo "The depCustoms build overlay uses BuildKit secrets, which require BuildKit/buildx."
      echo "Install the Docker buildx plugin or use Docker Desktop before running the build."
    fi
  else
    echo "Docker CLI was not found; skipping docker login."
    echo "Run this later before building base images through the proxy:"
    echo "  echo '<raw-project-token>' | docker login ${docker_registry} --username customs --password-stdin"
  fi

  echo
  echo "Build with:"
  echo "  cd ${SCRIPT_DIR}"
  echo "  ./build-with-depcustoms-proxy.sh"
}

main "$@"
