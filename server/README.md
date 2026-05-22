# Серверный экспортёр

Node.js CLI: **саммари** встреч Plaud → Markdown для Obsidian (или любого дерева папок). Рассчитан на небольшой VPS без БД и веб-UI.

**По умолчанию только саммари.** Аудио сервер не скачивает.

## Что делает

1. Читает сохранённую сессию Plaud (`session.json` после Playwright-входа на Mac).
2. Получает список записей через внутренний API Plaud.
3. Загружает AI-саммари и пишет `.md` в `{vault}/Plaud/` (при зеркалировании папок — `Plaud/{тег}/`).
4. Ведёт `server/.data/sync-index.json`, чтобы не дублировать неизменённые записи.
5. При сбоях пишет отчёты в `{vault}/_errors/`.

Общая логика путей и хешей — в [`plaud-exporter/common/`](../plaud-exporter/common/) (тот же код, что у Chrome-расширения).

## Быстрый старт

Из **корня репозитория** (не из `server/`):

```bash
npm install --workspaces
npx playwright install chromium   # только Mac, для auth
cp .env.example .env
# Задайте PLAUD_EXPORT_ROOT и PLAUD_TIMEZONE

npm run server:auth
npm run server:status
npm run server:sync -- --dry-run
npm run server:sync
```

Полная инструкция: [docs/getting-started.md](../docs/getting-started.md).

## Конфигурация (`.env` в корне репозитория)

| Переменная | Назначение |
|------------|------------|
| `PLAUD_EXPORT_ROOT` | Каталог для Markdown (обязательно) |
| `PLAUD_OBSIDIAN_VAULT_PATH` | Опционально: существующий vault Obsidian вместо export root |
| `PLAUD_OBSIDIAN_SUBFOLDER` | Подпапка в vault (по умолчанию `Plaud`) |
| `PLAUD_MIRROR_FOLDERS` | Отражать теги папок Plaud в пути (по умолчанию `true`) |
| `PLAUD_TIMEZONE` | IANA timezone для дат в именах файлов (по умолчанию `UTC`) |
| `PLAUD_DATA_DIR` | Переопределить каталог `server/.data` |
| `PLAUD_LOG_LEVEL` | `debug` / `info` / `warn` / `error` |
| `PLAUD_API_CONCURRENCY` | Параллельные запросы API (по умолчанию `4`) |
| `PLAUD_WEB_ORIGIN` | Origin Plaud Web (по умолчанию `https://web.plaud.ai`) |
| `WEBAPP_HOST` | Адрес HTTP в процессе бота (Docker: `0.0.0.0`) |
| `WEBAPP_PORT` | Порт HTTP (по умолчанию `8080`; healthcheck `/healthz`) |
| `WEBAPP_BASE_URL` | Публичный HTTPS URL для `/connect` (nginx), не локальный путь |

Не коммитьте `.env` и `server/.data/session.json`.

## Команды

| Команда | Описание |
|---------|----------|
| `npm run server:auth` | Playwright-вход на Mac → `session.json` |
| `npm run server:sync` | Выгрузка саммари (one-shot) |
| `npm run server:sync -- --dry-run` | План без записи на диск и без обновления индекса |
| `npm run server:status` | JSON-статус (без секретов) |
| `npm run server:bot` | Запустить Telegram-бот (long-polling + планировщик) |
| `node server/src/cli/index.js logout` | Удалить снимок сессии |

### Коды выхода

| Код | Значение |
|-----|----------|
| `0` | Успех |
| `1` | Ошибки sync (см. `_errors/`) |
| `2` | Нет или битая сессия |
| `3` | Изменился API Plaud (`plaud_changed`) |
| `4` | Уже выполняется другой sync |

## Куда пишутся файлы

| Вывод | Путь |
|-------|------|
| Саммари | `{PLAUD_EXPORT_ROOT или vault}/Plaud/ГГГГ-ММ-ДД - {название}.md` |
| Ошибки | `{корень vault}/_errors/ГГГГ-ММ-ДД-ЧЧ-ММ-plaud-export-error-*.md` |
| Индекс sync | `server/.data/sync-index.json` (не в дереве экспорта) |
| Сессия | `server/.data/session.json` |
| Статус | `server/.data/status.json` |

В `.md` только текст саммари. Технические поля (stable id, hash, пути) — в `sync-index.json`.

## Аудио

**Сервер аудио не качает.** Флага `--audio-too` нет. Для аудио используйте Chrome-расширение в [`plaud-exporter/`](../plaud-exporter/) или экспорт с Plaud Web.

## Продакшен на VPS

Два режима (не смешивать с одним `TELEGRAM_BOT_TOKEN`):

| Режим | Документ |
|-------|----------|
| **systemd** + Node на хосте (`/srv/plaud-exporter`) | [docs/server-deploy.md](../docs/server-deploy.md) |
| **Docker** + nginx TLS (`/opt/plaud-exporter`, GHCR, CI deploy) | [deploy/README.md](../deploy/README.md) |

Общее:

- `server:auth` — **только на Mac**; `session.json` копируйте на сервер (`scp`) или в Docker volume.
- `server:bot` — основной долгоживущий процесс (systemd или контейнер); вместе с ним поднимается HTTP `/healthz`.
- `server:sync` — ручные запуски; общий файловый лок не даст столкнуться с ботом.
- Playwright на VPS с 1 GB RAM не запускайте.

