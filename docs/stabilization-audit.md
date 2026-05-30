# Plaud Exporter Stabilization Audit

> Technical audit (2026-05-18). Day-to-day ops: [getting-started.md](./getting-started.md).

## Current architecture

- **Root repo** `plaud-server-exporter`: Node 20+ CLI (`server:auth`, `server:sync`, `server:status`, `logout`).
- **Submodule** `plaud-exporter/`: Chrome extension + shared `common/syncCore.js`, `common/exportPathUtils.js`,
  `common/plaudFolders.js`.
- **Server** `server/src/`: Playwright auth, session snapshot, Plaud API client, sync runner, Obsidian writer, filename
  planner, error reporter, JSON sync-index, run lock.

No database, queue, or HTTP server — CLI and files only.

**Target server:** Ubuntu 22.04 VPS (~1 vCPU / 1 GB RAM). Playwright auth on Mac only; `session.json` copied via `scp`.

## Current sync flow

1. Load `server/.data/session.json` → `PlaudSession`.
2. Acquire `sync.lock` (skipped in dry-run).
3. `listAllRecordings` → paginated `/file/simple/web`.
4. Per recording: `fetchSummaries` (`/ai/query_note`), build stable id + summary hash.
5. `determineSyncAction` against `sync-index.json`.
6. Write clean Markdown under `{vault}/Plaud/` (optional folder segment from Plaud tags).
7. Atomic `saveSyncIndex`; write `status.json`.
8. Exit `3` if any `plaud_changed`; exit `1` on per-file errors; exit `4` on lock conflict.

## Auth/session flow

- **Interactive:** Playwright → `web.plaud.ai` → snapshot `localStorage` + cookies → `session.json` (`chmod 600`).
- **Profile:** `server/.data/playwright-profile/` (gitignored).
- **API client:** `Authorization`, `workspace-id`, region redirect on `-302`, retries except 401/403.
- **`server:status`:** JSON with session *presence* only (no token values).
- **Expiry:** `PlaudAuthError` → `_errors/auth_error*.md`, exit `2`; re-run `server:auth` on Mac and `scp`.

## Summary export flow

- Notes from `/ai/query_note` (`summary`, `auto_sum_note`, `sum_multi_note`).
- **`.md` content:** summary body only — no YAML frontmatter, no exporter debug fields.
- Duplicate leading `# Title` stripped when it matches the resolved meeting title.
- **Metadata** (stable id, hash, paths, timestamps): `server/.data/sync-index.json` only.

## Audio export status

- **Server exporter: summary-only only.** No `--audio-too`, no `PLAUD_EXPORT_AUDIO` env, no audio download in `runSync`.
- `runSync` never calls `/file/temp-url` (covered by `syncAudioDefault.test.js`).
- Helpers `writeAudioFile`, `planAudioPath`, `fetchAudioUrl` remain in codebase but are **not wired** to sync —
  intentional simplification; user requirement is no audio by default.
- **Chrome extension** (`plaud-exporter/`) still has its own audio export; unchanged and tested via
  `npm run test:submodule`.

## File naming logic

- **Module:** `server/src/sync/filenamePlanner.js` (+ shared `exportPathUtils.js`).
- **Title resolution:** Plaud `file_name` → first non-boilerplate Markdown heading → `YYYY-MM-DD Plaud summary`.
- **Boilerplate ignored:** `Plaud`, `Plaud Web`, `Untitled`, empty.
- **Filename pattern:** `YYYY-MM-DD - {title}.md`, cross-platform sanitize, Windows reserved names escaped.
- **Collisions:** short stable-id suffix via `collectOccupiedFilenames` / sync-index.

## Filename/path length handling

- Path component limit 255 (Win/macOS/Linux) → **242** chars for filename incl. `.md` (~5% below 255).
- Full path budget **240** chars (`MAX_FULL_PATH_LENGTH`) for conservative Windows MAX_PATH.
- `planSummaryPath` shrinks title when vault prefix is long.
- Truncation via `Intl.Segmenter` (grapheme-safe) when available.

## Error handling

- **`errorClassifier.js`:** `auth_error`, `plaud_changed`, `network_error`, `rate_limit`, `write_error`, `config_error`,
  `unknown_error`.
