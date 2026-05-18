# Security notes

This exporter handles the Plaud session of a real user. Treat the files
listed below as **secrets**.

## Where secrets live

| Path (default) | Contents | Permissions |
|----------------|----------|-------------|
| `server/.data/session.json` | Plaud `localStorage` snapshot (JWTs, workspace tokens) and cookies | `0600` (file), `0700` (parent dir) |
| `server/.data/playwright-profile/` | Persistent Chromium profile with auto-login cookies | `0700` |
| `server/.data/sync-index.json` | Index of synced records (titles, hashes, stable ids, paths). Not as sensitive but still personal. | `0600` |
| `{export}/_errors/*.md` | Redacted failure reports for operators. No tokens by design — still check before sharing. | `0644` typical |
| `.env` | Local configuration. Should not contain raw tokens — only paths. | `0600` recommended |

The repository ships a `.gitignore` that excludes `server/.data/`, `.env`,
`exports/`, logs, and any `session*.json` / `*-tokens.json`. **Never** commit
those files.

## How to refresh the Plaud session

The most common reason for `server:sync` to fail with `auth_expired` is that
the user JWT or workspace token has expired or has been invalidated.

Three supported paths, in order of preference:

1. **Interactive Playwright login.** On a machine with a display (your Mac):

   ```bash
   npm run server:auth
   ```

   Chromium opens at `https://web.plaud.ai`, you sign in, and the CLI writes
   a new snapshot. The persistent profile under `playwright-profile/` lets
   subsequent runs use cached cookies.

2. **Headless refresh** against an existing profile (useful on the server if
   the cookies are still valid but the snapshot is stale):

   ```bash
   npm run server:auth -- --refresh
   ```

3. **DevTools import.** Use this when the server has no display and you do
   not want to scp the profile:

   ```bash
   npm run server:auth -- --import ~/Downloads/plaud-session.json
   ```

   The JSON format is described in
   [`docs/devtools-data-needed.md`](./devtools-data-needed.md).

## How to delete the session

```bash
node server/src/cli/index.js logout
# also remove the Playwright profile if you want a full reset:
rm -rf server/.data/playwright-profile
```

## What to do if a session is compromised

1. Log out of every Plaud Web session from the Plaud account settings — this
   is the only way to revoke the JWTs that the snapshot contained.
2. Delete `server/.data/session.json` and `playwright-profile/` on every
   machine where they were stored. Rotate any shell history that recorded
   the file content.
3. Run `server:auth` again with a fresh login to create a new snapshot.

## What logs are safe to share

The logger and `redactError` helper redact the obvious offenders before
anything is written:

- `Authorization`, `Cookie`, `Set-Cookie` headers (entire value masked).
- `Bearer …` tokens anywhere in strings.
- JWT-shaped strings (`xxx.yyy.zzz`).
- Long hex strings (≥ 64 chars).
- Keys named `pld_*`, `workspaceToken`, `workspace-id`, `token`, `password`,
  `secret`, etc. in object values.

It is still your responsibility to **not paste raw `.json` files or HAR
exports into public chats or issue trackers**. The redaction protects logs,
not arbitrary attachments.

## What never leaves the server

- Plaud API request bodies (the client logs only HTTP statuses).
- The contents of `session.json`, `playwright-profile/`, and the cookies
  from `runInteractiveLogin`.
- The bearer token values themselves; only the existence/absence and a short
  user-id prefix are reported by `server:status`.
