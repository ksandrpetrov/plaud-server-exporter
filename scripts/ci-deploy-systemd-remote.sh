#!/usr/bin/env bash
# Rolling deploy for legacy systemd production (/srv/plaud-exporter).
#
# Mirrors the manual checklist in docs/server-deploy.md § «Обновление кода»:
# stop → fetch/reset → clean → chown → npm install → refresh unit → restart.
#
# Does not touch .env or server/.data (gitignored). Requires passwordless sudo
# for the deploy SSH user (same as manual ops on the VPS).
set -euo pipefail

strip_ws() {
  printf '%s' "$1" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-}"
DEPLOY_REPO_DIR="${DEPLOY_REPO_DIR:-}"
SYSTEMD_UNIT="${SYSTEMD_UNIT:-plaud-exporter.service}"
SSH_KNOWN_HOSTS="${SSH_KNOWN_HOSTS:-}"
GIT_REF="${GIT_REF:-main}"

DEPLOY_HOST="$(strip_ws "$DEPLOY_HOST")"
DEPLOY_USER="$(strip_ws "$DEPLOY_USER")"
DEPLOY_REPO_DIR="$(strip_ws "$DEPLOY_REPO_DIR")"
SYSTEMD_UNIT="$(strip_ws "$SYSTEMD_UNIT")"
GIT_REF="$(strip_ws "$GIT_REF")"

if [[ -z "$DEPLOY_HOST" || -z "$DEPLOY_USER" ]]; then
  echo "ci-deploy-systemd-remote: DEPLOY_HOST and DEPLOY_USER are required." >&2
  exit 2
fi

if [[ ! "$DEPLOY_HOST" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]]; then
  echo "ci-deploy-systemd-remote: DEPLOY_HOST failed hostname validation: '$DEPLOY_HOST'" >&2
  exit 2
fi

SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=yes)
if [[ -n "$SSH_KNOWN_HOSTS" ]]; then
  KNOWN_FILE="$(mktemp)"
  printf '%s\n' "$SSH_KNOWN_HOSTS" >"$KNOWN_FILE"
  SSH_OPTS+=(-o "UserKnownHostsFile=$KNOWN_FILE")
fi

REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

remote() {
  ssh "${SSH_OPTS[@]}" "$REMOTE" "$@"
}

echo "==> Preflight + deploy (resolve repo path on host)"
remote \
  env DEPLOY_REPO_DIR="${DEPLOY_REPO_DIR}" SYSTEMD_UNIT="${SYSTEMD_UNIT}" GIT_REF="${GIT_REF}" \
  bash -s <<'REMOTE_SCRIPT'
set -euo pipefail

UNIT="${SYSTEMD_UNIT:-plaud-exporter.service}"
REF="${GIT_REF:-main}"
REQUESTED="${DEPLOY_REPO_DIR:-}"

CANDIDATES=()
if [[ -n "$REQUESTED" ]]; then
  CANDIDATES+=("$REQUESTED")
fi
CANDIDATES+=(
  "/srv/plaud-exporter"
  "/opt/plaud-server-exporter"
  "/home/plaud/plaud-server-exporter"
)

REPO=""
for dir in "${CANDIDATES[@]}"; do
  [[ -n "$dir" && -d "$dir/.git" ]] || continue
  REPO="$dir"
  break
done

if [[ -z "$REPO" ]]; then
  echo "ci-deploy-systemd-remote: no git checkout found. Tried: ${CANDIDATES[*]}" >&2
  if [[ -f /opt/plaud-exporter/docker-compose.yml ]]; then
    echo "ci-deploy-systemd-remote: /opt/plaud-exporter has Docker — set PRODUCTION_DOCKER_DEPLOY=true in GitHub Variables." >&2
  fi
  exit 2
fi

if ! systemctl list-unit-files "$UNIT" &>/dev/null; then
  echo "ci-deploy-systemd-remote: systemd unit $UNIT not found." >&2
  exit 2
fi

echo "ci-deploy-systemd-remote: preflight ok (repo=$REPO unit=$UNIT)"

sudo systemctl stop "$UNIT"

sudo -u plaud git -C "$REPO" fetch origin "$REF"
sudo -u plaud git -C "$REPO" reset --hard "origin/$REF"
sudo -u plaud git -C "$REPO" clean -fd

sudo chown -R plaud:plaud "$REPO"

sudo -u plaud bash -lc "cd '$REPO' && npm install --workspaces --ignore-scripts"
if [[ -f "$REPO/plaud-exporter/package.json" ]]; then
  sudo -u plaud bash -lc "cd '$REPO/plaud-exporter' && npm install --ignore-scripts"
fi

UNIT_FILE="$REPO/deploy/systemd/$UNIT"
if [[ ! -f "$UNIT_FILE" ]]; then
  UNIT_FILE="$REPO/deploy/systemd/plaud-exporter.service"
fi
sudo cp "$UNIT_FILE" "/etc/systemd/system/$UNIT"
sudo systemctl daemon-reload
sudo systemctl restart "$UNIT"

for i in $(seq 1 24); do
  if systemctl is-active --quiet "$UNIT"; then
    echo "ci-deploy-systemd-remote: $UNIT is active"
    systemctl status "$UNIT" --no-pager -l | head -20
    exit 0
  fi
  sleep 5
done

echo "ci-deploy-systemd-remote: $UNIT failed to become active" >&2
systemctl status "$UNIT" --no-pager -l || true
journalctl -u "$UNIT" -n 40 --no-pager || true
exit 1
REMOTE_SCRIPT

echo "Deploy finished (systemd) @ origin/${GIT_REF}"
