#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=./.helper.sh
source "${SCRIPT_DIR}/.helper.sh"

cleanup_demo_artifacts() {
  rm -rf "${DATA_DIR}/site-packages"
}

trap cleanup_demo_artifacts EXIT

ensure_demo_setup
print_registry_banner

rm -rf "${DATA_DIR}/site-packages"
mkdir -p "${DATA_DIR}/site-packages"

PACKAGES=(
  "urllib3==1.25.8"
  "PyYAML==5.3.1"
  "Django==2.2.0"
  "Pillow==8.1.0"
)

classify_output() {
  local output="$1"
  if echo "${output}" | grep -Eiq "403|forbidden|policy|blocked"; then
    echo "BLOCKED"
    return 0
  fi
  echo "ERROR"
}

echo "--- Combined pip install simulation ---"
echo ""

set +e
combined_output="$(run_pip_install "${PACKAGES[@]}" 2>&1)"
combined_exit=$?
set -e

if [[ ${combined_exit} -eq 0 ]]; then
  echo "[PASS]    combined install allowed through"
else
  combined_result="$(classify_output "${combined_output}")"
  echo "[${combined_result}] combined install failed"
  echo "${combined_output}" | grep -Ei "error|403|forbidden|policy|blocked" | head -5 | sed 's/^/          /'
fi

echo ""
echo "--- Individual package probes ---"
echo ""

PASS=0
BLOCKED=0
ERROR=0

for package in "${PACKAGES[@]}"; do
  rm -rf "${DATA_DIR}/site-packages"
  mkdir -p "${DATA_DIR}/site-packages"

  set +e
  output="$(run_pip_install "${package}" 2>&1)"
  exit_code=$?
  set -e

  if [[ ${exit_code} -eq 0 ]]; then
    echo "[PASS]    ${package}"
    ((PASS += 1))
  elif echo "${output}" | grep -Eiq "403|forbidden|policy|blocked"; then
    echo "[BLOCKED] ${package}"
    ((BLOCKED += 1))
  else
    echo "[ERROR]   ${package}"
    echo "${output}" | grep -Ei "error|403|forbidden|policy|blocked" | head -5 | sed 's/^/          /'
    ((ERROR += 1))
  fi
done

echo ""
echo "============================================================"
echo "  Results"
echo "  BLOCKED (proxy enforced policy): ${BLOCKED}"
echo "  PASS    (allowed through):       ${PASS}"
echo "  ERROR   (unexpected failure):    ${ERROR}"
echo "============================================================"
echo ""
