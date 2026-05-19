# Server exporter

Node.js CLI that exports **Plaud meeting summaries** to Markdown for Obsidian (or any folder tree). Designed for a small VPS next to other services — no database, no web UI.

**Default behavior: summary-only.** Audio is not downloaded by the server exporter.

## What it does

1. Uses a saved Plaud session (`session.json` from Playwright login on Mac).
2. Lists recordings via Plaud internal API.
3. Fetches AI summaries and writes `.md` files under `{vault}/Plaud/{year}/`.
4. Tracks state in `server/.data/sync-index.json` to avoid duplicates.
5. On failure, writes human-readable error reports to `{vault}/_errors/`.

## Quick start

From the **repository root** (not this folder):

```bash
npm install --workspaces
npx playwright install chromium   # Mac, for auth only
cp .env.example .env
# Edit PLAUD_EXPORT_ROOT and PLAUD_TIMEZONE

npm run server:auth      # interactive login → server/.data/session.json
npm run server:status    # paths, session presence, last sync stats
npm run server:sync -- --dry-run
npm run server:sync      # real export (summary only)
```

Full guide: [docs/getting-started.md](../docs/getting-started.md).

## Configuration (`.env` in repo root)

| Variable | Purpose |
|----------|---------|
| `PLAUD_EXPORT_ROOT` | Directory for Markdown exports (required) |
| `PLAUD_OBSIDIAN_VAULT_PATH` | Optional: write into an existing Obsidian vault instead of export root |
| `PLAUD_OBSIDIAN_SUBFOLDER` | Subfolder under vault (default `Plaud`) |
| `PLAUD_MIRROR_FOLDERS` | Mirror Plaud folder tags in path (default `true`) |
| `PLAUD_TIMEZONE` | IANA timezone for dates in filenames (default `UTC`) |
| `PLAUD_DATA_DIR` | Override `server/.data` location |
| `PLAUD_LOG_LEVEL` | `debug` / `info` / `warn` / `error` |

Do not commit `.env` or `server/.data/session.json`.

## Commands

| Command | Description |
|---------|-------------|
| `npm run server:auth` | Playwright login on Mac; saves session |
| `npm run server:sync` | Export summaries |
| `npm run server:sync -- --dry-run` | Plan only: no files, no index update |
| `npm run server:status` | JSON status (no secrets) |
| `node server/src/cli/index.js logout` | Remove session snapshot |

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Sync errors (see `_errors/`) |
| `2` | Auth / missing session |
| `3` | Plaud API shape change (`plaud_changed`) |
| `4` | Another sync already running |

## Where files go

| Output | Path |
|--------|------|
| Summaries | `{PLAUD_EXPORT_ROOT or vault}/Plaud/{YYYY}/YYYY-MM-DD - {title}.md` |
| Errors | `{same vault root}/_errors/YYYY-MM-DD-HH-MM-plaud-export-error-*.md` |
| Sync index | `server/.data/sync-index.json` (not inside export tree) |
| Session | `server/.data/session.json` |
| Status | `server/.data/status.json` |

Summary `.md` files contain **only** the meeting summary text. Technical fields (stable id, hash, paths) are in `sync-index.json`.

## Audio

The **server exporter does not download audio.** There is no `--audio-too` flag. If you need audio, use the Chrome extension in `plaud-exporter/` or export manually from Plaud Web.

## Production server

- Run `server:auth` on **Mac only**; copy `session.json` to the server (`scp`).
- Run `server:sync` as a dedicated user (e.g. `plaud`) via systemd timer or cron.
- Do **not** run Playwright auth on a 1 GB VPS.

See [docs/server-deploy.md](../docs/server-deploy.md), [docs/security.md](../docs/security.md), [docs/troubleshooting.md](../docs/troubleshooting.md).

## Development

```bash
npm test              # from repo root
npm run lint
```

Tests live in `server/tests/`.
