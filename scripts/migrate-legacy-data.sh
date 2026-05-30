#!/usr/bin/env bash
# One-time migration: copy server/.data from systemd host path into Docker named volume.
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/plaud-exporter}"
LEGACY_DATA_DIR="${LEGACY_DATA_DIR:-/srv/plaud-exporter/server/.data}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-plaud-exporter}"
VOLUME_NAME="${COMPOSE_PROJECT_NAME}_app-data"
FORCE="${FORCE:-0}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root on the server (sudo)." >&2
  exit 1
fi

count_json() {
  local dir="$1"
  if [[ ! -d "$dir" ]]; then echo 0; return; fi
  find "$dir" -maxdepth 1 -type f -name '*.json' 2>/dev/null | wc -l | tr -d ' '
}

VOL_PATH="$(docker volume inspect "$VOLUME_NAME" -f '{{ .Mountpoint }}' 2>/dev/null || true)"
if [[ -z "$VOL_PATH" ]]; then
  echo "Volume $VOLUME_NAME not found. Run docker compose up once in $DEPLOY_DIR." >&2
  exit 1
fi

host_n="$(count_json "$LEGACY_DATA_DIR")"
vol_n="$(count_json "$VOL_PATH")"

if [[ "$host_n" -eq 0 ]]; then
  echo "No JSON files in $LEGACY_DATA_DIR — nothing to migrate."
  exit 0
fi

if [[ "$vol_n" -ge "$host_n" && "$FORCE" != "1" ]]; then
  echo "Volume already has $vol_n JSON files (host $host_n). Set FORCE=1 to overwrite."
  exit 0
fi

cd "$DEPLOY_DIR"
export COMPOSE_PROJECT_NAME
docker compose stop bot || true

RESCUE="/root/plaud-exporter-rescue-$(date +%Y%m%d%H%M%S)"
mkdir -p "$RESCUE"
cp -a "$VOL_PATH/." "$RESCUE/" 2>/dev/null || true
echo "Rescue copy: $RESCUE"

cp -a "${LEGACY_DATA_DIR}/." "$VOL_PATH/"
find "$VOL_PATH" -type f -exec chmod 600 {} \;
chown -R 1000:1000 "$VOL_PATH" 2>/dev/null || chown -R node:node "$VOL_PATH" 2>/dev/null || true

docker compose up -d

for _ in $(seq 1 24); do
  if docker compose ps --format '{{.Health}}' 2>/dev/null | grep -q healthy; then
    echo "Migration complete. volume=$VOLUME_NAME files=$(count_json "$VOL_PATH")"
    exit 0
  fi
  sleep 5
done

docker compose logs --tail=80 bot
exit 1
