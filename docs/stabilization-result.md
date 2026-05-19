# Результат стабилизации

> Завершено 2026-05-18. Эксплуатация: [getting-started.md](./getting-started.md). Аудит: [stabilization-audit.md](./stabilization-audit.md). Обновление сервера: [server-deploy.md#обновление-кода-и-перезапуск](./server-deploy.md#обновление-кода-и-перезапуск).

## Что изменилось

- **Серверный exporter работает только с summary.** Sync пишет Markdown-саммари; в `runSync` нет скачивания audio. Флага `--audio-too` и env vars для audio нет.
- **Markdown чистый.** Summary-файлы содержат только полезный текст Plaud; техническая metadata живёт в `server/.data/sync-index.json`.
- **Имена файлов стабильные.** Формат `YYYY-MM-DD - {meeting title}.md`, sanitize, grapheme-safe truncation, лимит 242 символа для filename, collision suffix, Windows reserved-name handling.
- **Ошибки видны.** Сбои создают redacted Markdown-отчёты в `{export}/_errors/`; `plaud_changed` возвращает exit `3`.
- **Синхронизация стала предсказуемой.** Skip по hash, update при изменении summary, rename при title-only change, восстановление удалённых вручную `.md`, `sync.lock` для параллельных запусков.
- **Документация русифицирована.** Добавлен flow обновления кода на сервере, быстрого restart и обновления Plaud-сессии.

## Изменённые области

| Область | Ключевые пути |
|---------|---------------|
| Синхронизация | `server/src/sync/syncRunner.js`, `filenamePlanner.js`, `obsidianWriter.js`, `serverSyncIndex.js`, `runLock.js` |
| Ошибки | `server/src/errors/errorReporter.js`, `errorClassifier.js`, `server/src/security/redact.js` |
| API / auth | `server/src/plaud/plaudApiClient.js`, `server/src/auth/*` |
| CLI | `server/src/cli/index.js` |
| Конфиг | `server/src/config/config.js`, `.env.example` |
| Тесты | `server/tests/*.test.js`, `plaud-exporter/tests/*.test.js` |
| Документация | `README.md`, `server/README.md`, `docs/*.md`, `plaud-exporter/README.md` |
| Chrome extension | Код расширения не удалялся; общий код проверяется тестами |

## Поведение после изменений

| Тема | Поведение |
|------|-----------|
| Обычный sync | Только Markdown summaries |
| `.md` content | Текст summary Plaud, без exporter frontmatter |
| Имена файлов | `YYYY-MM-DD - {title}.md`, filename ≤242 chars, full path budget ≤240 |
| Ошибки | `{vault}/_errors/*.md`, redacted, deduped |
| Повторный sync | Skip unchanged, update on hash change, rename on title-only change |
| Удалённый `.md` | Восстанавливается, если index hash совпадает |
| Изменение API Plaud | `plaud_changed`, exit `3` |
| Параллельный sync | Второй запуск exit `4` |
| Dry-run | Без `.md`, без index update, без lock, без audio API |
| Audio | Серверный CLI **не экспортирует audio**; Chrome-расширение может экспортировать audio в браузере |

## Как запускать

```bash
cd "$(git rev-parse --show-toplevel)"
npm install --workspaces
npx playwright install chromium   # только на Mac, для auth
cp .env.example .env              # отредактировать PLAUD_EXPORT_ROOT, PLAUD_TIMEZONE

npm run server:auth               # Mac: login → session.json
npm run server:status
npm run server:sync -- --dry-run
npm run server:sync               # summary-only export
node server/src/cli/index.js logout
```

На сервере: скопировать `session.json` с Mac, запускать `npm run server:sync` от пользователя `plaud`. Подробно: [getting-started.md](./getting-started.md).

## Как тестировать

```bash
npm test                 # 68 server tests
npm run lint
npm run verify
npm run test:submodule   # 15 extension tests, название команды историческое
```

## Как деплоить и обновлять

Основная инструкция: [server-deploy.md](./server-deploy.md).

После обновления кода на сервере:

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

Быстрый restart без обновления кода:

```bash
sudo systemctl restart plaud-exporter.service
sudo systemctl status plaud-exporter.service --no-pager
journalctl -u plaud-exporter.service -n 100 --no-pager
```

## Оставшиеся риски

- Plaud может изменить API; это surfaced как `plaud_changed` и требует code update.
- Lifetime JWT контролирует Plaud; периодически нужен re-auth на Mac.
- Очень длинный vault path оставляет меньше места под filename.
- `sync.lock` host-local; не запускайте два writer на shared storage с разных машин.

## Ручные проверки

1. `server:auth` на реальном Plaud account на Mac.
2. Full sync на 10+ recordings: filenames и чистый Markdown в Obsidian folder.
3. Expired session: `_errors/auth_error*.md`, exit `2`.
4. Simulated API shape break: `_errors/plaud_changed*.md`, exit `3`.
5. Два одновременных `server:sync`: один должен выйти с exit `4`.
6. Тесты Chrome-расширения: `npm run test:submodule`.
