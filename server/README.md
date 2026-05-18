# Plaud Server Exporter

Server-side CLI that exports Plaud meeting **summaries** to Obsidian-friendly Markdown on disk.

## Default behavior

- **Summary only** — audio is never downloaded unless you opt in.
- Markdown files contain the meeting summary text only (no YAML frontmatter).
- Sync metadata lives in `sync-index.json`, not inside `.md` files.
- Failures produce readable reports in `_errors/`.
- If you delete a summary `.md` by hand, the next sync restores it when the
  index hash is unchanged (no duplicate).
- A file lock (`server/.data/sync.lock`) prevents two parallel `server:sync`
  runs from corrupting the index. A stale lock (dead pid, > 2 h old) is
  reclaimed automatically.

## Configuration

Copy the repo `.env.example` to `.env` at the repository root:

```env
PLAUD_EXPORT_ROOT=/path/to/exports
PLAUD_EXPORT_SUMMARY_ONLY=true       # default; flip to false to enable env opt-in
PLAUD_EXPORT_AUDIO=false             # opt-in audio; only honored when summary-only=false
PLAUD_TIMEZONE=Europe/Moscow
# PLAUD_OBSIDIAN_VAULT_PATH=/path/to/vault   # optional
```

Audio is enabled in **exactly** these cases:

| Flag/env                                          | Result          |
|---------------------------------------------------|-----------------|
| `--audio-too` on CLI                              | Audio enabled   |
| `PLAUD_EXPORT_SUMMARY_ONLY=false` + `PLAUD_EXPORT_AUDIO=true` | Audio enabled |
| Anything else (including default)                 | Summary only    |
| `--no-audio` or `--summary-only`                  | Summary only (overrides env) |

## Commands

```bash
cd "$(git rev-parse --show-toplevel)"   # repo root — not docs/

npm run server:auth          # one-time Plaud login (uses your installed Chrome; see troubleshooting if Google blocks)
npm run server:status        # config, session, index, last sync
npm run server:sync          # export summaries (default)
npm run server:sync -- --dry-run
npm run server:sync -- --audio-too   # opt-in audio for this run
npm run server:sync -- --no-audio    # force summary-only even if env opted in
node server/src/cli/index.js logout  # delete saved session snapshot
```

## Exit codes

| Code | Meaning                                            |
|------|----------------------------------------------------|
| 0    | Success                                            |
| 1    | Sync finished with per-file errors / network error |
| 2    | Auth error (`PlaudAuthError`) — run `server:auth`  |
| 3    | `plaud_changed` — Plaud API/shape changed, manual review needed |
| 4    | Another sync is already running (lock held)        |

## Output layout

```text
{vault or export root}/
├── Plaud/
│   └── 2026/
│       └── 2026-05-18 - Weekly planning.md
├── _errors/
│   └── 2026-05-18-12-00-plaud-export-error-….md
└── (optional) Plaud/_attachments/   # only with --audio-too
```

## Data files (gitignored)

| File | Purpose |
|------|---------|
| `server/.data/session.json` | Plaud session snapshot |
| `server/.data/sync-index.json` | Stable ids, hashes, paths |
| `server/.data/sync-index.json.bak` | Last good index copy (auto-restored on parse failure) |
| `server/.data/status.json` | Last sync stats |
| `server/.data/sync.lock` | Active sync lock (auto-removed on success) |
| `server/.data/playwright-profile/` | Browser profile for re-auth |

## More documentation

- [Deploy on Ubuntu](../docs/server-deploy.md)
- [Security](../docs/security.md)
- [Troubleshooting](../docs/troubleshooting.md)
- [Stabilization audit](../docs/stabilization-audit.md)
