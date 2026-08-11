# AGENTS.md — рабочий контракт репо для AI-агентов

## Цель файла

Это не документация ради документации, а **рабочий контракт** для AI-агентов и разработчиков. За 60 секунд он
должен дать ответ на вопросы: что в проекте можно трогать, что — только по отдельному решению, какие проверки
запускать и какие инварианты нельзя ломать.

Глубина и обоснования — в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), CI и required checks —
в [docs/quality-gate.md](docs/quality-gate.md), быстрый старт — в [README.md](README.md). AGENTS.md дублирует их
только в части инвариантов и маршрутизации; за деталями идём по ссылкам, а не копируем их сюда.

## Главные принципы

- Маленькое точечное изменение лучше широкого переписывания. Решает задачу — значит, достаточно.
- Сначала понять существующий код и найти готовое решение, потом менять. Не плодить параллельные реализации.
- Не ломать критичные бизнес-сценарии (раздел ниже) и публичное поведение без явного запроса.
- Не оставлять мёртвый код: удалил реализацию — удали её следы.
- UI/UX (Telegram-копия и popup расширения) меняем только по необходимости и консистентно.
- Любое изменение должно быть проверяемым: к нему есть команда проверки или ручной smoke.
- Стабильность продукта важнее «красивого» рефакторинга.

## Что это за проект

Монорепозиторий с двумя средами выполнения и одним общим контрактом:

- `server/` — Node 22+ ESM CLI + Telegram-бот (long-polling). Точка входа: [`server/src/cli/index.js`](server/src/cli/index.js); бот: [`server/src/telegram/index.js`](server/src/telegram/index.js).
- `browser-extension/` — Chrome MV3 расширение. **Не** git-submodule, вендорный код в монорепо. Точки входа:
  `background.js`, `content.js`, `popup/`.
- `docs/`, `deploy/`, `scripts/` — документация, systemd/Docker/Ansible, верификация, `ci-deploy-remote.sh`.

Сервер **не** качает аудио (только саммари). Расширение — качает и то и другое.

## Структура проекта: зоны, что можно и что осторожно

| Зона                                            | Назначение                                   | Можно менять                | Осторожно (нужен план)               | После изменений                                                    |
| ----------------------------------------------- | -------------------------------------------- | --------------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| `server/src/sync/`                              | runSync, lock, filename planner, index write | точечно по задаче           | `syncRunner.js` (~500 LOC)           | `npm test`; при правке shared — `npm run verify` + extension tests |
| `server/src/plaud/`                             | Plaud HTTP, folders, live tree               | точечно                     | `recordingsApi.js` (~500 LOC)        | `npm test` (`recordingsApi.test.js`, `plaudLiveTree.test.js`)      |
| `server/src/telegram/`                          | бот: handlers/messages/scheduler             | `handlers/*` и `messages/*` | `syncOrchestrator.js`, `streaming/*` | `telegram*.test.js`, `syncOrchestrator.test.js`                    |
| `server/src/{auth,errors,config,security}/`     | сессия, классификация ошибок, env            | по задаче                   | контракт session/status.json         | `npm test`                                                         |
| `browser-extension/common/` (7 shared)          | контракт server ↔ extension                  | только с двойными тестами   | любой из 7 файлов                    | `npm run verify` + оба набора тестов                               |
| `browser-extension/{popup,background,features}` | UI попапа и service worker                   | точечно                     | god modules (см. ниже)               | `npm run test:extension`, `npm run verify:extension`               |
| `deploy/`, `scripts/`, `.github/`               | инфраструктура и CI                          | по задаче                   | CI/deploy, ordering-тесты            | `infra-lint` + ручной smoke по PR-шаблону                          |

### Shared контракт (7 файлов)

Формальный контракт между server и extension. Меняешь один — обновляешь оба consumer'а и **оба** набора тестов.

