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
DEPLOY_REPO_DIR="${DEPLOY_REPO_DIR:-/srv/plaud-exporter}"
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

echo "==> Preflight: repo + systemd unit must exist"
remote bash -s <<EOF
set -euo pipefail
REPO='${DEPLOY_REPO_DIR}'
UNIT='${SYSTEMD_UNIT}'
if [[ ! -d "\$REPO/.git" ]]; then
  echo "ci-deploy-systemd-remote: \$REPO is not a git checkout." >&2
  exit 2
fi
if ! systemctl list-unit-files "\$UNIT" &>/dev/null; then
  echo "ci-deploy-systemd-remote: systemd unit \$UNIT not found." >&2
  exit 2
fi
echo "ci-deploy-systemd-remote: preflight ok (repo=\$REPO unit=\$UNIT)"
EOF

echo "==> Stop bot, update code, reinstall deps, refresh unit, restart"
remote bash -s <<EOF
set -euo pipefail
REPO='${DEPLOY_REPO_DIR}'
UNIT='${SYSTEMD_UNIT}'
REF='${GIT_REF}'

sudo systemctl stop "\$UNIT"

sudo -u plaud git -C "\$REPO" fetch origin "\$REF"
sudo -u plaud git -C "\$REPO" reset --hard "origin/\$REF"
sudo -u plaud git -C "\$REPO" clean -fd

sudo chown -R plaud:plaud "\$REPO"

sudo -u plaud bash -lc "cd '\$REPO' && npm install --workspaces --ignore-scripts"
if [[ -f "\$REPO/plaud-exporter/package.json" ]]; then
  sudo -u plaud bash -lc "cd '\$REPO/plaud-exporter' && npm install --ignore-scripts"
fi

sudo cp "\$REPO/deploy/systemd/\$UNIT" "/etc/systemd/system/\$UNIT"
sudo systemctl daemon-reload
sudo systemctl restart "\$UNIT"

for i in \$(seq 1 24); do
  if systemctl is-active --quiet "\$UNIT"; then
    echo "ci-deploy-systemd-remote: \$UNIT is active"
    systemctl status "\$UNIT" --no-pager -l | head -20
    exit 0
  fi
  sleep 5
done

echo "ci-deploy-systemd-remote: \$UNIT failed to become active" >&2
systemctl status "\$UNIT" --no-pager -l || true
journalctl -u "\$UNIT" -n 40 --no-pager || true
exit 1
EOF

echo "Deploy finished (systemd): ${DEPLOY_REPO_DIR} @ origin/${GIT_REF}"
