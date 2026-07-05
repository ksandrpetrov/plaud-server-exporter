# Устранение неполадок

## Plaud разлогинил (код выхода 2)

**Симптомы:** `No Plaud credentials`, `PlaudAuthError`, `_errors/*auth_error*.md`.

**Исправление (Mac) — OAuth (рекомендуется):**

```bash
npm run server:auth
scp server/.data/oauth-tokens.json YOUR_SSH_USER@YOUR_SERVER_HOST:/tmp/oauth-tokens.json
```

На сервере:

```bash
sudo install -o plaud -g plaud -m 600 /tmp/oauth-tokens.json /srv/plaud-exporter/server/.data/oauth-tokens.json
sudo rm -f /tmp/oauth-tokens.json
```

**Legacy Playwright snapshot:**

```bash
npm run server:auth -- --playwright
scp server/.data/session.json YOUR_SSH_USER@YOUR_SERVER_HOST:/tmp/session.json
```

На сервере: перенести в `server/.data/`, `chown plaud:plaud`, `chmod 600` — [getting-started.md](./getting-started.md).

OAuth refresh на VPS обновляет access token автоматически; повторный `scp` нужен только если refresh token отозван
(`plaud logout` / смена пароля). Playwright на VPS с 1 GB RAM не запускайте.

Подробнее о режимах auth/API — [plaud-oauth-spike.md](./plaud-oauth-spike.md).

## Изменился API Plaud (код выхода 3)

**Симптомы:** `plaud_changed` в логах, `_errors/*plaud-export-error*.md` со стадией `list-recordings` или
`fetch-summary`.

**Смысл:** JSON ответа больше не совпадает с ожиданиями `plaudApiClient.js` — нужно обновить код.

**Действия:**

1. Откройте Markdown ошибки в `{export}/_errors/`.
2. Сравните с вкладкой Network в Plaud Web (токены вставлять не нужно).
3. Обновите `server/src/plaud/plaudApiClient.js` и добавьте регрессионный тест.

## Саммари не выгружается

**Проверка:**

```bash
npm run server:status   # session.snapshot.present, vaultRoot, exportRoot
```

- У записи нет AI-саммари в Plaud Web → пустой или placeholder `.md`.
- Ошибки по файлам увеличивают `errors` в статистике — см. `_errors/` за этот прогон.
- `PLAUD_MIRROR_FOLDERS` и теги папок — файлы могут быть в `Plaud/{папка}/` (при mirror on) или в корне `Plaud/`.

## Нет папки `Plaud/Unfiled/` после sync

Подпапка `Unfiled` создаётся только когда хотя бы одна запись пишется с `folderSegment: "Unfiled"`. Пустая папка заранее
не создаётся.

**Проверка на сервере:**

```bash
grep -E '^PLAUD_MIRROR_FOLDERS|^PLAUD_EXPORT_ROOT' /path/to/.env
ls -la "$PLAUD_EXPORT_ROOT/Plaud"
find "$PLAUD_EXPORT_ROOT/Plaud" -maxdepth 2 -type d | head -30
jq '[.records[] | .folderSegment] | group_by(.) | map({folder: .[0], n: length})' \
  server/.data/sync-index.json
```

**Частые причины:**

| Симптом                                             | Причина                                      | Действие                                                                               |
| --------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------- |
| Саммари лежат в `Plaud/*.md` (корень), нет подпапок | `PLAUD_MIRROR_FOLDERS=false` или legacy sync | В `.env` задать `PLAUD_MIRROR_FOLDERS=true`, один полный sync (cron или кнопка в боте) |
| Есть `Plaud/All files/`, нет `Unfiled/`             | Виртуальный тег «All files» (EN Plaud)       | Обновить до версии с фильтром All files → Unfiled; затем sync                          |
| Другие папки есть, `Unfiled/` нет                   | В Plaud нет записей в Unfiled                | Нормально: папка появится, когда появится первая такая запись                          |
| В index много `folderSegment: ""`                   | Mirror off или старый индекс                 | Включить mirror и пересинхронизировать                                                 |

При `PLAUD_MIRROR_FOLDERS=true` записи без пользовательской папки и с виртуальным «All files» должны попадать в
`Plaud/Unfiled/`. Файлы из корня `Plaud/` переносятся в `Plaud/Unfiled/` при следующем sync, если mirror включён.

