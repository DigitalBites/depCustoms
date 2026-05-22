#!/usr/bin/env bash

set -euo pipefail

DEMO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly DEMO_DIR
readonly DATA_DIR="${DEMO_DIR}/data"
readonly PIP_CONF_PATH="${DEMO_DIR}/.pip.conf"
readonly CERT_PATH="${DATA_DIR}/depCustoms-root.crt"

ensure_demo_setup() {
  mkdir -p "${DATA_DIR}"

  if [[ -f "${PIP_CONF_PATH}" ]]; then
    ensure_existing_pip_tls_config
    export_pip_config
    return 0
  fi

  echo ""
  echo "No local .pip.conf found for this demo."
  echo ""
  echo "Generate a project token in the Customs UI:"
  echo "1. Open the dashboard."
  echo "2. Go to Projects."
  echo "3. Open the project you want this demo to use."
  echo "4. Open the Tokens page."
  echo "5. Create a token and copy the raw value."
  echo ""

  local proxy_url=""
  local project_token=""

  read -r -p "Proxy URL (example: http://localhost:8080): " proxy_url
  if [[ -z "${proxy_url}" ]]; then
    echo "Proxy URL is required." >&2
    return 1
  fi

  prompt_secret "Project token: " project_token
  if [[ -z "${project_token}" ]]; then
    echo "Project token is required." >&2
    return 1
  fi

  write_pip_conf "${proxy_url}" "${project_token}"
  ensure_proxy_tls_config "${proxy_url}"
  export_pip_config

  echo ""
  echo "Created ${PIP_CONF_PATH}"
  echo "Using PyPI index: $(redacted_index_url)"
  echo "Forced pip config: ${PIP_CONFIG_FILE}"
  echo ""
}

export_pip_config() {
  export PIP_CONFIG_FILE="${PIP_CONF_PATH}"
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

write_pip_conf() {
  local proxy_url="$1"
  local project_token="$2"
  local normalized_proxy="${proxy_url%/}"
  local index_url
  local trusted_host

  index_url="$(build_authenticated_index_url "${normalized_proxy}" "${project_token}")"

  cat > "${PIP_CONF_PATH}" <<EOF
[global]
index-url = ${index_url}
disable-pip-version-check = true
EOF

  if [[ "${normalized_proxy}" == http://* ]]; then
    trusted_host="$(url_host "${normalized_proxy}")"
    printf 'trusted-host = %s\n' "${trusted_host}" >> "${PIP_CONF_PATH}"
  fi
}

build_authenticated_index_url() {
  local proxy_url="$1"
  local project_token="$2"

  if [[ "${proxy_url}" == http://* ]]; then
    printf 'http://%s@%s/pypi/simple\n' "${project_token}" "${proxy_url#http://}"
    return 0
  fi
  if [[ "${proxy_url}" == https://* ]]; then
    printf 'https://%s@%s/pypi/simple\n' "${project_token}" "${proxy_url#https://}"
    return 0
  fi

  printf 'http://%s@%s/pypi/simple\n' "${project_token}" "${proxy_url}"
}

url_host() {
  local url="$1"
  local host="${url#http://}"
  host="${host#https://}"
  host="${host%%/*}"
  host="${host%%:*}"
  printf '%s\n' "${host}"
}

ensure_existing_pip_tls_config() {
  local index_url
  index_url="$(read_pip_conf_value "index-url")"

  if [[ -z "${index_url}" ]]; then
    return 0
  fi

  local proxy_url="${index_url%%/pypi/simple*}"
  proxy_url="$(strip_url_credentials "${proxy_url}")"
  ensure_proxy_tls_config "${proxy_url}"
}

strip_url_credentials() {
  local url="$1"
  if [[ "${url}" == http://*@* ]]; then
    printf 'http://%s\n' "${url#*@}"
    return 0
  fi
  if [[ "${url}" == https://*@* ]]; then
    printf 'https://%s\n' "${url#*@}"
    return 0
  fi
  printf '%s\n' "${url}"
}

ensure_proxy_tls_config() {
  local proxy_url="$1"

  if [[ "${proxy_url}" != https://* ]]; then
    return 0
  fi

  if pip_conf_uses_demo_cert && [[ -f "${CERT_PATH}" ]]; then
    return 0
  fi

  fetch_proxy_root_cert "${proxy_url}"
  upsert_pip_cert
}

fetch_proxy_root_cert() {
  local proxy_url="$1"
  local normalized_proxy="${proxy_url%/}"
  local cert_url="${normalized_proxy}/root.crt"
  local temp_cert
  temp_cert="$(mktemp "${DATA_DIR}/depCustoms-root.XXXXXX.crt")"

  if ! curl -fkfsSL "${cert_url}" -o "${temp_cert}"; then
    rm -f "${temp_cert}"
    echo "Failed to download proxy root certificate from ${cert_url}." >&2
    echo "Check that the proxy URL is correct and that /root.crt is reachable." >&2
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
  echo "The HTTPS proxy is not currently trusted by your machine."
  echo "The demo fetched ${cert_url} with certificate verification disabled to inspect it."
  echo "It appears to be a local Caddy root CA and will only be trusted for this demo by writing cert=${CERT_PATH} to ${PIP_CONF_PATH}."
  echo ""
  echo "Certificate details:"
  echo "  subject: ${subject}"
  echo "  issuer:  ${issuer}"
  echo "  valid:   ${not_before} -> ${not_after}"
  echo ""
  read -r -p "Trust this certificate for the PyPI demo? [y/N]: " response
  case "${response}" in
    y|Y|yes|YES)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

upsert_pip_cert() {
  if grep -q '^cert = ' "${PIP_CONF_PATH}"; then
    sed -i "s|^cert = .*|cert = ${CERT_PATH}|" "${PIP_CONF_PATH}"
  else
    printf 'cert = %s\n' "${CERT_PATH}" >> "${PIP_CONF_PATH}"
  fi
}

pip_conf_uses_demo_cert() {
  [[ "$(read_pip_conf_value "cert")" == "${CERT_PATH}" ]]
}

read_pip_conf_value() {
  local key="$1"
  local value=""

  if [[ -f "${PIP_CONF_PATH}" ]]; then
    value="$(grep -E "^${key}[[:space:]]*=" "${PIP_CONF_PATH}" | tail -n 1 | cut -d= -f2- | sed 's/^[[:space:]]*//' || true)"
  fi

  printf '%s\n' "${value}"
}

redacted_index_url() {
  local index_url
  index_url="$(read_pip_conf_value "index-url")"
  if [[ "${index_url}" == http://*@* ]]; then
    printf 'http://<project-token>@%s\n' "${index_url#*@}"
    return 0
  fi
  if [[ "${index_url}" == https://*@* ]]; then
    printf 'https://<project-token>@%s\n' "${index_url#*@}"
    return 0
  fi
  printf '%s\n' "${index_url}"
}

print_registry_banner() {
  echo ""
  echo "============================================================"
  echo "  depCustoms PyPI OSS package demo"
  echo "  Index: $(redacted_index_url)"
  echo "  Working dir: ${DATA_DIR}"
  echo "  pip config: ${PIP_CONFIG_FILE}"
  if [[ -f "${CERT_PATH}" ]]; then
    echo "  CA file: ${CERT_PATH}"
  fi
  echo "============================================================"
  echo ""
}

run_pip_install() {
  python3 -m pip install --no-cache-dir --target "${DATA_DIR}/site-packages" "$@"
}
