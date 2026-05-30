#!/usr/bin/env bash
# Generates lcov coverage for server and extension workspaces, then enforces
# thresholds via scripts/coverage-thresholds.mjs. Requires Node 22+ (lcov reporter).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/coverage"

# Ensure each workspace produces a separate lcov so include filters stay simple.
( cd "$ROOT/server" && npm run --silent test:coverage )
( cd "$ROOT/plaud-exporter" && npm run --silent test:coverage )

node "$ROOT/scripts/coverage-thresholds.mjs" \
  "$ROOT/coverage/server.lcov.info" \
  "$ROOT/scripts/coverage-thresholds.server.json"

node "$ROOT/scripts/coverage-thresholds.mjs" \
  "$ROOT/coverage/extension.lcov.info" \
  "$ROOT/scripts/coverage-thresholds.extension.json"

echo "run-coverage: OK"
