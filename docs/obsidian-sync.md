# Obsidian: Syncthing

Сервер пишет в `PLAUD_EXPORT_ROOT` (например `/srv/plaud-exporter/exports`). Эту папку синхронизируйте на Mac.

## Сервер

```bash
sudo apt install -y syncthing
sudo systemctl enable --now syncthing@plaud.service
```

Панель (с Mac, тот же логин, что в `ssh` — `YOUR_SSH_USER`): `ssh -L 8384:127.0.0.1:8384 YOUR_SSH_USER@YOUR_SERVER_HOST` → http://127.0.0.1:8384. `Permission denied` — раздел «scp: Permission denied» в [troubleshooting.md](troubleshooting.md) (та же диагностика для `ssh`).

Добавьте папку `/srv/plaud-exporter/exports`, режим **Send Only** (сервер → Mac).

## Mac

Установите [Syncthing](https://syncthing.net/), примите устройство сервера, укажите локальную папку vault (например `~/Obsidian/Plaud`).

В Obsidian откройте vault или подпапку `Plaud` — появятся `Plaud/2026/… .md`.
