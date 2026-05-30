# AGENTS.md — карта репо для AI-агентов

Цель: за 60 секунд понять, **что трогать** и **что не трогать** при изменениях. Подробности —
в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Что это

Монорепозиторий с двумя средами выполнения и одним общим контрактом:

- `server/` — Node 20+ ESM CLI + Telegram-бот (long-polling). Точка входа: [`server/src/cli/index.js`](server/src/cli/index.js); бот: [`server/src/telegram/index.js`](server/src/telegram/index.js).
- `plaud-exporter/` — Chrome MV3 расширение. **Не** git-submodule, вендорный код в монорепо. Точки входа:
  `background.js`, `content.js`, `popup/`.
- `docs/`, `deploy/`, `scripts/` — документация, systemd/Docker/Ansible, верификация, `ci-deploy-remote.sh`.

Сервер **не** качает аудио (только саммари). Расширение — качает и то и другое.

## Shared контракт (5 файлов)

| Файл                                                                                       | Меняешь — обновляй                                                                                                                                       |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`plaud-exporter/common/syncCore.js`](plaud-exporter/common/syncCore.js)                   | Тесты в `plaud-exporter/tests/syncCore.test.js` **и** `server/tests/syncRunner*.test.js`                                                                 |
| [`plaud-exporter/common/exportPathUtils.js`](plaud-exporter/common/exportPathUtils.js)     | `plaud-exporter/tests/exportPathUtils.test.js` + `server/tests/filenamePlanner.test.js`                                                                  |
| [`plaud-exporter/common/plaudFolders.js`](plaud-exporter/common/plaudFolders.js)           | `plaud-exporter/tests/plaudFolders.test.js` + `server/tests/plaudFolders.test.js`                                                                        |
| [`plaud-exporter/common/plaudRecordingIds.js`](plaud-exporter/common/plaudRecordingIds.js) | `plaud-exporter/tests/plaudRecordingIds.test.js` + `server/tests/plaudRecordingIds.test.js`; consumers: `recordingsApi.js`, `plaudRecordingIdScraper.js` |
| [`plaud-exporter/common/plaudTitles.js`](plaud-exporter/common/plaudTitles.js)             | `plaud-exporter/tests/plaudTitles.test.js` + `server/tests/recordingsApi.test.js`; consumers: `recordingsApi.js`, `audioExport.js`, `summariesApi.js`    |

Список захардкожен в [`scripts/verify-submodule.js`](scripts/verify-submodule.js). `npm run verify` проверяет
существование файлов и что все относительные импорты `server/src/...` резолвятся.

Остальные `plaud-exporter/common/*` (`runtimeMessages.js`, `storageUtils.js`, `domUtils.js`, `uiComponents.js`,
`plaud-i18n-messages.js`) — **только** для расширения, server их не трогает. Модули `plaud-exporter/background/*` — тоже
только SW.

## Команды (из корня)

```bash
npm install              # ставит deps + pre-commit хук (simple-git-hooks)
npm run check            # единый umbrella: lint + typecheck + format:check
                         #   + lint:markdown + verify + verify:extension
                         #   + test + test:extension + smoke_container
npm run lint             # server eslint, --max-warnings 0
npm run lint:extension   # plaud-exporter eslint
npm run lint:markdown    # markdownlint-cli2 (docs/, README, AGENTS)
npm run typecheck        # JSDoc + tsc --checkJs (server + extension)
npm run format           # prettier --write
npm run format:check     # prettier --check (CI)
npm run verify           # shared common imports OK (server side)
npm run verify:extension # MV3 dynamic imports + manifest.json invariants
npm test                 # server tests (node:test)
npm run test:extension   # extension tests (alias: test:submodule)
npm run test:coverage    # lcov + thresholds (требует Node 22+)
```

Extension отдельно: `cd plaud-exporter && npm run lint && npm test && npm run verify`. CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) — матрица Node 20 + 22, переиспользует reusable [`.github/workflows/checks.yml`](.github/workflows/checks.yml) и параллельный [`.github/workflows/infra-lint.yml`](.github/workflows/infra-lint.yml) (actionlint/shellcheck/hadolint/markdownlint); [`.github/workflows/codeql.yml`](.github/workflows/codeql.yml) + [`.github/workflows/gitleaks.yml`](.github/workflows/gitleaks.yml) — security gate; [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) — образ GHCR + опциональный Docker deploy (
`PRODUCTION_DOCKER_DEPLOY`). Подробности и список required checks — в [docs/quality-gate.md](docs/quality-gate.md).

## Файлы, которые нельзя трогать целиком без плана

