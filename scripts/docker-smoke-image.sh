#!/usr/bin/env bash
set -euo pipefail

# Modes:
#   SKIP_BUILD=0 (default) — build the image locally from the repo root.
#   SKIP_BUILD=1           — image must be available locally already; pull only
#                            if it is missing (set ALLOW_PULL=0 to disallow pull
#                            for PR builds that haven't been pushed yet).
IMAGE="${1:-plaud-exporter:smoke}"
SKIP_BUILD="${SKIP_BUILD:-0}"
ALLOW_PULL="${ALLOW_PULL:-1}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "$SKIP_BUILD" != "1" ]]; then
  docker build -t "$IMAGE" "$ROOT"
elif ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  if [[ "$ALLOW_PULL" == "1" ]]; then
    docker pull "$IMAGE"
  else
    echo "docker-smoke-image: image $IMAGE not present locally and ALLOW_PULL=0" >&2
    exit 1
  fi
fi

CID="$(docker run -d --rm \
  -e TELEGRAM_BOT_TOKEN=smoke:token \
  -e TELEGRAM_ALLOWED_USER_ID=1 \
  -e WEBAPP_HOST=0.0.0.0 \
  -e WEBAPP_PORT=8080 \
  "$IMAGE")"
trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 30); do
  if docker exec "$CID" curl -fsS http://127.0.0.1:8080/healthz >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

docker exec "$CID" node /app/scripts/smoke_container.mjs

docker exec "$CID" curl -fsS http://127.0.0.1:8080/healthz | python3 -c "
import json, sys
d = json.load(sys.stdin)
assert d.get('status') == 'ok', d
"

echo "docker-smoke-image: OK ($IMAGE)"
