# Пошаговая установка

Репозиторий: [github.com/ksandrpetrov/plaud-server-exporter](https://github.com/ksandrpetrov/plaud-server-exporter)

Это **подробная инструкция**: от «ничего не установлено» до работающей выгрузки саммари Plaud в файлы и (опционально)
Telegram-бота на сервере. Общее описание проекта — в [README.md](../README.md).

## Какой путь выбрать

| Ваша цель                                         | Что делать                                                                                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Просто проверить, что всё работает, без сервера   | Раздел [A. Проверка на Mac](#a-проверка-на-mac-без-сервера)                                                                                        |
| Полная схема: сервер круглосуточно + Telegram-бот | Сначала A, потом [B. Первый sync на сервере](#b-первый-sync-на-сервере-после-установки) и [автозапуск бота](#сервер-автозапуск-через-telegram-бот) |
| Читать саммари в Obsidian на Mac                  | После выгрузки — [Obsidian на Mac](#obsidian-на-mac)                                                                                               |
| Нужно скачивать аудио                             | [browser-extension/README.md](../browser-extension/README.md) (расширение Chrome)                                                                  |

## Что понадобится

| Что                                                              | Зачем                                                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Mac**                                                          | Один раз войти в Plaud и сохранить файл доступа (логин на сервере не делаем) |
| **Node.js 22+**                                                  | Запуск программы (`npm install`, команды `server:*`)                         |
| **Терминал**                                                     | Все команды ниже вводятся текстом (на Mac — «Терминал»)                      |
| **VPS** (Ubuntu 22.04+, ~1 CPU / 1 GB RAM)                       | Только для схемы «сервер + бот»; для проверки на Mac не нужен                |
| **Telegram-бот** (токен от [@BotFather](https://t.me/BotFather)) | Только если хотите уведомления и кнопку «синхронизировать» в чате            |

**Важно:** сервер выгружает **только текст саммари**, не аудио. Вход в Plaud (`npm run server:auth`) выполняется
**только на Mac** — на сервер копируется лишь сохранённый файл доступа.

### Плейсхолдеры в командах

В командах ниже подставьте **свои** значения **без угловых скобок**:

- **`YOUR_SERVER_HOST`** — IP или имя вашего сервера (например `91.201.114.159`)
- **`YOUR_SSH_USER`** — логин SSH (`root`, `ubuntu`, …)

В zsh символ `<` означает перенаправление ввода — поэтому `user@host` пишите без `<` и `>`.

### Два способа входа в Plaud

| Способ                    | Команда                               | Файл                             | Когда выбирать                                               |
| ------------------------- | ------------------------------------- | -------------------------------- | ------------------------------------------------------------ |
| **OAuth** (по умолчанию)  | `npm run server:auth`                 | `server/.data/oauth-tokens.json` | Проще: браузер → Authorize; токены обновляются сами          |
| **Playwright** (snapshot) | `npm run server:auth -- --playwright` | `server/.data/session.json`      | Нужны **папки Plaud** на диске (`PLAUD_MIRROR_FOLDERS=true`) |

OAuth использует официальный API Plaud **без папок**. Для зеркалирования папок нужен Playwright-снимок и web API.

---

## Первый sync вручную

Два сценария: **только Mac** (проверка) и **Mac → сервер** (как в проде). На сервере `server:auth` **не**
запускайте.

### A. Проверка на Mac (без сервера)

Цель: убедиться, что Plaud доступен и саммари сохраняются в папку на вашем Mac.

1. **Скачайте проект и поставьте зависимости** — блок [Mac](#mac) ниже (`git clone`, `npm install`,
   `npx playwright install chromium` — Chromium нужен только для snapshot-входа).
2. **Настройте `.env`:** скопируйте `.env.example` → `.env`, укажите `PLAUD_EXPORT_ROOT` (куда складывать файлы,
   например `~/plaud-exports`) и `PLAUD_TIMEZONE` (ваш часовой пояс, например `Europe/Moscow`).
3. **Создайте папку выгрузки:** `mkdir -p ~/plaud-exports`.
4. **Войдите в Plaud** — откроется браузер, подтвердите доступ:

   ```bash
   npm run server:auth
   ```

   Сохранится `server/.data/oauth-tokens.json`. Для snapshot через Playwright:
   `npm run server:auth -- --playwright` → `session.json`.

5. **Проверьте, что доступ есть:**

   ```bash
   npm run server:status
   ```

   Ожидаем: `session.loadStatus: "ok"`, `auth.oauth.present: true` (или `session.snapshot.present` для Playwright)
   и правильный `PLAUD_EXPORT_ROOT`.

6. _(Опционально)_ **Пробный прогон** — посмотреть, что выгрузится, **без записи файлов:**

   ```bash
   npm run server:sync -- --dry-run
   ```

7. **Первая реальная выгрузка:**

   ```bash
   npm run server:sync
   ```

8. **Проверьте результат:** в `{PLAUD_EXPORT_ROOT}/Plaud/` появились файлы `.md` с датой и названием записи.
   Код выхода `0` — успех.

Если при `--playwright` Google блокирует вход — [troubleshooting.md](troubleshooting.md#google-блокирует-вход-при-serverauth).
При OAuth Playwright обычно не нужен.

### B. Первый sync на сервере (после установки)

Предполагается, что сервер уже подготовлен: Node 24, пользователь `plaud`, репозиторий в `/srv/plaud-exporter`, `.env` и
каталог `exports` — блок [Сервер](#сервер) ниже.

**На Mac** (из корня локального клона):

1. В `.env` на Mac можно оставить любой `PLAUD_EXPORT_ROOT` — для копирования доступа важны только
   `oauth-tokens.json` (OAuth) или `session.json` (Playwright).
2. **Сохраните доступ** (если ещё не делали в сценарии A):

   ```bash
   npm run server:auth
   ```

3. **Проверьте SSH** (тот же логин, что для `scp`):

   ```bash
   ssh YOUR_SSH_USER@YOUR_SERVER_HOST 'echo ok'
   ```

   Должно напечатать `ok`. Если просит пароль — вводите пароль **от SSH**, не от Plaud.

4. **Скопируйте файл доступа на сервер** (OAuth — рекомендуется):

   ```bash
   scp server/.data/oauth-tokens.json YOUR_SSH_USER@YOUR_SERVER_HOST:/tmp/oauth-tokens.json
   ```

   Snapshot через Playwright:

   ```bash
   scp server/.data/session.json YOUR_SSH_USER@YOUR_SERVER_HOST:/tmp/session.json
   ```

**На сервере** (под своим SSH-пользователем):

1. **Положите файл в каталог приложения** (`install` проставит владельца `plaud` и права `600`):

   ```bash
   sudo install -d -o plaud -g plaud -m 700 /srv/plaud-exporter/server/.data
   sudo install -o plaud -g plaud -m 600 /tmp/oauth-tokens.json /srv/plaud-exporter/server/.data/oauth-tokens.json
   sudo rm -f /tmp/oauth-tokens.json
   ```

   Для snapshot вместо этого — `session.json` (см. выше).

2. **Про папки Plaud:** при OAuth сервер использует официальный API — **без** filetags/папок.
   Для зеркалирования папок (`PLAUD_MIRROR_FOLDERS=true`) нужен Playwright-снимок (`--playwright`) и web API.

3. **Проверка** от пользователя `plaud`:

   ```bash
   sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:status'
   ```

4. **Первый sync вручную** (бот пока не поднимаем):

   ```bash
   sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:sync'
   ```

   Либо: `sudo /srv/plaud-exporter/scripts/server-as-plaud.sh npm run server:sync`.

5. **Проверьте результат:**

   ```bash
   sudo -u plaud ls -la /srv/plaud-exporter/exports/Plaud/
   ```

   Код выхода `0`, в каталоге — новые `.md`.

**После успешного ручного sync** включите Telegram-бота —
раздел [Сервер: автозапуск через Telegram-бот](#сервер-автозапуск-через-telegram-бот) ниже. Полный чеклист —
[server-deploy.md](./server-deploy.md). Альтернатива без Node на хосте — Docker +
nginx: [deploy/README.md](../deploy/README.md). Для Obsidian на Mac —
[Syncthing](obsidian-sync.md).

| Код выхода | Что значит                   | Что делать                                           |
| ---------- | ---------------------------- | ---------------------------------------------------- |
| `0`        | Успех                        | Ничего                                               |
| `2`        | Нет или битый доступ к Plaud | Снова `server:auth` на Mac и `scp oauth-tokens.json` |
| `4`        | Уже идёт другой sync         | Подождать                                            |
| `1`, `3`   | Ошибка sync / API            | [troubleshooting.md](troubleshooting.md)             |

---

## Mac

Одноразовая подготовка Mac (из терминала):

```bash
git clone https://github.com/ksandrpetrov/plaud-server-exporter.git
cd plaud-server-exporter
npm install --workspaces
npx playwright install chromium   # только для snapshot-входа --playwright
cp .env.example .env
```

В `.env` задайте `PLAUD_EXPORT_ROOT` (папка для выгрузки) и `PLAUD_TIMEZONE` (IANA, например `Europe/Moscow`).

Основные команды:

```bash
npm run server:auth          # OAuth (default) → server/.data/oauth-tokens.json
npm run server:auth -- --playwright   # snapshot → session.json
npm run server:sync          # выгрузка .md
npm run server:status        # проверка доступа и путей
```

Доступ протух — снова `npm run server:auth` и скопируйте `oauth-tokens.json` (или `session.json` для Playwright)
на сервер (см. сценарий B). При OAuth на VPS access token обновляется автоматически, пока жив refresh token.

---

## Сервер

> Перед деплоем убедитесь, что свежий код запушен в GitHub (`git push origin main` с Mac) — иначе сервер клонирует
> устаревшую версию без `server:bot`.

Ниже — подготовка Ubuntu-сервера. Если не уверены в командах — можно попросить помощи у того, кто администрирует VPS;
ваша часть на Mac — `server:auth` и `scp` файла доступа.

```bash
sudo apt update && sudo apt install -y curl ca-certificates git
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v && npm -v   # v22+ и npm обязательны

id plaud &>/dev/null || sudo useradd --system --create-home --home-dir /srv/plaud-exporter --shell /usr/sbin/nologin plaud
sudo mkdir -p /var/log/plaud-exporter && sudo chown plaud:plaud /var/log/plaud-exporter

if [ -d /srv/plaud-exporter/.git ]; then
  sudo -u plaud git -C /srv/plaud-exporter pull --ff-only
else
  sudo -u plaud git clone https://github.com/ksandrpetrov/plaud-server-exporter.git /srv/plaud-exporter
fi
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm install --workspaces'

sudo -u plaud bash -lc '[ -f /srv/plaud-exporter/.env ] || cp /srv/plaud-exporter/.env.example /srv/plaud-exporter/.env'
sudo -u plaud chmod 600 /srv/plaud-exporter/.env
sudo -u plaud nano /srv/plaud-exporter/.env
```

В `.env` на сервере минимум:

```env
PLAUD_EXPORT_ROOT=/srv/plaud-exporter/exports
PLAUD_TIMEZONE=UTC
PLAUD_LOG_LEVEL=info
```

```bash
sudo -u plaud mkdir -p /srv/plaud-exporter/exports /srv/plaud-exporter/server/.data
```

### Копирование доступа с Mac

В `scp` укажите тот же логин, что и в `ssh` (`YOUR_SSH_USER`, **не** системный `plaud` с `nologin`).

1. Сначала проверьте SSH — `scp` использует те же логин и пароль:

   ```bash
   ssh YOUR_SSH_USER@YOUR_SERVER_HOST 'echo ok'
   ```

2. Получили `ok` — копируйте OAuth tokens (рекомендуется):

   ```bash
   scp server/.data/oauth-tokens.json YOUR_SSH_USER@YOUR_SERVER_HOST:/tmp/oauth-tokens.json
   ```

   Snapshot через Playwright:

   ```bash
   scp server/.data/session.json YOUR_SSH_USER@YOUR_SERVER_HOST:/tmp/session.json
   ```

Чтобы не вводить пароль при каждом обновлении — разово:
`ssh-copy-id YOUR_SSH_USER@YOUR_SERVER_HOST` (нужен `~/.ssh/id_*.pub`).

Если `Permission denied` не уходит — [troubleshooting.md](troubleshooting.md#scp-permission-denied).

На сервере (через `sudo`). Каталог `.data` должен принадлежать `plaud`, иначе sync не создаст `sync.lock`:

```bash
sudo install -d -o plaud -g plaud -m 700 /srv/plaud-exporter/server/.data
sudo install -o plaud -g plaud -m 600 /tmp/oauth-tokens.json /srv/plaud-exporter/server/.data/oauth-tokens.json
sudo rm -f /tmp/oauth-tokens.json
```

Snapshot вместо OAuth:

```bash
sudo install -o plaud -g plaud -m 600 /tmp/session.json /srv/plaud-exporter/server/.data/session.json
sudo rm -f /tmp/session.json
```

```bash
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:status'
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:sync'
```

### Сервер: автозапуск через Telegram-бот

Бот работает круглосуточно: сам запускает синхронизацию по расписанию (по умолчанию каждые 2 часа), присылает отчёт
в Telegram и умеет запускать sync по кнопке. Отдельный `timer` systemd **не** нужен.

Добавьте в `/srv/plaud-exporter/.env` (под пользователем `plaud`, права `600`):

```env
TELEGRAM_BOT_TOKEN=123456:ABC-your-bot-token
# Стабильный user_id владельца (узнать у @userinfobot). Рекомендуется задать.
TELEGRAM_ALLOWED_USER_ID=123456789
# Опционально как дополнительная проверка поверх id.
TELEGRAM_ALLOWED_USERNAME=your_username
BOT_SYNC_INTERVAL_MIN=120
BOT_LONG_POLL_SEC=30
```

Если на сервере стоял старый `plaud-exporter.timer`, снимите его:

```bash
sudo systemctl disable --now plaud-exporter.timer 2>/dev/null || true
sudo rm -f /etc/systemd/system/plaud-exporter.timer
sudo systemctl daemon-reload
```

Установка бот-сервиса:

```bash
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run | grep -E "^  server:bot$"'   # должен быть найден
sudo cp /srv/plaud-exporter/deploy/systemd/plaud-exporter.service /etc/systemd/system/
sudo cp /srv/plaud-exporter/deploy/logrotate/plaud-exporter /etc/logrotate.d/plaud-exporter
sudo systemctl daemon-reload
sudo systemctl enable --now plaud-exporter.service
systemctl --no-pager status plaud-exporter.service   # Active: active (running)
```

Если `npm run | grep server:bot` ничего не вывел — на сервере устаревший клон. Сначала `git pull` (см. «Обновление кода»
ниже) или запушьте новые правки с Mac.

После старта отправьте боту `/start` **со своего** Telegram-аккаунта — он сохранит `chatId` в `server/.data/owner-chat.json`
(`0o600`) и начнёт работать по расписанию. Чужие сообщения бот игнорирует.

В меню **📁 Файлы → 🌳 Дерево синка** — список записей с номерами; отправьте **цифру** в чат (1–20 на странице),
и бот пришлёт соответствующий `.md`-файл. Подробнее — [server/README.md](../server/README.md#telegram-бот).

Логи: `journalctl -u plaud-exporter.service -n 50` и `/var/log/plaud-exporter/bot.log`. Sync-логи one-shot'а —
`/var/log/plaud-exporter/sync.log`. Детально — [server-deploy.md](./server-deploy.md).

**Обновление кода (systemd):** [server-deploy.md § Обновление кода](./server-deploy.md#обновление-кода).

**Docker:** push в `main` собирает образ в GHCR; SSH-deploy в Docker только при `PRODUCTION_DOCKER_DEPLOY=true` —
см. [deploy/README.md](../deploy/README.md). Пока бот на **systemd** (`/srv/plaud-exporter`), эту переменную **не**
включайте.

На сервере все `git`/`npm` — от пользователя `plaud` (`sudo -u plaud …`), путь `/srv/plaud-exporter`. **Не** запускайте
`npm run server:auth` на сервере.

---

## Obsidian на Mac

Папку `/srv/plaud-exporter/exports` синхронизируйте на Mac через [Syncthing](./obsidian-sync.md) и откройте как vault
или подпапку vault.

---

## Если что-то пошло не так

| Симптом                        | Что делать                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| exit `2`, нет доступа к Plaud  | `server:auth` на Mac → `scp oauth-tokens.json` (или `session.json` для Playwright)                                       |
| exit `4`                       | Подождать; не запускать `server:sync` руками параллельно с ботом                                                         |
| exit `3`                       | [troubleshooting.md](troubleshooting.md)                                                                                 |
| `Missing script: "server:bot"` | Устаревший клон на сервере — `sudo -u plaud git -C /srv/plaud-exporter pull --ff-only` (с Mac предварительно `git push`) |
| `scp … Permission denied`      | Проверить пароль через `ssh`, [troubleshooting.md](troubleshooting.md#scp-permission-denied)                             |
| `npm: command not found`       | Поставить Node 24 (блок «Сервер» выше)                                                                                   |
| `dubious ownership`            | Команды только `sudo -u plaud`, не от root в `/srv/plaud-exporter`                                                       |
| `EACCES` … `sync.lock`         | [troubleshooting.md](troubleshooting.md#eacces-synclock-на-сервере)                                                      |

Подробнее: [troubleshooting.md](troubleshooting.md), [security.md](security.md).
