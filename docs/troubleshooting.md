# Troubleshooting

## Google blocks sign-in ("this browser may not be secure")

**Symptoms:** During `npm run server:auth`, after you click *Sign in with
Google* on Plaud, Google shows:

> Couldn't sign you in
> This browser or app may not be secure.

**Why:** Google blocks OAuth from browsers it identifies as automated, even
when you drive them yourself. Playwright's bundled Chromium ships with the
`--enable-automation` flag and `navigator.webdriver === true`, both of which
trip Google's detector.

**Fix — in order of effort:**

1. **Sign in with email/password on Plaud** (not via Google). This bypasses
   Google entirely. If you don't have a password, set one at
   `https://web.plaud.ai` → *Account* first.
2. **Use installed Google Chrome.** This is the new default: the exporter now
   launches your local Chrome (`channel: "chrome"`), which Google trusts. If
   Chrome is not installed, install it from `https://www.google.com/chrome/`
   and re-run `npm run server:auth`.
3. **Override the browser channel.** Set in `.env`:

   ```env
   PLAUD_PLAYWRIGHT_CHANNEL=chrome      # default
   PLAUD_PLAYWRIGHT_CHANNEL=msedge      # try Microsoft Edge
   PLAUD_PLAYWRIGHT_EXECUTABLE=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
   ```

4. **Headless server or still blocked? Import a snapshot from your real
   Chrome via DevTools.** See [devtools-data-needed.md](./devtools-data-needed.md)
   and:

   ```bash
   npm run server:auth -- --import /path/to/plaud-session.json
   ```

If you previously ran `server:auth` and a stale Playwright profile is
confusing Google, wipe it and retry:

```bash
rm -rf server/.data/playwright-profile
npm run server:auth
```

## Plaud logged me out / auth errors

**Symptoms:** `server:sync` exits with code `2`, logs mention auth, `_errors/` may contain `auth_error`.

**Fix:**

```bash
npm run server:auth
npm run server:status    # confirm session.present
npm run server:sync -- --dry-run
```

On a headless server, import a snapshot from your Mac — see [devtools-data-needed.md](./devtools-data-needed.md).

## Plaud changed API / `plaud_changed`

**Symptoms:** exit code `3`, log says manual review required, error kind `plaud_changed` in `_errors/`.

**What it means:** The exporter expected a known JSON shape (file list or summary notes) and did not find it.

**Fix:** Open the newest `_errors/*.md`, check logs, compare with Plaud Web Network tab, update `plaudApiClient.js` if endpoints changed. Report upstream or patch locally.

## Summary not exporting

1. `npm run server:status` — is session valid?
2. `npm run server:sync -- --dry-run` — are recordings listed (`total > 0`)?
3. Check `_errors/` for per-file `fetch-summary` failures.
4. If `skipped` count is high, stable id may be unreliable — inspect `sync-index.json`.

## Files not created

- Verify `PLAUD_EXPORT_ROOT` or `PLAUD_OBSIDIAN_VAULT_PATH` exists and is writable.
- Look for `write_error` in `_errors/`.
- Run as the same user as systemd/cron.

## Strange file names

- Names come from Plaud `file_name` or the first real markdown heading.
- Boilerplate (`Plaud`, `Untitled`) is ignored.
- Very long titles are truncated (~242 chars max filename).
- Duplicate titles get a short stable-id suffix.

## Error markdown files appeared

This is intentional. Read `_errors/*.md` — they are redacted and safe to skim. Fix the root cause (auth, API, disk), then re-run sync. Duplicate identical errors are not recreated.

## I deleted a summary `.md` file manually

The next `server:sync` **restores** the file when `sync-index.json` still has the same `summaryHash` (content unchanged). You will see `updated: 1` in stats, not a duplicate.

If you deleted both the file **and** the index entry, the next run treats the recording as new.

## Re-run creates duplicates

Should not happen if `sync-index.json` is intact. If you deleted the index but kept Markdown files, the exporter may create new files with the same title — merge manually or restore `.bak` index from `server/.data/sync-index.json.bak`.

## Audio downloading unexpectedly

Audio runs only when at least one of these is true:

- `--audio-too` was passed on the CLI, **or**
- `.env` has `PLAUD_EXPORT_SUMMARY_ONLY=false` **and** `PLAUD_EXPORT_AUDIO=true`.

To force summary-only even when env opts in, pass `--no-audio` (or `--summary-only`).
Confirm `.env` and systemd unit do not flip both env flags. `server:status`
prints the effective settings under `config.exportSummaryOnly` /
`config.exportAudio`.

## Sync says it's already running (exit code 4)

A lock file `server/.data/sync.lock` is held by another `server:sync`
process. Real concurrent runs (cron + manual run) hit this on purpose. If the
lock looks stuck (no other process running), check that the file's pid is
gone (`ps -p <pid>`); the exporter auto-reclaims locks older than 2 hours or
with a dead pid, but you can delete the file manually if needed.

```bash
sudo -u plaud cat /srv/plaud-exporter/server/.data/sync.lock
sudo -u plaud rm /srv/plaud-exporter/server/.data/sync.lock   # only if stale
```
