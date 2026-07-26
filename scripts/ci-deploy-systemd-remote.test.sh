#!/usr/bin/env bash
# Static checks for ci-deploy-systemd-remote.sh ordering.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="${ROOT}/scripts/ci-deploy-systemd-remote.sh"

bash -n "$SCRIPT"

preflight_line="$(grep -n 'Preflight + deploy' "$SCRIPT" | head -1 | cut -d: -f1)"
workdir_line="$(grep -n 'systemctl show.*WorkingDirectory' "$SCRIPT" | head -1 | cut -d: -f1)"
stop_line="$(grep -n 'systemctl stop' "$SCRIPT" | head -1 | cut -d: -f1)"
chown_line="$(grep -n 'chown -R plaud:plaud' "$SCRIPT" | head -1 | cut -d: -f1)"
init_line="$(grep -n 'git -C.*init' "$SCRIPT" | head -1 | cut -d: -f1)"
fetch_line="$(grep -n 'git -C.*fetch origin' "$SCRIPT" | head -1 | cut -d: -f1)"
restart_line="$(grep -n 'systemctl restart' "$SCRIPT" | tail -1 | cut -d: -f1)"

if [[ -z "$preflight_line" || -z "$workdir_line" || -z "$stop_line" || -z "$init_line" || -z "$fetch_line" || -z "$restart_line" ]]; then
  echo "ci-deploy-systemd-remote.test: expected markers missing" >&2
  exit 1
fi

if [[ -z "$chown_line" ]]; then
  echo "ci-deploy-systemd-remote.test: missing chown before git" >&2
  exit 1
fi

if [[ "$preflight_line" -ge "$workdir_line" || "$workdir_line" -ge "$stop_line" || "$stop_line" -ge "$chown_line" || "$chown_line" -ge "$init_line" || "$init_line" -ge "$fetch_line" || "$fetch_line" -ge "$restart_line" ]]; then
  echo "ci-deploy-systemd-remote.test: wrong order (preflight < workdir < stop < chown < init < fetch < restart)" >&2
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

if ! grep -q '/opt/plaud-server-exporter' "$SCRIPT"; then
  echo "ci-deploy-systemd-remote.test: missing alternate repo path probe" >&2
  exit 1
fi

if ! grep -q 'refusing deploy because.*\.env is missing' "$SCRIPT"; then
  echo "ci-deploy-systemd-remote.test: missing state-preserving .env guard" >&2
  exit 1
fi

if ! grep -q 'trap rollback_on_error EXIT' "$SCRIPT"; then
  echo "ci-deploy-systemd-remote.test: missing systemd rollback trap" >&2
  exit 1
fi

echo "ci-deploy-systemd-remote.test: OK"
