# Аудит стабилизации Plaud Exporter

> Технический аудит от 2026-05-18. Повседневные операции: [getting-started.md](./getting-started.md). Деплой и обновление сервера: [server-deploy.md](./server-deploy.md).

## Текущая архитектура

- **Корневой репозиторий** `plaud-server-exporter`: Node 20+ CLI (`server:auth`, `server:sync`, `server:status`, `logout`).
- **Директория расширения** `plaud-exporter/`: Chrome extension и общий код `common/syncCore.js`, `common/exportPathUtils.js`.
- **Сервер** `server/src/`: Playwright auth, снимок сессии, Plaud API client, sync runner, Obsidian writer, filename planner, error reporter, JSON sync-index, run lock.

Базы данных, очереди и HTTP-сервера нет: только CLI и файлы.

Целевой production-сервер: Ubuntu 22.04 VPS, около 1 vCPU / 1 GB RAM. Playwright auth запускается на Mac, `session.json` копируется на сервер через `scp`.

## Текущий поток sync

1. Загрузить `server/.data/session.json` и собрать `PlaudSession`.
2. Взять `sync.lock`; в dry-run lock не нужен.
3. Получить записи через `listAllRecordings`, paginated `/file/simple/web`.
4. Для каждой записи получить summary через `/ai/query_note`, собрать stable id и summary hash.
5. Принять решение через `determineSyncAction` по `sync-index.json`.
6. Записать чистый Markdown в `{vault}/Plaud/{folder}/{YYYY}/`.
7. Атомарно сохранить `sync-index.json` и записать `status.json`.
8. Вернуть exit `3` при `plaud_changed`, exit `1` при per-file ошибках, exit `4` при занятом lock.

## Поток auth/session

- **Интерактивный вход:** Playwright → `web.plaud.ai` → снимок `localStorage` + cookies → `session.json` (`chmod 600`).
- **Профиль браузера:** `server/.data/playwright-profile/`, находится в `.gitignore`.
- **API client:** `Authorization`, `workspace-id`, смена региона при `-302`, retry кроме 401/403.
- **`server:status`:** показывает наличие сессии без token values.
- **Истечение сессии:** `PlaudAuthError` → `_errors/auth_error*.md`, exit `2`; нужно заново выполнить `server:auth` на Mac и скопировать `session.json`.

## Поток выгрузки summary

- Notes берутся из `/ai/query_note`: `summary`, `auto_sum_note`, `sum_multi_note`.
- **Содержимое `.md`:** только тело summary; без YAML frontmatter, debug-полей и metadata exporter.
- Дублирующий первый `# Title` удаляется, если совпадает с resolved meeting title.
- **Metadata** (stable id, hash, paths, timestamps) живёт только в `server/.data/sync-index.json`.

## Статус выгрузки audio

- **Серверный exporter работает только в summary-only режиме.** Нет `--audio-too`, нет `PLAUD_EXPORT_AUDIO`, нет audio download в `runSync`.
- `runSync` не вызывает `/file/temp-url`; это покрыто `syncAudioDefault.test.js`.
- Helpers `writeAudioFile`, `planAudioPath`, `fetchAudioUrl` остаются в коде, но не подключены к sync. Это осознанное упрощение под основной сценарий.
- Chrome-расширение в `plaud-exporter/` по-прежнему умеет экспортировать audio в браузере; серверная стабилизация его не ломает и проверяется через `npm run test:submodule`.

## Логика имён файлов

- **Модуль:** `server/src/sync/filenamePlanner.js` плюс общий `exportPathUtils.js`.
- **Источник title:** Plaud `file_name` → первый не boilerplate Markdown heading → `YYYY-MM-DD Plaud summary`.
- **Boilerplate игнорируется:** `Plaud`, `Plaud Web`, `Untitled`, пустой title.
- **Паттерн filename:** `YYYY-MM-DD - {title}.md`, cross-platform sanitize, reserved Windows names экранируются.
- **Collision:** короткий suffix по stable id через `collectOccupiedFilenames` и sync-index.

## Ограничения длины filename/path

- Практический path component limit на Windows/macOS/Linux: 255. Выбран лимит **242** символа для filename с `.md`, примерно 5% запас.
- Full path budget: **240** символов (`MAX_FULL_PATH_LENGTH`) как консервативный Windows MAX_PATH budget.
- `planSummaryPath` уменьшает title budget, если vault path слишком длинный.
- Обрезка идёт по grapheme через `Intl.Segmenter`, когда он доступен.

## Обработка ошибок

