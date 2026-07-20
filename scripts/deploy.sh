#!/bin/bash
# deploy.sh — shim into the shared runner. See shared/docs/DEPLOY_STANDARD.md.
#
# All deploy logic lives in shared/scripts/deploy.sh + shared/scripts/deploy-lib/.
# This file is deliberately not logic: a copied-and-adapted deploy.sh is
# exactly how one template bug (silent no-op tag reuse) spread to 31 services
# before the 2026-07-18 standardization (see DEPLOY_STANDARDIZATION_REPORT.md).
#
# The declaration is ../deploy.config.sh at the repo root. It builds every
# container in this repository (growth-core now, growth-web at S5), so there is
# one deploy for the platform rather than one per service directory.
# Prove changes with `shared/scripts/deploy.sh growth --dry-run` first.
set -euo pipefail
exec "$(dirname "$0")/../../shared/scripts/deploy.sh" "$(basename "$(cd "$(dirname "$0")/.." && pwd)")" "$@"
