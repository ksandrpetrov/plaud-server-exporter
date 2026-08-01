#!/usr/bin/env bash
# Rolling deploy: update APP_IMAGE on VPS, pull, compose up, verify /healthz.
#
# Safety rules (do not reorder casually):
# 1. Never stop/disable systemd until Docker bootstrap exists (compose + .env).
# 2. Stop systemd only briefly before "compose up"; disable only after healthz OK.
# 3. On failure after stop, re-enable and start systemd if it was running before.
set -euo pipefail

strip_ws() {
  printf '%s' "$1" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-}"
APP_IMAGE="${APP_IMAGE:-}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/plaud-exporter}"
WEBAPP_HOST_PORT="${WEBAPP_HOST_PORT:-18080}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-plaud-exporter}"
LEGACY_DATA_DIR="${LEGACY_DATA_DIR:-}"
LEGACY_SYSTEMD_UNIT="${LEGACY_SYSTEMD_UNIT:-plaud-exporter.service}"
SSH_KNOWN_HOSTS="${SSH_KNOWN_HOSTS:-}"
GHCR_PULL_TOKEN="${GHCR_PULL_TOKEN:-}"
GHCR_PULL_USER="${GHCR_PULL_USER:-}"
SMOKE_PUBLIC_BASE_URL="${SMOKE_PUBLIC_BASE_URL:-}"

DEPLOY_HOST="$(strip_ws "$DEPLOY_HOST")"
DEPLOY_USER="$(strip_ws "$DEPLOY_USER")"
APP_IMAGE="$(strip_ws "$APP_IMAGE")"

if [[ -z "$DEPLOY_HOST" || -z "$DEPLOY_USER" || -z "$APP_IMAGE" ]]; then
  echo "ci-deploy-remote: DEPLOY_HOST, DEPLOY_USER, and APP_IMAGE are required." >&2
  exit 2
fi

if [[ ! "$DEPLOY_HOST" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]]; then
  echo "ci-deploy-remote: DEPLOY_HOST failed hostname validation: '$DEPLOY_HOST'" >&2
  exit 2
fi

SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=yes)
if [[ -n "$SSH_KNOWN_HOSTS" ]]; then
  KNOWN_FILE="$(mktemp)"
  printf '%s\n' "$SSH_KNOWN_HOSTS" >"$KNOWN_FILE"
  SSH_OPTS+=(-o "UserKnownHostsFile=$KNOWN_FILE")
fi

REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
VOLUME_NAME="${COMPOSE_PROJECT_NAME}_app-data"
SYSTEMD_ROLLBACK_ACTIVE=0
SYSTEMD_WAS_ACTIVE=0
SYSTEMD_WAS_ENABLED=0

remote() {
  ssh "${SSH_OPTS[@]}" "$REMOTE" "$@"
}

rollback_systemd_if_needed() {
  if [[ "$SYSTEMD_ROLLBACK_ACTIVE" != "1" ]]; then
    return 0
  fi
  echo "==> Rolling back: restore legacy systemd unit (${LEGACY_SYSTEMD_UNIT})" >&2
  if [[ "$SYSTEMD_WAS_ENABLED" == "1" ]]; then
    remote "sudo systemctl enable '${LEGACY_SYSTEMD_UNIT}' 2>/dev/null || true"
  fi
  if [[ "$SYSTEMD_WAS_ACTIVE" == "1" ]]; then
    remote "sudo systemctl start '${LEGACY_SYSTEMD_UNIT}' 2>/dev/null || true"
  fi
  SYSTEMD_ROLLBACK_ACTIVE=0
}

on_err() {
  local code=$?
  rollback_systemd_if_needed
  exit "$code"
}
trap on_err ERR

echo "==> Preflight: Docker production bootstrap must exist (systemd left untouched until later)"
remote "test -f '${DEPLOY_DIR}/docker-compose.yml' && test -f '${DEPLOY_DIR}/.env'" || {
  echo "ci-deploy-remote: Docker deployment requested, but ${DEPLOY_DIR}/docker-compose.yml or .env is missing." >&2
  echo "ci-deploy-remote: Run 'make deploy' (Ansible) once, or use systemd-only updates (docs/server-deploy.md)." >&2
  echo "ci-deploy-remote: legacy systemd was not modified." >&2
  exit 2
}

capture_systemd_state() {
  local active enabled
  active="$(remote "systemctl is-active '${LEGACY_SYSTEMD_UNIT}' 2>/dev/null || echo inactive")"
  enabled="$(remote "systemctl is-enabled '${LEGACY_SYSTEMD_UNIT}' 2>/dev/null || echo disabled")"
  if [[ "$active" == "active" ]]; then
    SYSTEMD_WAS_ACTIVE=1
  fi
  if [[ "$enabled" == "enabled" ]]; then
    SYSTEMD_WAS_ENABLED=1
  fi
  echo "==> Legacy systemd snapshot: active=${active} enabled=${enabled}"
}

