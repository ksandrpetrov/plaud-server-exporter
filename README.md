# Plaud Server Exporter

Репозиторий: [github.com/ksandrpetrov/plaud-server-exporter](https://github.com/ksandrpetrov/plaud-server-exporter)

Серверный CLI выгружает **саммари** записей Plaud в Markdown для Obsidian. На VPS расписание и уведомления ведёт **Telegram-бот** (long-polling под systemd). В том же репозитории лежит Chrome-расширение **`plaud-exporter/`** — общие модули путей и sync-индекса (`syncCore.js`, `exportPathUtils.js`) импортируются сервером напрямую.

## Состав репозитория

| Каталог | Назначение |
|---------|------------|
| [`server/`](server/) | Node CLI, Playwright-авторизация, Plaud API, Telegram-бот |
| [`plaud-exporter/`](plaud-exporter/) | Расширение Chrome MV3 + общий код sync/путей |
| [`docs/`](docs/) | Установка, деплой, Syncthing, безопасность |
| [`deploy/`](deploy/) | systemd (`plaud-exporter.service`), logrotate |

Отдельный репозиторий расширения (исторически): [ksandrpetrov/plaud-exporter](https://github.com/ksandrpetrov/plaud-exporter).

## Сервер (кратко)

| | |
|--|--|
| Хост | `YOUR_SERVER_HOST` (IP или hostname VPS) |
| ОС | Ubuntu 22.04+ (пример: 1 vCPU, 1 GB RAM) |
| На сервере | `server:bot` под systemd — автосинк и отбивки в Telegram |
| На Mac | `server:auth` (Playwright + Chrome), перенос `session.json` по `scp` |

Аудио сервер **не** выгружает. Playwright на VPS не запускайте.

## Документация

| Документ | Содержание |
|----------|------------|
| **[docs/getting-started.md](docs/getting-started.md)** | Mac, VPS, первый sync, Telegram-бот, systemd |
| [docs/server-deploy.md](docs/server-deploy.md) | Продакшен-деплой (чеклист) |
| [docs/obsidian-sync.md](docs/obsidian-sync.md) | Syncthing: сервер → Mac |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Коды выхода, сессия, `scp`, lock, Telegram |
| [docs/security.md](docs/security.md) | Секреты, логи, ротация сессии |
| [plaud-exporter/README.md](plaud-exporter/README.md) | Chrome-расширение (установка, попап) |
| [server/README.md](server/README.md) | CLI, `.env`, Telegram, пути на диске |

## Команды (из корня репозитория)

```bash
npm run server:auth      # Mac: вход в Plaud
npm run server:sync      # разовая выгрузка саммари
npm run server:status    # конфиг и сессия
npm run server:bot       # Telegram-бот (VPS / локальная проверка)
```

Коды выхода: `0` ок; `1` ошибки sync; `2` сессия или нет `TELEGRAM_BOT_TOKEN` для `bot`; `3` изменился API Plaud; `4` уже идёт sync.

Выход из сессии: `node server/src/cli/index.js logout`.

## Вывод на диск

```text
{PLAUD_EXPORT_ROOT}/Plaud/2026-05-18 - Meeting.md
```

При `PLAUD_MIRROR_FOLDERS=true` — подпапки по тегам Plaud: `Plaud/{папка}/…`.

Индекс: `server/.data/sync-index.json`. Ошибки: `{export}/_errors/*.md`.

## Разработка

```bash
npm install --workspaces
npm test                 # server/tests (127 тестов)
npm run test:submodule   # plaud-exporter/tests (15 тестов)
npm run lint
npm run verify           # импорты server → plaud-exporter/common/*
```

Расширение отдельно: `cd plaud-exporter && npm run lint && npm test && npm run verify`.
