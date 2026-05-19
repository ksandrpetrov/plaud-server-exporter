# Устранение неполадок

## Plaud разлогинил (код выхода 2)

**Симптомы:** `No session snapshot`, `PlaudAuthError`, `_errors/*auth_error*.md`.

**Исправление (Mac):**

```bash
npm run server:auth
scp server/.data/session.json YOUR_SSH_USER@YOUR_SERVER_HOST:/tmp/session.json
```

На сервере: перенести в `server/.data/`, `chown plaud:plaud`, `chmod 600` — [getting-started.md](./getting-started.md).

Playwright на VPS с 1 GB RAM не запускайте.

## Изменился API Plaud (код выхода 3)

**Симптомы:** `plaud_changed` в логах, `_errors/*plaud-export-error*.md` со стадией `list-recordings` или `fetch-summary`.

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
- `PLAUD_MIRROR_FOLDERS` и теги папок — файлы могут быть в `Plaud/{год}/{папка}/`.

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
2. Битый индекс — восстановите из `sync-index.json.bak` или примите разовый повторный экспорт (неизменённые хеши всё равно пропустятся).
3. Два разных stable id с одним названием → два файла по задумке.

## Google блокирует вход при `server:auth`

Используйте email/пароль, не Google. Установите Google Chrome. Сбросьте профиль:

```bash
rm -rf server/.data/playwright-profile
npm run server:auth
```

## scp: Permission denied

Проблема уровня SSH — тот же логин, что `ssh YOUR_SSH_USER@YOUR_SERVER_HOST`. Настройте `ssh-copy-id`. В командах не используйте угловые скобки (`<user>` ломает zsh).

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

Другой sync держит `sync.lock` — это может быть Telegram-бот (авто- или ручной синк) или параллельный `npm run server:sync`. Дождитесь завершения или удалите устаревший lock, если процесс умер:

```bash
sudo rm -f /srv/plaud-exporter/server/.data/sync.lock
```

Lock снимается автоматически через 2 часа или если PID мёртв. Не запускайте `server:sync` вручную одновременно с активным ботом без необходимости.

## Telegram-бот

### `Missing script: "server:bot"`

На сервере устаревший клон — нет скрипта в `package.json`. С Mac: `git push origin main`. На сервере:

```bash
sudo -u plaud git -C /srv/plaud-exporter pull --ff-only
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm install --workspaces'
```

### Сервис не стартует / сразу падает (код 2)

Проверьте `.env` под `plaud`:

```bash
sudo -u plaud grep -E '^TELEGRAM_' /srv/plaud-exporter/.env
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:status'
journalctl -u plaud-exporter.service -n 30 --no-pager
```

Нужны `TELEGRAM_BOT_TOKEN` и `TELEGRAM_ALLOWED_USERNAME`. Без токена `server:bot` завершается с кодом `2`.

### Бот молчит после `/start`

1. Username в `.env` — **без `@**, lowercase, тот же, что в Telegram.
2. Проверьте, что сервис running: `systemctl status plaud-exporter.service`.
3. После первого `/start` должен появиться `server/.data/owner-chat.json` (`0o600`). Если файла нет — смотрите `bot.log` на ошибки API Telegram.
4. Перепривязка: [server-deploy.md](./server-deploy.md#сброс-owner-chat).

### Кнопки sync не работают / «чужой» бот

Только аккаунт из `TELEGRAM_ALLOWED_USERNAME` может запускать синк и менять расписание. Остальные callback'и игнорируются.

### Старый `plaud-exporter.timer` всё ещё запускает sync

```bash
sudo systemctl disable --now plaud-exporter.timer 2>/dev/null || true
sudo rm -f /etc/systemd/system/plaud-exporter.timer
sudo systemctl daemon-reload
```

Расписание теперь только в боте (`BOT_SYNC_INTERVAL_MIN` или меню ⚙️).

## `npm: command not found`

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

## `dubious ownership` в git

```bash
sudo chown -R plaud:plaud /srv/plaud-exporter
sudo -u plaud git -C /srv/plaud-exporter status
```
