#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
readonly SCRIPT_DIR
readonly DATA_DIR="${SCRIPT_DIR}/data"
readonly DOCKER_CONFIG_DIR="${DATA_DIR}/docker-config"
readonly CERT_PATH="${DATA_DIR}/depCustoms-root.crt"
readonly SETTINGS_PATH="${DATA_DIR}/test-basic.settings.env"
readonly ORIGINAL_DOCKER_CONFIG="${DOCKER_CONFIG:-${HOME}/.docker}"

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

parse_registry_input() {
  local raw="$1"
  raw="${raw%/}"

  if [[ "${raw}" == http://* ]]; then
    DOCKER_PROXY_SCHEME="http"
    DOCKER_PROXY_REGISTRY="${raw#http://}"
    return 0
  fi

  if [[ "${raw}" == https://* ]]; then
    DOCKER_PROXY_SCHEME="https"
    DOCKER_PROXY_REGISTRY="${raw#https://}"
    return 0
  fi

  DOCKER_PROXY_SCHEME=""
  DOCKER_PROXY_REGISTRY="${raw}"
}

proxy_endpoint() {
  if [[ -n "${DOCKER_PROXY_SCHEME}" ]]; then
    printf '%s://%s\n' "${DOCKER_PROXY_SCHEME}" "${DOCKER_PROXY_REGISTRY}"
    return 0
  fi

  printf '%s\n' "${DOCKER_PROXY_REGISTRY}"
}

load_saved_settings() {
  local env_registry="${CUSTOMS_DOCKER_REGISTRY-}"
  local env_registry_set="false"
  local env_token="${CUSTOMS_PROJECT_TOKEN-}"
  local env_token_set="false"

  if [[ -v CUSTOMS_DOCKER_REGISTRY ]]; then
    env_registry_set="true"
  fi
  if [[ -v CUSTOMS_PROJECT_TOKEN ]]; then
    env_token_set="true"
  fi

  SAVED_DOCKER_REGISTRY=""
  SAVED_PROJECT_TOKEN=""

  if [[ ! -f "${SETTINGS_PATH}" ]]; then
    return 0
  fi

  # shellcheck source=/dev/null
  source "${SETTINGS_PATH}"
  SAVED_DOCKER_REGISTRY="${CUSTOMS_DOCKER_REGISTRY:-}"
  SAVED_PROJECT_TOKEN="${CUSTOMS_PROJECT_TOKEN:-}"

  if [[ "${env_registry_set}" == "true" ]]; then
    CUSTOMS_DOCKER_REGISTRY="${env_registry}"
  else
    unset CUSTOMS_DOCKER_REGISTRY
  fi

  if [[ "${env_token_set}" == "true" ]]; then
    CUSTOMS_PROJECT_TOKEN="${env_token}"
  else
    unset CUSTOMS_PROJECT_TOKEN
  fi
}

save_demo_settings() {
  if [[ "${CUSTOMS_DOCKER_SAVE_SETTINGS:-true}" == "false" ]]; then
    return 0
  fi

  mkdir -p "${DATA_DIR}"
  umask 077
  {
    printf '# Local settings for examples/docker-oss-images/test-basic.sh\n'
    printf '# Contains a raw project token. Keep this file out of source control.\n'
    printf 'CUSTOMS_DOCKER_REGISTRY=%q\n' "$(proxy_endpoint)"
    printf 'CUSTOMS_PROJECT_TOKEN=%q\n' "${PROJECT_TOKEN}"
  } > "${SETTINGS_PATH}"
  chmod 600 "${SETTINGS_PATH}"
}

ensure_registry_tls_config() {
  if [[ "${DOCKER_PROXY_SCHEME}" != "https" ]]; then
    return 0
  fi

  if [[ -n "${CUSTOMS_DOCKER_CA_CERT:-}" ]]; then
    install_registry_ca "${CUSTOMS_DOCKER_CA_CERT}"
    maybe_install_daemon_registry_ca "${CUSTOMS_DOCKER_CA_CERT}"
    return 0
  fi

  fetch_registry_root_cert
  install_registry_ca "${CERT_PATH}"
  maybe_install_daemon_registry_ca "${CERT_PATH}"
}

fetch_registry_root_cert() {
  local cert_url="https://${DOCKER_PROXY_REGISTRY}/root.crt"
  local temp_cert
  temp_cert="$(mktemp "${DATA_DIR}/depCustoms-root.XXXXXX.crt")"

  if ! curl -fkfsSL "${cert_url}" -o "${temp_cert}"; then
    rm -f "${temp_cert}"
    echo "Failed to download registry root certificate from ${cert_url}." >&2
    echo "Set CUSTOMS_DOCKER_CA_CERT=/path/to/ca.crt if the proxy does not expose /root.crt." >&2
    return 1
  fi

  if ! cert_looks_like_caddy_local_root "${temp_cert}"; then
    rm -f "${temp_cert}"
    echo "Refusing to trust ${cert_url} automatically." >&2
    echo "The downloaded certificate does not match the expected local Caddy root CA pattern." >&2
    echo "Set CUSTOMS_DOCKER_CA_CERT=/path/to/ca.crt to trust a different CA explicitly." >&2
    return 1
  fi

  mv "${temp_cert}" "${CERT_PATH}"
  echo "Fetched current registry CA: ${CERT_PATH}"
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

install_registry_ca() {
  local source_cert="$1"
  local cert_dir="${DOCKER_CONFIG}/certs.d/${DOCKER_PROXY_REGISTRY}"

  if [[ ! -f "${source_cert}" ]]; then
    echo "Docker CA certificate does not exist: ${source_cert}" >&2
    return 1
  fi

  mkdir -p "${cert_dir}"
  cp "${source_cert}" "${cert_dir}/ca.crt"
  print_cert_fingerprint "Demo Docker registry CA" "${cert_dir}/ca.crt"
}

maybe_install_daemon_registry_ca() {
  local source_cert="$1"
  local daemon_cert_dir="${ORIGINAL_DOCKER_CONFIG}/certs.d/${DOCKER_PROXY_REGISTRY}"
  local daemon_cert="${daemon_cert_dir}/ca.crt"
  local response=""

  if [[ "${ORIGINAL_DOCKER_CONFIG}" == "${DOCKER_CONFIG}" ]]; then
    return 0
  fi

  maybe_install_colima_registry_ca "${source_cert}"

  if [[ -f "${daemon_cert}" ]] && cmp -s "${source_cert}" "${daemon_cert}"; then
    return 0
  fi

  if [[ "${CUSTOMS_DOCKER_INSTALL_CA_TO_USER_CONFIG:-}" == "true" ]]; then
    install_daemon_registry_ca "${source_cert}"
    return 0
  fi

  echo ""
  echo "Docker Desktop may verify registry TLS in the daemon, outside this demo's isolated DOCKER_CONFIG."
  echo "The demo can install the registry CA at ${daemon_cert} while keeping login credentials isolated."
  read -r -p "Install this CA into your Docker registry trust store? [y/N]: " response

  case "${response}" in
    y|Y|yes|YES)
      install_daemon_registry_ca "${source_cert}"
      ;;
    *)
      echo "Skipped Docker daemon registry CA install."
      ;;
  esac
}

install_daemon_registry_ca() {
  local source_cert="$1"
  local daemon_cert_dir="${ORIGINAL_DOCKER_CONFIG}/certs.d/${DOCKER_PROXY_REGISTRY}"

  mkdir -p "${daemon_cert_dir}"
  cp "${source_cert}" "${daemon_cert_dir}/ca.crt"
  echo "Installed Docker registry CA: ${daemon_cert_dir}/ca.crt"
  print_cert_fingerprint "Docker daemon registry CA" "${daemon_cert_dir}/ca.crt"
  echo "Restart Docker Desktop if the daemon still reports an unknown authority error."
}

maybe_install_colima_registry_ca() {
  local source_cert="$1"
  local context_name="${DOCKER_CONTEXT:-}"
  local profile=""
  local response=""

  if ! command -v colima >/dev/null 2>&1; then
    return 0
  fi

  if [[ -z "${context_name}" ]]; then
    context_name="$(current_docker_context)"
  fi

  case "${context_name}" in
    colima)
      profile="${COLIMA_PROFILE:-default}"
      ;;
    colima-*)
      profile="${context_name#colima-}"
      ;;
    *)
      return 0
      ;;
  esac

  if [[ "${CUSTOMS_DOCKER_INSTALL_CA_TO_COLIMA:-}" == "true" ]]; then
    install_colima_registry_ca "${source_cert}" "${profile}"
    return 0
  fi

  echo ""
  echo "Detected Colima Docker context: ${context_name}"
  echo "Colima's Docker daemon verifies registry TLS inside the VM, not from ${ORIGINAL_DOCKER_CONFIG}/certs.d."
  read -r -p "Install this CA into the Colima VM Docker trust store? [y/N]: " response

  case "${response}" in
    y|Y|yes|YES)
      install_colima_registry_ca "${source_cert}" "${profile}"
      ;;
    *)
      echo "Skipped Colima VM registry CA install."
      ;;
  esac
}

