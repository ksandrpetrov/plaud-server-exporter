#!/usr/bin/env bash
# shellcheck disable=SC2034
# Output variables are consumed by the caller after this function returns.
# Read-only checkout selection. Sets REPO, BOOTSTRAP_GIT, AUTO_DISCOVERED.
# Optional search roots allow hermetic tests; production uses /srv /opt /home.
resolve_systemd_checkout() {
  local requested="$1" unit_workdir="$2"
  shift 2
  local roots=("$@") candidates=("$requested") discovered=()
  local root dir env_file
  [[ "${#roots[@]}" -gt 0 ]] || roots=(/srv /opt /home)
  REPO=""
  BOOTSTRAP_GIT=false
  AUTO_DISCOVERED=0

  for root in "${roots[@]}"; do
    case "$unit_workdir" in
      "$root"/*) candidates+=("$unit_workdir"); break ;;
    esac
  done
  for root in "${roots[@]}"; do
    case "$root" in
      /srv) candidates+=(/srv/plaud-exporter) ;;
      /opt) candidates+=(/opt/plaud-server-exporter) ;;
      /home) candidates+=(/home/plaud/plaud-server-exporter) ;;
    esac
  done

  # An explicit path or the loaded unit is authoritative, including recovery
  # after .git was removed. Never prefer a different checkout just for its .git.
  for dir in "${candidates[@]}"; do
    [[ -d "$dir" && -f "$dir/.env" ]] || continue
    REPO="$dir"
    [[ -d "$dir/.git" ]] || BOOTSTRAP_GIT=true
    return 0
  done

  while IFS= read -r env_file; do
    dir="${env_file%/.env}"
    if grep -Eq '"name"[[:space:]]*:[[:space:]]*"plaud-server-exporter"' "$dir/package.json" 2>/dev/null ||
      [[ -f "$dir/server/.data/session.json" || -f "$dir/server/.data/owner-chat.json" ]]; then
      discovered+=("$dir")
    fi
  done < <(find "${roots[@]}" -mindepth 2 -maxdepth 6 -type f -name .env -print 2>/dev/null | sort -u)
  AUTO_DISCOVERED="${#discovered[@]}"
  [[ "$AUTO_DISCOVERED" -eq 1 ]] || return 2
  REPO="${discovered[0]}"
  [[ -d "$REPO/.git" ]] || BOOTSTRAP_GIT=true
}
