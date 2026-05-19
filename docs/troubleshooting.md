# Troubleshooting

## Plaud logged out (exit code 2)

**Symptoms:** `No session snapshot`, `PlaudAuthError`, `_errors/*auth_error*.md`.

**Fix (Mac):**

```bash
npm run server:auth
scp server/.data/session.json YOUR_SSH_USER@YOUR_SERVER_HOST:/tmp/session.json
```

On server: move into `server/.data/`, `chown plaud:plaud`, `chmod 600` — [getting-started.md](./getting-started.md).

Do not run Playwright on a 1 GB VPS.

## Plaud changed API (exit code 3)

**Symptoms:** `plaud_changed` in logs, `_errors/*plaud-export-error*.md` with stage `list-recordings` or `fetch-summary`.

**Meaning:** Response JSON no longer matches what `plaudApiClient.js` expects — needs a code update.

**Actions:**

1. Read the error Markdown in `{export}/_errors/`.
2. Compare with Plaud Web Network tab (no need to paste tokens).
3. Update `server/src/plaud/plaudApiClient.js` and add a regression test.

## Summary not exporting

**Check:**

```bash
npm run server:status   # session.snapshot.present, vaultRoot, exportRoot
```

- Recording has no AI summary in Plaud Web → empty or placeholder `.md`.
- Per-file errors increment `errors` in stats — see `_errors/` for that run.
- `PLAUD_MIRROR_FOLDERS` and folder tags — files may be under `Plaud/{year}/{folder}/`.

## Files not created

```bash
npm run server:status
ls -la "$PLAUD_EXPORT_ROOT/Plaud"
```

- Wrong `PLAUD_EXPORT_ROOT` or vault path in `.env`.
- Permission: export dir must be writable by user running sync (`plaud` on server).
- Dry-run does not write — remove `--dry-run` for real export.
- See [EACCES sync.lock](#eacces-synclock-on-server) if sync aborts before write.

## Strange file names

Expected pattern: `YYYY-MM-DD - {meeting title}.md`.

- Boilerplate titles (`Plaud`, `Untitled`) are ignored → fallback `YYYY-MM-DD Plaud summary`.
- Very long titles are truncated (~242 chars) — beginning kept readable.
- Duplicate titles get a short id suffix — not a bug.
- Forbidden characters become `-` or `_` (readable, not deleted).

Logic: `server/src/sync/filenamePlanner.js`.

## Error Markdown files in `_errors/`

Normal when something failed. Open the newest file — sections **Что случилось** / **Что сделать**.

- Dedupe: identical failures reuse the same file (check `dedupe_key` in technical section).
- Dry-run does not create `_errors/` — only logs.

## Duplicate files on re-run

Should **not** happen if `sync-index.json` is intact.

If duplicates appear:

1. Check `server/.data/sync-index.json` exists and is writable.
2. Corrupt index — restore from `sync-index.json.bak` or accept one-time re-export (unchanged hashes still skip content).
3. Two different stable ids with same title → two files by design.

## Google blocks login at `server:auth`

Use email/password, not Google. Install Google Chrome. Reset profile:

```bash
rm -rf server/.data/playwright-profile
npm run server:auth
```

## scp: Permission denied

SSH-level issue — same login as `ssh YOUR_SSH_USER@YOUR_SERVER_HOST`. Use `ssh-copy-id`. Do not use angle brackets in commands (`<user>` breaks zsh).

## EACCES sync.lock on server

**Symptom:** `status` OK, `sync` fails with `EACCES` on `sync.lock`.

**Cause:** `server/.data` owned by root.

```bash
sudo chown -R plaud:plaud /srv/plaud-exporter/server/.data
sudo chmod 700 /srv/plaud-exporter/server/.data
sudo rm -f /srv/plaud-exporter/server/.data/sync.lock
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:sync'
```

Always run sync as `plaud`, not root.

## Sync already running (exit code 4)

Another `server:sync` holds `sync.lock`. Wait for timer, or remove stale lock if process died:

```bash
sudo rm -f /srv/plaud-exporter/server/.data/sync.lock
```

Lock auto-expires after 2 hours or if PID is dead.

## `npm: command not found`

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

## `dubious ownership` in git

```bash
sudo chown -R plaud:plaud /srv/plaud-exporter
sudo -u plaud git -C /srv/plaud-exporter status
```