| Файл | Меняешь — обновляй |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [`browser-extension/common/syncCore.js`](browser-extension/common/syncCore.js) | Тесты в `browser-extension/tests/syncCore.test.js` **и** `server/tests/syncRunner*.test.js` |
| [`browser-extension/common/exportPathUtils.js`](browser-extension/common/exportPathUtils.js) | `browser-extension/tests/exportPathUtils.test.js` + `server/tests/filenamePlanner.test.js` |
| [`browser-extension/common/plaudFolders.js`](browser-extension/common/plaudFolders.js) | `browser-extension/tests/plaudFolders.test.js` + `server/tests/plaudFolders.test.js` |
| [`browser-extension/common/plaudRecordingIds.js`](browser-extension/common/plaudRecordingIds.js) | `browser-extension/tests/plaudRecordingIds.test.js` + `server/tests/plaudRecordingIds.test.js`; consumers: `recordingsApi.js`, `plaudRecordingIdScraper.js` |
| [`browser-extension/common/plaudTitles.js`](browser-extension/common/plaudTitles.js) | `browser-extension/tests/plaudTitles.test.js` + `server/tests/recordingsApi.test.js`; consumers: `recordingsApi.js`, `audioExport.js`, `summariesApi.js` |
| [`browser-extension/common/plaudSummaries.js`](browser-extension/common/plaudSummaries.js) | `browser-extension/tests/plaudSummaries.test.js` + `server/tests/plaudApiClient.test.js`; consumers: `summariesApi.js`, `audioExport.js` |
| [`browser-extension/common/plaudRecordings.js`](browser-extension/common/plaudRecordings.js) | Парсинг `/file/simple/web`, pagination, ingest/fan-out, нормализация записей | `browser-extension/tests/plaudRecordings.test.js` + `server/tests/recordingsApi.test.js`; consumers: `recordingsApi.js`, `audioExport.js` |

Список захардкожен в [`scripts/verify-shared-contract.js`](scripts/verify-shared-contract.js). `npm run verify` проверяет
существование файлов и что все относительные импорты `server/src/...` резолвятся.

Остальные `browser-extension/common/*` (`runtimeMessages.js`, `storageUtils.js`, `uiComponents.js`,
`plaud-i18n-messages.js`) — **только** для расширения, server их не трогает. Модули `browser-extension/background/*` — тоже
только SW.

### Файлы, которые нельзя трогать целиком без плана

> Размер > 1k LOC. Любые правки — точечно, маленькими PR, чтобы не съесть весь контекст агента.

| Файл                                                                                                                     | LOC  | Что в нём                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| [`browser-extension/popup/popupExportUi.js`](browser-extension/popup/popupExportUi.js)                                   | ~690 | DOM wiring; pure helpers — `exportStatusFormat.js`, `exportControls.js`, `exportStatusPolling.js`, `exportForegroundFlow.js` |
| [`browser-extension/features/audioExport/plaudBrowserApi.js`](browser-extension/features/audioExport/plaudBrowserApi.js) | ~490 | Plaud HTTP; retry — `plaudFetchRetry.js`                                                                                     |
| [`browser-extension/common/syncCore.js`](browser-extension/common/syncCore.js)                                           | ~560 | Shared sync contract                                                                                                         |

Уже разбиты (точечные правки): `audioExport.js` (barrel), `popup.js` (~60), `background.js` (~130), `messageRouter.js` (registry + `background/handlers/*`), `content.js` + `content/contentHandlers.js`, `extensionSmartSync.js` → `extensionSyncCandidate.js` + `extensionSyncExecutor.js`.

Средние (400–500 LOC) на server: [`telegram/telegramClient.js`](server/src/telegram/telegramClient.js) (facade; transport — `telegram/transport/*`), [`telegram/messages/`](server/src/telegram/messages/), [`plaud/recordingsApi.js`](server/src/plaud/recordingsApi.js), [`telegram/syncOrchestrator.js`](server/src/telegram/syncOrchestrator.js). `syncRunner.js` ~300 LOC.

Streaming Telegram (draft/progress/thinking): barrel [`streamingDelivery.js`](server/src/telegram/streamingDelivery.js) → [`streaming/draftChannel.js`](server/src/telegram/streaming/draftChannel.js) + [`streaming/draftAvailability.js`](server/src/telegram/streaming/draftAvailability.js), progress — [`sync/syncProgressChannel.js`](server/src/telegram/sync/syncProgressChannel.js), tree delivery — [`treeBrowseDelivery.js`](server/src/telegram/treeBrowseDelivery.js). API fallback markers — [`apiFallback.js`](server/src/telegram/apiFallback.js).