install_colima_registry_ca() {
  local source_cert="$1"
  local profile="$2"
  local cert_dir="/etc/docker/certs.d/${DOCKER_PROXY_REGISTRY}"
  local ssh_args=()

  if [[ "${profile}" != "default" ]]; then
    ssh_args+=("${profile}")
  fi

  colima ssh "${ssh_args[@]}" -- sudo mkdir -p "${cert_dir}"
  colima ssh "${ssh_args[@]}" -- sudo tee "${cert_dir}/ca.crt" >/dev/null < "${source_cert}"
  echo "Installed Colima Docker registry CA: ${cert_dir}/ca.crt"
  echo "Restarting Docker inside Colima so dockerd reloads registry trust."
  colima ssh "${ssh_args[@]}" -- sudo sh -c 'systemctl restart docker 2>/dev/null || service docker restart 2>/dev/null || rc-service docker restart 2>/dev/null || pkill -HUP dockerd 2>/dev/null || true'
}

print_cert_fingerprint() {
  local label="$1"
  local cert_path="$2"
  local fingerprint

  fingerprint="$(openssl x509 -in "${cert_path}" -noout -fingerprint -sha256 2>/dev/null | sed 's/^sha256 Fingerprint=//; s/^SHA256 Fingerprint=//' || true)"
  if [[ -n "${fingerprint}" ]]; then
    echo "${label}: ${fingerprint}"
  fi
}

