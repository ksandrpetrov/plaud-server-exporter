#!/usr/bin/env bash
set -euo pipefail

IMAGE="${1:-plaud-exporter:smoke}"
SKIP_BUILD="${SKIP_BUILD:-0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "$SKIP_BUILD" != "1" ]]; then
  docker build -t "$IMAGE" "$ROOT"
else
  docker pull "$IMAGE"
fi

CID="$(docker run -d --rm \
  -e TELEGRAM_BOT_TOKEN=smoke:token \
  -e TELEGRAM_ALLOWED_USER_ID=1 \
  -e WEBAPP_HOST=0.0.0.0 \
  -e WEBAPP_PORT=8080 \
  "$IMAGE")"
trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

for i in $(seq 1 30); do
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
