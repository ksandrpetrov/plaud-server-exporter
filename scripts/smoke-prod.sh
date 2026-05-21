#!/usr/bin/env bash
# Post-deploy smoke against public HTTPS base URL (no trailing slash).
set -euo pipefail

BASE="${SMOKE_PUBLIC_BASE_URL:-}"
if [[ -z "$BASE" ]]; then
  echo "smoke-prod: set SMOKE_PUBLIC_BASE_URL (e.g. https://example.com)" >&2
  exit 2
fi

BASE="${BASE%/}"

check_json_healthz() {
  local body
  body="$(curl -fsS "${BASE}/healthz")"
  python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
assert d.get('status') == 'ok', d
" <<<"$body"
  echo "GET /healthz OK (JSON)"
}

check_connect_html() {
  local code
  code="$(curl -fsS -o /dev/null -w '%{http_code}' "${BASE}/connect")"
  [[ "$code" == "200" ]]
  echo "GET /connect OK ($code)"
}

check_api_unauth() {
  local code
  code="$(curl -fsS -o /dev/null -w '%{http_code}' "${BASE}/api/v1/status")"
  [[ "$code" == "401" ]]
  echo "GET /api/v1/status OK (401 without init data)"
}

check_json_healthz
check_connect_html
check_api_unauth
echo "smoke-prod: all checks passed"
