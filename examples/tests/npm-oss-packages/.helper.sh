#!/usr/bin/env bash

set -euo pipefail

readonly DEMO_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly DATA_DIR="${DEMO_DIR}/data"
readonly NPMRC_PATH="${DEMO_DIR}/.npmrc"
readonly CERT_PATH="${DATA_DIR}/depCustoms-root.crt"

ensure_demo_setup() {
  mkdir -p "${DATA_DIR}"

  if [[ -f "${NPMRC_PATH}" ]]; then
    ensure_existing_npmrc_tls_config
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

  read -r -p "Registry URL (example: http://localhost:8080): " registry_url
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
  ensure_registry_tls_config "${registry_url}"
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

ensure_existing_npmrc_tls_config() {
  local registry_url
  registry_url="$(read_npmrc_value "registry")"

  if [[ -z "${registry_url}" ]]; then
    return 0
  fi

  ensure_registry_tls_config "${registry_url}"
}

ensure_registry_tls_config() {
  local registry_url="$1"

  if [[ "${registry_url}" != https://* ]]; then
    return 0
  fi

  if npmrc_uses_demo_cafile && [[ -f "${CERT_PATH}" ]]; then
    return 0
  fi

  fetch_registry_root_cert "${registry_url}"
  upsert_npmrc_cafile
}

fetch_registry_root_cert() {
  local registry_url="$1"
  local normalized_registry="${registry_url%/}"
  local cert_url="${normalized_registry}/root.crt"
  local temp_cert
  temp_cert="$(mktemp "${DATA_DIR}/depCustoms-root.XXXXXX.crt")"

  if ! curl -fkfsSL "${cert_url}" -o "${temp_cert}"; then
    rm -f "${temp_cert}"
    echo "Failed to download registry root certificate from ${cert_url}." >&2
    echo "Check that the registry URL is correct and that /root.crt is reachable." >&2
    return 1
  fi

  if ! cert_looks_like_caddy_local_root "${temp_cert}"; then
    rm -f "${temp_cert}"
    echo "Refusing to trust ${cert_url} automatically." >&2
    echo "The downloaded certificate does not match the expected local Caddy root CA pattern." >&2
    return 1
  fi

  if ! confirm_caddy_root_trust "${temp_cert}" "${cert_url}"; then
    rm -f "${temp_cert}"
    echo "Skipped trusting ${cert_url}." >&2
    return 1
  fi

  mv "${temp_cert}" "${CERT_PATH}"
}

cert_looks_like_caddy_local_root() {
  local cert_path="$1"
  local subject issuer constraints

  subject="$(openssl x509 -in "${cert_path}" -noout -subject 2>/dev/null || true)"
  issuer="$(openssl x509 -in "${cert_path}" -noout -issuer 2>/dev/null || true)"
  constraints="$(openssl x509 -in "${cert_path}" -noout -text 2>/dev/null || true)"

  if [[ -z "${subject}" || -z "${issuer}" || -z "${constraints}" ]]; then
    return 1
  fi

  [[ "${subject}" == *"Caddy Local Authority - "* ]] || return 1
  [[ "${subject}" == *" Root"* ]] || return 1
  [[ "${issuer}" == *"Caddy Local Authority - "* ]] || return 1
  [[ "${issuer}" == *" Root"* ]] || return 1
  [[ "${constraints}" == *"CA:TRUE"* ]] || return 1

  return 0
}

confirm_caddy_root_trust() {
  local cert_path="$1"
  local cert_url="$2"
  local subject issuer not_before not_after response

  subject="$(openssl x509 -in "${cert_path}" -noout -subject 2>/dev/null | sed 's/^subject=//')"
  issuer="$(openssl x509 -in "${cert_path}" -noout -issuer 2>/dev/null | sed 's/^issuer=//')"
  not_before="$(openssl x509 -in "${cert_path}" -noout -startdate 2>/dev/null | sed 's/^notBefore=//')"
  not_after="$(openssl x509 -in "${cert_path}" -noout -enddate 2>/dev/null | sed 's/^notAfter=//')"

  echo ""
  echo "The HTTPS registry is not currently trusted by your machine."
  echo "The demo fetched ${cert_url} with certificate verification disabled to inspect it."
  echo "It appears to be a local Caddy root CA and will only be trusted for this demo by writing cafile=${CERT_PATH} to ${NPMRC_PATH}."
  echo ""
  echo "Certificate details:"
  echo "  subject: ${subject}"
  echo "  issuer:  ${issuer}"
  echo "  valid:   ${not_before} -> ${not_after}"
  echo ""
  read -r -p "Trust this certificate for the npm demo? [y/N]: " response
  case "${response}" in
    y|Y|yes|YES)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

upsert_npmrc_cafile() {
  local escaped_cert_path
  escaped_cert_path="$(printf '%s\n' "${CERT_PATH}" | sed 's/[\/&]/\\&/g')"

  if grep -q '^cafile=' "${NPMRC_PATH}"; then
    sed -i "s/^cafile=.*/cafile=${escaped_cert_path}/" "${NPMRC_PATH}"
  else
    printf 'cafile=%s\n' "${CERT_PATH}" >> "${NPMRC_PATH}"
  fi
}

npmrc_uses_demo_cafile() {
  [[ "$(read_npmrc_value "cafile")" == "${CERT_PATH}" ]]
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
  if [[ -f "${CERT_PATH}" ]]; then
    echo "  CA file: ${CERT_PATH}"
  fi
  echo "============================================================"
  echo ""
}