См. [docs/security.md](../docs/security.md), [docs/troubleshooting.md](../docs/troubleshooting.md).

## Telegram-бот

Long-polling бот рапортует о каждом синке (как ручном, так и по расписанию)
и позволяет запустить синк кнопкой. Доступ — одному владельцу, идентифицируемому
по `TELEGRAM_ALLOWED_USER_ID` (рекомендуется) и/или `TELEGRAM_ALLOWED_USERNAME`.
Чужие апдейты (включая `/start` и `/help`) молча игнорируются, как и
любые сообщения из групповых/канальных чатов — бот работает только в личке.

Переменные окружения:

| Переменная | Назначение |
|------------|------------|
| `TELEGRAM_BOT_TOKEN` | Токен бота от BotFather (без него команда `server:bot` падает с кодом 2) |
| `TELEGRAM_ALLOWED_USER_ID` | Числовой Telegram user_id владельца (стабильный, рекомендуется) |
| `TELEGRAM_ALLOWED_USERNAME` | Lowercase username без `@`. Можно как доп. проверку поверх id, либо как fallback в legacy-конфиге |
| `BOT_SYNC_INTERVAL_MIN` | Интервал автозапуска синка из бота (по умолчанию `120` минут) |
| `BOT_LONG_POLL_SEC` | Таймаут `getUpdates` (по умолчанию `30`) |

Должно быть задано **хотя бы одно** из `TELEGRAM_ALLOWED_USER_ID` / `TELEGRAM_ALLOWED_USERNAME`. Если задано только имя — стартует с warning, потому что username в Telegram перевыпускаемый.

Запуск:

```bash
npm run server:bot
```

После старта отправьте боту `/start` со своего аккаунта — бот запишет ваш
`chat_id` в `server/.data/owner-chat.json` (mode `0o600`) и начнёт слать
туда уведомления о syncs по расписанию. Чтобы перепривязать чат, удалите
этот файл и снова отправьте `/start`.

Меню в Telegram (`/menu` или кнопка «Меню»):

- 🔄 Запустить синк сейчас — ручной запуск, статусные обновления на том же сообщении;
- 📊 Статус последнего синка — счётчики из `server/.data/status.json`;
- 📁 **Файлы**:
  - **🌳 Дерево синка** — папки из `sync-index.json` (с учётом `folderSegment` при `PLAUD_MIRROR_FOLDERS=true`); внутри папки — постраничный список записей с номерами `1 -` … `30 -`;
  - отправьте боту **цифру** (1–30 на текущей странице), чтобы получить соответствующий `.md` как документ (если файл уже есть на диске после синка);
  - **📊 Сводка vault** — число `.md`, размер, последние 10 файлов по дате изменения;
- ⚙️ Настройки расписания — выбор интервала (60 / 120 / 240 / 480 минут), значение сохраняется в `server/.data/bot-settings.json`;
- ℹ️ Помощь — справочник по командам.

Индекс sync (`syncCore.js`): при смене только папки Plaud (`folderSegment`), названия или имени файла без изменения хеша саммари запись помечается как обновлённая метаданными — файл на диске **переименовывается/переносится** без повторной загрузки с API.

systemd-юниты живут в [`deploy/systemd/`](../deploy/systemd/):

- `plaud-exporter.service` — long-running бот (`Type=simple`, `Restart=always`);
- `plaud-exporter-sync.service` — backup oneshot для ручного `server:sync` (по умолчанию не enable'нут).

Подробный деплой — [docs/server-deploy.md](../docs/server-deploy.md).

### UX (паттерны из [satellite](https://github.com/aleksandr/Developer/satellite))

Telegram-слой бота сознательно повторяет UX соседнего проекта «Чайка»
(`satellite/telegram_bot/`, `docs/telegram-ux.md`):

| Паттерн | Модуль | Поведение |
|---------|--------|-----------|
| Централизованные RU-строки | `src/telegram/messages.js` | Копирайт и `ERR_*` без stack trace в чат |
| Inline-меню (одна кнопка на ряд) | `keyboards.js` | ✅ на активном интервале автосинка |
| ActionGuard | `actionGuard.js`, `syncGuards.js` | Повторный тап «🔄» → toast; cooldown ~35 с после успеха |
| Потоковый прогресс | `streamingDelivery.js` | `sendMessageDraft` с fallback на edit |
| Typewriter reveal | `messageAnimator.js`, `streamingDelivery.js` | Превью в поле ввода (`sendMessageDraft`) перед `sendMessage` / `editMessageText`; порог ~60 символов; короткие toast и `animate: false` — мгновенно |
| HTML blockquote | `htmlFormat.js` | Длинная справка; retry без blockquote при 400 |
| Typing + message effect | `telegramVisual.js` | `typing` на синке/дереве; ✨ после ручного успеха в личке |
| Dedup callback | `bot.js` | Тот же `callback_query_id` не обрабатывается дважды |

Не переносим: reply-клавиатуру, Web App, персону «Чайка», PNG-аналитику.

## Разработка

```bash
npm test              # из корня репозитория
npm run lint
npm run verify
```

Тесты: `server/tests/`.
