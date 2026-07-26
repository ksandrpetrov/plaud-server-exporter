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
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-}"
GIT_FETCH_TOKEN="${GIT_FETCH_TOKEN:-}"

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
  GITHUB_REPOSITORY="${GITHUB_REPOSITORY}" GIT_FETCH_TOKEN="${GIT_FETCH_TOKEN}" \
  bash -s <<'REMOTE_SCRIPT'
set -euo pipefail

UNIT="${SYSTEMD_UNIT:-plaud-exporter.service}"
REF="${GIT_REF:-main}"
REQUESTED="${DEPLOY_REPO_DIR:-}"

if ! systemctl list-unit-files "$UNIT" &>/dev/null; then
  echo "ci-deploy-systemd-remote: systemd unit $UNIT not found." >&2
  exit 2
fi

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

BOOTSTRAP_GIT=false
if [[ -z "$REPO" ]]; then
  # The service unit is the authoritative fallback after an incomplete/manual
  # migration that left the application files and state but removed .git.
  UNIT_WORKDIR="$(systemctl show "$UNIT" --property=WorkingDirectory --value)"
  case "$UNIT_WORKDIR" in
    /srv/plaud-exporter | /opt/plaud-server-exporter | /home/plaud/plaud-server-exporter)
      if [[ -d "$UNIT_WORKDIR" ]]; then
        REPO="$UNIT_WORKDIR"
        BOOTSTRAP_GIT=true
      fi
      ;;
  esac
fi

if [[ -z "$REPO" && -n "$REQUESTED" && -d "$REQUESTED" ]]; then
  UNIT_WORKDIR="$(systemctl show "$UNIT" --property=WorkingDirectory --value)"
  if [[ "$UNIT_WORKDIR" == "$REQUESTED" ]]; then
    REPO="$REQUESTED"
    BOOTSTRAP_GIT=true
  fi
fi

if [[ -z "$REPO" ]]; then
  echo "ci-deploy-systemd-remote: no repository or allowed systemd workdir found. Tried: ${CANDIDATES[*]}" >&2
  if [[ -f /opt/plaud-exporter/docker-compose.yml ]]; then
    echo "ci-deploy-systemd-remote: /opt/plaud-exporter has Docker — set PRODUCTION_DOCKER_DEPLOY=true in GitHub Variables." >&2
  fi
  exit 2
fi

if [[ ! -f "$REPO/.env" ]]; then
  echo "ci-deploy-systemd-remote: refusing deploy because $REPO/.env is missing." >&2
  exit 2
fi

echo "ci-deploy-systemd-remote: preflight ok (repo=$REPO unit=$UNIT bootstrap_git=$BOOTSTRAP_GIT)"

SERVICE_STOPPED=false
rollback_on_error() {
  status=$?
  if [[ "$status" -ne 0 && "$SERVICE_STOPPED" == "true" ]]; then
    echo "ci-deploy-systemd-remote: deploy failed; restarting previous systemd service" >&2
    sudo systemctl daemon-reload || true
    sudo systemctl restart "$UNIT" || true
  fi
  exit "$status"
}
trap rollback_on_error EXIT

sudo systemctl stop "$UNIT"
SERVICE_STOPPED=true

# Git must run as plaud after ownership is fixed (avoids dubious ownership).
sudo chown -R plaud:plaud "$REPO"
sudo -u plaud git config --global --add safe.directory "$REPO" 2>/dev/null || true

if [[ "$BOOTSTRAP_GIT" == "true" ]]; then
  if [[ -z "${GIT_FETCH_TOKEN:-}" || -z "${GITHUB_REPOSITORY:-}" ]]; then
    echo "ci-deploy-systemd-remote: GitHub repository and fetch token are required to restore .git." >&2
    exit 2
  fi
  sudo -u plaud git -C "$REPO" init
fi

ORIGIN_BEFORE="$(sudo -u plaud git -C "$REPO" remote get-url origin 2>/dev/null || true)"
if [[ -n "${GIT_FETCH_TOKEN:-}" && -n "${GITHUB_REPOSITORY:-}" ]]; then
  AUTH_ORIGIN="https://x-access-token:${GIT_FETCH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
  if [[ -n "$ORIGIN_BEFORE" ]]; then
    sudo -u plaud git -C "$REPO" remote set-url origin "$AUTH_ORIGIN"
  else
    sudo -u plaud git -C "$REPO" remote add origin "$AUTH_ORIGIN"
  fi
fi

sudo -u plaud git -C "$REPO" fetch origin "$REF"
sudo -u plaud git -C "$REPO" reset --hard "origin/$REF"
sudo -u plaud git -C "$REPO" clean -fd

if [[ -n "${GIT_FETCH_TOKEN:-}" && -n "${GITHUB_REPOSITORY:-}" ]]; then
  PUBLIC_ORIGIN="https://github.com/${GITHUB_REPOSITORY}.git"
  sudo -u plaud git -C "$REPO" remote set-url origin "$PUBLIC_ORIGIN"
elif [[ -n "$ORIGIN_BEFORE" ]]; then
  sudo -u plaud git -C "$REPO" remote set-url origin "$ORIGIN_BEFORE"
fi

sudo -u plaud mkdir -p "$REPO/.npm-cache"
NPM_ENV="NPM_CONFIG_CACHE=$REPO/.npm-cache npm_config_cache=$REPO/.npm-cache"
sudo -u plaud bash -lc "cd '$REPO' && $NPM_ENV npm install --workspaces --ignore-scripts"
if [[ -f "$REPO/browser-extension/package.json" ]]; then
  sudo -u plaud bash -lc "cd '$REPO/browser-extension' && $NPM_ENV npm install --ignore-scripts"
fi

UNIT_FILE="$REPO/deploy/systemd/$UNIT"
if [[ ! -f "$UNIT_FILE" ]]; then
  UNIT_FILE="$REPO/deploy/systemd/plaud-exporter.service"
fi
sudo cp "$UNIT_FILE" "/etc/systemd/system/$UNIT"
# Repo may live outside /srv/plaud-exporter — align unit paths with detected checkout.
sudo sed -i "s|^WorkingDirectory=.*|WorkingDirectory=$REPO|" "/etc/systemd/system/$UNIT"
sudo sed -i "s|^EnvironmentFile=.*|EnvironmentFile=$REPO/.env|" "/etc/systemd/system/$UNIT"
if grep -q '^ReadWritePaths=' "/etc/systemd/system/$UNIT"; then
  sudo sed -i "s|^ReadWritePaths=.*|ReadWritePaths=$REPO /var/log/plaud-exporter|" "/etc/systemd/system/$UNIT"
fi
sudo systemctl daemon-reload
sudo systemctl restart "$UNIT"

for i in $(seq 1 24); do
  if systemctl is-active --quiet "$UNIT"; then
    echo "ci-deploy-systemd-remote: $UNIT is active"
    systemctl status "$UNIT" --no-pager -l | head -20
    SERVICE_STOPPED=false
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
