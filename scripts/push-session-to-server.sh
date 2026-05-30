#!/usr/bin/env bash
# Deploy server/.data/session.json from your Mac to the production VPS.
# Run `npm run server:auth` on the Mac first — never on the server.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="${REPO_ROOT}/server/.data/session.json"

DEPLOY_HOST="${DEPLOY_HOST:-91.201.114.159}"
DEPLOY_USER="${DEPLOY_USER:-root}"
REMOTE_DATA="${REMOTE_DATA:-/opt/plaud-server-exporter/server/.data}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "push-session-to-server: run this script from your Mac (after npm run server:auth)." >&2
  exit 1
fi

if [[ ! -f "$SESSION" ]]; then
  echo "Missing ${SESSION}. Run: npm run server:auth" >&2
  exit 1
fi

echo "==> Upload session to ${DEPLOY_USER}@${DEPLOY_HOST}"
scp "$SESSION" "${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/session.json"

echo "==> Install session and restart bot"
# REMOTE_DATA must be expanded locally before sending, so the unquoted EOF is
# intentional (shellcheck SC2087 is acknowledged here).
# shellcheck disable=SC2087
ssh "${DEPLOY_USER}@${DEPLOY_HOST}" bash -s <<EOF
set -euo pipefail
sudo install -d -o plaud -g plaud -m 700 '${REMOTE_DATA}'
sudo install -o plaud -g plaud -m 600 /tmp/session.json '${REMOTE_DATA}/session.json'
rm -f /tmp/session.json
sudo systemctl restart plaud-exporter.service
sudo systemctl is-active plaud-exporter.service
EOF

echo "Done. Session deployed; plaud-exporter.service restarted."
