#!/usr/bin/env bash
# Static checks for ci-deploy-remote.sh safety ordering.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="${ROOT}/scripts/ci-deploy-remote.sh"

bash -n "$SCRIPT"

preflight_line="$(grep -n 'Preflight: Docker production bootstrap' "$SCRIPT" | head -1 | cut -d: -f1)"
stop_line="$(grep -n 'stop_systemd_for_cutover' "$SCRIPT" | head -1 | cut -d: -f1)"
disable_line="$(grep -n 'disable_systemd_after_docker_ok' "$SCRIPT" | head -1 | cut -d: -f1)"
old_kill_line="$(grep -n 'Stop legacy systemd unit if present' "$SCRIPT" | head -1 | cut -d: -f1 || true)"

if [[ -z "$preflight_line" || -z "$stop_line" || -z "$disable_line" ]]; then
  echo "ci-deploy-remote.test: expected safety markers missing" >&2
  exit 1
fi

if [[ -n "$old_kill_line" ]]; then
  echo "ci-deploy-remote.test: remove eager 'Stop legacy systemd' block" >&2
  exit 1
fi

if [[ "$preflight_line" -ge "$stop_line" || "$stop_line" -ge "$disable_line" ]]; then
  echo "ci-deploy-remote.test: wrong order (preflight < stop < disable)" >&2
  exit 1
fi

preflight_block="$(sed -n "/remote \"test -f.*docker-compose.yml/,/^capture_systemd_state()/p" "$SCRIPT")"
if grep -q 'exit 0' <<<"$preflight_block" || ! grep -q 'exit 2' <<<"$preflight_block"; then
  echo "ci-deploy-remote.test: missing non-zero exit when Docker is selected without bootstrap" >&2
  exit 1
fi

if ! grep -q 'rollback_systemd_if_needed' "$SCRIPT"; then
  echo "ci-deploy-remote.test: missing systemd rollback" >&2
  exit 1
fi

echo "ci-deploy-remote.test: OK"
