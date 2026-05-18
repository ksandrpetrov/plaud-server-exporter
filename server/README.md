# Server exporter

Саммари Plaud → Markdown. Полная инструкция: [docs/getting-started.md](../docs/getting-started.md).

```bash
npm run server:auth      # Mac
npm run server:sync
npm run server:status
```

Конфиг: `.env` в корне репозитория (`PLAUD_EXPORT_ROOT`, `PLAUD_TIMEZONE`).

Данные (gitignore): `server/.data/session.json`, `sync-index.json`, `status.json`.