Быстрая маршрутизация для агентов: [docs/agent-routing.md](docs/agent-routing.md).

### Telegram module map (server)

| Модуль                                                                               | Назначение                                                              |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [`handlers.js`](server/src/telegram/handlers.js)                                     | Barrel: `dispatchUpdate`, re-export command parsers                     |
| [`handlers/dispatch.js`](server/src/telegram/handlers/dispatch.js)                   | `dispatchUpdate`, callback auth gate                                    |
| [`handlers/privateUpdateGate.js`](server/src/telegram/handlers/privateUpdateGate.js) | `guardAuthorizedPrivateUpdate` — private chat + allowed sender          |
| [`handlers/inboundMessages.js`](server/src/telegram/handlers/inboundMessages.js)     | `/start`, `/menu`, tree pick by number (inbound text)                   |
| [`handlers/callbacks.js`](server/src/telegram/handlers/callbacks.js)                 | Inline button routing (`routeCallback`)                                 |
| [`handlers/menu.js`](server/src/telegram/handlers/menu.js)                           | Main menu screens, interval settings                                    |
| [`handlers/filesTree.js`](server/src/telegram/handlers/filesTree.js)                 | Files menu, tree folder callbacks                                       |
| [`messages/menu.js`](server/src/telegram/messages/menu.js)                           | Welcome, help, menu header copy                                         |
| [`messages/sync.js`](server/src/telegram/messages/sync.js)                           | Sync progress, status, busy toasts                                      |
| [`messages/files.js`](server/src/telegram/messages/files.js)                         | Tree/stats HTML, tree line formatting                                   |
| [`messages/settings.js`](server/src/telegram/messages/settings.js)                   | Settings screen copy                                                    |
| [`messages/errors.js`](server/src/telegram/messages/errors.js)                       | Tree/auto-sync error strings                                            |
| [`messages/format.js`](server/src/telegram/messages/format.js)                       | `clipTelegramText`, `safeSliceHtml`, `TELEGRAM_HTML_MAX_LEN`            |
| [`liveTreeReadModel.js`](server/src/plaud/liveTreeReadModel.js)                      | Live tree read model; **must** use `syncCore.buildStableId`             |
| [`syncOrchestrator.js`](server/src/telegram/syncOrchestrator.js)                     | Manual/scheduled sync UX bridge                                         |
| [`sync/syncIndexRead.js`](server/src/sync/syncIndexRead.js)                          | Read-only sync-index API для tree browse (не писать индекс из telegram) |

### Где живёт что

