# Plaud Exporter Stabilization Audit

## Current architecture

- **Root repo** `plaud-server-exporter`: Node 20+ CLI, workspaces, scripts `server:auth`, `server:sync`, `server:status`.
- **Submodule** `plaud-exporter/`: Chrome extension + shared `common/syncCore.js`, `common/exportPathUtils.js`.
- **Server** `server/src/`: Playwright auth, session snapshot, Plaud API client, sync runner, Obsidian writer, filename planner, error reporter, JSON sync-index.

No database, queue, or HTTP server — only CLI + files.

## Current sync flow

1. Load `session.json` → build `PlaudSession`.
2. `listAllRecordings` (paginated `/file/simple/web`).
3. Per file: `fetchSummaries` (`/ai/query_note`), build stable id + summary hash.
4. `determineSyncAction` against `sync-index.json`.
5. Write clean Markdown under `{vault}/Plaud/{YYYY}/`, update index atomically.
6. Optional audio only when `--audio-too` or `PLAUD_EXPORT_AUDIO=true`.

## Auth/session flow

- Interactive: Playwright → `web.plaud.ai` → snapshot `localStorage` + cookies → `session.json` (`0600`).
- Persistent profile: `playwright-profile/` (gitignored).
- API client: `Authorization`, `workspace-id`, region `-302` switch, retries except 401/403.
- `server:status` shows presence without token values.

## Summary export flow

- Summaries from `/ai/query_note` (types: `summary`, `auto_sum_note`, `sum_multi_note`).
- Markdown files contain **only** summary body (no YAML frontmatter).
- Metadata (stable id, hash, paths) lives in `sync-index.json`.

## Audio export status

- **Default: disabled.** `PLAUD_EXPORT_AUDIO=false`, `PLAUD_EXPORT_SUMMARY_ONLY=true`.
- Audio is enabled in exactly two cases:
  - CLI: `--audio-too`.
  - Env (both required): `PLAUD_EXPORT_SUMMARY_ONLY=false` **and** `PLAUD_EXPORT_AUDIO=true`.
- CLI flags `--no-audio` and `--summary-only` always force summary-only.
- Dry-run **never** fetches the audio URL: with `--audio-too --dry-run` the
  exporter only reports the would-download count (no Plaud API call).

## File naming logic

- Central module: `server/src/sync/filenamePlanner.js`.
- Title: Plaud `file_name` → markdown heading (skip boilerplate) → `YYYY-MM-DD Plaud summary`.
- Filename: `YYYY-MM-DD - {title}.md`, sanitized, Windows reserved names handled.
- Collisions: suffix from stable id in sync-index.

## Filename/path length handling

- Limit: 255 chars/component on Win/macOS/Linux → **242** chars max filename (~5% below 255).
- Full path: Windows MAX_PATH 260 → **240** chars conservative budget (`MAX_FULL_PATH_LENGTH`).
- `planSummaryPath` shrinks the title when `{vault}/Plaud/{year}/` leaves little room for the basename.
- Title budget accounts for date prefix + `.md`.
- Truncation via `Intl.Segmenter` (grapheme-safe) when available.

## Error handling

- `server/src/errors/errorClassifier.js` — kinds: `auth_error`, `plaud_changed`, `network_error`, `rate_limit`, `write_error`, `config_error`, `unknown_error`.
- `server/src/errors/errorReporter.js` — human Markdown in `{vault}/_errors/`, redacted, deduplicated.
- `PlaudChangedError` when API response shape is unexpected.
- Non-zero exit codes: auth `2`, plaud_changed `3`, other errors `1`.

## Sync index behavior

- Path: `server/.data/sync-index.json` (configurable).
- Atomic write: temp file + rename; `.bak` of previous version.
- Corrupt JSON: recover from `.bak` or empty index.
- Dedup: `stableId` primary, `fingerprint` secondary.
- Rename: metadata-only update moves file when title changes.
- **Deleted summary file:** if the index still has the same hash but the
  `.md` is missing on disk, the next sync rewrites the file (`updated`, not
  a duplicate).
- **Concurrent-run lock:** `server/.data/sync.lock` (atomic `open(O_EXCL)`)
  with `{ pid, host, startedAt }`. Stale (dead pid or > 2 h old) locks are
  auto-reclaimed. Dry-run is exempt.

## Tests coverage

- Naming (incl. emoji/unicode, Windows reserved names, long titles, full path).
- Audio defaults (summary-only by default, env opt-in, `--no-audio` override,
  dry-run does not call `/file/temp-url`).
- Sync integration (new, unchanged, updated, rename-only, duplicate titles,
  manually deleted file restore, missing-id filtering, dry-run).
- CLI subprocess (missing session → exit 2; read-only export root failure).
- Error classification across all 7 kinds + redaction + dedup.
- `plaud_changed` end-to-end (list and summary shapes) producing exit 3.
- Sync lock prevents parallel runs, dry-run bypasses lock.
- API client, session parser, sync-index atomic write + `.bak`.
- Extension tests: `npm run test:submodule` (14 tests, untouched).

## Main risks

| Risk | Impact |
|------|--------|
| Plaud API/DOM change | Sync fails; `plaud_changed` errors in `_errors/` |
| Token expiry | Auth errors; need `server:auth` |
| Lost sync-index | Re-download possible; unchanged content skipped by hash |
| Parallel runs on same host | `sync.lock` (exit 4); stale lock auto-reclaim after 2 h / dead pid |
| Parallel runs on NFS from two hosts | Lock is host-local only — run one writer or use a single scheduler host |
| Same title, different ids | Collision suffix prevents overwrite |

## Refactoring plan

1. ✅ Summary-only defaults and tests.
2. ✅ Clean Markdown (metadata in index only).
3. ✅ Unified filename planner + path limits.
4. ✅ Error reporter + classification.
5. ✅ Atomic sync-index + backup.
6. ✅ Documentation + operational guides.
7. ✅ Env `PLAUD_EXPORT_AUDIO=true` now actually opts into audio; `--no-audio` overrides.
8. ✅ Concurrent-run lock (`sync.lock`) with stale detection; exit code `4`.
9. ✅ Dry-run never fetches audio URLs even when audio is opted in.

## Acceptance checklist

- [x] `npm test`, `npm run lint`, `npm run verify` pass (61 server + 14 ext.)
- [x] Default summary-only, audio opt-in via CLI **or** explicit env pair
- [x] Clean `.md` without frontmatter
- [x] Meeting title in filename (Plaud → markdown heading → date fallback)
- [x] Safe truncation + collision handling + reserved Windows names + emoji
- [x] `_errors/*.md` with redaction and dedup
- [x] `plaud_changed` visible with exit code 3 (list and summary shapes)
- [x] Concurrent-run lock with exit code 4 and stale auto-reclaim
- [x] Dry-run does no writes and no audio API calls
- [x] Chrome extension untouched (`npm run test:submodule` still green)
- [x] Docs updated (README, server/README, .env.example, audit, result,
      security, deploy, troubleshooting)