- **`errorClassifier.js`:** `auth_error`, `plaud_changed`, `network_error`, `rate_limit`, `write_error`, `config_error`, `unknown_error`.
- **`errorReporter.js`:** человекочитаемый Markdown в `{vault}/_errors/`, redaction, dedupe через `dedupe_key`.
- **`PlaudChangedError`:** неожиданные формы list/summary API.
- **Коды выхода:** `0` успех, `1` общая ошибка, `2` auth, `3` `plaud_changed`, `4` занят lock.
- Dry-run логирует ошибки, но не создаёт `_errors/`.

## Поведение sync-index

- Путь: `server/.data/sync-index.json`.
- Запись: temp file + rename; `.bak` предыдущей валидной версии.
- Повреждённый JSON: recovery из `.bak` или старт с пустого index.
- Dedup: `stableId` основной, `fingerprint` дополнительный.
- **Саммари не изменилось:** write пропускается.
- **Content изменился:** файл обновляется.
- **Изменился только title/path:** файл переименовывается/перемещается как metadata-only update.
- **Пользователь удалил `.md`:** файл восстанавливается на следующем sync.
- **Одинаковые title у разных встреч:** создаются разные файлы, без перетирания.
- **Lock:** `sync.lock` через `O_EXCL`; stale lock снимается, если старше 2 часов или PID умер.

## Покрытие тестами

Текущие проверки: **68 server tests** (`npm test`) и **15 extension tests** (`npm run test:submodule`).

| Область | Покрытие |
|---------|----------|
| Naming | Plaud title, Markdown heading, boilerplate, запрещённые символы, Windows reserved, длинные RU/EN title, emoji, path budget, collisions |
| Summary-only | Обычный `runSync` не вызывает `/file/temp-url` |
| Интеграция sync | new / unchanged / updated / rename-only / duplicate titles / restore deleted file / skip bad id / dry-run |
| Ошибки | auth + `plaud_changed` reports, redaction, dedupe, classifier kinds |
| Lock | parallel run exit `4`, dry-run bypass |
| CLI subprocess | no session → `2`, read-only export root |
| Index | atomic save, `.bak`, load missing |
| API client | headers, redirect, 401, shape errors |

## Основные риски

| Риск | Последствие |
|------|-------------|
| Plaud изменил API/DOM | Sync падает явно: `plaud_changed` в `_errors/`, exit `3` |
| Истёк token | Auth error; нужен `server:auth` на Mac и `scp session.json` |
| Потерян sync-index | Возможна одноразовая повторная выгрузка; дальше hash снова защитит от дублей |
| Параллельный sync на одном host | Второй запуск exit `4`, lock auto-expires |
| Параллельный sync на shared storage с разных host | Локальный lock не защищает; нужен один writer |
| Одинаковые названия разных встреч | Collision suffix, без перетирания |
| Очень глубокий `PLAUD_OBSIDIAN_VAULT_PATH` | Basename станет короче |
| VPS 1 GB RAM | Не запускать Playwright auth на сервере; при `npm install` может понадобиться swap |

## План рефакторинга

| # | Пункт | Статус |
|---|-------|--------|
| 1 | Summary-only по умолчанию + тест | ✅ |
| 2 | Чистый Markdown, metadata только в index | ✅ |
| 3 | Единый filename planner + path limits | ✅ |
| 4 | Error reporter, classification и redaction | ✅ |
| 5 | Atomic sync-index + backup | ✅ |
| 6 | Run lock + exit `4` | ✅ |
| 7 | Убрать server audio CLI/env как ненужные | ✅ |
| 8 | Операционная документация | ✅ |
| 9 | Chrome extension не сломан | ✅ |
| 10 | Русификация docs + update/restart flow | ✅ |

## Чеклист приёмки

- [x] `npm test`, `npm run lint`, `npm run verify`, `npm run test:submodule`
- [x] Экспорт по умолчанию summary-only; сервер не скачивает audio
- [x] Чистый `.md` без exporter frontmatter
- [x] Название встречи в filename: Plaud → heading → date fallback
- [x] Safe truncation, collisions, Windows reserved names, Unicode
- [x] `_errors/*.md` с redaction и dedupe
- [x] `plaud_changed` виден явно, exit `3`
- [x] Sync-index atomic + `.bak`
- [x] Параллельный запуск блокируется, exit `4`
- [x] Dry-run: без файлов, без index update, без audio API
- [x] Extension tests green
- [x] README, deploy, security, troubleshooting и update/restart flow задокументированы