## Файлы не появляются

```bash
npm run server:status
ls -la "$PLAUD_EXPORT_ROOT/Plaud"
```

- Неверный `PLAUD_EXPORT_ROOT` или путь vault в `.env`.
- Права: каталог экспорта должен быть доступен на запись пользователю sync (`plaud` на сервере).
- `--dry-run` ничего не пишет — уберите флаг для реального экспорта.
- См. [EACCES sync.lock](#eacces-synclock-на-сервере), если sync падает до записи.

## Странные имена файлов

Ожидаемый шаблон: `ГГГГ-ММ-ДД - {название встречи}.md`.

- Шаблонные заголовки (`Plaud`, `Untitled`) игнорируются → fallback `ГГГГ-ММ-ДД Plaud summary`.
- Длинные названия обрезаются (~242 символа) — начало остаётся читаемым.
- Дубликаты названий получают короткий суффикс id — это норма.

Логика: `server/src/sync/filenamePlanner.js`.

## Markdown в `_errors/`

Нормально при сбое. Откройте новейший файл — разделы **Что случилось** / **Что сделать**.

- Дедупликация: одинаковые сбои переиспользуют файл (см. `dedupe_key` в техническом блоке).
- `--dry-run` не создаёт `_errors/` — только логи.

## Дубликаты при повторном sync

**Не должно** быть, если `sync-index.json` цел.

Если дубликаты появились:

1. Проверьте, что `server/.data/sync-index.json` существует и доступен на запись.
2. Битый индекс — восстановите из `sync-index.json.bak` или примите разовый повторный экспорт (неизменённые хеши всё
   равно пропустятся).
3. Два разных stable id с одним названием → два файла по задумке.

## Google блокирует вход при `server:auth`

Используйте email/пароль, не Google. Установите Google Chrome. Сбросьте профиль:

```bash
rm -rf server/.data/playwright-profile
npm run server:auth
```

## scp: Permission denied

Проблема уровня SSH — тот же логин, что `ssh YOUR_SSH_USER@YOUR_SERVER_HOST`. Настройте `ssh-copy-id`. В командах не
используйте угловые скобки (`<user>` ломает zsh).

## EACCES sync.lock на сервере

**Симптом:** `status` OK, `sync` падает с `EACCES` на `sync.lock`.

**Причина:** `server/.data` принадлежит root.

```bash
sudo chown -R plaud:plaud /srv/plaud-exporter/server/.data
sudo chmod 700 /srv/plaud-exporter/server/.data
sudo rm -f /srv/plaud-exporter/server/.data/sync.lock
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:sync'
```

Sync всегда от пользователя `plaud`, не от root.

## Sync уже выполняется (код выхода 4)

Другой sync держит `sync.lock` — это может быть Telegram-бот (авто- или ручной синк) или параллельный
`npm run server:sync`. Дождитесь завершения или удалите устаревший lock, если процесс умер:

```bash
sudo rm -f /srv/plaud-exporter/server/.data/sync.lock
```

Lock снимается автоматически через 2 часа или если PID мёртв. Не запускайте `server:sync` вручную одновременно с
активным ботом без необходимости.

## Telegram-бот

### Бот мёртв после push в `main` / CI Deploy (`inactive`, `disabled`)

**Симптомы:** `systemctl status plaud-exporter.service` → `inactive (dead)`, `disabled`; в journal — штатный `SIGTERM`
около времени GitHub Actions Deploy; `/opt/plaud-exporter` нет.

**Причина:** workflow Deploy раньше останавливал и **отключал** systemd **до** проверки Docker. Если Ansible/bootstrap
не делали, бот оставался выключенным.

**Сейчас в репо:** deploy по SSH только при `PRODUCTION_DOCKER_DEPLOY=true`; скрипт не трогает systemd, пока нет
`docker-compose.yml`, и откатывает systemd при сбое до healthz.

**Поднять systemd снова (ваш случай):**

```bash
sudo systemctl enable plaud-exporter.service
sudo systemctl start plaud-exporter.service
sudo systemctl status plaud-exporter.service --no-pager -l
```

Путь к коду смотрите в unit: `systemctl cat plaud-exporter.service | grep WorkingDirectory` (у вас может быть
`/opt/plaud-server-exporter`, не `/srv/plaud-exporter`).

Пока остаётесь на systemd — **не** включайте `PRODUCTION_DOCKER_DEPLOY` в GitHub Variables.

### `Missing script: "server:bot"`

На сервере устаревший клон — нет скрипта в `package.json`. С Mac: `git push origin main`. На
сервере — [server-deploy.md § Обновление кода](./server-deploy.md#обновление-кода) (не только `git pull`).

### Сервис не стартует / сразу падает (код 2)

Проверьте `.env` под `plaud`:

```bash
sudo -u plaud grep -E '^TELEGRAM_' /srv/plaud-exporter/.env
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:status'
journalctl -u plaud-exporter.service -n 30 --no-pager
```

Нужны `TELEGRAM_BOT_TOKEN` и хотя бы одно из `TELEGRAM_ALLOWED_USER_ID` / `TELEGRAM_ALLOWED_USERNAME`. Без них
`server:bot` завершается с кодом `2`. Если задан только username — будет warning «add TELEGRAM_ALLOWED_USER_ID», бот при
этом стартует.

### Бот молчит после `/start`

1. `/start` отправлен **в личном чате** с ботом, не в группе (групповые чаты бот игнорирует молча).
2. `TELEGRAM_ALLOWED_USER_ID` в `.env` совпадает с вашим Telegram user_id (узнать через `@userinfobot`).
3. Username в `.env` — **без `@`**, lowercase, тот же, что в Telegram (если задан).
4. Сервис running: `systemctl status plaud-exporter.service`.
5. После первого `/start` должен появиться `server/.data/owner-chat.json` (`0o600`). Если файла нет — смотрите `bot.log`
   на ошибки API Telegram или строки `Silently ignored …` (увидите, кто и почему был отброшен).
6. Перепривязка: [server-deploy.md](./server-deploy.md#сброс-owner-chat).

### Кнопки sync не работают / «чужой» бот

Команды и callback’и принимаются только при совпадении `chat.type === "private"`, `from.id === TELEGRAM_ALLOWED_USER_ID`
и (если задано) `from.username === TELEGRAM_ALLOWED_USERNAME`. Остальные апдейты молча отбрасываются — в `bot.log` будет
`Silently ignored …` с причиной.

### Старый `plaud-exporter.timer` всё ещё запускает sync

```bash
sudo systemctl disable --now plaud-exporter.timer 2>/dev/null || true
sudo rm -f /etc/systemd/system/plaud-exporter.timer
sudo systemctl daemon-reload
```

Расписание теперь только в боте (`BOT_SYNC_INTERVAL_MIN` или меню ⚙️).

## `npm: command not found`

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
```

## `dubious ownership` в git

```bash
sudo chown -R plaud:plaud /srv/plaud-exporter
sudo -u plaud git -C /srv/plaud-exporter status
```

## Docker: бот «забыл» сессию / owner-chat после деплоя

**Симптомы:** в логах `Persistence is empty but backup files exist`, синк не идёт, `/start` как с нуля.

**Причина:** named volume `plaud-exporter_app-data` пустой, а старые JSON лежат в `/srv/plaud-exporter/server/.data/` (
systemd).

**Исправление (один раз на сервере):**

```bash
sudo bash /path/to/repo/scripts/migrate-legacy-data.sh
```

CI deploy (`scripts/ci-deploy-remote.sh`) намеренно падает, если на хосте больше JSON-файлов, чем в volume — не
копируйте `.data` вручную поверх свежего volume.

## Публичный `/healthz` отдаёт HTML главной страницы

В nginx нужен **exact** match: `location = /healthz { proxy_pass http://127.0.0.1:18080; ... }`.  
См. [deploy/nginx/plaud-exporter-webapp.conf.example](../deploy/nginx/plaud-exporter-webapp.conf.example).

## Два бота с одним `TELEGRAM_BOT_TOKEN`

Отключите legacy unit перед Docker:

```bash
sudo systemctl stop plaud-exporter.service
sudo systemctl disable plaud-exporter.service
```

Не держите systemd и `docker compose up` одновременно — будут 409 от Telegram и гонки offset.