print_cert_fingerprint_stderr() {
  local label="$1"
  local cert_path="$2"
  local fingerprint

  if [[ ! -f "${cert_path}" ]]; then
    return 0
  fi

  fingerprint="$(openssl x509 -in "${cert_path}" -noout -fingerprint -sha256 2>/dev/null | sed 's/^sha256 Fingerprint=//; s/^SHA256 Fingerprint=//' || true)"
  if [[ -n "${fingerprint}" ]]; then
    echo "${label}: ${fingerprint}" >&2
  fi
}

current_docker_context() {
  if [[ -n "${DOCKER_CONTEXT:-}" ]]; then
    printf '%s\n' "${DOCKER_CONTEXT}"
    return 0
  fi

  docker --config "${ORIGINAL_DOCKER_CONFIG}" context show 2>/dev/null || true
}

prepare_demo_docker_config() {
  local context_name
  context_name="$(current_docker_context)"

  mkdir -p "${DOCKER_CONFIG_DIR}"

  if [[ -d "${ORIGINAL_DOCKER_CONFIG}/contexts" ]]; then
    rm -rf "${DOCKER_CONFIG_DIR}/contexts"
    cp -R "${ORIGINAL_DOCKER_CONFIG}/contexts" "${DOCKER_CONFIG_DIR}/contexts"
  fi

  if [[ -n "${context_name}" && "${context_name}" != "default" ]]; then
    export DOCKER_CONTEXT="${context_name}"
  fi

  export DOCKER_CONFIG="${DOCKER_CONFIG_DIR}"
}

ensure_demo_setup() {
  prepare_demo_docker_config

  if [[ -n "${CUSTOMS_DOCKER_REGISTRY:-}" && -n "${CUSTOMS_PROJECT_TOKEN:-}" ]]; then
    parse_registry_input "${CUSTOMS_DOCKER_REGISTRY}"
    PROJECT_TOKEN="${CUSTOMS_PROJECT_TOKEN}"
    return 0
  fi

  load_saved_settings

  if [[ -n "${SAVED_DOCKER_REGISTRY}" && -n "${SAVED_PROJECT_TOKEN}" ]]; then
    parse_registry_input "${SAVED_DOCKER_REGISTRY}"
    PROJECT_TOKEN="${SAVED_PROJECT_TOKEN}"
    return 0
  fi

  echo ""
  echo "Generate a project token in the Customs UI:"
  echo "1. Open the dashboard."
  echo "2. Go to Projects."
  echo "3. Open the project you want this demo to use."
  echo "4. Open the Tokens page."
  echo "5. Create a token and copy the raw value."
  echo ""

  local registry=""
  local token=""
  local registry_prompt="Docker proxy registry (example: http://localhost:8080 or https://docker.customs.local)"

  if [[ -n "${SAVED_DOCKER_REGISTRY}" ]]; then
    read -r -p "${registry_prompt} [${SAVED_DOCKER_REGISTRY}]: " registry
    registry="${registry:-${SAVED_DOCKER_REGISTRY}}"
  else
    read -r -p "${registry_prompt}: " registry
  fi

  if [[ -z "${registry}" ]]; then
    echo "Docker proxy registry is required." >&2
    return 1
  fi

  if [[ -n "${SAVED_PROJECT_TOKEN}" ]]; then
    echo "Project token: using saved token from ${SETTINGS_PATH}."
    prompt_secret "Press Enter to reuse it, or paste a replacement token: " token
    token="${token:-${SAVED_PROJECT_TOKEN}}"
  else
    prompt_secret "Project token: " token
  fi

  if [[ -z "${token}" ]]; then
    echo "Project token is required." >&2
    return 1
  fi

  parse_registry_input "${registry}"
  PROJECT_TOKEN="${token}"
  save_demo_settings
}