> Размер > 1k LOC. Любые правки — точечно, маленькими PR, чтобы не съесть весь контекст агента.

| Файл                                                                                                       | LOC   | Что в нём                                                                                      |
| ---------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------- |
| [`plaud-exporter/features/audioExport/audioExport.js`](plaud-exporter/features/audioExport/audioExport.js) | ~2.2k | Plaud HTTP в браузере + `runExportAll` + `runSmartSync`                                        |
| [`plaud-exporter/popup/popup.js`](plaud-exporter/popup/popup.js)                                           | ~1.9k | Весь UI попапа и его состояние                                                                 |
| [`plaud-exporter/background.js`](plaud-exporter/background.js)                                             | ~1k   | MV3 service worker: оркестрация export/sync (downloads — `background/chromeDownloadBridge.js`) |

Средние (500–600 LOC) тоже лучше править прицельно: [`server/src/telegram/messages/`](server/src/telegram/messages/) (
barrel: `messages.js`), [`server/src/telegram/vaultTree.js`](server/src/telegram/vaultTree.js), [`server/src/plaud/recordingsApi.js`](server/src/plaud/recordingsApi.js), [`server/src/sync/syncRunner.js`](server/src/sync/syncRunner.js), [`server/src/telegram/syncOrchestrator.js`](server/src/telegram/syncOrchestrator.js).

Streaming Telegram (draft/progress/typewriter): barrel [`streamingDelivery.js`](server/src/telegram/streamingDelivery.js) → [`streaming/draftChannel.js`](server/src/telegram/streaming/draftChannel.js), [`streaming/typewriter.js`](server/src/telegram/streaming/typewriter.js), [`streaming/loadingPulse.js`](server/src/telegram/streaming/loadingPulse.js).

## Telegram module map (server)

| Модуль                                                               | Назначение                                                              |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [`handlers.js`](server/src/telegram/handlers.js)                     | Barrel: `dispatchUpdate`, `ownerChatId`, re-export command parsers      |
| [`handlers/dispatch.js`](server/src/telegram/handlers/dispatch.js)   | `dispatchUpdate`, callback auth gate                                    |
| [`handlers/messages.js`](server/src/telegram/handlers/messages.js)   | `/start`, `/menu`, tree pick by number                                  |
| [`handlers/callbacks.js`](server/src/telegram/handlers/callbacks.js) | Inline button routing (`routeCallback`)                                 |
| [`handlers/menu.js`](server/src/telegram/handlers/menu.js)           | Main menu screens, interval settings                                    |
| [`handlers/filesTree.js`](server/src/telegram/handlers/filesTree.js) | Files menu, tree folder callbacks                                       |
| [`messages/menu.js`](server/src/telegram/messages/menu.js)           | Welcome, help, menu header copy                                         |
| [`messages/sync.js`](server/src/telegram/messages/sync.js)           | Sync progress, status, busy toasts                                      |
| [`messages/files.js`](server/src/telegram/messages/files.js)         | Tree/stats HTML, tree line formatting                                   |
| [`messages/settings.js`](server/src/telegram/messages/settings.js)   | Settings screen copy                                                    |
| [`messages/errors.js`](server/src/telegram/messages/errors.js)       | Tree/auto-sync error strings                                            |
| [`messages/format.js`](server/src/telegram/messages/format.js)       | `clipTelegramText`, `safeSliceHtml`, `TELEGRAM_HTML_MAX_LEN`            |
| [`plaudLiveTree.js`](server/src/telegram/plaudLiveTree.js)           | Live tree; **must** use `syncCore.buildStableId`                        |
| [`syncOrchestrator.js`](server/src/telegram/syncOrchestrator.js)     | Manual/scheduled sync UX bridge                                         |
| [`sync/syncIndexRead.js`](server/src/sync/syncIndexRead.js)          | Read-only sync-index API для tree browse (не писать индекс из telegram) |

## Где живёт что

