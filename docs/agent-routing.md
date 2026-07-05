# Agent routing — куда идти за 60 секунд

Краткая карта для AI-агентов и разработчиков. Полные инварианты — [AGENTS.md](../AGENTS.md), детали — [ARCHITECTURE.md](./ARCHITECTURE.md).

## Sync и identity

| Задача                                          | Файл                                                                                                                | Не трогать                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Решение new/unchanged/metadata-only/re-download | [`syncCore.js`](../browser-extension/common/syncCore.js) `determineSyncAction`                                      | Дублировать логику в runner/extension     |
| Запись `sync-index.json`                        | [`syncRunner.js`](../server/src/sync/syncRunner.js) + [`serverSyncIndex.js`](../server/src/sync/serverSyncIndex.js) | Telegram, tree browse                     |
| Чтение индекса из бота                          | [`syncIndexRead.js`](../server/src/sync/syncIndexRead.js)                                                           | —                                         |
| `stableId` на server                            | [`stableIdentity.js`](../server/src/sync/stableIdentity.js)                                                         | Инлайнить `buildStableId` с разными title |
| Timestamp keys Plaud                            | [`syncCore.js`](../browser-extension/common/syncCore.js) `RECORDING_*_KEYS`                                         | Инлайнить массивы ключей                  |
| Top-level ошибки sync                           | [`syncFailureMapper.js`](../server/src/sync/syncFailureMapper.js)                                                   | `instanceof` в runner                     |

## Telegram

| Задача                              | Файл                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| Копия / HTML                        | [`telegram/messages/*`](../server/src/telegram/messages/)                           |
| Callback routing                    | [`handlers/callbacks.js`](../server/src/telegram/handlers/callbacks.js)             |
| Ручной/scheduled sync UX            | [`syncOrchestrator.js`](../server/src/telegram/syncOrchestrator.js)                 |
| Progress channel (throttle + draft) | [`sync/syncProgressChannel.js`](../server/src/telegram/sync/syncProgressChannel.js) |
| Tree quiet sync + document          | [`treeBrowseDelivery.js`](../server/src/telegram/treeBrowseDelivery.js)             |
| Tree data (без I/O)                 | [`treeBrowseOrchestrator.js`](../server/src/telegram/treeBrowseOrchestrator.js)     |
| HTTP transport / retry              | [`telegram/transport/*`](../server/src/telegram/transport/)                         |
| HTML/effect fallback                | [`htmlFallback.js`](../server/src/telegram/htmlFallback.js)                         |

## Browser extension

| Задача                | Файл                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `action` протокол     | [`runtimeMessages.js`](../browser-extension/common/runtimeMessages.js)                                                                        |
| SW message registry   | [`messageRouter.js`](../browser-extension/background/messageRouter.js) + [`background/handlers/*`](../browser-extension/background/handlers/) |
| Content handlers      | [`content/contentHandlers.js`](../browser-extension/content/contentHandlers.js)                                                               |
| Smart sync loop       | [`extensionSmartSync.js`](../browser-extension/features/audioExport/extensionSmartSync.js)                                                    |
| Smart sync per-file   | [`extensionSyncExecutor.js`](../browser-extension/features/audioExport/extensionSyncExecutor.js)                                              |
| Smart sync candidate  | [`extensionSyncCandidate.js`](../browser-extension/features/audioExport/extensionSyncCandidate.js)                                            |
| Plaud fetch retry     | [`plaudFetchRetry.js`](../browser-extension/features/audioExport/plaudFetchRetry.js)                                                          |
| Popup export polling  | [`exportStatusPolling.js`](../browser-extension/popup/exportStatusPolling.js)                                                                 |
| Popup export start UX | [`exportForegroundFlow.js`](../browser-extension/popup/exportForegroundFlow.js)                                                               |
| Popup DOM wiring      | [`popupExportUi.js`](../browser-extension/popup/popupExportUi.js) — только wiring                                                             |

## Проверки после правок

| Зона            | Команда                                                |
| --------------- | ------------------------------------------------------ |
| Server          | `npm test`                                             |
| Shared contract | `npm run verify` + оба `syncCore`/`plaud*` test suites |
| Extension       | `cd browser-extension && npm test`                     |
| Полный gate     | `npm run check`                                        |

## Оставшийся долг (низкий приоритет)

- [`plaudBrowserApi.js`](../browser-extension/features/audioExport/plaudBrowserApi.js) — title heuristics vs `plaudTitles.js`
- [`popupExportUi.js`](../browser-extension/popup/popupExportUi.js) — ~690 LOC wiring (helpers вынесены)
- [`telegramClient.js`](../server/src/telegram/telegramClient.js) — facade, transport уже отделён
- E2e popup — ручной smoke, CI нет

Не редактировать локальную копию `plaud-exporter/` — используйте `browser-extension/`.
