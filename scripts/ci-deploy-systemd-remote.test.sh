#!/usr/bin/env bash
# Static checks for ci-deploy-systemd-remote.sh ordering.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="${ROOT}/scripts/ci-deploy-systemd-remote.sh"

bash -n "$SCRIPT"

preflight_line="$(grep -n 'Preflight: repo + systemd unit' "$SCRIPT" | head -1 | cut -d: -f1)"
stop_line="$(grep -n 'systemctl stop' "$SCRIPT" | head -1 | cut -d: -f1)"
fetch_line="$(grep -n 'git -C' "$SCRIPT" | head -1 | cut -d: -f1)"
restart_line="$(grep -n 'systemctl restart' "$SCRIPT" | head -1 | cut -d: -f1)"

if [[ -z "$preflight_line" || -z "$stop_line" || -z "$fetch_line" || -z "$restart_line" ]]; then
  echo "ci-deploy-systemd-remote.test: expected markers missing" >&2
  exit 1
fi

if [[ "$preflight_line" -ge "$stop_line" || "$stop_line" -ge "$fetch_line" || "$fetch_line" -ge "$restart_line" ]]; then
  echo "ci-deploy-systemd-remote.test: wrong order (preflight < stop < fetch < restart)" >&2
  exit 1
fi

if ! grep -q 'reset --hard' "$SCRIPT"; then
  echo "ci-deploy-systemd-remote.test: missing git reset --hard" >&2
  exit 1
fi

if ! grep -q 'npm install --workspaces' "$SCRIPT"; then
  echo "ci-deploy-systemd-remote.test: missing npm install --workspaces" >&2
  exit 1
fi

echo "ci-deploy-systemd-remote.test: OK"
