# Аудит стабилизации Plaud Exporter

> Архив. Актуальная инструкция: [getting-started.md](./getting-started.md). Аудио и альтернативные способы auth сняты с поддержки.

## Целевой сервер

| Параметр | Пример / заметка |
|----------|------------------|
| Хост | `YOUR_SERVER_HOST` |
| ОС | Ubuntu 22.04 LTS |
| CPU | 1 vCPU (типичный минимальный VPS) |
| RAM | 1 GB |
| Диск | по тарифу провайдера |

Архитектурные следствия:

- Playwright (`server:auth`) рассматриваем как **локальный** инструмент (Mac); на
  сервере — только `--import` или импорт `session.json` через `scp`.
- `npm run server:sync` без аудио укладывается в ~80–150 MB RSS — это
  совместимо с 1 GB RAM при отсутствии параллельных тяжёлых соседей.
- 30 GB диска: режим по умолчанию (только саммари) тратит десятки KB на встречу.
  При включённом аудио — следить за `df -h`.

## Текущая архитектура

- **Корневой репозиторий** `plaud-server-exporter`: CLI Node 20+, workspaces, скрипты
  `server:auth`, `server:sync`, `server:status`.
- **Submodule** `plaud-exporter/`: Chrome-расширение + общие
  `common/syncCore.js`, `common/exportPathUtils.js`.
- **Сервер** `server/src/`: Playwright auth, снимок сессии, клиент API Plaud, sync
  runner, writer Obsidian, планировщик имён, отчёты об ошибках, JSON sync-index.

Без БД, очередей и HTTP-сервера — только CLI и файлы.

## Текущий поток sync

1. Загрузка `session.json` → `PlaudSession`.
2. `listAllRecordings` (пагинация `/file/simple/web`).
3. На файл: `fetchSummaries` (`/ai/query_note`), stable id + hash саммари.
4. `determineSyncAction` по `sync-index.json`.
5. Запись чистого Markdown в `{vault}/Plaud/{YYYY}/`, атомарное обновление индекса.
6. Аудио опционально при `--audio-too` или `PLAUD_EXPORT_AUDIO=true`.

## Auth / сессия

- Интерактивно: Playwright → `web.plaud.ai` → снимок `localStorage` + cookies →
  `session.json` (`0600`).
- Профиль: `playwright-profile/` (в gitignore).
- API-клиент: `Authorization`, `workspace-id`, редирект `-302`, повторы кроме
  401/403.
- `server:status` показывает наличие без значений токенов.

## Выгрузка саммари

- Саммари из `/ai/query_note` (типы: `summary`, `auto_sum_note`, `sum_multi_note`).
- В `.md` — только тело саммари (без YAML frontmatter).
- Метаданные (stable id, hash, пути) — в `sync-index.json`.

## Статус аудио

- **По умолчанию выключено.** `PLAUD_EXPORT_AUDIO=false`,
  `PLAUD_EXPORT_SUMMARY_ONLY=true`.
- Включение только если:
  - CLI: `--audio-too`, или
  - env (оба): `PLAUD_EXPORT_SUMMARY_ONLY=false` **и** `PLAUD_EXPORT_AUDIO=true`.
- `--no-audio` / `--summary-only` всегда только саммари.
- Dry-run **не** запрашивает URL аудио: с `--audio-too --dry-run` только счётчик
  «скачали бы», без вызова Plaud.

## Имена файлов

- Модуль: `server/src/sync/filenamePlanner.js`.
- Заголовок: `file_name` Plaud → заголовок markdown (без шаблонов) →
  `YYYY-MM-DD Plaud summary`.
- Имя: `YYYY-MM-DD - {title}.md`, санитизация, зарезервированные имена Windows.
- Коллизии: суффикс stable id из sync-index.

## Длина пути / имени

- Лимит компонента 255 (Win/macOS/Linux) → **242** символа в имени файла.
- Полный путь Windows MAX_PATH 260 → бюджет **240** (`MAX_FULL_PATH_LENGTH`).
- `planSummaryPath` ужимает заголовок, если `{vault}/Plaud/{year}/` съедает место.
- Обрезка через `Intl.Segmenter` (по графемам), если доступен.

