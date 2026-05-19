# Диагностика и типовые сбои

## Plaud разлогинил или сессия протухла (exit code 2)

**Симптомы:** `No session snapshot`, `PlaudAuthError`, `_errors/*auth_error*.md`, exit `2`.

**Исправление на Mac:**

```bash
npm run server:auth
scp server/.data/session.json YOUR_SSH_USER@YOUR_SERVER_HOST:/tmp/session.json
```

**На сервере:**

```bash
sudo install -d -o plaud -g plaud -m 700 /srv/plaud-exporter/server/.data
sudo install -o plaud -g plaud -m 600 /tmp/session.json /srv/plaud-exporter/server/.data/session.json
sudo systemctl start plaud-exporter.service
journalctl -u plaud-exporter.service -n 100 --no-pager
```

Не запускайте Playwright auth на VPS с 1 GB RAM.

## Plaud изменил API (exit code 3)

**Симптомы:** `plaud_changed` в логах, `_errors/*plaud-export-error*.md` со stage `list-recordings` или `fetch-summary`, exit `3`.

**Что это значит:** JSON-ответ Plaud больше не похож на форму, которую ожидает `plaudApiClient.js`; нужен ручной аудит кода.

**Действия:**

1. Откройте свежий Markdown-отчёт в `{export}/_errors/`.
2. Сравните с Plaud Web в Network tab браузера, не копируя токены и cookies.
3. Обновите `server/src/plaud/plaudApiClient.js`.
4. Добавьте regression test на новую форму ответа.
5. Прогоните `npm test`, `npm run lint`, `npm run verify`.

## Саммари не выгружается

Проверьте статус:

```bash
npm run server:status
```

Смотрите поля `session.snapshot.present`, `vaultRoot`, `exportRoot`, `lastStatus.lastSyncStats`.

Возможные причины:

- В Plaud Web у записи ещё нет AI summary.
- Есть per-file ошибки: `lastSyncStats.errors > 0`, детали в `_errors/`.
- Включено `PLAUD_MIRROR_FOLDERS=true`, поэтому файлы могут лежать в `Plaud/{folder}/{year}/`.
- Был dry-run: `npm run server:sync -- --dry-run` не пишет `.md`.

## Файлы не создаются

```bash
npm run server:status
ls -la "$PLAUD_EXPORT_ROOT/Plaud"
```

Проверьте:

- правильный `PLAUD_EXPORT_ROOT` или `PLAUD_OBSIDIAN_VAULT_PATH` в `.env`;
- каталог export существует;
- пользователь `plaud` может писать в export-каталог;
- запуск был без `--dry-run`.

Если sync падает до записи файлов из-за `sync.lock`, см. [EACCES sync.lock на сервере](#eacces-synclock-на-сервере).

## Странные имена файлов

Ожидаемый формат: `YYYY-MM-DD - {meeting title}.md`.

- Заголовки-заглушки (`Plaud`, `Plaud Web`, `Untitled`) игнорируются.
- Если нормального заголовка нет, используется fallback `YYYY-MM-DD Plaud summary`.
- Очень длинные названия обрезаются до безопасного лимита; начало сохраняется читаемым.
- Запрещённые символы заменяются на читаемые `-` или `_`.
- Две разные встречи с одинаковым названием получают разные пути, чтобы не перетирать друг друга.

Логика: `server/src/sync/filenamePlanner.js` и `plaud-exporter/common/exportPathUtils.js`.

## Markdown-файлы ошибок в `_errors/`

Это нормально, если что-то сломалось. Откройте самый свежий файл: там есть разделы **Что случилось**, **Технические детали**, **Что сделать**.

- Одинаковые повторяющиеся ошибки дедуплицируются через `dedupe_key`.
- Dry-run не создаёт `_errors/`, а только пишет в лог.
- Секреты должны быть отредактированы. Если видите токен или cookie, это баг redaction.

## Повторный запуск создаёт дубли

Такого не должно быть, если `sync-index.json` цел и доступен для записи.

Проверьте:

1. `server/.data/sync-index.json` существует и принадлежит пользователю `plaud`.
2. Есть backup `server/.data/sync-index.json.bak`.
3. Не запущены два разных планировщика на один и тот же `server/.data`.

Команды:

```bash
sudo -u plaud ls -la /srv/plaud-exporter/server/.data/
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:status'
```

Если index повреждён, восстановите `.bak` или примите одноразовую повторную выгрузку. Неизменённые summary дальше будут пропускаться по hash.

## Google блокирует вход при `server:auth`

Используйте email/password вместо Google OAuth, установите обычный Google Chrome и сбросьте профиль:

```bash
rm -rf server/.data/playwright-profile
npm run server:auth
```

Если Chrome не найден, настройте `PLAUD_PLAYWRIGHT_CHANNEL=chromium` или установите Chrome.

## scp: Permission denied

Это проблема SSH, а не exporter. `scp` использует тот же логин и пароль/ключ, что `ssh`:

```bash
ssh YOUR_SSH_USER@YOUR_SERVER_HOST 'echo ok'
```

Не используйте угловые скобки в командах: `<user>` в zsh означает перенаправление ввода. Для ключевого доступа разово выполните:

```bash
ssh-copy-id YOUR_SSH_USER@YOUR_SERVER_HOST
```

Системный пользователь `plaud` создан с `/usr/sbin/nologin`; через него нельзя логиниться по SSH. Копируйте в `/tmp/session.json` обычным SSH-пользователем, затем переносите файл через `sudo install`.

## EACCES sync.lock на сервере

**Симптом:** `server:status` выглядит нормально, но `sync` падает с `EACCES` на `sync.lock`.

**Причина:** `server/.data` принадлежит root или другому пользователю.

```bash
sudo chown -R plaud:plaud /srv/plaud-exporter/server/.data
sudo chmod 700 /srv/plaud-exporter/server/.data
sudo rm -f /srv/plaud-exporter/server/.data/sync.lock
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:sync'
```

Всегда запускайте sync от `plaud`, не от root.

## Уже идёт sync (exit code 4)

Другой `server:sync` держит `sync.lock`. Обычно нужно просто подождать завершения timer-запуска.

Проверка:

```bash
sudo systemctl status plaud-exporter.service --no-pager
journalctl -u plaud-exporter.service -n 100 --no-pager
```

Если процесс точно умер, lock можно удалить:

```bash
sudo rm -f /srv/plaud-exporter/server/.data/sync.lock
```

Lock также auto-expires через 2 часа или если PID умер.

## `npm: command not found`

Поставьте Node 20:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v && npm -v
```

## `dubious ownership` в git

Обычно это значит, что в `/srv/plaud-exporter` работали от root.

```bash
sudo chown -R plaud:plaud /srv/plaud-exporter
sudo -u plaud git -C /srv/plaud-exporter status
```

## Обновили код, но exporter работает старой версией

Проверьте, что обновили именно `/srv/plaud-exporter`, а потом перезапустили service:

```bash
sudo -u plaud git -C /srv/plaud-exporter log -1 --oneline
sudo systemctl start plaud-exporter.service
journalctl -u plaud-exporter.service -n 100 --no-pager
```

Полный flow обновления: [server-deploy.md#обновление-кода-и-перезапуск](./server-deploy.md#обновление-кода-и-перезапуск).
