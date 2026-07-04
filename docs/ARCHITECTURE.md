# Архитектура Plaud Server Exporter

Один git-репозиторий, две среды выполнения (Node CLI + Chrome MV3), и небольшой набор общих чистых модулей. Цель
документа — дать новому разработчику (или AI-агенту) карту кода за минуту: где что лежит, какие файлы общие, и что
трогать при изменении X.

## Карта репозитория

```text
plaud-server-exporter/
├── server/                      Node CLI + Telegram bot
│   ├── src/
│   │   ├── cli/                 Точка входа: auth | sync | status | bot | logout
│   │   ├── config/              dotenv + getters (singleton)
│   │   ├── auth/                Playwright login, session.json snapshot
│   │   ├── plaud/               Plaud HTTP API + folders/tags
│   │   ├── sync/                Цикл экспорта, индекс, lock, filename planner, writer
│   │   ├── errors/              Классификация ошибок + report в _errors/
│   │   ├── telegram/            Бот: loop, handlers/*, messages/*, дерево, scheduler
│   │   ├── security/            redact для логов и отчётов
│   │   ├── http/                webServer: /healthz, /connect (Docker + nginx)
│   │   └── logger.js
│   └── tests/                   node:test (см. ниже)
├── plaud-exporter/              Chrome MV3 extension
│   ├── common/                  Shared (3) + extension-only (см. ниже)
│   ├── background/              Модули SW: downloads, tabs, locale
│   ├── background.js            Service worker (~1k LOC, оркестрация)
│   ├── features/audioExport/    Plaud API + smart sync (browser)
│   ├── content.js               onMessage → audioExport
│   └── popup/                   UI расширения
├── docs/                        Документация (RU)
├── deploy/                      systemd, logrotate, docker-compose, Ansible
├── Dockerfile                   Production image (бот + HTTP)
└── scripts/                     verify-submodule.js, ci-deploy-remote.sh, migrate-legacy-data.sh
```

## Общий код (shared common)

Семь файлов — формальный контракт между server и extension. Меняешь один — обновляешь оба consumer'а и оба набора
тестов. Список зафиксирован в [`scripts/verify-submodule.js`](../scripts/verify-submodule.js) (
`REQUIRED_SUBMODULE_FILES`).

| Файл                                                                                          | Что в нём                                                                                                                | Server-side consumers                                                                                      |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| [`plaud-exporter/common/syncCore.js`](../plaud-exporter/common/syncCore.js)                   | Стабильные ID, хеши саммари, `determineSyncAction` (new / unchanged / metadata-only / re-download), нормализация индекса | `syncRunner.js`, `serverSyncIndex.js`, `errorReporter.js`                                                  |
| [`plaud-exporter/common/exportPathUtils.js`](../plaud-exporter/common/exportPathUtils.js)     | Санитизация имён, даты-префиксы, `MAX_FULL_PATH_LENGTH`, режимы экспорта                                                 | `filenamePlanner.js`, `obsidianWriter.js`                                                                  |
| [`plaud-exporter/common/plaudFolders.js`](../plaud-exporter/common/plaudFolders.js)           | Парсинг filetags, `attachFolderSegmentsToFiles`, локализованный Unfiled, Trash                                           | Re-export в `server/src/plaud/plaudFolders.js`; `recordingsApi.js`, `vaultTree.js`, `liveTreeReadModel.js` |
| [`plaud-exporter/common/plaudRecordingIds.js`](../plaud-exporter/common/plaudRecordingIds.js) | `extractRawRecordingId`, `normalizeHexRecordingId`, `normalizePlaudRecordingId`                                          | `recordingsApi.js`                                                                                         |
| [`plaud-exporter/common/plaudTitles.js`](../plaud-exporter/common/plaudTitles.js)             | `normalizeHumanTitle`, `TITLE_KEYS`, `pickRawTitleFromFile`                                                              | `recordingsApi.js`, `summariesApi.js`, `audioExport.js`                                                    |
| [`plaud-exporter/common/plaudSummaries.js`](../plaud-exporter/common/plaudSummaries.js)       | `stripPlaudInlineAssets` — удаление битых Plaud CDN-картинок из markdown                                                 | `summariesApi.js` (re-export в `plaudApiClient.js` для тестов)                                             |
| [`plaud-exporter/common/plaudRecordings.js`](../plaud-exporter/common/plaudRecordings.js)     | Парсинг `/file/simple/web`, нормализация записей, pagination stop, fan-out по папкам Plaud                               | `recordingsApi.js`                                                                                         |

> Исторически каталог называется «submodule» в скриптах (`npm run verify`, `scripts/verify-submodule.js`), но это **не
> git-submodule**. Это вендорный код в монорепо. Сценарий: импорты server'а резолвятся как
> `../../../plaud-exporter/common/...`.

