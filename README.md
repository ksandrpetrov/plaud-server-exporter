# Plaud Server Exporter

Репозиторий: [github.com/ksandrpetrov/plaud-server-exporter](https://github.com/ksandrpetrov/plaud-server-exporter)

Серверный CLI: саммари записей Plaud → Markdown для Obsidian. Рядом с Chrome-расширением [`plaud-exporter`](https://github.com/ksandrpetrov/plaud-exporter) (общий код путей и sync-индекса).

## Сервер

| | |
|--|--|
| Хост | `YOUR_SERVER_HOST` (IP или hostname вашего VPS) |
| ОС | Ubuntu 22.04+ (пример: 1 vCPU, 1 GB RAM) |
| На сервере | `server:sync` по systemd (каждые 2 ч) |
| На Mac | `server:auth` (Playwright + Chrome), перенос `session.json` по `scp` |

Аудио не выгружается. Playwright на сервере не используется.

## Инструкция

**[docs/getting-started.md](docs/getting-started.md)** — Mac, сервер, systemd, Syncthing.

## Команды (из корня репозитория)

```bash
npm run server:auth      # Mac: вход в Plaud
npm run server:sync      # выгрузка саммари
npm run server:status    # конфиг и сессия
```

Коды выхода: `0` ок; `1` ошибки sync; `2` сессия; `3` изменился API Plaud; `4` уже идёт sync.

## Вывод на диск

```text
{PLAUD_EXPORT_ROOT}/Plaud/2026/2026-05-18 - Meeting.md
```

Индекс: `server/.data/sync-index.json`. Ошибки: `{export}/_errors/*.md`.

## Разработка

```bash
npm test
npm run lint
npm run verify
```
