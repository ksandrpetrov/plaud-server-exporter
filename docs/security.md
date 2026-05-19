# Security

## Where secrets live

| Path | Contents | Permissions |
|------|----------|-------------|
| `server/.data/session.json` | Plaud JWT, cookies, workspace ids | `600`, dir `700` |
| `server/.data/playwright-profile/` | Browser profile (may contain cookies) | gitignored |
| `.env` | Paths and tuning only — **no Plaud passwords** | `600` |
| `server/.data/sync-index.json` | File paths, hashes, titles — not auth tokens | `600` recommended |

**Never commit:** `.env`, `session.json`, `playwright-profile/`, export trees with real data.

## What must not appear in logs or error files

The server redacts before writing `_errors/*.md` and structured logs:

- `Authorization` headers and Bearer tokens
- Cookies and `Set-Cookie`
- `pld_*` localStorage keys
- JWT-shaped strings and long hex secrets

If you share logs, use files from `/var/log/plaud-exporter/` after a failed run — do not paste raw `session.json`.

## Refresh session

On Mac:

```bash
npm run server:auth
scp server/.data/session.json YOUR_SSH_USER@YOUR_SERVER_HOST:/tmp/session.json
# on server: mv + chown plaud (see getting-started.md)
```

## Remove session

```bash
node server/src/cli/index.js logout
```

Playwright profile is kept (faster re-login). To wipe it:

```bash
rm -rf server/.data/playwright-profile
```

## If session is compromised

1. `logout` or delete `server/.data/session.json` on Mac and server.
2. Change Plaud password in the web UI.
3. `server:auth` again and deploy new `session.json`.

## Safe operations on server

- Run sync as user `plaud`, not root.
- `chown -R plaud:plaud /srv/plaud-exporter/server/.data` after any `sudo mv` of session.
- Restrict SSH; prefer `ssh-copy-id` over password auth for `scp`.

## Sending diagnostics

OK to share:

- `npm run server:status` output (no token values)
- `_errors/*.md` from export root (already redacted)
- Exit codes and journalctl lines

Do **not** share:

- `session.json`
- Full debug logs with `PLAUD_LOG_LEVEL=debug` unless reviewed for tokens first