Остальные модули `plaud-exporter/common/` — **только** для расширения, server их не использует:

| Модуль                           | Назначение                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `runtimeMessages.js`             | Константы `action` для popup ↔ service worker ↔ content; тест `runtimeMessages.test.js` сверяет литералы в `popup.js` / `content.js` |
| `storageUtils.js`                | `chrome.storage` + загрузка/сохранение индекса sync                                                                                  |
| `domUtils.js`, `uiComponents.js` | DOM и статусный UI на странице Plaud                                                                                                 |
| `plaud-i18n-messages.js`         | Каталоги строк popup / background                                                                                                    |

Service worker вынесен в `background/`: `chromeDownloadBridge.js` (`chrome.downloads`), `tabMessaging.js` (
`sendMessage` + re-inject), `bgLocale.js`. В `features/audioExport/` из `audioExport.js` выделены
`plaudBrowserSession.js` (сессия из `localStorage`), `plaudRecordingIdScraper.js`, `plaudCollisionPaths.js` (имена и
коллизии в sync-папке).

Команда `npm run verify` из корня проверяет, что все семь shared-файлов существуют и что относительные импорты из
`server/src/` резолвятся. CI запускает её на каждом push/PR.

### Слои Telegram ↔ sync-index (read path)

```mermaid
flowchart LR
  handlers[handlers/*]
  treeBrowse[treeBrowse.js]
  liveTree[liveTreeReadModel.js]
  readFacade[syncIndexRead.js]
  diskIndex[serverSyncIndex.js]
  runner[syncRunner.js]

  handlers --> treeBrowse
  treeBrowse --> readFacade
  treeBrowse --> liveTree
  liveTree --> readFacade
  readFacade --> diskIndex
  runner --> diskIndex
```

Запись индекса — только через `syncRunner` / `saveSyncIndex`. Бот читает через [`syncIndexRead.js`](../server/src/sync/syncIndexRead.js).

## Точки входа

| Команда                 | Что запускается                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm run server:auth`   | [`server/src/cli/index.js`](../server/src/cli/index.js) → Playwright (только Mac) → `server/.data/session.json` |
| `npm run server:sync`   | CLI → [`server/src/sync/syncRunner.js`](../server/src/sync/syncRunner.js)                                       |
| `npm run server:status` | CLI → JSON со статусом конфига и сессии                                                                         |
| `npm run server:bot`    | CLI → [`server/src/telegram/index.js`](../server/src/telegram/index.js) (long-poll + scheduler)                 |
| Chrome                  | manifest.json → `background.js` + `content.js`                                                                  |

## Поток sync

```mermaid
flowchart LR
  CLI[cli/index.js]
  BOT[telegram/syncOrchestrator]
  RUN[sync/syncRunner.js]
  LOCK[sync/runLock.js]
  API[plaud/plaudApiClient.js]
  CORE[common/syncCore.js]
  PLAN[sync/filenamePlanner.js]
  WRT[sync/obsidianWriter.js]
  IDX[sync/serverSyncIndex.js]
  ERR[errors/errorReporter.js]
  FS[("vault: *.md + _errors/")]
  DATA[("server/.data/sync-index.json")]

  CLI --> RUN
  BOT --> RUN
  RUN --> LOCK
  RUN --> API
  RUN --> CORE
  RUN --> PLAN
  RUN --> WRT
  WRT --> FS
  RUN --> IDX
  IDX --> DATA
  RUN --> ERR
  ERR --> FS
