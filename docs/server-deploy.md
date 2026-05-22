# Деплой на сервер

Пошаговая установка на Ubuntu. Первый sync и auth на Mac — в [getting-started.md](./getting-started.md).

| Режим | Когда | Документ |
|-------|--------|----------|
| **systemd** | Node на хосте, `/srv/plaud-exporter` | Этот файл (ниже) |
| **Docker** | Образ в GHCR, nginx, `/opt/plaud-exporter` | [deploy/README.md](../deploy/README.md) |

Не запускайте оба режима с одним `TELEGRAM_BOT_TOKEN`. CI SSH-deploy включается только переменной `PRODUCTION_DOCKER_DEPLOY=true` — иначе push в `main` не трогает systemd.

## Целевой сервер

| Параметр | Типичное значение |
|----------|-------------------|
| ОС | Ubuntu 22.04 LTS |
| CPU / RAM | 1 vCPU, 1 GB RAM |
| Диск | Только саммари — килобайты на встречу |

**Важно:**

- Не запускайте `npm run server:auth` (Playwright) на VPS — риск OOM. Вход на Mac, `scp session.json`.
- `npm run server:sync` ~80–150 MB RSS без аудио — нормально на 1 GB, если нет тяжёлых соседей.
- По желанию: swap 2 GB, если `npm install` не хватает памяти.

## Установка (один раз)

> Деплой бота полагается на код из `main` в GitHub. Перед запуском убедитесь, что свежие правки **запушены**: `git push origin main` с Mac, иначе на сервере окажется устаревший `package.json` без `server:bot` и старый `plaud-exporter.service` (oneshot + timer).

Базовая установка системы и пользователя `plaud`:

```bash
sudo apt update && sudo apt install -y curl ca-certificates git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

id plaud &>/dev/null || sudo useradd --system --create-home --home-dir /srv/plaud-exporter --shell /usr/sbin/nologin plaud
sudo mkdir -p /var/log/plaud-exporter && sudo chown plaud:plaud /var/log/plaud-exporter
```

Идемпотентный clone-or-pull (можно безопасно перезапускать при ребуте/обновлении):

```bash
if [ -d /srv/plaud-exporter/.git ]; then
  sudo -u plaud git -C /srv/plaud-exporter pull --ff-only
else
  sudo -u plaud git clone https://github.com/ksandrpetrov/plaud-server-exporter.git /srv/plaud-exporter
fi
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm install --workspaces'
```

Проверьте, что в репозитории есть бот-скрипт (иначе ниже systemd-unit упадёт с `Missing script: "server:bot"`):

```bash
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run | grep -E "^  server:bot$"'
```

`.env` (только если ещё нет):

```bash
sudo -u plaud bash -lc '[ -f /srv/plaud-exporter/.env ] || cp /srv/plaud-exporter/.env.example /srv/plaud-exporter/.env'
sudo -u plaud chmod 600 /srv/plaud-exporter/.env
sudo -u plaud nano /srv/plaud-exporter/.env
sudo -u plaud mkdir -p /srv/plaud-exporter/exports /srv/plaud-exporter/server/.data
```

Минимальный `.env` на сервере (Telegram-секреты добавим ниже):

```env
PLAUD_EXPORT_ROOT=/srv/plaud-exporter/exports
PLAUD_TIMEZONE=Europe/Moscow
PLAUD_LOG_LEVEL=info
```

## Сессия с Mac

На Mac (локальный клон):

```bash
npm run server:auth
scp server/.data/session.json YOUR_SSH_USER@YOUR_SERVER_HOST:/tmp/session.json
```

На сервере (`install` атомарно ставит права и владельца):

```bash
sudo install -d -o plaud -g plaud -m 700 /srv/plaud-exporter/server/.data
sudo install -o plaud -g plaud -m 600 /tmp/session.json /srv/plaud-exporter/server/.data/session.json
sudo rm -f /tmp/session.json
```

Проверка:

```bash
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:status'
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:sync'
```

Обёртка (опционально):

```bash
sudo /srv/plaud-exporter/scripts/server-as-plaud.sh npm run server:sync
```

## systemd: Telegram-бот как основной сервис