| Хочешь поменять                                                             | Иди сюда                                                                                                                                                         |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Решение sync (new / unchanged / metadata-only / re-download / disk restore) | [`syncCore.js`](browser-extension/common/syncCore.js) (`determineSyncAction`, `refineSyncActionForDisk`) + `serverSyncIndex.js`                                  |
| Имя файла, длина пути, санитизация                                          | [`exportPathUtils.js`](browser-extension/common/exportPathUtils.js) + `filenamePlanner.js`                                                                       |
| Папки Plaud / Unfiled / Trash                                               | [`plaudFolders.js`](browser-extension/common/plaudFolders.js)                                                                                                    |
| Context резолва папок для API/live tree                                     | [`plaud/folderResolution.js`](server/src/plaud/folderResolution.js) — `buildFolderResolutionContext` (не инлайнить три вызова заново)                            |
| `action` popup ↔ SW ↔ content                                               | [`runtimeMessages.js`](browser-extension/common/runtimeMessages.js) + `tests/runtimeMessages.test.js`; литералы в `popup.js` / `content.js`                      |
| Live tree stableId / merge с sync-index                                     | [`liveTreeReadModel.js`](server/src/plaud/liveTreeReadModel.js) + [`stableIdentity.js`](server/src/sync/stableIdentity.js)                                       |
| Plaud list parsing / mirror fan-out                                         | [`plaudRecordings.js`](browser-extension/common/plaudRecordings.js) + runtime HTTP in [`recordingsApi.js`](server/src/plaud/recordingsApi.js) / `audioExport.js` |
| ID записи Plaud (extract/normalize hex)                                     | [`plaudRecordingIds.js`](browser-extension/common/plaudRecordingIds.js)                                                                                          |
| Telegram HTML clip                                                          | [`messages/format.js`](server/src/telegram/messages/format.js) — `clipTelegramText`                                                                              |
| Tree browse / read sync-index                                               | [`syncIndexRead.js`](server/src/sync/syncIndexRead.js) + [`treeBrowse.js`](server/src/telegram/treeBrowse.js) (тесты: `treeBrowse.test.js`)                      |
| Sync UX в боте                                                              | [`syncOrchestrator.js`](server/src/telegram/syncOrchestrator.js) → `syncRunBridge`, `syncProgressChannel`, `syncProgressPresenter`                               |
| Telegram callback + copy                                                    | [`handlers/callbacks.js`](server/src/telegram/handlers/callbacks.js) + [`messages/`](server/src/telegram/messages/) + `keyboards.js`                             |
| Новая CLI команда                                                           | [`server/src/cli/index.js`](server/src/cli/index.js)                                                                                                             |
| Новая env переменная                                                        | [`server/src/config/config.js`](server/src/config/config.js) + `.env.example` + `server/README.md`                                                               |
| Классификация ошибки sync                                                   | [`errors/errorClassifier.js`](server/src/errors/errorClassifier.js) + `errorReporter.js` + exit codes в README                                                   |
| Один источник для CLI и бота при ошибках sync                               | [`sync/syncFailureMapper.js`](server/src/sync/syncFailureMapper.js) — `classifySyncFailure`, `mapSyncFailureToBotOutcome`, `recordAuthFailureIfNeeded`           |
| Загрузка Plaud session из snapshot                                          | [`auth/loadPlaudSession.js`](server/src/auth/loadPlaudSession.js) — CLI, bot, live tree                                                                          |
| Запись `status.json`                                                        | [`sync/syncStatusWriter.js`](server/src/sync/syncStatusWriter.js) — `lastAuthError` всегда `{ message, at }`                                                     |
| Чтение `status.json`                                                        | [`sync/statusReader.js`](server/src/sync/statusReader.js) — CLI, бот, scheduler; schema — [`sync/statusSchema.js`](server/src/sync/statusSchema.js)              |
| Timestamp полей записи Plaud                                                | [`plaud/recordingTimestamps.js`](server/src/plaud/recordingTimestamps.js) — sync runner + live tree                                                              |
| Список `.data/` JSON-файлов                                                 | [`config/config.js`](server/src/config/config.js) — `DATA_STATE_FILE_NAMES`; diagnostics — `persistenceDiagnostics.js`                                           |

### Состояние на диске

| Путь                                | Назначение                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `server/.data/session.json`         | Plaud session (`chmod 600`)                                                               |
| `server/.data/sync-index.json`      | sync index (atomic + `.bak`)                                                              |
| `server/.data/status.json`          | Последний run для `server:status` и бота                                                  |
| `server/.data/sync.lock`            | Файловый лок                                                                              |
| `server/.data/owner-chat.json`      | Chat ID владельца бота                                                                    |
| `server/.data/bot-settings.json`    | Интервал автосинка + `scheduledSummaryVisible` (default `false` — автосинк молчит в чате) |
| `server/.data/telegram-offset.json` | Offset long-poll                                                                          |
| `server/.data/tree-browse.json`     | Per-chat browse state для pick-by-number (TTL 30 мин)                                     |
| `{vault}/Plaud/...md`               | Саммари (поведение определено `PLAUD_MIRROR_FOLDERS` и `plaudFolders.js`)                 |
| `{vault}/_errors/*.md`              | Отчёты об ошибках                                                                         |

Все JSON в `.data/` — `chmod 600`, директория `chmod 700`.

### Коды выхода CLI

`0` ок, `1` ошибки sync, `2` нет/битая сессия (или нет `TELEGRAM_BOT_TOKEN` для `bot`), `3` API Plaud изменился (
`PlaudChangedError`), `4` другой sync держит lock. Telegram-бот свой exit code не использует — `syncOrchestrator`
маппит ошибки в HTML и не пробрасывает throw наружу.

## Архитектурные правила

Где живёт бизнес-логика и какие границы нельзя нарушать:

- **Решение sync** (new / unchanged / metadata-only / re-download / disk restore) — только в
  `syncCore.determineSyncAction` / `refineSyncActionForDisk`. **Нельзя** дублировать эту логику в `audioExport.js`
  или `syncRunner.js`; они её вызывают, а не повторяют.
- **Логика папок Plaud / Unfiled / Trash** — только через `plaudFolders.js`; общий context для трёх call sites — через
  `folderResolution.js`. Не вводить параллельные реализации и не инлайнить резолв заново.
- **Запись `sync-index.json`** — только `syncRunner` / `serverSyncIndex` (`saveSyncIndex`). Telegram и tree browse
  читают через `syncIndexRead.js` (read-only) — из бота индекс не писать.
- **`status.json`**: запись — `syncStatusWriter`, чтение — `statusReader`, нормализация полей — `statusSchema`.
  `lastAuthError` всегда имеет форму `{ message, at }`.
- **Plaud session**: грузится через `loadPlaudSession` (CLI, бот, live tree). Snapshot сессии (Playwright) создаётся
  **только на Mac** — на VPS Playwright не запускаем.
- **Server summary-only**: `runSync` не качает аудио и не зовёт `/file/temp-url` (тест `syncAudioDefault.test.js`).
  Аудио — только Chrome-расширение.
- **Ошибки sync**: per-file/per-stage — `errorClassifier` → `errorReporter`; top-level (lock/auth/plaud_changed/exit
  code) — `syncFailureMapper`. Не глотать throws в `syncOrchestrator` молча и не подменять понятную ошибку на generic.
- **Протокол `action`** между popup ↔ SW ↔ content — константа в `runtimeMessages.js`, wiring в sender/handler в том же
  PR, литералы сверяет `runtimeMessages.test.js`.
- **Чего в репо нет и не вводим**: БД, очередей, публичного HTTP API (всё на файлах); Playwright на VPS; параллельный
  sync на одном vault с разных машин (`runLock` локальный для хоста).

## Правила изменений для AI-агентов

- Не делать масштабный рефакторинг без прямого запроса. Решает задачу минимальный diff — этого достаточно.
- Не менять публичное поведение (CLI exit codes, формат `.md`, копию бота, протокол `action`) без явного запроса.
- Не добавлять зависимости без необходимости. Сначала искать готовое в репо.
- Не создавать новый паттерн, если уже есть существующий (sync-решения, папки, ошибки, session, status — см. выше).
- Не дублировать код: расширяй существующие функции вместо копий.
- Не оставлять временный/закомментированный код и compatibility-слои без причины.
- Не маскировать ошибки пустыми `catch` и не заменять конкретную ошибку на generic.
- Не удалять код без проверки usages (`grep`/поиск ссылок + тесты).
- Не переформатировать весь проект ради одного изменения: prettier/eslint только на затронутое.

## Мёртвый код

- Заменил реализацию — удали старую в том же PR.
- Перед удалением проверь usages по всему репо (оба пакета: `server/` и `browser-extension/`) и прогони тесты.
- Удаляй неиспользуемые импорты, функции, классы, компоненты, CSS-классы и конфиги.
- Не оставляй закомментированный код — это git history.
- `TODO` допустим только с причиной и понятным следующим действием; без владельца/причины — не добавлять.
- Если код выглядит мёртвым, но есть сомнение — **не удалять молча**, а отметить в финальном отчёте.

## Критичные бизнес-сценарии

Короткие business invariants (из тестов и README). Что не должно ломаться и минимальная проверка после правок в зоне.

