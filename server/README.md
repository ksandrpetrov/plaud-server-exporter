# Серверный exporter

Node.js CLI, который выгружает **саммари встреч Plaud** в Markdown для Obsidian или обычной папки. Он рассчитан на небольшой VPS рядом с другими сервисами: без базы данных, очередей и веб-интерфейса.

**Поведение по умолчанию: только summary.** Серверный exporter не скачивает audio. Флага `--audio-too` нет.

## Что делает

1. Использует сохранённую Plaud-сессию (`session.json` после входа через Playwright на Mac).
2. Получает список записей через внутренний API Plaud.
3. Забирает AI-саммари и пишет `.md` в `{vault}/Plaud/{folder}/{year}/`; теги-папки Plaud зеркалируются, записи без папки попадают в `Без категории`.
4. Хранит состояние в `server/.data/sync-index.json`, чтобы не создавать дубли.
5. При сбое пишет человекочитаемые отчёты в `{vault}/_errors/`.

## Быстрый старт

Команды запускаются из **корня репозитория**, не из папки `server/`:

```bash
npm install --workspaces
npx playwright install chromium   # только на Mac, для auth
cp .env.example .env
# Отредактируйте PLAUD_EXPORT_ROOT и PLAUD_TIMEZONE

npm run server:auth      # интерактивный вход → server/.data/session.json
npm run server:status    # пути, наличие сессии, статистика последнего sync
npm run server:sync -- --dry-run
npm run server:sync      # реальная выгрузка, только summary
```

Подробная инструкция: [docs/getting-started.md](../docs/getting-started.md).

## Конфигурация (`.env` в корне репозитория)

| Переменная | Назначение |
|------------|------------|
| `PLAUD_EXPORT_ROOT` | Каталог для Markdown-выгрузки |
| `PLAUD_OBSIDIAN_VAULT_PATH` | Опционально: писать в существующий Obsidian vault вместо `PLAUD_EXPORT_ROOT` |
| `PLAUD_OBSIDIAN_SUBFOLDER` | Подпапка внутри vault, по умолчанию `Plaud` |
| `PLAUD_MIRROR_FOLDERS` | Зеркалировать папки/теги Plaud в пути, по умолчанию `true` |
| `PLAUD_TIMEZONE` | IANA timezone для дат в именах файлов, по умолчанию `UTC` |
| `PLAUD_DATA_DIR` | Переопределить расположение `server/.data` |
| `PLAUD_LOG_LEVEL` | `debug`, `info`, `warn` или `error` |

Не коммитьте `.env` и `server/.data/session.json`.

## Команды

| Команда | Что делает |
|---------|------------|
| `npm run server:auth` | Вход через Playwright на Mac, сохраняет сессию |
| `npm run server:sync` | Выгружает summary |
| `npm run server:sync -- --dry-run` | Пробный прогон: без файлов и без обновления индекса |
| `npm run server:status` | JSON-статус без секретов |
| `node server/src/cli/index.js logout` | Удаляет сохранённый снимок сессии |

### Коды выхода

| Код | Значение |
|-----|----------|
| `0` | Успех |
| `1` | Ошибки sync, смотреть `_errors/` |
| `2` | Проблема auth или нет сессии |
| `3` | Plaud изменил форму API-ответа (`plaud_changed`) |
| `4` | Уже идёт другой sync |

## Куда пишутся файлы

| Вывод | Путь |
|-------|------|
| Саммари | `{PLAUD_EXPORT_ROOT или vault}/Plaud/{folder}/{YYYY}/YYYY-MM-DD - {title}.md` (`Без категории`, если у записи нет папки Plaud) |
| Ошибки | `{тот же vault root}/_errors/YYYY-MM-DD-HH-MM-plaud-export-error-*.md` |
| Sync-index | `server/.data/sync-index.json`, вне дерева выгрузки |
| Сессия | `server/.data/session.json` |
| Статус | `server/.data/status.json` |

Файл `.md` с саммари содержит **только текст саммари встречи**. Технические поля, stable id, hash и пути живут в `sync-index.json`.

## Экспорт audio

Серверный exporter **не скачивает audio**. Флага `--audio-too` нет. Если audio всё же нужно, используйте Chrome-расширение в `plaud-exporter/` или ручной экспорт из Plaud Web.

## Рабочий сервер

- `server:auth` запускается **только на Mac**; затем `session.json` копируется на сервер через `scp`.
- `server:sync` запускается от отдельного пользователя, например `plaud`, через systemd timer или cron.
- Playwright auth не запускается на VPS с 1 GB RAM.
- После обновления кода на сервере используйте flow из [docs/server-deploy.md](../docs/server-deploy.md#обновление-кода-и-перезапуск).

См. также [docs/security.md](../docs/security.md) и [docs/troubleshooting.md](../docs/troubleshooting.md).

## Разработка

```bash
npm test
npm run lint
npm run verify
npm run test:submodule
```

Тесты сервера лежат в `server/tests/`. Команда `test:submodule` проверяет директорию Chrome-расширения `plaud-exporter/`; название команды историческое.
