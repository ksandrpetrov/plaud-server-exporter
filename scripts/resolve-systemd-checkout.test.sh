#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=scripts/resolve-systemd-checkout.sh
source "$(dirname "$0")/resolve-systemd-checkout.sh"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/requested/.git" "$fixture/moved/.git" "$fixture/unrelated"
touch "$fixture/requested/.env" "$fixture/moved/.env" "$fixture/unrelated/.env"
printf '{"name":"plaud-server-exporter"}\n' > "$fixture/moved/package.json"
resolve_systemd_checkout "$fixture/requested" "$fixture/moved" "$fixture"
[[ "$REPO" == "$fixture/requested" && "$BOOTSTRAP_GIT" == false ]]
rmdir "$fixture/requested/.git"
resolve_systemd_checkout "$fixture/requested" "$fixture/moved" "$fixture"
[[ "$REPO" == "$fixture/requested" && "$BOOTSTRAP_GIT" == true ]]
resolve_systemd_checkout "" "$fixture/moved" "$fixture"
[[ "$REPO" == "$fixture/moved" && "$BOOTSTRAP_GIT" == false ]]
resolve_systemd_checkout "" "" "$fixture"
[[ "$REPO" == "$fixture/moved" && "$AUTO_DISCOVERED" == 1 ]]
rmdir "$fixture/moved/.git"
resolve_systemd_checkout "" "" "$fixture"
[[ "$BOOTSTRAP_GIT" == true ]]
mkdir -p "$fixture/second/server/.data"
touch "$fixture/second/.env" "$fixture/second/server/.data/session.json"
if resolve_systemd_checkout "" "" "$fixture"; then
  echo 'ambiguous discovery must fail' >&2; exit 1
fi
[[ -z "$REPO" && "$AUTO_DISCOVERED" == 2 ]]
rm "$fixture/moved/.env" "$fixture/second/.env"
if resolve_systemd_checkout "$fixture/moved" "" "$fixture"; then
  echo 'missing environment must fail' >&2; exit 1
fi
[[ -z "$REPO" ]]
echo 'resolve-systemd-checkout.test: OK'
