# Stabilization Result

> Completed 2026-05-18. Operations: [getting-started.md](./getting-started.md). Audit: [stabilization-audit.md](./stabilization-audit.md).

## What changed

- **Summary-only server exporter.** Sync writes Markdown summaries only; no audio download path in `runSync`. No `--audio-too` or audio env vars — simpler ops, matches primary use case.
- **Clean Markdown.** Summary files contain Plaud content only; sync metadata lives in `server/.data/sync-index.json`.
- **Stable filenames.** `YYYY-MM-DD - {meeting title}.md` with sanitize, grapheme-safe truncation (242-char budget), collision suffixes, Windows reserved-name handling.
- **Error visibility.** Failures create redacted reports in `{export}/_errors/`; `plaud_changed` uses exit code 3.
- **Reliable sync.** Hash-based skip/update, rename-on-title-change, restore manually deleted files, `sync.lock` for concurrent runs (exit 4).
- **Tests.** 127 server + 15 extension tests; all green with `npm test`, `npm run lint`, `npm run verify`.

## Files changed

| Area | Key paths |
|------|-----------|
| Sync | `server/src/sync/syncRunner.js`, `filenamePlanner.js`, `obsidianWriter.js`, `serverSyncIndex.js`, `runLock.js` |
| Errors | `server/src/errors/errorReporter.js`, `errorClassifier.js`, `server/src/security/redact.js` |
| API / auth | `server/src/plaud/plaudApiClient.js`, `server/src/auth/*` |
| CLI | `server/src/cli/index.js` |
| Config | `server/src/config/config.js`, `.env.example` |
| Tests | `server/tests/*.test.js` |
| Docs | `docs/stabilization-*.md`, `server/README.md`, `docs/server-deploy.md`, `docs/security.md`, `docs/troubleshooting.md` |
| Extension submodule | **unchanged** |

## Behavior after changes

| Topic | Behavior |
|-------|----------|
| Default sync | Markdown summaries only |
| `.md` content | Plaud summary text, no exporter frontmatter |
| Filenames | `YYYY-MM-DD - {title}.md`, ≤242 chars, full path ≤240 budget |
| Errors | `{vault}/_errors/*.md`, redacted, deduped |
| Repeat sync | Skip unchanged, update on hash change, rename on title-only change |
| Deleted `.md` | Restored if index hash matches |
| Plaud API change | `plaud_changed`, exit 3 |
| Parallel sync | Second run exit 4 |
| Dry-run | No files, no index, no lock, no audio API |
| Audio | **Not exported** by server CLI (extension may still export audio in browser) |

## How to run

```bash
cd "$(git rev-parse --show-toplevel)"
npm install --workspaces
npx playwright install chromium   # Mac only, for auth
cp .env.example .env              # edit PLAUD_EXPORT_ROOT, PLAUD_TIMEZONE

npm run server:auth               # Mac: login → session.json
npm run server:status
npm run server:sync -- --dry-run
npm run server:sync               # summary-only export
node server/src/cli/index.js logout
```

On server: copy `session.json` from Mac, run `npm run server:sync` as user `plaud` — see [getting-started.md](./getting-started.md).

## How to test

```bash
npm test                 # 127 server tests
npm run lint
npm run verify
npm run test:submodule   # 15 extension tests
```

## How to deploy

See [server-deploy.md](./server-deploy.md) and [getting-started.md](./getting-started.md) (Telegram bot under systemd, logrotate, `scripts/server-as-plaud.sh`).

## Remaining risks

- Plaud API changes require code updates (surfaced as `plaud_changed`).
- JWT lifetime is controlled by Plaud — periodic re-auth on Mac.
- Very long vault paths leave little room for filenames.
- `sync.lock` is host-local; do not run two writers on shared storage from different machines.

## Manual checks needed

1. `server:auth` on a real Plaud account (Mac).
2. Full sync with 10+ recordings — filenames and clean Markdown in Obsidian folder.
3. Expired session — `_errors/auth_error*.md`, exit 2.
4. Simulated API shape break — `_errors/plaud_changed*.md`, exit 3.
5. Two simultaneous `server:sync` — one exits 4.
6. Chrome extension still loads (`npm run test:submodule`).