- **`errorReporter.js`:** human Markdown in `{vault}/_errors/`, redaction, dedupe by `dedupe_key`.
- **`PlaudChangedError`** on unexpected API list/summary shapes.
- **Exit codes:** `0` ok, `1` generic, `2` auth, `3` plaud_changed, `4` lock held.
- Dry-run logs errors but does not write `_errors/` files.

## Sync index behavior

- Path: `server/.data/sync-index.json`.
- Atomic write: temp file + rename; `.bak` of previous version.
- Corrupt JSON: recover from `.bak` or start empty.
- Dedup: `stableId` primary, `fingerprint` secondary (`syncCore.js`).
- **Unchanged summary:** skip write.
- **Content change:** update file.
- **Metadata-only change** (title, filename, `folderSegment`): rename/move on disk (`metadataOnly`, no API re-download).
- **User deleted `.md`:** restore on next sync if hash unchanged.
- **Same title, different ids:** distinct files (collision suffix).
- **Lock:** `sync.lock` via `O_EXCL`; stale >2h or dead pid removed.

## Tests coverage

**127 server tests** (`npm test`), **15 extension tests** (`npm run test:submodule`) — на момент аудита; сейчас
`npm test` / `npm run test:submodule` из корня дают больше (см. CI).

| Area             | Coverage                                                                                                            |
|------------------|---------------------------------------------------------------------------------------------------------------------|
| Naming           | Plaud title, MD heading, boilerplate, forbidden chars, Windows reserved, long RU/EN, emoji, path budget, collisions |
| Summary-only     | Default `runSync` never hits `/file/temp-url`                                                                       |
| Sync integration | new / unchanged / updated / rename-only / duplicate titles / restore deleted file / skip bad id / dry-run           |
| Errors           | auth + plaud_changed reports, redaction, dedupe, classifier kinds                                                   |
| Lock             | parallel run exit 4, dry-run bypass                                                                                 |
| CLI subprocess   | no session → 2, read-only export root                                                                               |
| Index            | atomic save, `.bak`, load missing                                                                                   |
| API client       | headers, redirect, 401, shape errors                                                                                |

## Main risks

| Risk                                 | Impact                                                     |
|--------------------------------------|------------------------------------------------------------|
| Plaud API/DOM change                 | Sync fails; `plaud_changed` in `_errors/`, exit 3          |
| Token expiry                         | Auth errors; `server:auth` + `scp`                         |
| Lost sync-index                      | Re-export possible; unchanged content skipped by hash      |
| Concurrent sync (same host)          | Exit 4; lock auto-expires                                  |
| Concurrent sync (NFS, two hosts)     | Local lock only — single writer or one timer               |
| Identical titles, different meetings | Collision suffix — OK                                      |
| Deep `PLAUD_OBSIDIAN_VAULT_PATH`     | Very short basenames                                       |
| 1 GB VPS                             | No Playwright on server; OOM on `npm install` without swap |

## Refactoring plan

| # | Item                                        | Status        |
|---|---------------------------------------------|---------------|
| 1 | Summary-only default + test                 | ✅             |
| 2 | Clean Markdown (metadata in index only)     | ✅             |
| 3 | Unified filename planner + path limits      | ✅             |
| 4 | Error reporter + classification + redaction | ✅             |
| 5 | Atomic sync-index + backup                  | ✅             |
| 6 | Run lock + exit 4                           | ✅             |
| 7 | Remove server audio CLI/env (not needed)    | ✅             |
| 8 | Operational docs                            | ✅ (this pass) |
| 9 | Chrome extension untouched                  | ✅             |

## Acceptance checklist

- [x] `npm test`, `npm run lint`, `npm run verify`, `npm run test:submodule`
- [x] Default export is summary-only; server never downloads audio
- [x] Clean `.md` without exporter frontmatter
- [x] Meeting title in filename (Plaud → heading → date fallback)
- [x] Safe truncation, collisions, Windows reserved names, Unicode
- [x] `_errors/*.md` with redaction and dedupe
- [x] `plaud_changed` visible with exit 3
- [x] Sync-index atomic + `.bak`
- [x] Concurrent run blocked (exit 4)
- [x] Dry-run: no writes, no audio API
- [x] Extension tests green
- [x] README + deploy + security + troubleshooting documented
