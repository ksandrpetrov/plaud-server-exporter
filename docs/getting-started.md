# Запуск Plaud Server Exporter

Репозиторий: [github.com/ksandrpetrov/plaud-server-exporter](https://github.com/ksandrpetrov/plaud-server-exporter)

CLI выгружает **саммари** записей Plaud в Markdown для Obsidian. На VPS (например Ubuntu 22.04) — только `server:sync` по таймеру; вход в Plaud и Playwright — **только на Mac**.

В командах ниже: **`YOUR_SERVER_HOST`** — IP или hostname сервера, **`YOUR_SSH_USER`** — логин SSH (`root`, `ubuntu`, …). Подставляйте свои значения **без угловых скобок** — в zsh `<` означает перенаправление ввода.

---

## Первый sync вручную

Два сценария: **только Mac** (проверка, что всё работает) и **Mac → сервер** (как в проде). На сервере `server:auth` не запускайте.

### A. Проверка на Mac (без сервера)

1. Клонируйте репозиторий и поставьте зависимости — блок [Mac](#mac) ниже (`git clone`, `npm install`, `npx playwright install chromium`).
2. Скопируйте `.env.example` в `.env`. Задайте `PLAUD_EXPORT_ROOT` на локальную папку, например `~/plaud-exports`, и `PLAUD_TIMEZONE`.
3. Создайте каталог выгрузки: `mkdir -p ~/plaud-exports`.
4. Войдите в Plaud и сохраните сессию:
   ```bash
   npm run server:auth
   ```
   Откроется Chrome → войдите в Plaud (email/Google). Дождитесь сообщения в терминале про успешную валидацию сессии. Файл: `server/.data/session.json`.
5. Проверьте конфиг и сессию:
   ```bash
   npm run server:status
   ```
   Должно быть `session.snapshot.present: true` и корректный `PLAUD_EXPORT_ROOT`.
6. (Опционально) Пробный прогон без записи на диск:
   ```bash
   npm run server:sync -- --dry-run
   ```
7. Первый реальный sync:
   ```bash
   npm run server:sync
   ```
8. Убедитесь, что появились `.md` в `{PLAUD_EXPORT_ROOT}/Plaud/…` (год и дата в имени файла). Код выхода `0` — успех.

Если `server:auth` ругается на Google — [troubleshooting.md](troubleshooting.md#google-блокирует-вход-при-serverauth).

### B. Первый sync на сервере (после установки)

Предполагается, что сервер уже подготовлен: Node 20, пользователь `plaud`, репозиторий в `/srv/plaud-exporter`, `.env` и каталог `exports` — блок [Сервер](#сервер) ниже.

**На Mac** (из корня локального клона):

1. В `.env` на Mac можно оставить тот же `PLAUD_EXPORT_ROOT`, что для проверки; для auth это не критично — важен только `session.json`.
2. Сохраните сессию:
   ```bash
   npm run server:auth
   ```
3. Проверьте SSH (тот же логин, что для `scp`):
   ```bash
   ssh YOUR_SSH_USER@YOUR_SERVER_HOST 'echo ok'
   ```
4. Скопируйте сессию на сервер:
   ```bash
   scp server/.data/session.json YOUR_SSH_USER@YOUR_SERVER_HOST:/tmp/session.json
   ```

**На сервере** (под своим SSH-пользователем):

5. Положите сессию в каталог приложения и выставьте права:
   ```bash
   sudo install -d -o plaud -g plaud -m 700 /srv/plaud-exporter/server/.data
   sudo install -o plaud -g plaud -m 600 /tmp/session.json /srv/plaud-exporter/server/.data/session.json
   ```
6. Проверка от пользователя `plaud`:
   ```bash
   sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:status'
   ```
7. Первый sync вручную (timer пока можно не включать):
   ```bash
   sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:sync'
   ```
   Либо через обёртку: `sudo /srv/plaud-exporter/scripts/server-as-plaud.sh npm run server:sync`.
8. Проверьте результат:
   ```bash
   sudo -u plaud ls -la /srv/plaud-exporter/exports/Plaud/
   ```
   Код выхода `0`, в каталоге — новые `.md`.

**После успешного ручного sync** включите автозапуск по таймеру — раздел «Автозапуск каждые 2 часа» в [Сервер](#сервер). Для Obsidian на Mac настройте Syncthing — [obsidian-sync.md](obsidian-sync.md).

| Код выхода | Значение |
|------------|----------|
| `0` | Успех |
| `2` | Нет или битая сессия → снова `server:auth` на Mac и `scp` |
| `4` | Уже идёт другой sync → подождать |
| `1`, `3` | Ошибка sync / API → [troubleshooting.md](troubleshooting.md) |

---

## Mac

```bash
git clone https://github.com/ksandrpetrov/plaud-server-exporter.git
cd plaud-server-exporter
npm install --workspaces
npx playwright install chromium
cp .env.example .env
```

В `.env` задайте `PLAUD_EXPORT_ROOT` (папка для проверки) и `PLAUD_TIMEZONE` (IANA timezone, например `UTC`).

```bash
npm run server:auth          # Chromium → войти в Plaud → сессия в server/.data/session.json
npm run server:sync          # выгрузка .md
npm run server:status        # сессия и пути
```

Сессия протухла — снова `npm run server:auth` и скопируйте `session.json` на сервер (см. ниже).

---

## Сервер

```bash
sudo apt update && sudo apt install -y curl ca-certificates git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v && npm -v   # v20+ и npm обязательны

sudo useradd --system --create-home --home-dir /srv/plaud-exporter --shell /usr/sbin/nologin plaud
sudo mkdir -p /var/log/plaud-exporter && sudo chown plaud:plaud /var/log/plaud-exporter

sudo -u plaud git clone https://github.com/ksandrpetrov/plaud-server-exporter.git /srv/plaud-exporter
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm install --workspaces'

sudo -u plaud bash -lc 'cd /srv/plaud-exporter && cp .env.example .env && chmod 600 .env'
sudo -u plaud nano /srv/plaud-exporter/.env
```

В `.env` на сервере:

```env
PLAUD_EXPORT_ROOT=/srv/plaud-exporter/exports
PLAUD_TIMEZONE=UTC
PLAUD_LOG_LEVEL=info
```

```bash
sudo -u plaud mkdir -p /srv/plaud-exporter/exports
```

**Сессия с Mac.** В `scp` укажите тот же логин, что и в `ssh` (`YOUR_SSH_USER`, **не** системный `plaud` с `nologin`).

1. Сначала проверьте логин/пароль обычным `ssh` — `scp` использует те же. Если просит пароль и не пускает (`Permission denied, please try again.`) — это **тот самый** пароль, что в `scp`: проверяйте здесь, чтобы не вслепую гадать.

   ```bash
   ssh YOUR_SSH_USER@YOUR_SERVER_HOST 'echo ok'
   ```

2. Получили `ok` — копируйте сессию (из корня репозитория):

   ```bash
   scp server/.data/session.json YOUR_SSH_USER@YOUR_SERVER_HOST:/tmp/session.json
   ```

Чтобы не вводить пароль при каждом обновлении сессии — разово настройте ключ: `ssh-copy-id YOUR_SSH_USER@YOUR_SERVER_HOST` (нужен `~/.ssh/id_*.pub`). После этого `ssh`/`scp` пускают без пароля.

Permission denied не уходит — раздел «scp: Permission denied» в [troubleshooting.md](troubleshooting.md).

На сервере (под своим SSH-пользователем, через `sudo`):

```bash
sudo install -d -o plaud -g plaud -m 700 /srv/plaud-exporter/server/.data
sudo install -o plaud -g plaud -m 600 /tmp/session.json /srv/plaud-exporter/server/.data/session.json
```

```bash
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:status'
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:sync'
```

**Автозапуск каждые 2 часа:**

```bash
sudo cp /srv/plaud-exporter/deploy/systemd/plaud-exporter.service /etc/systemd/system/
sudo cp /srv/plaud-exporter/deploy/systemd/plaud-exporter.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now plaud-exporter.timer
sudo cp /srv/plaud-exporter/deploy/logrotate/plaud-exporter /etc/logrotate.d/plaud-exporter
```

Логи: `journalctl -u plaud-exporter.service -n 50` и `/var/log/plaud-exporter/sync.log`.

**Обновление кода и перезапуск:**

```bash
sudo systemctl stop plaud-exporter.timer
sudo systemctl status plaud-exporter.service --no-pager
sudo systemctl stop plaud-exporter.service
sudo -u plaud git -C /srv/plaud-exporter status --short
sudo -u plaud git -C /srv/plaud-exporter pull --ff-only
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm install --workspaces'
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm test'
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run lint'
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run verify'
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run test:submodule'
sudo systemctl daemon-reload
sudo systemctl start plaud-exporter.service
sudo systemctl status plaud-exporter.service --no-pager
journalctl -u plaud-exporter.service -n 100 --no-pager
sudo systemctl enable --now plaud-exporter.timer
systemctl list-timers plaud-exporter.timer --no-pager
```

Короткий вариант без обновления кода:

```bash
sudo systemctl restart plaud-exporter.service
sudo systemctl status plaud-exporter.service --no-pager
journalctl -u plaud-exporter.service -n 100 --no-pager
```

На сервере все `git`/`npm` — от пользователя `plaud` (`sudo -u plaud …`), путь `/srv/plaud-exporter`. Не запускайте `npm run server:auth` на сервере. Подробный flow: [server-deploy.md#обновление-кода-и-перезапуск](./server-deploy.md#обновление-кода-и-перезапуск).

---

## Obsidian на Mac

Папку `/srv/plaud-exporter/exports` синхронизируйте на Mac через [Syncthing](./obsidian-sync.md) и откройте как vault или подпапку vault.

---

## Сбои

| Симптом | Действие |
|---------|----------|
| exit `2`, нет сессии | `server:auth` на Mac → `scp session.json` |
| exit `4` | Подождать; не гонять второй `sync` параллельно с timer |
| exit `3` | См. [troubleshooting.md](troubleshooting.md) |
| `scp … Permission denied` | Проверить пароль через `ssh YOUR_SSH_USER@YOUR_SERVER_HOST`, [troubleshooting.md](troubleshooting.md#scp-permission-denied) |
| `npm: command not found` | Поставить Node 20 через NodeSource (блок «Сервер» выше) |
| `dubious ownership` | Команды только `sudo -u plaud`, не от root в `/srv/plaud-exporter` |
| `EACCES` … `sync.lock`, status ок, sync падает | [troubleshooting.md](troubleshooting.md#eacces-synclock-на-сервере) |

Подробнее: [troubleshooting.md](troubleshooting.md), [security.md](security.md).