| Сценарий                          | Что не должно ломаться                                                | Какие зоны участвуют                                                                                           | Минимальная проверка                                                                       |
| --------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Auth на Mac → session на VPS      | re-auth UX, `session.json` `chmod 600`, exit `2` без сессии           | `auth/playwrightAuth.js`, `loadPlaudSession.js`, `sessionStore.js`                                             | `loadPlaudSession.test.js`, `sessionParser.test.js`; ручной `server:auth` при правках auth |
| CLI sync саммари → vault          | new / skip unchanged / content update / rename-only, atomic index     | `syncRunner.js`, `syncCore.js`, `obsidianWriter.js`, `serverSyncIndex.js`                                      | `syncRunner.integration.test.js`; при правке shared — `syncCore.test.js`                   |
| Server summary-only               | `runSync` не качает аудио (нет `/file/temp-url`)                      | `syncRunner.js`                                                                                                | `syncAudioDefault.test.js`                                                                 |
| Lock / busy                       | параллельный sync → exit `4` / «занят» в боте; dry-run обходит lock   | `sync/runLock.js`, `syncFailureMapper.js`, `syncOrchestrator.js`                                               | `syncRunner.errors.test.js`, `syncOrchestrator.test.js`                                    |
| Plaud API изменился               | exit `3`, отчёт в `_errors/`                                          | `recordingsApi.js`, `plaudApiClient.js`, `errorClassifier.js`                                                  | `syncRunner.errors.test.js`, `recordingsApi.test.js`                                       |
| Telegram owner-only + ручной sync | только владелец; чужие/группы молча игнор; progress → итог            | `privateUpdateGate.js`, `dispatch.js`, `syncOrchestrator.js`, streaming/\*                                     | `telegramAuth.test.js`, `telegramDispatch.test.js`, `syncOrchestrator.test.js`             |
| Автосинк по расписанию            | интервал, по умолчанию молчит в чат (`scheduledSummaryVisible=false`) | `scheduler.js`, `botSettings.js`, `syncOrchestrator.js`                                                        | `scheduler.test.js`, `botSettings.test.js`                                                 |
| Files tree pick-by-number         | stableId, отдать `.md`, тихий resync при отсутствии файла             | `treeBrowse.js`, `treeBrowseOrchestrator.js`, `liveTreeReadModel.js`, `syncIndexRead.js`, `treeBrowseState.js` | `treeBrowse.test.js`, `plaudLiveTree.test.js`, `treeBrowseState.test.js`                   |
| Extension smart sync              | skip unchanged, metadata-only rename; lock от параллельных прогонов   | `features/audioExport/audioExport.js`, `common/syncCore.js`, `content.js`                                      | `browser-extension/tests/syncCore.test.js`, `runtimeMessages.test.js`; ручной smoke попапа |
| status.json последний run         | schema, `lastAuthError` `{ message, at }`, merge без потери stats     | `syncStatusWriter.js`, `statusReader.js`, `statusSchema.js`                                                    | `syncStatusWriter.test.js`, `statusReader.test.js`                                         |

TODO: уточнить — у части браузерных сценариев нет авто-покрытия: e2e попапа/`content.js` в CI отсутствует;
`exportOrchestrator` keep-alive chain покрыт unit-тестом `tryStartKeepAliveChain`; полный MV3 timer smoke — ручной.

## UI/UX инварианты

Дизайн-системы как отдельного пакета нет; источники истины — два. Любые UI-изменения должны быть минимальными,
консистентными существующим компонентам и проверенными на основных сценариях.

### Telegram-бот (server)

- Копия — только в `telegram/messages/*`, кнопки — в `keyboards.js`, routing — в `handlers/callbacks.js`. Не вшивать
  тексты в обработчики.
- HTML обрезаем через `clipTelegramText` / `TELEGRAM_HTML_MAX_LEN` (`messages/format.js`) — не превышать лимит Telegram
  и не слать «битый» HTML.
- Не ломать streaming-доставку (`streamingDelivery` → draft/thinking/loadingPulse): прогресс-сообщение редактируется,
  а не плодит новые.
- Сохранять ActionGuard/cooldown (`actionGuard.js`): двойной тап и повтор сразу после успеха блокируются.
- Не менять тексты/кнопки без задачи.

### Расширение (popup)

- Цвета, отступы, скругления, тени — только через токены и компоненты в [`popup/popup.css`](browser-extension/popup/popup.css)
  (HSL-переменные `--primary`/`--muted`/`--destructive`/`--success`/`--radius`, классы `.card`/`.btn-*`/`.alert`/
  `.badge`). Не вводить случайные цвета/отступы/шрифты.
- Plaud-вкладка обязательна для export/sync/current; без неё показывается offline-панель. Не ломать взаимное исключение
  (`updateExportControls`): во время export/sync/refresh кнопки заблокированы.
- Текст — через `data-i18n` + `PlaudI18n` (ru/en, RU по умолчанию). Тема Auto/Light/Dark. Не хардкодить строки.
- Сохранять состояния: offline-панель, загрузка/offline статистики, баннер экспорта с прогрессом, строки sync-статуса.
- Подробности UX попапа — [`browser-extension/README.md`](browser-extension/README.md).