```

1. CLI или Telegram-бот запускает `runSync`.
2. `runLock` берёт файловый лок (`server/.data/sync.lock`, `O_EXCL`).
3. Plaud API → список записей + саммари по каждой.
4. `syncCore.determineSyncAction` + (на server) `refineSyncActionForDisk` решают: new / unchanged / metadata-only /
   re-download / restore missing file.
5. `filenamePlanner` + `obsidianWriter` пишут `.md` атомарно; при metadata-only — `rename`/`move`.
6. `serverSyncIndex` сохраняет индекс (atomic + `.bak`).
7. Ошибки классифицируются и пишутся в `{vault}/_errors/*.md`.

### Слои обработки ошибок

| Слой                 | Модуль                                                                                                                        | Когда                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Top-level throw      | [`syncFailureMapper.js`](../server/src/sync/syncFailureMapper.js)                                                             | CLI и бот после `runSync` (lock, auth, plaud_changed, exit code); `recordAuthFailureIfNeeded` пишет auth в status.json |
| Per-file / per-stage | [`errorReporter.js`](../server/src/errors/errorReporter.js) + [`errorClassifier.js`](../server/src/errors/errorClassifier.js) | Внутри `syncRunner` на каждую запись или этап list/fetch                                                               |
| UX copy              | `sync/syncProgressPresenter.js`, `messages/sync.js`                                                                           | HTML для Telegram; CLI пишет в stderr                                                                                  |

Не дублировать `instanceof` в `syncRunner`, если `reportError` уже вернул `classified.kind`.

## Состояние на диске

| Путь                                | Назначение                                                                                                                                                                                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/.data/session.json`         | Plaud session (mode `0o600`)                                                                                                                                                                                                                                                        |
| `server/.data/sync-index.json`      | Состояние sync (атомик + `.bak`)                                                                                                                                                                                                                                                    |
| `server/.data/status.json`          | Последний run (для `server:status` и бота); чтение — [`sync/statusReader.js`](../server/src/sync/statusReader.js), запись — [`sync/syncStatusWriter.js`](../server/src/sync/syncStatusWriter.js); нормализация полей — [`sync/statusSchema.js`](../server/src/sync/statusSchema.js) |
| `server/.data/sync.lock`            | Файловый лок                                                                                                                                                                                                                                                                        |
| `server/.data/owner-chat.json`      | Chat ID владельца бота                                                                                                                                                                                                                                                              |
| `server/.data/bot-settings.json`    | Интервал автосинка + флаг `scheduledSummaryVisible` (по умолчанию `false` — автосинк не пишет в чат)                                                                                                                                                                                |
| `server/.data/telegram-offset.json` | Offset long-poll                                                                                                                                                                                                                                                                    |
| `server/.data/tree-browse.json`     | Per-chat browse state для `pick-by-number` в Telegram (TTL 30 мин)                                                                                                                                                                                                                  |
| `{vault}/Plaud/...md`               | Саммари                                                                                                                                                                                                                                                                             |
| `{vault}/_errors/*.md`              | Отчёты об ошибках                                                                                                                                                                                                                                                                   |

Все JSON в `.data/` — `chmod 600`, директория `chmod 700`. См. [security.md](./security.md).

## Коды выхода CLI

| Код | Значение                                                |
| --- | ------------------------------------------------------- |
| `0` | Успех                                                   |
| `1` | Ошибки sync (см. `_errors/`)                            |
| `2` | Нет/битая сессия или нет `TELEGRAM_BOT_TOKEN` для `bot` |
| `3` | Изменился API Plaud (`PlaudChangedError`)               |
| `4` | Уже идёт другой sync (lock занят)                       |

Telegram-бот собственного exit code не использует — `syncOrchestrator` никогда не пробрасывает ошибки, маппит их в HTML.

## Что трогать при изменении X

| Изменение                               | Файлы                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Новое поле в индексе sync               | [`syncCore.js`](../plaud-exporter/common/syncCore.js) (`determineSyncAction`, `refineSyncActionForDisk`, normalize), [`serverSyncIndex.js`](../server/src/sync/serverSyncIndex.js), тесты обоих пакетов                                                                                                                                                                                     |
| Нормализация title Plaud                | [`plaudTitles.js`](../plaud-exporter/common/plaudTitles.js), тесты `plaudTitles` + `recordingsApi`                                                                                                                                                                                                                                                                                          |
| Парсинг списка записей Plaud            | [`plaudRecordings.js`](../plaud-exporter/common/plaudRecordings.js), `plaudRecordings.test.js` + `recordingsApi.test.js`                                                                                                                                                                                                                                                                    |
| Очистка markdown саммари                | [`plaudSummaries.js`](../plaud-exporter/common/plaudSummaries.js), `plaudSummaries.test.js` + `plaudApiClient.test.js`                                                                                                                                                                                                                                                                      |
| Загрузка session snapshot               | [`auth/loadPlaudSession.js`](../server/src/auth/loadPlaudSession.js) — CLI, `syncRunBridge`, `liveTreeReadModel`, diagnostics                                                                                                                                                                                                                                                               |
| Live tree (Plaud API → synthetic index) | [`plaud/liveTreeReadModel.js`](../server/src/plaud/liveTreeReadModel.js)                                                                                                                                                                                                                                                                                                                    |
| Vault .md scan (Files stats)            | [`sync/vaultDiskScan.js`](../server/src/sync/vaultDiskScan.js)                                                                                                                                                                                                                                                                                                                              |
| Логика имени файла / папки              | [`exportPathUtils.js`](../plaud-exporter/common/exportPathUtils.js), [`filenamePlanner.js`](../server/src/sync/filenamePlanner.js), [`plaudFolders.js`](../server/src/plaud/plaudFolders.js)                                                                                                                                                                                                |
| Новый тип ошибки sync                   | [`errorClassifier.js`](../server/src/errors/errorClassifier.js), [`errorReporter.js`](../server/src/errors/errorReporter.js), README exit codes                                                                                                                                                                                                                                             |
| Сообщения/кнопки Telegram               | barrel [`telegram/messages.js`](../server/src/telegram/messages.js) → [`telegram/messages/`](../server/src/telegram/messages/), [`telegram/keyboards.js`](../server/src/telegram/keyboards.js)                                                                                                                                                                                              |
| Callback'и Telegram                     | [`handlers/dispatch.js`](../server/src/telegram/handlers/dispatch.js) → [`callbacks.js`](../server/src/telegram/handlers/callbacks.js); inbound text — [`inboundMessages.js`](../server/src/telegram/handlers/inboundMessages.js); auth gate — [`privateUpdateGate.js`](../server/src/telegram/handlers/privateUpdateGate.js) + [`callbackData.js`](../server/src/telegram/callbackData.js) |
| Новая команда CLI                       | [`server/src/cli/index.js`](../server/src/cli/index.js)                                                                                                                                                                                                                                                                                                                                     |
| Env переменная                          | [`server/src/config/config.js`](../server/src/config/config.js) + [`.env.example`](../.env.example) + [`server/README.md`](../server/README.md)                                                                                                                                                                                                                                             |
| Тесты sync flow                         | `server/tests/syncRunner*.test.js`                                                                                                                                                                                                                                                                                                                                                          |
| Тесты Telegram                          | `server/tests/telegram*.test.js`, `syncOrchestrator.test.js`                                                                                                                                                                                                                                                                                                                                |
| Новое `action` в расширении             | [`runtimeMessages.js`](../plaud-exporter/common/runtimeMessages.js) + sender/handler в том же PR; `grep action:` в `popup/`, `content.js`, `background.js`, `features/`                                                                                                                                                                                                                     |
| Скачивание через Chrome                 | [`chromeDownloadBridge.js`](../plaud-exporter/background/chromeDownloadBridge.js)                                                                                                                                                                                                                                                                                                           |
| Сессия Plaud в браузере                 | [`plaudBrowserSession.js`](../plaud-exporter/features/audioExport/plaudBrowserSession.js)                                                                                                                                                                                                                                                                                                   |

## Локальная проверка

```bash
npm install --workspaces
cd plaud-exporter && npm install && cd ..

npm test                 # server (node:test)
npm run lint             # eslint server/
npm run verify           # shared common imports + файлы существуют
npm run test:submodule   # plaud-exporter (node:test)
```

CI ([`/.github/workflows/ci.yml`](../.github/workflows/ci.yml)) — lint, verify, тесты на Node 22 при push/PR в `main`.

Deploy ([`/.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)) на push в `main`: образ в GHCR,
docker-smoke; опциональный SSH deploy через [`scripts/ci-deploy-remote.sh`](../scripts/ci-deploy-remote.sh) при
`PRODUCTION_DOCKER_DEPLOY=true`. Подробности — [deploy/README.md](../deploy/README.md).

## Что **не** трогаем в этом репо

- БД, очереди, HTTP API — нет и не планируем; всё на файлах.
- Скачивание аудио с сервера — намеренно отключено (`runSync` summary-only). Аудио — только через Chrome-расширение.
- Playwright на VPS — не запускать (1 GB RAM, нет дисплея); auth только на Mac.
- Два параллельных sync на одном vault на разных машинах — `runLock` локальный.

## Backlog рефакторинга (extension)

| Файл                                                 | ~LOC  | Заметка                                                              |
| ---------------------------------------------------- | ----- | -------------------------------------------------------------------- |
| `plaud-exporter/features/audioExport/audioExport.js` | 1.7k+ | Вынести Plaud API client; не дублировать sync-решения вне `syncCore` |
| `plaud-exporter/popup/popup.js`                      | 1.9k+ | Модули UI или build step для ESM                                     |
| `plaud-exporter/background.js`                       | 1k+   | Роутер `onMessage` и state machines в `background/*`                 |

## История и связанные документы

- [`docs/server-exporter-research.md`](./server-exporter-research.md) — обоснование портирования расширения в серверный
  CLI.
- [`docs/stabilization-audit.md`](./stabilization-audit.md), [`docs/stabilization-result.md`](./stabilization-result.md) — аудит и результат стабилизации (май 2026).
- [`docs/getting-started.md`](./getting-started.md) — установка и первый запуск.
- [`docs/server-deploy.md`](./server-deploy.md) — продакшен на VPS (systemd или Docker).
- [`deploy/README.md`](../deploy/README.md) — Docker, Ansible, rolling deploy из CI.
