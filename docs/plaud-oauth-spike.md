# Spike: Plaud OAuth / Developer API vs web API

> Результаты сравнения официального стека Plaud (`@plaud-ai/cli`, MCP) с текущим reverse-engineered web API.
> Дата: 2026-06-06.

## Источники

- [Plaud MCP](https://docs.plaud.ai/documentation/plaud_app/mcp)
- [Plaud CLI](https://docs.plaud.ai/documentation/plaud_app/cli.md)
- Исходники `@plaud-ai/cli@0.2.4` (`dist/index.js`)

## Сводная таблица parity

| Возможность            | Web API (текущий)                     | Official Developer API                         | Заметка                                                  |
| ---------------------- | ------------------------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| Список записей         | `GET /file/simple/web`                | `GET /open/third-party/files/`                 | Разные формы ответа; official проще                      |
| Саммари                | `GET /ai/query_note` + `data_link`    | `note_list[].data_content` в `GET /files/{id}` | Official inline markdown; web может тянуть presigned URL |
| Транскрипт             | через `source_list` в web             | `source_list` в official `getFile`             | Parity на уровне полей                                   |
| Аудио                  | `GET /file/temp-url/{id}`             | `presigned_url` в `getFile` (24h)              | Server sync аудио не качает                              |
| Папки / filetags       | `GET /filetag/` + fan-out             | **Не документировано**                         | Критично для `PLAUD_MIRROR_FOLDERS` и Telegram tree      |
| Trash / Unfiled        | query params `is_trash`, `filetag_id` | **Не документировано**                         | Только web API                                           |
| Workspace scope        | `workspace-id` header                 | Не требуется (OAuth user scope)                | Разные модели auth                                       |
| Region redirect `-302` | Да                                    | Нет (фиксированный `platform.plaud.ai`)        | Web-only                                                 |
| OAuth + refresh        | Нет (Playwright snapshot)             | Да (`tokens.json`, refresh URL)                | Главный выигрыш стабильности                             |

## OAuth vs web API (совместимость токенов)

OAuth access token выдан для `platform.plaud.ai/developer/api`. Web endpoints (`api.plaud.ai/file/simple/web`, `/filetag`) ожидают JWT из Plaud Web `localStorage` с `workspace-id`.

**Вывод:** OAuth Bearer **не является drop-in заменой** web JWT для `/file/simple/web` и `/filetag`. Hybrid «OAuth auth + web endpoints» без отдельной проверки Plaud **не гарантирован**.

Рекомендуемая конфигурация по умолчанию:

| `PLAUD_AUTH_MODE` | `PLAUD_API_MODE` | Поведение                                               |
| ----------------- | ---------------- | ------------------------------------------------------- |
| `auto` (default)  | `web` (default)  | OAuth tokens если есть, иначе snapshot; web API + папки |
| `oauth`           | `official`       | OAuth + Developer API; flat vault (без mirror folders)  |
| `snapshot`        | `web`            | Legacy Playwright snapshot (как раньше)                 |

## Official API: форма записи

```json
{
  "id": "…",
  "name": "Meeting title",
  "created_at": "2026-05-01T10:00:00Z",
  "start_at": "2026-05-01T10:00:00Z",
  "duration": 3600000,
  "serial_number": "…"
}
```

`normalizePlaudFile` уже понимает поле `name` (`plaudTitles.TITLE_KEYS`).

## Go / no-go

| Критерий                       | Статус                                         |
| ------------------------------ | ---------------------------------------------- |
| OAuth refresh на headless VPS  | **Go** — реализовано в `plaudOAuth.js`         |
| Official list + summary parity | **Go** — `officialPlaudApi.js`                 |
| Папки на official API          | **No-go** — остаёмся на web API или flat sync  |
| Замена Playwright              | **Partial** — OAuth primary, snapshot fallback |

## Проверка локально

```bash
node scripts/plaud-oauth-spike.mjs
```

Скрипт сравнивает counts (если доступны snapshot и/или oauth tokens), не печатает секреты.
