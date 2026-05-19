#!/usr/bin/env bash
# server-as-plaud.sh — run a command as user `plaud` from /srv/plaud-exporter.
#
# Designed for the production server (Ubuntu 22.04, см. docs/server-deploy.md).
# Решает рецидивирующие проблемы:
#   • `fatal: detected dubious ownership in repository at '/srv/plaud-exporter'`
#     (git запущен из-под root в дереве, принадлежащем `plaud`);
#   • файлы с владельцем `root`, появляющиеся после случайного `npm install`
#     или `git pull` от root;
#   • забывание `--preserve-env=HOME` при `sudo -u plaud`, из-за которого
#     `npm`/`npx` падают на чтении кэшей в `/root/.npm`.
#
# Usage:
#   sudo /srv/plaud-exporter/scripts/server-as-plaud.sh <command> [args...]
#
# Examples:
#   sudo /srv/plaud-exporter/scripts/server-as-plaud.sh git pull
#   sudo /srv/plaud-exporter/scripts/server-as-plaud.sh npm install --workspaces
#   sudo /srv/plaud-exporter/scripts/server-as-plaud.sh npm run server:sync -- --dry-run
#
# Overrides (env):
#   PLAUD_SERVER_DIR   default: /srv/plaud-exporter
#   PLAUD_SERVER_USER  default: plaud

set -euo pipefail

PROJECT_DIR="${PLAUD_SERVER_DIR:-/srv/plaud-exporter}"
TARGET_USER="${PLAUD_SERVER_USER:-plaud}"

usage() {
  cat >&2 <<EOF
Usage: $0 <command> [args...]

Runs <command> as user '$TARGET_USER' inside '$PROJECT_DIR'.

Examples:
  sudo $0 git pull
  sudo $0 npm install --workspaces
  sudo $0 npm run server:sync -- --dry-run

Overrides (env): PLAUD_SERVER_DIR, PLAUD_SERVER_USER
EOF
}

if [[ $# -eq 0 ]]; then
  usage
  exit 64
fi

if ! id -u "$TARGET_USER" >/dev/null 2>&1; then
  echo "server-as-plaud: user '$TARGET_USER' does not exist." >&2
  echo "  Создайте его как в docs/server-deploy.md §2:" >&2
  echo "  sudo useradd --system --create-home --home-dir $PROJECT_DIR --shell /usr/sbin/nologin $TARGET_USER" >&2
  exit 65
fi

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "server-as-plaud: directory '$PROJECT_DIR' not found." >&2
  echo "  Склонируйте репозиторий как в docs/server-deploy.md §3 и запустите снова." >&2
  exit 66
fi

quote_args() {
  local q=""
  local a
  for a in "$@"; do
    q+=" $(printf '%q' "$a")"
  done
  printf '%s' "$q"
}

# Уже работаем под нужным пользователем — просто переходим в каталог и запускаем.
if [[ "$(id -un)" == "$TARGET_USER" ]]; then
  cd "$PROJECT_DIR"
  exec "$@"
fi

# Из-под root: переключаемся на TARGET_USER, сохраняя HOME (нужно npm/npx).
if [[ "$(id -u)" -eq 0 ]]; then
  exec sudo -u "$TARGET_USER" --preserve-env=HOME bash -lc "cd $(printf '%q' "$PROJECT_DIR") &&$(quote_args "$@")"
fi

echo "server-as-plaud: запустите от root (sudo) или от пользователя '$TARGET_USER'." >&2
echo "  Текущий пользователь: $(id -un)" >&2
exit 77
