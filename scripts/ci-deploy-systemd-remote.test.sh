#!/usr/bin/env bash
# Static checks for ci-deploy-systemd-remote.sh ordering.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="${ROOT}/scripts/ci-deploy-systemd-remote.sh"

bash -n "$SCRIPT"

preflight_line="$(grep -n 'Preflight + deploy' "$SCRIPT" | head -1 | cut -d: -f1)"
workdir_line="$(grep -n 'systemctl show.*WorkingDirectory' "$SCRIPT" | head -1 | cut -d: -f1)"
stop_line="$(grep -n 'systemctl stop' "$SCRIPT" | head -1 | cut -d: -f1)"
chown_line="$(grep -n 'chown -R plaud:plaud' "$SCRIPT" | head -1 | cut -d: -f1)"
init_line="$(grep -n 'git -C.*init' "$SCRIPT" | head -1 | cut -d: -f1)"
fetch_line="$(grep -n 'git -C.*fetch origin' "$SCRIPT" | head -1 | cut -d: -f1)"
restart_line="$(grep -n 'systemctl restart' "$SCRIPT" | tail -1 | cut -d: -f1)"

if [[ -z "$preflight_line" || -z "$workdir_line" || -z "$stop_line" || -z "$init_line" || -z "$fetch_line" || -z "$restart_line" ]]; then
  echo "ci-deploy-systemd-remote.test: expected markers missing" >&2
  exit 1
fi

if [[ -z "$chown_line" ]]; then
  echo "ci-deploy-systemd-remote.test: missing chown before git" >&2
  exit 1
fi

if [[ "$preflight_line" -ge "$workdir_line" || "$workdir_line" -ge "$stop_line" || "$stop_line" -ge "$chown_line" || "$chown_line" -ge "$init_line" || "$init_line" -ge "$fetch_line" || "$fetch_line" -ge "$restart_line" ]]; then
  echo "ci-deploy-systemd-remote.test: wrong order (preflight < workdir < stop < chown < init < fetch < restart)" >&2
  exit 1
fi

if ! grep -q 'reset --hard' "$SCRIPT"; then
  echo "ci-deploy-systemd-remote.test: missing git reset --hard" >&2
  exit 1
fi

if ! grep -q 'npm install --workspaces' "$SCRIPT"; then
  echo "ci-deploy-systemd-remote.test: missing npm install --workspaces" >&2
  exit 1
fi

if ! grep -q 'refusing deploy because.*\.env is missing' "$SCRIPT"; then
  echo "ci-deploy-systemd-remote.test: missing state-preserving .env guard" >&2
  exit 1
fi

if ! grep -q 'trap rollback_on_error EXIT' "$SCRIPT"; then
  echo "ci-deploy-systemd-remote.test: missing systemd rollback trap" >&2
  exit 1
fi

if ! grep -q 'deployed commit mismatch' "$SCRIPT" || ! grep -q '/healthz' "$SCRIPT"; then
  echo "ci-deploy-systemd-remote.test: missing commit or healthz post-deploy smoke" >&2
  exit 1
fi

bash "$ROOT/scripts/resolve-systemd-checkout.test.sh"
# Verify the actual SSH payload contains the helper, without contacting a host.
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
cat > "$fixture/ssh" <<'FAKE_SSH'
#!/usr/bin/env bash
cat > "$PAYLOAD_PATH"
FAKE_SSH
chmod +x "$fixture/ssh"
env -i PATH="$fixture:$PATH" PAYLOAD_PATH="$fixture/payload.sh" \
  DEPLOY_HOST=fixture.invalid DEPLOY_USER=fixture \
  bash "$SCRIPT" > /dev/null
bash -n "$fixture/payload.sh"
grep -q '^resolve_systemd_checkout()' "$fixture/payload.sh"
selector_line="$(grep -n '^resolve_systemd_checkout "' "$fixture/payload.sh" | cut -d: -f1)"
mutation_line="$(grep -n 'sudo systemctl stop' "$fixture/payload.sh" | head -1 | cut -d: -f1)"
[[ "$selector_line" -lt "$mutation_line" ]]
echo "ci-deploy-systemd-remote.test: OK"