| Хочешь поменять                                                             | Иди сюда                                                                                                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Решение sync (new / unchanged / metadata-only / re-download / disk restore) | [`syncCore.js`](plaud-exporter/common/syncCore.js) (`determineSyncAction`, `refineSyncActionForDisk`) + `serverSyncIndex.js`                |
| Имя файла, длина пути, санитизация                                          | [`exportPathUtils.js`](plaud-exporter/common/exportPathUtils.js) + `filenamePlanner.js`                                                     |
| Папки Plaud / Unfiled / Trash                                               | [`plaudFolders.js`](plaud-exporter/common/plaudFolders.js)                                                                                  |
| `action` popup ↔ SW ↔ content                                               | [`runtimeMessages.js`](plaud-exporter/common/runtimeMessages.js) + `tests/runtimeMessages.test.js`; литералы в `popup.js` / `content.js`    |
| Live tree stableId / merge с sync-index                                     | [`liveTreeReadModel.js`](server/src/plaud/liveTreeReadModel.js) (Telegram re-export: `plaudLiveTree.js`) + `syncCore.buildStableId`         |
| Plaud list parsing / mirror fan-out                                         | [`recordingsApi.js`](server/src/plaud/recordingsApi.js) + `recordingsApi.test.js`                                                           |
| ID записи Plaud (extract/normalize hex)                                     | [`plaudRecordingIds.js`](plaud-exporter/common/plaudRecordingIds.js)                                                                        |
| Telegram HTML clip                                                          | [`messages/format.js`](server/src/telegram/messages/format.js) — `clipTelegramText`                                                         |
| Tree browse / read sync-index                                               | [`syncIndexRead.js`](server/src/sync/syncIndexRead.js) + [`treeBrowse.js`](server/src/telegram/treeBrowse.js) (тесты: `treeBrowse.test.js`) |
| Sync UX в боте                                                              | [`syncOrchestrator.js`](server/src/telegram/syncOrchestrator.js) → `telegram/sync/syncRunBridge.js`, `syncProgressPresenter.js`             |
| Telegram callback + copy                                                    | [`handlers/callbacks.js`](server/src/telegram/handlers/callbacks.js) + [`messages/`](server/src/telegram/messages/) + `keyboards.js`        |
| Новая CLI команда                                                           | [`server/src/cli/index.js`](server/src/cli/index.js)                                                                                        |
| Новая env переменная                                                        | [`server/src/config/config.js`](server/src/config/config.js) + `.env.example` + `server/README.md`                                          |
| Классификация ошибки sync                                                   | [`errors/errorClassifier.js`](server/src/errors/errorClassifier.js) + `errorReporter.js` + exit codes в README                              |
| Один источник для CLI и бота при ошибках sync                               | [`sync/syncFailureMapper.js`](server/src/sync/syncFailureMapper.js) — паттерн «не дрейфуем»                                                 |

## Состояние на диске

| Путь                             | Назначение                                                                |
| -------------------------------- | ------------------------------------------------------------------------- |
| `server/.data/session.json`      | Plaud session (`chmod 600`)                                               |
| `server/.data/sync-index.json`   | sync index (atomic + `.bak`)                                              |
| `server/.data/status.json`       | Последний run для `server:status` и бота                                  |
| `server/.data/sync.lock`         | Файловый лок                                                              |
| `server/.data/owner-chat.json`   | Chat ID владельца бота                                                    |
| `server/.data/bot-settings.json` | Интервал автосинка                                                        |
| `{vault}/Plaud/...md`            | Саммари (поведение определено `PLAUD_MIRROR_FOLDERS` и `plaudFolders.js`) |
| `{vault}/_errors/*.md`           | Отчёты об ошибках                                                         |

Все JSON в `.data/` — `chmod 600`, директория `chmod 700`.

## Коды выхода CLI

`0` ок, `1` ошибки sync, `2` нет/битая сессия (или нет `TELEGRAM_BOT_TOKEN` для `bot`), `3` API Plaud изменился (
`PlaudChangedError`), `4` другой sync держит lock.

## Чего точно не делать

- Не качать аудио на сервере — `runSync` summary-only по дизайну (тест `syncAudioDefault.test.js`).
- Не запускать Playwright на VPS — auth только на Mac.
- Не дублировать решения sync в `audioExport.js` или `syncRunner.js` — они должны звать `determineSyncAction` из
  `syncCore.js`.
- Не вводить параллельные реализации логики папок — всё через `plaudFolders.js`.
- Не менять протокол `action` точечно: константа в [`runtimeMessages.js`](plaud-exporter/common/runtimeMessages.js),
  wiring в sender/handler, `npm test` в `plaud-exporter` (в т.ч. `runtimeMessages.test.js`).

## Backlog (вне текущего server-рефактора)

| Область                        | Файлы                                                      | Заметка                                                     |
| ------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------- |
| Extension god modules          | `audioExport.js`, `popup.js`, `background.js`              | Разбивать отдельными PR; popup может потребовать build step |
| ~~Title normalization shared~~ | —                                                          | Вынесено в `plaudTitles.js`                                 |
| Server splits                  | `syncOrchestrator.js`, `vaultTree.js`, `telegramClient.js` | Ниже приоритет, чем extension                               |
