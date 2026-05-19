# Server deployment

Step-by-step production setup on Ubuntu. For first-time sync and Mac auth, see [getting-started.md](./getting-started.md).

## Target server

| Parameter | Typical value |
|-----------|---------------|
| OS | Ubuntu 22.04 LTS |
| CPU / RAM | 1 vCPU, 1 GB RAM (minimal VPS) |
| Disk | Summary-only exports are small (KB per meeting) |

**Implications:**

- Do **not** run `npm run server:auth` (Playwright) on the server — OOM risk. Auth on Mac, copy `session.json`.
- `npm run server:sync` uses ~80–150 MB RSS without audio — OK on 1 GB if nothing else is heavy.
- Optional: 2 GB swap if `npm install` struggles.

## Install (once)

```bash
sudo apt update && sudo apt install -y curl ca-certificates git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

sudo useradd --system --create-home --home-dir /srv/plaud-exporter --shell /usr/sbin/nologin plaud
sudo mkdir -p /var/log/plaud-exporter && sudo chown plaud:plaud /var/log/plaud-exporter

sudo -u plaud git clone https://github.com/ksandrpetrov/plaud-server-exporter.git /srv/plaud-exporter
sudo -u plaud git -C /srv/plaud-exporter submodule update --init --recursive
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm install --workspaces'

sudo -u plaud bash -lc 'cd /srv/plaud-exporter && cp .env.example .env && chmod 600 .env'
sudo -u plaud nano /srv/plaud-exporter/.env
sudo -u plaud mkdir -p /srv/plaud-exporter/exports
```

Example `.env` on server:

```env
PLAUD_EXPORT_ROOT=/srv/plaud-exporter/exports
PLAUD_TIMEZONE=Europe/Moscow
PLAUD_LOG_LEVEL=info
```

## Session from Mac

On Mac (repo clone):

```bash
npm run server:auth
scp server/.data/session.json YOUR_SSH_USER@YOUR_SERVER_HOST:/tmp/session.json
```

On server:

```bash
sudo mkdir -p /srv/plaud-exporter/server/.data
sudo mv /tmp/session.json /srv/plaud-exporter/server/.data/session.json
sudo chown -R plaud:plaud /srv/plaud-exporter/server/.data
sudo chmod 700 /srv/plaud-exporter/server/.data
sudo chmod 600 /srv/plaud-exporter/server/.data/session.json
```

Verify:

```bash
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:status'
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:sync'
```

Wrapper script (optional):

```bash
sudo /srv/plaud-exporter/scripts/server-as-plaud.sh npm run server:sync
```

## systemd timer (every 2 hours)

```bash
sudo cp /srv/plaud-exporter/deploy/systemd/plaud-exporter.service /etc/systemd/system/
sudo cp /srv/plaud-exporter/deploy/systemd/plaud-exporter.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now plaud-exporter.timer
sudo cp /srv/plaud-exporter/deploy/logrotate/plaud-exporter /etc/logrotate.d/plaud-exporter
```

The unit runs `npm run server:sync` as user `plaud` — summary-only, no audio.

## Logs and status

```bash
journalctl -u plaud-exporter.service -n 50 --no-pager
tail -n 50 /var/log/plaud-exporter/sync.log
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:status'
```

Non-zero exit codes fail the oneshot unit — suitable for monitoring.

| Exit | Meaning |
|------|---------|
| `0` | OK |
| `2` | Re-auth on Mac + `scp` |
| `3` | Plaud API changed — see `_errors/` |
| `4` | Overlapping sync — check timer overlap |

## Coexistence with other services

- Use dedicated user `plaud` and path `/srv/plaud-exporter` — do not run sync as root.
- Export directory is separate (`exports/`) — safe beside Cassini Web or bots if disk space is monitored.
- Only one scheduler should run `server:sync` on the same data directory (local `sync.lock`).

## Updates

```bash
sudo -u plaud git -C /srv/plaud-exporter pull
sudo -u plaud git -C /srv/plaud-exporter submodule update --init --recursive
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm install --workspaces'
```

Re-copy `session.json` from Mac when Plaud logs you out (exit 2).

## cron alternative

If you prefer cron instead of systemd:

```cron
0 */2 * * * plaud cd /srv/plaud-exporter && /usr/bin/npm run server:sync >> /var/log/plaud-exporter/sync.log 2>&1
```

Avoid overlapping runs with a 2-hour interval shorter than worst-case sync duration.
