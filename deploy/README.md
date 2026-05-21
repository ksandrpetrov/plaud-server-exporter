# Production deploy (Docker)

Host nginx terminates TLS on `:443`. The bot runs in Docker with HTTP on **loopback only** (`127.0.0.1:WEBAPP_HOST_PORT` → container `:8080`).

## Modes (pick one)

| Mode | When |
|------|------|
| **systemd** | Legacy: `deploy/systemd/plaud-exporter.service` + `/srv/plaud-exporter` (see [docs/server-deploy.md](../docs/server-deploy.md)) |
| **Docker** | This guide — `deploy/docker-compose.yml` under `/opt/plaud-exporter` |

Never run both with the same `TELEGRAM_BOT_TOKEN`.

## First-time bootstrap (Ansible)

1. Copy `deploy/ansible/inventory.example.yml` → `deploy/ansible/inventory.yml` and fill secrets (no quotes around `TELEGRAM_BOT_TOKEN`).
2. From repo root:

```bash
make deploy
```

This installs Docker, disables `plaud-exporter.service`, renders `/opt/plaud-exporter/.env`, and starts the stack (`app_image_source: build` builds on the server).

3. Add nginx fragment from [deploy/nginx/plaud-exporter-webapp.conf.example](nginx/plaud-exporter-webapp.conf.example) to your existing `server { listen 443 ssl; ... }`, then `sudo nginx -t && sudo systemctl reload nginx`.

## systemd → Docker migration

If the bot previously wrote state to `/srv/plaud-exporter/server/.data/` and the new named volume is empty:

```bash
sudo bash /opt/plaud-exporter/src/scripts/migrate-legacy-data.sh
```

Rolling deploy from CI **refuses** to proceed if host `.data` has more JSON files than the volume (see `scripts/ci-deploy-remote.sh`).

## Rolling deploy (CI / manual)

GitHub Actions on `push` to `main` builds `ghcr.io/<owner>/<repo>:sha-<short>`, runs image smoke, then SSH deploy.

Secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `SSH_PRIVATE_KEY`; optional `SSH_KNOWN_HOSTS`, `GHCR_PULL_TOKEN`.  
Variable: `SMOKE_PUBLIC_BASE_URL` (public HTTPS base for `make smoke-prod`).

Manual:

```bash
APP_IMAGE=ghcr.io/OWNER/plaud-server-exporter:sha-abc1234 \
  DEPLOY_HOST=... DEPLOY_USER=... \
  bash scripts/ci-deploy-remote.sh
```

Tags `v*` push semver images to GHCR but **do not** auto-deploy production.

## Local Docker

```bash
cp .env.example .env   # set TELEGRAM_BOT_TOKEN, etc.
make docker-up
curl -s http://127.0.0.1:8080/healthz
make docker-smoke
```

Bind-mounts: `./server/.data`, `./exports`.

## Persistent paths

| Path | Role |
|------|------|
| Docker volume `plaud-exporter_app-data` | `server/.data/*.json` (session, sync index, owner chat, offsets) |
| Host `PLAUD_EXPORTS_HOST_DIR` | Markdown exports (`/srv/plaud-exporter/exports` by default) |

There is no `TOKEN_ENCRYPTION_KEY` in this project — preserve `session.json` and the volume across deploys.