## Обработка ошибок

- `server/src/errors/errorClassifier.js` — виды: `auth_error`, `plaud_changed`,
  `network_error`, `rate_limit`, `write_error`, `config_error`, `unknown_error`.
- `server/src/errors/errorReporter.js` — Markdown в `{vault}/_errors/`, редакция,
  дедупликация.
- `PlaudChangedError` при неожиданной форме ответа API.
- Коды выхода: auth `2`, plaud_changed `3`, прочее `1`.

## Поведение sync-index

- Путь: `server/.data/sync-index.json`.
- Атомарная запись: temp + rename; `.bak` предыдущей версии.
- Битый JSON: восстановление из `.bak` или пустой индекс.
- Дедуп: `stableId` основной, `fingerprint` вторичный.
- Переименование: при смене только метаданных — move файла на диске.
- **Удалённый `.md`:** при том же hash в индексе — перезапись (`updated`, не
  дубликат).
- **Блокировка параллельного запуска:** `sync.lock` (`open(O_EXCL)`), `{ pid, host,
  startedAt }`. Устаревшие (> 2 ч / мёртвый pid) снимаются. Dry-run без блокировки.

## Покрытие тестами

- Имена (emoji/unicode, зарезервированные Windows, длинные заголовки, полный путь).
- Умолчания аудио, env opt-in, `--no-audio`, dry-run без `/file/temp-url`.
- Интеграция sync (new, unchanged, updated, rename-only, дубликаты названий,
  восстановление удалённого файла, фильтр без id, dry-run).
- CLI subprocess (нет сессии → 2; read-only export root).
- Все 7 видов classifier + редакция + дедуп.
- `plaud_changed` end-to-end → exit 3.
- Блокировка sync, обход в dry-run.
- API-клиент, парсер сессии, атомарная запись индекса + `.bak`.
- Расширение: `npm run test:submodule` (14 тестов, без изменений).

## Основные риски

| Риск | Влияние |
|------|---------|
| Смена API/DOM Plaud | Сбой sync; `plaud_changed` в `_errors/` |
| Истечение токена | Auth; нужен `server:auth` |
| Потеря sync-index | Возможна повторная выгрузка; тот же контент пропускается по hash |
| Параллель на одном хосте | `sync.lock` (exit 4); авто-снятие через 2 ч / мёртвый pid |
| Параллель на NFS с двух хостов | Блокировка только локальная — один писатель или один scheduler |
| Одно название, разные id | Суффикс коллизии |
| 1 GB RAM на целевом сервере | Playwright/`npm install` могут упасть в OOM; смягчение — swap 2 GB и логин на Mac, см. [server-deploy.md](./server-deploy.md#целевой-сервер) |

## План рефакторинга

1. ✅ Умолчание «только саммари» и тесты.
2. ✅ Чистый Markdown (метаданные только в индексе).
3. ✅ Единый filename planner + лимиты пути.
4. ✅ Error reporter + классификация.
5. ✅ Атомарный sync-index + backup.
6. ✅ Документация и операционные гайды.
7. ✅ `PLAUD_EXPORT_AUDIO=true` реально включает аудио; `--no-audio` перебивает.
8. ✅ Блокировка concurrent run; exit `4`.
9. ✅ Dry-run не ходит за URL аудио при opt-in.

## Чеклист приёмки

- [x] `npm test`, `npm run lint`, `npm run verify` (61 server + 14 ext.)
- [x] По умолчанию только саммари; аудио через CLI **или** явную пару env
- [x] Чистый `.md` без frontmatter
- [x] Название встречи в имени файла (Plaud → заголовок → дата)
- [x] Безопасная обрезка, коллизии, зарезервированные Windows, emoji
- [x] `_errors/*.md` с редакцией и дедупом
- [x] `plaud_changed` с кодом 3 (список и саммари)
- [x] Блокировка concurrent с кодом 4 и авто-снятием
- [x] Dry-run без записи и без API аудио
- [x] Расширение Chrome не тронуто (`test:submodule` зелёный)
- [x] Документация обновлена