Расписание теперь живёт внутри Telegram-бота: один long-running процесс,
никаких systemd-таймеров. Бот шлёт «отбивку» о каждом синке и принимает
ручной запуск с inline-кнопки.

Добавьте в `.env` (под пользователем `plaud`, права остаются `600`):

```env
TELEGRAM_BOT_TOKEN=123456:ABC-your-bot-token
# Числовой user_id владельца (стабилен, не меняется при ребрендинге username).
# Получить можно у @userinfobot или из getUpdates после первого /start.
TELEGRAM_ALLOWED_USER_ID=123456789
# Опционально: username владельца без @ (доп. проверка поверх id).
TELEGRAM_ALLOWED_USERNAME=your_username
BOT_SYNC_INTERVAL_MIN=120
BOT_LONG_POLL_SEC=30
```

> Авторизация бота построена на трёх слоях: `chat.type === "private"`, совпадение `from.id` с `TELEGRAM_ALLOWED_USER_ID` и совпадение `from.username` с `TELEGRAM_ALLOWED_USERNAME` (если задан). Все три должны пройти, иначе апдейт молча отбрасывается — посторонние не видят даже подсказки «бот приватный». Подробности — в [security.md](./security.md#доступ-к-telegram-боту).

> Если на сервере раньше стоял старый `plaud-exporter.service` (oneshot `server:sync`) и `plaud-exporter.timer`, сначала уберите их, иначе `cp` поверх существующего unit'а ничего не починит без `daemon-reload`/`disable`:
>
> ```bash
> sudo systemctl disable --now plaud-exporter.timer 2>/dev/null || true
> sudo rm -f /etc/systemd/system/plaud-exporter.timer
> sudo systemctl daemon-reload
> ```

Установка нового unit-файла:

```bash
sudo cp /srv/plaud-exporter/deploy/systemd/plaud-exporter.service /etc/systemd/system/
sudo cp /srv/plaud-exporter/deploy/logrotate/plaud-exporter /etc/logrotate.d/plaud-exporter
sudo systemctl daemon-reload
sudo systemctl enable --now plaud-exporter.service
```

Проверка, что это действительно бот, а не oneshot-sync:

```bash
systemctl cat plaud-exporter.service | grep ExecStart   # должно быть: ... server:bot
systemctl --no-pager status plaud-exporter.service      # Active: active (running)
tail -n 50 /var/log/plaud-exporter/bot.log
```

После первого запуска отправьте боту `/start` **в личном чате** с разрешённого аккаунта (`TELEGRAM_ALLOWED_USER_ID` / `TELEGRAM_ALLOWED_USERNAME`) — он запомнит `chatId` в `server/.data/owner-chat.json` (`0o600`) и начнёт слать отбивки. После первой записи файл пиннится к этому `chatId`: повторный `/start` из другого чата отвергается и логируется как warning (см. [security.md](./security.md#доступ-к-telegram-боту)).

Сервис запускает `npm run server:bot` от пользователя `plaud`. Бот:

- читает `server/.data/session.json` (тот же, что и CLI);
- ждёт первое `/start` от владельца, чтобы запомнить `chatId` в
  `server/.data/owner-chat.json` (auto-captured, права `0o600`);
- запускает сам синк по таймеру каждые `BOT_SYNC_INTERVAL_MIN` минут;
- использует тот же `acquireSyncLock`, что и CLI, — параллельный
  `npm run server:sync` не сломает индекс.

Backup oneshot (`plaud-exporter-sync.service`) остался в репозитории для
ручного запуска или восстановления, если бот лежит. По умолчанию он
**не enable'нут**:

```bash
# Ручной разовый запуск без бота:
sudo cp /srv/plaud-exporter/deploy/systemd/plaud-exporter-sync.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start plaud-exporter-sync.service
```

## Логи и статус

```bash
journalctl -u plaud-exporter.service -n 50 --no-pager
tail -n 50 /var/log/plaud-exporter/bot.log
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:status'
```

В Telegram статус последнего синка доступен в /menu → 📊 Статус или
командой /status.

Коды выхода сохраняются для backup oneshot'а; работающий бот их не
использует — там Restart=always.

| Код | Значение |
|-----|----------|
| `0` | OK |
| `2` | Снова auth на Mac + `scp` |
| `3` | API Plaud изменился — см. `_errors/` |
| `4` | Параллельный sync (только при ручном `server:sync` рядом с ботом) |

## Соседство с другими сервисами

- Отдельный пользователь `plaud` и путь `/srv/plaud-exporter` — sync не от root.
- Каталог `exports/` изолирован — рядом с другими ботами, если следить за диском.
- Один планировщик на одну `server/.data` (локальный `sync.lock`).

## Обновление кода

**Автоматически (рекомендуется):** push в `main` → GitHub Actions job **Deploy to production (systemd)** (`scripts/ci-deploy-systemd-remote.sh`): `git reset --hard origin/main`, `npm install`, `systemctl restart plaud-exporter.service`. Job запускается, пока в Variables **не** стоит `PRODUCTION_DOCKER_DEPLOY=true` (Docker — отдельный opt-in). Нужны secrets `DEPLOY_HOST`, `DEPLOY_USER`, `SSH_PRIVATE_KEY`. Опционально variable `DEPLOY_REPO_DIR` (по умолчанию `/srv/plaud-exporter`).

**Вручную на VPS**, если CI недоступен — с Mac сначала: `git push origin main`. На сервере — полный чеклист (короткий `git pull` часто не хватает: висят локальные правки, root владелец файлов, бот держит процесс):

```bash
cd /srv/plaud-exporter

sudo systemctl stop plaud-exporter.service

sudo -u plaud git fetch origin main
sudo -u plaud git reset --hard origin/main
sudo -u plaud git clean -fd

sudo chown -R plaud:plaud /srv/plaud-exporter

sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm install --workspaces'

sudo cp /srv/plaud-exporter/deploy/systemd/plaud-exporter.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart plaud-exporter.service
sudo systemctl status plaud-exporter.service --no-pager -l
```

| Шаг | Зачем |
|-----|--------|
| `stop` | Бот не держит файлы и lock во время `git`/`npm` |
| `fetch` + `reset --hard` | Рабочая копия строго как `origin/main`, без локальных коммитов/конфликтов |
| `clean -fd` | Убрать неотслеживаемые артефакты после смены структуры репо |
| `chown` | После `sudo`/`root` git снова `plaud:plaud`, иначе `dubious ownership` |
| `cp` unit + `daemon-reload` | Новый `ExecStart` (например `server:bot`) не подхватится одним `restart` |

Не трогает `.env`, `server/.data/session.json`, `owner-chat.json` и `exports/` — они в `.gitignore`.

При выходе `2` после обновления снова скопируйте `session.json` с Mac, потом
`sudo systemctl restart plaud-exporter.service`.

## Сброс owner-chat

Если token бота сменился, или нужно перепривязать чат:

```bash
sudo -u plaud rm /srv/plaud-exporter/server/.data/owner-chat.json
sudo systemctl restart plaud-exporter.service
# затем отправьте /start боту в Telegram
```

## Альтернатива: cron (если бот не нужен)

```cron
0 */2 * * * plaud cd /srv/plaud-exporter && /usr/bin/npm run server:sync >> /var/log/plaud-exporter/sync.log 2>&1
```

Интервал 2 ч должен быть больше худшего времени sync, иначе пересечения и код `4`.

## Альтернатива: Docker (production)

Полная схема: [deploy/README.md](../deploy/README.md). Кратко:

- **Только бот** в compose; TLS на **хостовом nginx** (`location = /healthz` — exact match).
- Loopback: `127.0.0.1:18080` → контейнер `:8080`.
- State: volume `plaud-exporter_app-data` → `/app/server/.data`; exports — bind `/srv/plaud-exporter/exports`.
- **Не** запускайте одновременно `plaud-exporter.service` (systemd) и Docker с одним токеном.
- Первичный выкат: `make deploy` (Ansible). Дальше — push в `main` → GHCR `:sha-*` → CI deploy.
- Миграция с systemd: `scripts/migrate-legacy-data.sh` (см. [troubleshooting.md](./troubleshooting.md)).