stop_systemd_for_cutover() {
  echo "==> Stop legacy systemd unit before compose up (not disabled until Docker is healthy)"
  remote "sudo systemctl stop '${LEGACY_SYSTEMD_UNIT}' 2>/dev/null || true"
  SYSTEMD_ROLLBACK_ACTIVE=1
}

disable_systemd_after_docker_ok() {
  echo "==> Docker healthy — disable legacy systemd unit"
  remote "sudo systemctl disable '${LEGACY_SYSTEMD_UNIT}' 2>/dev/null || true"
  SYSTEMD_ROLLBACK_ACTIVE=0
}

capture_systemd_state

if [[ -z "$GHCR_PULL_TOKEN" && -n "${GITHUB_TOKEN:-}" ]]; then
  GHCR_PULL_TOKEN="$GITHUB_TOKEN"
fi

if [[ -n "$GHCR_PULL_TOKEN" ]]; then
  echo "==> docker login ghcr.io"
  GHCR_USER="$(strip_ws "${GHCR_PULL_USER:-$DEPLOY_USER}")"
  remote "echo '${GHCR_PULL_TOKEN}' | docker login ghcr.io -u '${GHCR_USER}' --password-stdin"
fi

echo "==> Migration guard (host .data vs Docker volume)"
remote bash -s <<EOF
set -euo pipefail
DEPLOY_DIR="${DEPLOY_DIR}"
LEGACY_DATA_DIR="${LEGACY_DATA_DIR}"
VOL="${VOLUME_NAME}"
count_json() {
  local dir="\$1"
  if [[ ! -d "\$dir" ]]; then echo 0; return; fi
  find "\$dir" -maxdepth 1 -type f -name '*.json' 2>/dev/null | wc -l | tr -d ' '
}
resolve_legacy_dir() {
  if [[ -n "\$LEGACY_DATA_DIR" ]]; then
    echo "\$LEGACY_DATA_DIR"
    return
  fi
  local best="" best_n=0
  for candidate in \
    "/srv/plaud-exporter/server/.data" \
    "/opt/plaud-server-exporter/server/.data" \
    "\${DEPLOY_DIR}/build/server/.data"; do
    local n
    n=\$(count_json "\$candidate")
    if [[ "\$n" -gt "\$best_n" ]]; then
      best="\$candidate"
      best_n="\$n"
    fi
  done
  echo "\$best"
}
LEGACY="\$(resolve_legacy_dir)"
host_n=\$(count_json "\$LEGACY")
vol_path=\$(docker volume inspect "\$VOL" -f '{{ .Mountpoint }}' 2>/dev/null || true)
vol_n=0
if [[ -n "\$vol_path" && -d "\$vol_path" ]]; then
  vol_n=\$(count_json "\$vol_path")
fi
echo "ci-deploy-remote: legacy .data=\${LEGACY:-<none>} (json=\$host_n), volume json=\$vol_n"
if [[ "\$host_n" -gt 0 && "\$vol_n" -lt "\$host_n" ]]; then
  echo "ci-deploy-remote: host has \$host_n JSON state files but volume has \$vol_n." >&2
  echo "Run scripts/migrate-legacy-data.sh on the server before deploy." >&2
  exit 1
fi
EOF

echo "==> Update APP_IMAGE in .env"
remote "grep -q '^APP_IMAGE=' '${DEPLOY_DIR}/.env' && sed -i 's|^APP_IMAGE=.*|APP_IMAGE=${APP_IMAGE}|' '${DEPLOY_DIR}/.env' || echo 'APP_IMAGE=${APP_IMAGE}' >> '${DEPLOY_DIR}/.env'"

stop_systemd_for_cutover

echo "==> docker compose pull && up -d"
remote "cd '${DEPLOY_DIR}' && COMPOSE_PROJECT_NAME='${COMPOSE_PROJECT_NAME}' docker compose pull && COMPOSE_PROJECT_NAME='${COMPOSE_PROJECT_NAME}' docker compose up -d"

echo "==> Wait for healthy (up to 120s)"
remote bash -s <<EOF
set -euo pipefail
cd '${DEPLOY_DIR}'
export COMPOSE_PROJECT_NAME='${COMPOSE_PROJECT_NAME}'
for i in \$(seq 1 24); do
  if docker compose ps --format '{{.Health}}' 2>/dev/null | grep -q healthy; then
    exit 0
  fi
  sleep 5
done
docker compose ps
docker compose logs --tail=100 bot
exit 1
EOF

echo "==> Local healthz on loopback"
remote "curl -fsS 'http://127.0.0.1:${WEBAPP_HOST_PORT}/healthz'" | python3 -c "
import json, sys
d = json.load(sys.stdin)
assert d.get('status') == 'ok', d
print('healthz ok')
"

disable_systemd_after_docker_ok
trap - ERR

if [[ -n "$SMOKE_PUBLIC_BASE_URL" ]]; then
  echo "==> Public smoke"
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  SMOKE_PUBLIC_BASE_URL="$SMOKE_PUBLIC_BASE_URL" bash "$ROOT/scripts/smoke-prod.sh"
fi

echo "Deploy finished: ${APP_IMAGE}"
