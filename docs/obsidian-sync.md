# Getting exports into Obsidian

The server writes Markdown to a folder. The vault on your Mac then needs to
see those files. Pick the simplest path that fits your existing setup.

## Recommendation

For most users: **Syncthing** (server folder ↔ Mac folder). Set up once,
no daemon to babysit, no credentials in the server's environment, and the
vault on your Mac stays under your full control.

If you already use Git for notes: **Git private repo** with a post-sync hook.

## Comparison

| Option | Server setup | Mac setup | Conflicts | Verdict |
|--------|--------------|-----------|-----------|---------|
| **Syncthing** | One package, one shared folder | Syncthing.app, accept folder | Resolved per-file, rare for new-only writes | **Primary** |
| **Git private repo** | `cron` hook after sync | Obsidian Git plugin pulls | Easy to diff, easy to revert | **Alternative** |
| Obsidian Sync | n/a (server writes locally, Mac syncs) | Built-in | Operated by Obsidian | Use only if you already pay for it |
| iCloud / Dropbox | Server cannot write directly | n/a | n/a | Only via an additional sync agent on the Mac |
| Manual `scp` | n/a | n/a | n/a | Fallback only |

## Option A — Syncthing (recommended)

On the server (Ubuntu):

```bash
sudo apt install -y syncthing
sudo systemctl enable --now syncthing@plaud.service
# open http://server-ip:8384 in an SSH tunnel:
ssh -L 8384:127.0.0.1:8384 server
```

In the Syncthing GUI:

1. **Actions → Settings** — give the device a stable name.
2. **Add folder.** Path: the value of `PLAUD_EXPORT_ROOT` (or
   `PLAUD_OBSIDIAN_VAULT_PATH`). Folder ID: `plaud-exports`.
3. Disable "Watch for Changes" if you only ever expect writes from the
   exporter; keep "Periodic rescan" at 1 hour.

On the Mac:

1. Install Syncthing.app.
2. Add the server as a remote device (paste device ID).
3. Accept the `plaud-exports` folder. Pin its local path to **inside your
   Obsidian vault**, e.g. `~/Obsidian/Notes/Plaud/`.

That's it. New `*.md` files arrive in your vault within minutes.

## Option B — Git private repo

Server side:

```bash
sudo -u plaud git init /srv/plaud-exporter/exports
cd /srv/plaud-exporter/exports
sudo -u plaud git remote add origin git@github.com:<you>/plaud-vault.git
```

Add a tiny post-sync wrapper at `deploy/scripts/sync-and-push.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /srv/plaud-exporter
npm run --silent server:sync
cd exports
if ! git diff --quiet || ! git diff --cached --quiet; then
  git add .
  git commit -m "plaud-exporter: $(date -Is)"
  git push origin HEAD
fi
```

Then point the systemd unit's `ExecStart` at this script instead of
`npm run server:sync` directly.

On the Mac, install the **Obsidian Git** community plugin and let it pull on
startup / every N minutes.

## Option C — Obsidian Sync

Obsidian Sync syncs a vault on your Mac. Combine it with Syncthing:

- Server writes to `~/Obsidian/Notes/Plaud/` on your Mac (via Syncthing).
- Obsidian Sync (running on the Mac) then propagates the new files to any
  other devices.

There is no direct API to write to Obsidian Sync from the server.

## Conflict policy

The exporter always uses a deterministic filename derived from the recording
date and title, written under `Plaud/{YYYY}/`. Two important behaviors:

- **Same content, repeated sync.** The sync index sees the same
  `summaryHash`, decides `already_synced`, and skips. No file write, no
  spurious modification time change.
- **Title change in Plaud.** The runner detects metadata change, renames the
  existing Markdown file on disk to the new name, and updates frontmatter.
  Syncthing/Git replicate this rename cleanly to the Mac.

If you do edit a Markdown file on the Mac side, **do not change the
`stable_id` or `plaud_id` in the frontmatter**. Those are the keys the
exporter uses to match records on the next run.
