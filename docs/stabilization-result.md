# Stabilization Result

This document summarizes stabilization of the server exporter: summary-only
defaults, clean Markdown, stable naming, error reports, sync-index safety, and
regression tests. A follow-up pass added deleted-file restore and CLI
operational tests.

## What changed

- **Env opt-in for audio actually works.** Previously the CLI hard-coded
  `summaryOnly=true` whenever no flag was passed, so `PLAUD_EXPORT_AUDIO=true`
  in `.env` was silently ignored. Audio is now enabled when **either**
  `--audio-too` is passed **or** both `PLAUD_EXPORT_SUMMARY_ONLY=false` and
  `PLAUD_EXPORT_AUDIO=true` are set. Default remains summary-only.
- **`--no-audio` / `--summary-only` flags** override env opt-in for ad-hoc
  forced summary runs.
- **Concurrent-run lock.** New `server/src/sync/runLock.js` acquires
  `server/.data/sync.lock` via atomic `open(O_EXCL)` with `{ pid, host,
  startedAt }`. A blocked run exits **code 4** without side effects. Stale
  locks (dead pid or > 2 h old) are auto-reclaimed. Dry-run is exempt.
- **Dry-run never calls `/file/temp-url`.** Even with `--audio-too --dry-run`,
  the exporter only reports the would-download count instead of touching the
  Plaud audio endpoint.
- **CLI polish.** `logout` is now in the help text; `--no-audio` flag added.
- **Deleted summary restore.** If you remove a `.md` but `sync-index.json`
  still has the same `summaryHash`, the next sync recreates the file
  (`updated: 1`) instead of silently skipping.
- **New tests** (61 server + 14 extension; verified 2026-05-18):
  - All 7 error classifier kinds.
  - `plaud_changed` end-to-end (list-recordings shape & summary shape) ⇒ exit 3.
  - Recordings without normalizable id are filtered, not crashed on.
  - Emoji/unicode title, Windows reserved names (COM1/LPT1/NUL/AUX/PRN),
    full basename budget.
  - Audio mode precedence (defaults, env opt-in, env summary-only, CLI overrides).
  - Sync lock acquire/release, dry-run bypass.
  - Manually deleted `.md` restored on next sync.
  - CLI: missing session (exit 2), read-only export path failure.

## Files changed

| Area | Files |
|------|-------|
| New server modules | `server/src/sync/runLock.js`, `server/src/cli/audioMode.js` |
| Server core | `cli/index.js`, `sync/syncRunner.js` (deleted-file restore) |
| Tests added | `tests/syncRunner.errors.test.js`, `tests/cliAudioMode.test.js`, `tests/cliCommands.test.js`, `tests/config.test.js` |
| Tests extended | `tests/errorReporter.test.js`, `tests/filenamePlanner.test.js`, `tests/syncAudioDefault.test.js`, `tests/syncRunner.integration.test.js` |
| Docs | `.env.example`, `server/README.md`, `docs/stabilization-audit.md`, `docs/stabilization-result.md` (this file), `docs/server-deploy.md`, `docs/troubleshooting.md` |
| Chrome extension submodule | **untouched** |

## Behavior after changes

| Topic | Behavior |
|-------|----------|
| Default sync | Summary Markdown only, no audio fetch |
| `.md` content | Plaud summary text, no exporter frontmatter |
| Filenames | `YYYY-MM-DD - {meeting title}.md`, ≤ 242 chars, ≤ 240-char full path |
| Errors | `{vault}/_errors/*.md`, redacted, deduped by hash |
| Re-sync | Skip unchanged (hash), update on change, rename on title-only change; restore missing `.md` |
| Plaud API change | `plaud_changed`, exit 3 |
| Concurrent run | Second run exits 4, no writes |
| Dry-run | No writes; never fetches audio URL |

## How to run

From the repository root (not `docs/`):

```bash
cd "$(git rev-parse --show-toplevel)"
npm install --workspaces
npx playwright install chromium
cp .env.example .env
npm run server:auth
npm run server:sync -- --dry-run
npm run server:sync                  # summary only
npm run server:sync -- --audio-too   # one-off audio
npm run server:sync -- --no-audio    # force summary-only even if env opted in
npm run server:status
node server/src/cli/index.js logout  # delete saved session snapshot
```

## How to test

```bash
npm test                # 61 server tests
npm run lint            # eslint
npm run verify          # submodule + import graph
npm run test:submodule  # 14 extension tests, untouched
```

## How to deploy

See [`server-deploy.md`](./server-deploy.md). Key new operational notes:

- Systemd `Type=oneshot` with `ExecStart=npm run server:sync` is unaffected.
- The lock file `server/.data/sync.lock` belongs to the unit user; clean it
  up only if the previous process died and the auto-reclaim has not yet
  fired.
- If you want audio on the server, set both env flags in the unit's
  `EnvironmentFile=` or `.env` — flipping just one is intentionally a no-op.

## Remaining risks

- Plaud API changes still require manual code updates (now surfaced as
  `plaud_changed` instead of generic failures).
- Very deep `PLAUD_OBSIDIAN_VAULT_PATH` (close to 240 chars itself) leaves
  little room for the basename; title shrinks accordingly but at the
  extreme, the resulting filename may be very short.
- Session JWT lifetime is bounded by Plaud — periodic `server:auth` is
  still required.
- Lock is host-local; if you ever run two instances against the same NFS
  share, prefer a single host or upgrade the lock to a network-safe one.

## Manual checks needed

1. Real `server:auth` against the production Plaud account.
2. Full sync on a server with 10+ recordings — verify clean Markdown and
   stable filenames.
3. Force `PLAUD_EXPORT_SUMMARY_ONLY=false` + `PLAUD_EXPORT_AUDIO=true` on a
   sandbox and confirm audio downloads end up in `_attachments/`.
4. Trigger two `server:sync` commands at once and confirm one exits with
   code `4` and writes nothing.
5. Intentionally expire the session and confirm `_errors/auth_error*.md`
   appears with exit code `2`.
6. Mock a malformed Plaud response (or wait for the real thing) and confirm
   `_errors/plaud_changed*.md` with exit code `3`.
7. Confirm the Chrome extension still loads (`npm run test:submodule`).
