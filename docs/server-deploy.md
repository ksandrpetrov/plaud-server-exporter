# Server deployment (Ubuntu)

The exporter is a Node 20+ CLI that runs as a periodic `oneshot` systemd job
alongside your existing services (Cassini Web, meetings bot). It does not
listen on any port, does not need a reverse proxy, and is fully isolated by
its own system user.

## 1. System prerequisites

```bash
sudo apt update
sudo apt install -y nodejs npm git
node -v   # expect >= v20
```

If your Ubuntu repos ship an older Node, use NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

## 2. System user and directories

```bash
sudo useradd --system --create-home --home-dir /srv/plaud-exporter --shell /usr/sbin/nologin plaud
sudo mkdir -p /var/log/plaud-exporter
sudo chown -R plaud:plaud /var/log/plaud-exporter
sudo chmod 0750 /var/log/plaud-exporter
```

## 3. Clone the repository

All `npm` / `cp .env.example` commands below run from `/srv/plaud-exporter`
(the repo root), not from `docs/`.

```bash
sudo -u plaud git clone https://github.com/<you>/plaud-server-exporter.git /srv/plaud-exporter
cd /srv/plaud-exporter
sudo -u plaud git submodule update --init --recursive
sudo -u plaud npm install --workspaces
```

If you do not run interactive logins on the server, you can skip Playwright
browsers entirely. Otherwise:

```bash
sudo -u plaud npx playwright install chromium
```

## 4. Configure environment

```bash
cd /srv/plaud-exporter
sudo -u plaud cp .env.example .env
sudo -u plaud chmod 600 .env
sudo -u plaud nano .env
```

Required values: `PLAUD_EXPORT_ROOT`, `PLAUD_TIMEZONE`. Optionally point
`PLAUD_OBSIDIAN_VAULT_PATH` at a vault that another agent (Syncthing,
Obsidian Git plugin) mirrors to your laptop. See
[`docs/obsidian-sync.md`](./obsidian-sync.md).

## 5. Authenticate once

Three options, pick whichever fits your server:

| Path | Command | When to use |
|------|---------|-------------|
| Run on Mac, copy snapshot | `npm run server:auth` locally, then `scp server/.data/session.json server:/srv/plaud-exporter/server/.data/` | Headless server, no display |
| DevTools import | Follow [`docs/devtools-data-needed.md`](./devtools-data-needed.md), then `npm run server:auth -- --import …` | No browser on server |
| SSH X-forwarding | `ssh -X server` then `npm run server:auth` | Server has X libs and you have X |

Verify it worked:

```bash
sudo -u plaud npm run server:status
sudo -u plaud npm run server:sync -- --dry-run
```

## 6. Install systemd units

```bash
sudo cp deploy/systemd/plaud-exporter.service /etc/systemd/system/
sudo cp deploy/systemd/plaud-exporter.timer  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now plaud-exporter.timer
```

Check the schedule and most recent run:

```bash
systemctl list-timers plaud-exporter.timer
systemctl status plaud-exporter.service
```

## 7. Log rotation

```bash
sudo cp deploy/logrotate/plaud-exporter /etc/logrotate.d/plaud-exporter
sudo logrotate -d /etc/logrotate.d/plaud-exporter   # dry-run
```

## 8. Operational notes

- **Exit codes.** `0` success; `1` generic/sync errors; `2` auth; `3` Plaud API
  shape change (`plaud_changed`); `4` another sync is already running
  (lock held). Check `{vault}/_errors/` and
  [`docs/troubleshooting.md`](./troubleshooting.md).
- **Concurrent runs.** A simple file lock (`server/.data/sync.lock`) keeps
  parallel `server:sync` runs from corrupting the index. A run that finds
  the lock held exits `4` with no further side effects; `--dry-run` is not
  blocked. Stale locks (dead pid or older than 2 hours) are reclaimed.
- **Audio env.** Audio is opt-in. Either pass `--audio-too` per run, or set
  **both** `PLAUD_EXPORT_SUMMARY_ONLY=false` and `PLAUD_EXPORT_AUDIO=true`
  in `.env`. `--no-audio` (or `--summary-only`) on the CLI forces
  summary-only regardless of env.
- **Auth failure does not spam.** `runSync` records `lastAuthError` to the
  status file and exits with code `2`. Error markdown in `_errors/` is
  deduplicated. Refresh the session (see [`docs/security.md`](./security.md)).
- **Coexistence with Cassini Web.** The exporter does not touch Nginx, ports,
  or other systemd units. It writes only to `/srv/plaud-exporter/` and
  `/var/log/plaud-exporter/`. Hardening directives in
  `plaud-exporter.service` lock the unit out of the rest of the filesystem.
- **Backups.** Treat `server/.data/sync-index.json` like any other data file.
  Losing it is recoverable — the next sync re-discovers every record and
  builds a fresh index from the actual files. Existing Markdown files will be
  preserved by filename, and identical content will not be re-written.

## 9. Quick reference

```bash
# manual one-off
sudo -u plaud npm run server:sync

# dry-run (no writes)
sudo -u plaud npm run server:sync -- --dry-run

# also fetch audio
sudo -u plaud npm run server:sync -- --audio-too

# inspect state
sudo -u plaud npm run server:status

# trigger via systemd
sudo systemctl start plaud-exporter.service
```
