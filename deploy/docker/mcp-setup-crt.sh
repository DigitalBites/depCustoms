#!/usr/bin/env bash

is_sourced() {
  if [[ -n "${ZSH_EVAL_CONTEXT:-}" ]]; then
    [[ "${ZSH_EVAL_CONTEXT}" == *:file:* || "${ZSH_EVAL_CONTEXT}" == *:file ]]
    return
  fi

  [[ "${BASH_SOURCE[0]:-}" != "${0:-}" ]]
}

download_root_cert() {
  curl --fail --silent --show-error --location -k \
    "${CERT_URL}" \
    --output "${CERT_PATH}"
}

print_cert_info() {
  echo "Saved cert to: ${SSL_CERT_FILE}"
  echo "SSL_CERT_FILE=${SSL_CERT_FILE}"
  echo "NODE_EXTRA_CA_CERTS=${NODE_EXTRA_CA_CERTS}"
  echo ""
  echo "--- Certificate Info ---"
  openssl x509 -in "${CERT_PATH}" -noout -subject -issuer -dates
}

print_instructions() {
  echo "You should have two variables set in your current shell."
  echo "  SSL_CERT_FILE and NODE_EXTRA_CA_CERTS"
  echo "for codex and claude code."
  echo ""
  echo "Setup commands:"
  echo "  codex mcp add customs --url https://${HOST}:${PORT}/api/mcp"
  echo "  claude mcp add customs --transport http https://${HOST}:${PORT}/api/mcp"
}

main() {
  if [[ $# -lt 2 ]]; then
    echo "Usage: source ./mcp-setup-crt.sh <host> <port>" >&2
    echo "This script is meant to be sourced so SSL_CERT_FILE and NODE_EXTRA_CA_CERTS stay in your current shell." >&2
    return 1
  fi

  HOST="${1}"
  PORT="${2}"
  CERT_PATH="$(pwd)/depCustoms-root.crt"
  CERT_URL="https://${HOST}:${PORT}/root.crt"

  if ! download_root_cert; then
    echo "Failed to download root certificate from ${CERT_URL}." >&2
    echo "Check that the host and port are correct and that /root.crt is reachable." >&2
    return 1
  fi

  export SSL_CERT_FILE="${CERT_PATH}"
  export NODE_EXTRA_CA_CERTS="${CERT_PATH}"

  print_cert_info
  print_instructions
}

if is_sourced; then
  main "$@"
  return $?
else
  echo "This script exports environment variables, so run it with:" >&2
  echo "  source ./mcp-setup-crt.sh <host> <port>" >&2
  echo "Running it as ./mcp-setup-crt.sh will not persist SSL_CERT_FILE or NODE_EXTRA_CA_CERTS in your shell." >&2
  exit 1
fi