docker_login() {
  local output
  set +e
  output="$(echo "${PROJECT_TOKEN}" | docker login "${DOCKER_PROXY_REGISTRY}" --username customs --password-stdin 2>&1)"
  local exit_code=$?
  set -e

  if [[ ${exit_code} -eq 0 ]]; then
    return 0
  fi

  echo "${output}" >&2

  if [[ "${DOCKER_PROXY_SCHEME}" == "http" && "${output}" == *"server gave HTTP response to HTTPS client"* ]]; then
    echo "" >&2
    echo "Docker image refs and docker login use a registry host without http:// or https://." >&2
    echo "For an HTTP registry at ${DOCKER_PROXY_REGISTRY}, configure your Docker daemon with this insecure registry first." >&2
    echo "Docker Desktop: Settings -> Docker Engine -> add \"insecure-registries\": [\"${DOCKER_PROXY_REGISTRY}\"], then restart Docker." >&2
  fi

  if [[ "${DOCKER_PROXY_SCHEME}" == "https" && "${output}" == *"certificate"* ]]; then
    echo "" >&2
    echo "The demo installed a CA at ${DOCKER_CONFIG}/certs.d/${DOCKER_PROXY_REGISTRY}/ca.crt." >&2
    echo "Docker daemon registry CA path: ${ORIGINAL_DOCKER_CONFIG}/certs.d/${DOCKER_PROXY_REGISTRY}/ca.crt" >&2
    echo "For Colima, install the CA inside the VM at /etc/docker/certs.d/${DOCKER_PROXY_REGISTRY}/ca.crt and restart Docker in the VM." >&2
    echo "You can let this script do that by accepting the Colima CA install prompt, or by setting CUSTOMS_DOCKER_INSTALL_CA_TO_COLIMA=true." >&2
    print_cert_fingerprint_stderr "Docker daemon registry CA" "${ORIGINAL_DOCKER_CONFIG}/certs.d/${DOCKER_PROXY_REGISTRY}/ca.crt"
  fi

  if [[ "${output}" == *"status: 404 Not Found"* ]]; then
    echo "" >&2
    echo "The proxy answered /v2/ with 404. For Docker support, set PROXY_ENABLED_ECOSYSTEMS=npm,pypi,docker and recreate the proxy container." >&2
  fi

  return "${exit_code}"
}

pull_image() {
  local image="$1"
  local ref="${DOCKER_PROXY_REGISTRY}/${image}"

  echo ""
  echo "--- docker pull ${ref} ---"
  docker pull "${ref}"
  docker image inspect "${ref}" --format 'digest={{index .RepoDigests 0}} id={{.Id}}' || true
}

ensure_demo_setup

echo ""
echo "============================================================"
echo "  depCustoms Docker OSS image demo"
echo "  Proxy endpoint: $(proxy_endpoint)"
echo "  Docker registry: ${DOCKER_PROXY_REGISTRY}"
echo "  Docker config: ${DOCKER_CONFIG}"
echo "============================================================"
echo ""

if [[ "${DOCKER_PROXY_SCHEME}" == "http" ]]; then
  echo "Using HTTP. Docker requires ${DOCKER_PROXY_REGISTRY} to be configured as an insecure registry in the Docker daemon."
  echo ""
fi

ensure_registry_tls_config

if [[ "${DOCKER_PROXY_SCHEME}" == "https" ]]; then
  echo "Using HTTPS. Docker registry CA path: ${DOCKER_CONFIG}/certs.d/${DOCKER_PROXY_REGISTRY}/ca.crt"
  echo ""
fi

docker_login

pull_image "alpine:3.20"
pull_image "hub.docker.io/library/alpine:3.20"

echo ""
echo "Completed Docker proxy smoke test."