## Команды проверки

Из корня репо.

```bash
# Установка (ставит deps + pre-commit хук simple-git-hooks)
npm install
cd browser-extension && npm install && cd ..

# Полный gate (= то, что гоняет CI)
npm run check            # lint + lint:extension + typecheck + format:check
                         #   + lint:markdown + verify + verify:extension
                         #   + test + test:extension + smoke_container
```

Точечно (дешевле, когда менял один пакет):

```bash
# Только server
npm test                 # node:test
npm run lint             # eslint server, --max-warnings 0
npm run typecheck:server # JSDoc + tsc --checkJs (server)
npm run verify           # shared common imports OK

# Только extension
cd browser-extension && npm run lint && npm test && npm run verify

# Остальные umbrella-шаги при необходимости
npm run typecheck        # server + extension
npm run format:check     # prettier --check (как в CI)
npm run lint:markdown    # markdownlint-cli2 (docs/, README, AGENTS)
npm run test:coverage    # lcov + thresholds (требует Node 22+)
```

Запуск приложения:

```bash
npm run server:auth      # Mac only: вход в Plaud (Playwright)
npm run server:sync      # разовая выгрузка саммари
npm run server:status    # конфиг и сессия
npm run server:bot       # Telegram-бот (VPS / локальная проверка)
node server/src/cli/index.js logout   # выход из сессии
```

Docker smoke (опционально, нужен Docker):

```bash
node scripts/smoke_container.mjs       # резолв критичных импортов
bash scripts/docker-smoke-image.sh     # build + smoke run образа
```

Pre-commit (`simple-git-hooks` + `lint-staged`) ставится при `npm install` и гоняет prettier/eslint/verify на
изменённые файлы — он **не** заменяет `npm run check` перед PR. CI и required checks —
в [docs/quality-gate.md](docs/quality-gate.md). Автотестов e2e/браузерных в репо нет — не выдумывать; вместо них
ручной smoke по [PR-шаблону](.github/PULL_REQUEST_TEMPLATE.md).

## Минимальный чеклист перед сдачей изменения

- [ ] Изменение точечное, не шире задачи.
- [ ] Архитектурные границы не нарушены (sync-решения / папки / index write / status / session / ошибки).
- [ ] Мёртвый код не оставлен (старая реализация удалена, импорты/usages проверены).
- [ ] Критичные бизнес-сценарии в затронутой зоне не сломаны.
- [ ] UI/UX (Telegram-копия, popup) не деградировал; изменения консистентны.
- [ ] Прогнаны нужные проверки: `npm run check` или точечный набор по пакету.
- [ ] Новые зависимости не добавлены без причины.
- [ ] Ошибки не замаскированы, понятные ошибки не подменены на generic.
- [ ] Документация обновлена только там, где нужно (включая этот файл при изменении контракта).

## Правила отчёта после работы

В финальном сообщении агент даёт короткий отчёт:

- **Что изменено** — суть, не «обновил файл X».
- **Почему** — связь с задачей/инвариантом.
- **Затронутые файлы** — список.
- **Запущенные проверки** — какие команды и результат.
- **Не удалось запустить** — что и почему (нет Docker, нет сессии, Mac-only auth и т.п.).
- **Оставшиеся риски** — что стоит перепроверить.
- **Подозрение на мёртвый код** — если есть сомнение, но удалять не стал.
- **Проверенные бизнес/UI-сценарии** — что подтверждено тестами или ручным smoke.

## Backlog (низкий приоритет)

| Область       | Файлы                               | Заметка                                   |
| ------------- | ----------------------------------- | ----------------------------------------- |
| Popup wiring  | `popupExportUi.js` (~690 LOC)       | Helpers вынесены; дальше только по задаче |
| Server facade | `telegramClient.js`, `vaultTree.js` | Transport/orchestration уже разбиты       |

~~Extension god modules~~, ~~server progress dual path~~, ~~stableId drift~~, ~~title heuristics drift~~, ~~getExportModeLabel triple copy~~ — закрыто в architecture pass 2026-07 (см. [stabilization-result.md](docs/stabilization-result.md)).
