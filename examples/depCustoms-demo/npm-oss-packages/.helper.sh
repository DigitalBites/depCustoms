#!/usr/bin/env bash

set -euo pipefail

readonly DEMO_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly DATA_DIR="${DEMO_DIR}/data"
readonly NPMRC_PATH="${DEMO_DIR}/.npmrc"

ensure_demo_setup() {
  mkdir -p "${DATA_DIR}"

  if [[ -f "${NPMRC_PATH}" ]]; then
    export_npm_userconfig
    return 0
  fi

  echo ""
  echo "No local .npmrc found for this demo."
  echo ""
  echo "Generate a project token in the Customs UI:"
  echo "1. Open the dashboard."
  echo "2. Go to Projects."
  echo "3. Open the project you want this demo to use."
  echo "4. Open the Tokens page."
  echo "5. Create a token and copy the raw value."
  echo ""

  local registry_url=""
  local project_token=""

  read -r -p "Registry URL (example: https://proxy-demo.depcustoms.com): " registry_url
  if [[ -z "${registry_url}" ]]; then
    echo "Registry URL is required." >&2
    return 1
  fi

  prompt_secret "Project token: " project_token
  if [[ -z "${project_token}" ]]; then
    echo "Project token is required." >&2
    return 1
  fi

  write_npmrc "${registry_url}" "${project_token}"
  export_npm_userconfig

  echo ""
  echo "Created ${NPMRC_PATH}"
  echo "Using registry: ${registry_url}"
  echo "Forced npm config: ${NPM_CONFIG_USERCONFIG}"
  echo ""
}

export_npm_userconfig() {
  export NPM_CONFIG_USERCONFIG="${NPMRC_PATH}"
}

prompt_secret() {
  local prompt="$1"
  local __resultvar="$2"
  local input=""
  local char=""

  printf "%s" "${prompt}"

  while IFS= read -r -s -n 1 char; do
    if [[ -z "${char}" || "${char}" == $'\n' || "${char}" == $'\r' ]]; then
      break
    fi

    if [[ "${char}" == $'\177' || "${char}" == $'\b' ]]; then
      if [[ -n "${input}" ]]; then
        input="${input%?}"
        printf '\b \b'
      fi
      continue
    fi

    input+="${char}"
    printf '*'
  done

  printf '\n'
  printf -v "${__resultvar}" '%s' "${input}"
}

write_npmrc() {
  local registry_url="$1"
  local project_token="$2"
  local normalized_registry="${registry_url%/}"
  local registry_host="${normalized_registry#http://}"
  registry_host="${registry_host#https://}"

  cat > "${NPMRC_PATH}" <<EOF
registry=${normalized_registry}
//${registry_host}/:_authToken=${project_token}
EOF
}

read_npmrc_value() {
  local key="$1"
  local value=""

  if [[ -f "${NPMRC_PATH}" ]]; then
    value="$(grep -E "^${key}=" "${NPMRC_PATH}" | tail -n 1 | cut -d= -f2- || true)"
  fi

  printf '%s\n' "${value}"
}

print_registry_banner() {
  echo ""
  echo "============================================================"
  echo "  depCustoms npm OSS package demo"
  echo "  Registry: $(read_npmrc_value "registry")"
  echo "  Working dir: ${DATA_DIR}"
  echo "  npm config: ${NPM_CONFIG_USERCONFIG}"
  echo "============================================================"
  echo ""
}
