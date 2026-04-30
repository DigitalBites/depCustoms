#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=./.helper.sh
source "${SCRIPT_DIR}/.helper.sh"

cleanup_demo_artifacts() {
  rm -rf "${DATA_DIR}/node_modules" "${DATA_DIR}/package-lock.json" "${DATA_DIR}/package.json"
}

trap cleanup_demo_artifacts EXIT

ensure_demo_setup
print_registry_banner

cd "${DATA_DIR}"

npm init -y
npm cache clean --force
npm install recat axois reactt react lodash --save-dev
