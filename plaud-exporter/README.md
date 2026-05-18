# Plaud.ai export — Chrome extension

[![Manifest](https://img.shields.io/badge/Manifest-V3-green)](./manifest.json)
[![Version](https://img.shields.io/badge/version-1.0-blue)](./manifest.json)

Unpacked Chrome extension (Manifest V3) that exports audio and AI summaries from **Plaud Web** (`https://web.plaud.ai/*`, `https://app.plaud.ai/*`): batch export, optional background runs, and a smart sync mode that avoids re-downloading unchanged recordings.

---

## English

### Overview

The extension injects a content script into Plaud Web pages and coordinates downloads through `chrome.downloads`. The popup shows archive statistics, actions for the **currently open recording**, **full-library export**, and **background smart sync** with a persistent index in `chrome.storage.local`.

Default locale for store strings is **Russian** (`manifest.json` → `default_locale: "ru"`); the popup can switch UI language between **RU** and **EN** (stored in `chrome.storage.sync`) and supports **system / light / dark** themes.

### Features

- **Archive snapshot** — recording and summary counts plus milestone UI in the popup (refresh may trigger a fuller recount).
- **Current recording** — export **audio + summary**, **audio only**, or **summary only** for the item open on the page.
- **All recordings** — same modes for the whole library; optional **export in background** while you use other tabs; **Stop** for active runs.
- **Smart background sync** — configurable subfolder under the browser **Downloads** directory (default `PlaudExports/Sync`). Stores a sync index (stable ids, hashes, filenames, status) so later runs **skip unchanged** items instead of duplicating files.
- **Safe paths** — summaries use Markdown-aware title extraction and sanitized filenames (`common/exportPathUtils.js`).
- **Notifications** — status events from the service worker (aligned with background export / sync).

**Limitation:** Extensions cannot write to arbitrary filesystem paths. Downloads go under **Downloads** + relative path (see popup hint). On macOS the UI documents an optional **symlink** into iCloud or another folder.

### Requirements

- **Google Chrome** (Chromium-based browsers that support unpacked MV3 extensions).
- A logged-in session on **Plaud Web**.

### Install (developer / unpacked)

1. Clone or copy this repository.
2. Open `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the project root (folder containing `manifest.json`).

### Using the popup

1. Open **Plaud Web** and stay on a matching tab.
2. Click the extension icon.

**Sections**

| Area | What it does |
|------|----------------|
| **Your archive** | High-level stats; **Refresh** may take longer if it recomputes summaries. |
| **Current recording** | Export modes for the **open** recording only. |
| **Background sync** | Set **folder under Downloads** (e.g. `PlaudExports/Sync`), save, then **Sync in background**. Opens **Downloads** folder helper. |
| **All recordings** | Bulk export modes + **Export in background** + **Stop**. |

Foreground bulk export expects the Plaud tab to stay alive for the session; background modes rely on the service worker + notifications.

### Where files are saved

Relative to **Downloads** (unless the user changed Chrome’s download location):

| Kind | Default relative path |
|------|------------------------|
| Audio | `PlaudExports/Audio/` |
| Summaries (Markdown) | `PlaudExports/Summaries/` |
| Smart sync | User-defined (default `PlaudExports/Sync/`) |

### Development

| Command | Purpose |
|---------|---------|
| `npm run lint` | ESLint |
| `npm test` | Node built-in test runner (`tests/**/*.test.js`) |
| `npm run verify` | Ensures dynamic import paths reference real files (`scripts/verify-extension-imports.js`) |

### Project layout

```
plaud-exporter/
├── manifest.json
├── background.js              # MV3 service worker (exports, sync, notifications, session)
├── content.js                 # Entry; loads feature modules
├── popup/                     # Popup UI (HTML/CSS/JS + i18n bridge)
├── common/
│   ├── exportPathUtils.js     # Paths, modes, filename sanitization
│   ├── syncCore.js            # Sync index, hashing, skip/updated semantics
│   ├── storageUtils.js        # chrome.storage helpers + sync index load/save
│   ├── domUtils.js            # DOM helpers for fallback flows
│   ├── plaudRecordingIds.js   # Recording id normalization
│   ├── plaud-i18n-messages.js # Popup / background message catalogs
│   └── uiComponents.js        # On-page status UI
├── features/
│   ├── audioExport/           # API + DOM fallback export pipeline
│   └── elementSelector/       # Selector helpers for Plaud DOM
├── _locales/                  # Extension name/description (en, ru)
├── tests/                     # Unit tests
└── scripts/verify-extension-imports.js
```

### Permissions (summary)

Declared in `manifest.json`: `activeTab`, `tabs`, `scripting`, `clipboardWrite`, `notifications`, `downloads`, `storage`; host access `https://*.plaud.ai/*`.

### Debugging

- **Service worker:** `chrome://extensions/` → this extension → **Service worker** (inspect).
- **Content script / page:** DevTools on the Plaud tab → **Console**.

### Disclaimer

Plaud Web’s DOM and APIs can change. Selector-heavy fallbacks (`features/audioExport/domExportFallback.js`, `elementSelector/`) may need updates after major site redesigns.

---

## Русский

### Обзор

Расширение для Chrome (Manifest V3) подключает content script к страницам **Plaud Web** и сохраняет аудио и текстовые саммари через `chrome.downloads`. Во всплывающем окне доступны сводка по архиву, экспорт **текущей записи**, **полный экспорт библиотеки** и **умная фоновая синхронизация** с индексом в `chrome.storage.local`.

Строки для магазина по умолчанию на **русском** (`default_locale: "ru"` в `manifest.json`). Интерфейс попапа переключается **RU / EN** (настройка в `chrome.storage.sync`), поддерживаются темы **как в системе / светлая / тёмная**.

### Возможности

- **Архив** — число записей и саммари, прогресс-маркер; кнопка **Обновить** может выполнять более тяжёлый пересчёт.
- **Текущая запись** — **аудио и саммари**, **только аудио** или **только саммари** для открытой на странице записи.
- **Все записи** — те же режимы для всей библиотеки; **экспорт в фоне** и кнопка **Стоп**.
- **Фоновая синхронизация** — подпапка в каталоге **Загрузки** Chrome (по умолчанию `PlaudExports/Sync`). Индекс синхронизации позволяет при повторных запусках **не создавать дубликаты** неизменённых записей.
- **Безопасные имена файлов** — разбор заголовков Markdown и санитизация имён (`common/exportPathUtils.js`).
- **Уведомления** — события из service worker для фоновых сценариев.

**Ограничение:** расширение не может сохранять файлы в произвольный путь на диске — только относительный путь внутри **Загрузок**. В попапе есть подсказка про **симлинк** на macOS (например, в iCloud).

### Требования

- **Google Chrome** (или совместимый Chromium с поддержкой распакованных расширений MV3).
- Авторизация на **Plaud Web**.

### Установка (режим разработчика)

1. Клонируйте или скопируйте репозиторий.
2. Откройте `chrome://extensions/`.
3. Включите **Режим разработчика**.
4. **Загрузить распакованное расширение** и укажите корень проекта (папку с `manifest.json`).

### Пользование попапом

1. Откройте **Plaud Web** и оставайтесь на подходящей вкладке.
2. Нажмите иконку расширения.

**Блоки интерфейса**

| Раздел | Назначение |
|--------|------------|
| **Ваш архив** | Сводная статистика; **Обновить** может занять время при полном пересчёте. |
| **Текущая запись** | Режимы экспорта только для **открытой** записи. |
| **Фоновая синхронизация** | Папка внутри **Загрузок**, сохранение, затем **Синхронизировать в фоне**; кнопка открытия **Загрузок**. |
| **Все записи** | Массовый экспорт, **Экспортировать в фоне**, **Стоп**. |

Для полного экспорта в foreground вкладка Plaud должна оставаться доступной; фоновые режимы опираются на service worker и уведомления.

### Куда сохраняются файлы

Относительно каталога **Загрузки** Chrome (если пользователь не менял место загрузок):

| Тип | Путь по умолчанию |
|-----|-------------------|
| Аудио | `PlaudExports/Audio/` |
| Саммари (Markdown) | `PlaudExports/Summaries/` |
| Умная синхронизация | Задаётся пользователем (по умолчанию `PlaudExports/Sync/`) |

### Разработка

| Команда | Назначение |
|---------|------------|
| `npm run lint` | ESLint |
| `npm test` | Тесты Node (`tests/**/*.test.js`) |
| `npm run verify` | Проверка путей динамических импортов (`scripts/verify-extension-imports.js`) |

### Структура проекта

См. дерево каталогов в английском разделе выше — файлы те же.

### Разрешения

В `manifest.json`: `activeTab`, `tabs`, `scripting`, `clipboardWrite`, `notifications`, `downloads`, `storage`; доступ к сайтам `https://*.plaud.ai/*`.

### Отладка

- **Service worker:** `chrome://extensions/` → расширение → **service worker** (открыть инструменты разработчика).
- **Content script / страница:** DevTools на вкладке Plaud → **Консоль**.

### Дисклеймер

Интерфейс и API Plaud Web могут меняться; при крупных обновлениях сайта может потребоваться правка DOM-фолбэков (`features/audioExport/domExportFallback.js`, `elementSelector/`).
