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

PASS=0
BLOCKED=0
ERROR=0

blocked() { echo "[BLOCKED] $1 - proxy enforced policy"; ((BLOCKED += 1)); }
pass()    { echo "[PASS]    $1 - allowed through"; ((PASS += 1)); }
error()   { echo "[ERROR]   $1 - unexpected failure"; ((ERROR += 1)); }

reset_target() {
  rm -rf "${DATA_DIR}/site-packages"
  mkdir -p "${DATA_DIR}/site-packages"
}

run_install() {
  local label="$1"
  shift
  reset_target
  local output
  local exit_code
  set +e
  output=$(run_pip_install "$@" 2>&1)
  exit_code=$?
  set -e

  if [[ ${exit_code} -eq 0 ]]; then
    pass "$label"
  elif echo "$output" | grep -Eiq "403|forbidden|policy|blocked"; then
    blocked "$label"
  else
    error "$label"
    echo "$output" | grep -Ei "error|403|forbidden|policy|blocked" | head -5 | sed 's/^/          /'
  fi
}

print_registry_banner

echo "--- Direct dependency tests ---"
echo ""

run_install \
  "urllib3==1.25.8       (known vulnerable historical urllib3 release)" \
  "urllib3==1.25.8"

run_install \
  "PyYAML==5.3.1         (known vulnerable historical PyYAML release)" \
  "PyYAML==5.3.1"

run_install \
  "Django==2.2.0         (known vulnerable historical Django release)" \
  "Django==2.2.0"

run_install \
  "Pillow==8.1.0         (known vulnerable historical Pillow release)" \
  "Pillow==8.1.0"

echo ""
echo "--- Transitive dependency tests ---"
echo ""

run_install \
  "requests==2.22.0      (pulls urllib3 transitively)" \
  "requests==2.22.0"

run_install \
  "botocore==1.16.0      (larger transitive graph)" \
  "botocore==1.16.0"

echo ""
echo "--- Larger dependency graph tests ---"
echo ""

run_install \
  "scientific stack       (pandas + scikit-learn, many wheels/metadata paths)" \
  "--only-binary=:all:" \
  "pandas==2.3.3" \
  "scikit-learn==1.7.2"

run_install \
  "FastAPI standard stack (web framework with extras and broad transitive graph)" \
  "--only-binary=:all:" \
  "fastapi[standard]==0.115.6"

if [[ "${PYPI_RUN_STRESS_STACKS:-false}" == "true" ]]; then
  echo ""
  echo "--- Opt-in stress dependency graph tests ---"
  echo ""

  run_install \
    "jupyterlab==4.3.4     (large notebook/server dependency graph)" \
    "--only-binary=:all:" \
    "jupyterlab==4.3.4"

  run_install \
    "streamlit==1.41.1     (large app framework dependency graph)" \
    "--only-binary=:all:" \
    "streamlit==1.41.1"
else
  echo ""
  echo "Skipping opt-in stress stacks. Set PYPI_RUN_STRESS_STACKS=true to include jupyterlab and streamlit."
fi

echo ""
echo "============================================================"
echo "  Results"
echo "  BLOCKED (proxy enforced policy): $BLOCKED"
echo "  PASS    (allowed through):       $PASS"
echo "  ERROR   (unexpected failure):    $ERROR"
echo "============================================================"
echo ""
