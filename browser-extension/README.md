# Plaud.ai export — расширение Chrome

[![Manifest](https://img.shields.io/badge/Manifest-V3-green)](./manifest.json)
[![Version](https://img.shields.io/badge/version-1.0-blue)](./manifest.json)

Распакованное расширение Chrome (Manifest V3): экспорт аудио и AI-саммари из
**Plaud Web** (`https://web.plaud.ai/*`, `https://app.plaud.ai/*`) — пакетная
выгрузка, фоновые запуски и умная синхронизация без повторного скачивания
неизменённых записей.

Входит в монорепозиторий [plaud-server-exporter](https://github.com/ksandrpetrov/plaud-server-exporter):
шесть модулей `common/*` (sync, пути, папки, id, title, summary markdown) — формальный контракт server ↔ extension (см. [AGENTS.md](../AGENTS.md)).
Серверная выгрузка саммари на VPS — [docs/getting-started.md](../docs/getting-started.md).

## Обзор

Расширение подключает content script к страницам Plaud Web и сохраняет файлы через
`chrome.downloads`. Во всплывающем окне — сводка по архиву, действия для
**текущей открытой записи**, **полной библиотеки** и **фоновой умной синхронизации**
с постоянным индексом в `chrome.storage.local`.

Строки магазина по умолчанию на **русском** (`default_locale: "ru"` в
`manifest.json`). Интерфейс попапа переключается **RU / EN** (настройка в
`chrome.storage.sync`), темы: **как в системе / светлая / тёмная**.

## Возможности

- **Архив** — число записей и саммари, прогресс-маркер; **Обновить** может выполнять
  более тяжёлый пересчёт.
- **Текущая запись** — **аудио и саммари**, **только аудио** или **только саммари**
  для открытой на странице записи.
- **Все записи** — те же режимы для всей библиотеки; **экспорт в фоне** и **Стоп**.
- **Фоновая синхронизация** — подпапка в каталоге **Загрузки** Chrome (по умолчанию
  `PlaudExports/Sync`). Индекс в `chrome.storage.local` (`syncCore.js`: stable id,
  хеши, имена файлов) позволяет при повторных запусках **не дублировать**
  неизменённые записи; смена только названия или имени файла обновляет метаданные
  без повторной загрузки.
- **Безопасные имена** — разбор заголовков Markdown и санитизация
  (`common/exportPathUtils.js`).
- **Уведомления** — события из service worker для фоновых сценариев.

**Ограничение:** расширение не пишет в произвольный путь на диске — только
относительный путь внутри **Загрузок**. В попапе есть подсказка про **симлинк** на
macOS (например, в iCloud).

## Требования

- **Google Chrome** (или совместимый Chromium с поддержкой распакованных MV3).
- Авторизация на **Plaud Web**.

## Установка (режим разработчика)

1. Клонируйте репозиторий или скопируйте каталог `browser-extension/`.
2. Откройте `chrome://extensions/`.
3. Включите **Режим разработчика**.
4. **Загрузить распакованное расширение** — папка **`browser-extension/`** (где лежит
   `manifest.json`), не корень всего монорепозитория.

## Пользование попапом

1. Откройте **Plaud Web** на подходящей вкладке.
2. Нажмите иконку расширения.

| Раздел                    | Назначение                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------- |
| **Ваш архив**             | Сводная статистика; **Обновить** может занять время при полном пересчёте.              |
| **Текущая запись**        | Режимы экспорта только для **открытой** записи.                                        |
| **Фоновая синхронизация** | Папка в **Загрузках**, сохранение, **Синхронизировать в фоне**; открытие **Загрузок**. |
| **Все записи**            | Массовый экспорт, **Экспортировать в фоне**, **Стоп**.                                 |

Для полного экспорта в foreground вкладка Plaud должна оставаться доступной;
фоновые режимы — service worker и уведомления.

## Куда сохраняются файлы

Относительно каталога **Загрузки** Chrome (если пользователь не менял место
загрузок):

| Тип                 | Путь по умолчанию                                          |
| ------------------- | ---------------------------------------------------------- |
| Аудио               | `PlaudExports/Audio/`                                      |
| Саммари (Markdown)  | `PlaudExports/Summaries/`                                  |
| Умная синхронизация | Задаётся пользователем (по умолчанию `PlaudExports/Sync/`) |

## Разработка

| Команда          | Назначение                                                                   |
| ---------------- | ---------------------------------------------------------------------------- |
| `npm run lint`   | ESLint                                                                       |
| `npm test`       | Тесты Node (`tests/**/*.test.js`)                                            |
| `npm run verify` | Проверка путей динамических импортов (`scripts/verify-extension-imports.js`) |

## Структура проекта

```text
browser-extension/                 # эта папка — «Load unpacked» в Chrome
├── manifest.json
├── background.js              # MV3 service worker: оркестрация, onMessage, сессии export/sync
├── background/                # Модули SW (импортируются из background.js)
│   ├── bgLocale.js            # Локаль фоновых уведомлений
│   ├── chromeDownloadBridge.js # chrome.downloads (downloadPlaudFile)
│   └── tabMessaging.js        # tabs.sendMessage + re-inject content script
├── content.js                 # onMessage → audioExport; классические скрипты без import
├── popup/                     # UI попапа (HTML/CSS/JS + i18n)
├── common/
│   ├── exportPathUtils.js     # Пути, режимы, санитизация имён (shared)
│   ├── syncCore.js            # Индекс sync, hash, folderSegment, skip/updated (shared)
│   ├── plaudFolders.js        # Filetags Plaud, Unfiled/Trash (shared)
│   ├── plaudRecordingIds.js   # Нормализация id записей (shared)
│   ├── plaudTitles.js         # normalizeHumanTitle, TITLE_KEYS (shared)
│   ├── plaudSummaries.js      # stripPlaudInlineAssets для markdown (shared)
│   ├── runtimeMessages.js     # Константы action для popup ↔ SW ↔ content
│   ├── storageUtils.js        # chrome.storage + индекс sync
│   ├── domUtils.js            # DOM-хелперы для fallback
│   ├── plaud-i18n-messages.js # Каталоги сообщений popup / background
│   └── uiComponents.js        # Статусный UI на странице
├── features/
│   ├── audioExport/
│   │   ├── audioExport.js           # Plaud API, runExportAll, runSmartSync
│   │   ├── plaudBrowserSession.js   # JWT / workspace из localStorage
│   │   ├── plaudRecordingIdScraper.js # Сбор id записей (API + fallback)
│   │   ├── plaudCollisionPaths.js   # Имена файлов и коллизии в sync-папке
│   │   └── domExportFallback.js     # DOM-fallback при сбое list API
├── _locales/                  # Имя/описание расширения (en, ru)
├── tests/                     # в т.ч. runtimeMessages.test.js (протокол сообщений)
└── scripts/verify-extension-imports.js
```

Протокол `chrome.runtime` / `chrome.tabs` (`action: …`): реестр в
`common/runtimeMessages.js` (ESM в SW и `audioExport.js`). `popup.js` и
`content.js` — классические скрипты со строковыми литералами; тест
`tests/runtimeMessages.test.js` проверяет, что каждая константа из реестра
встречается в этих файлах дословно.

## Разрешения

В `manifest.json`: `activeTab`, `tabs`, `scripting`, `clipboardWrite`,
`notifications`, `downloads`, `storage`; доступ к `https://*.plaud.ai/*`.

## Отладка

- **Service worker:** `chrome://extensions/` → расширение → **service worker**
  (инструменты разработчика).
- **Content script / страница:** DevTools на вкладке Plaud → **Консоль**.

## Дисклеймер

Интерфейс и API Plaud Web могут меняться. После крупных обновлений сайта может
понадобиться правка DOM-fallback (`features/audioExport/domExportFallback.js`).
