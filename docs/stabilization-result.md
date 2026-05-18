# Результат стабилизации

> Архив. Актуальная инструкция: [getting-started.md](./getting-started.md).

Кратко о стабилизации server exporter: умолчание «только саммари», чистый
Markdown, стабильные имена, отчёты об ошибках, безопасность sync-index и
регрессионные тесты. Дополнительно: восстановление удалённого файла и
операционные CLI-тесты.

## Что изменилось

- **Env opt-in для аудио работает.** Раньше CLI при отсутствии флагов всегда
  ставил `summaryOnly=true`, и `PLAUD_EXPORT_AUDIO=true` в `.env` игнорировался.
  Аудио включается при **`--audio-too`** или при **обоих**
  `PLAUD_EXPORT_SUMMARY_ONLY=false` и `PLAUD_EXPORT_AUDIO=true`. По умолчанию —
  только саммари.
- **Флаги `--no-audio` / `--summary-only`** перебивают env для разовых запусков.
- **Блокировка параллельного sync.** `server/src/sync/runLock.js`, файл
  `server/.data/sync.lock` через `open(O_EXCL)` с `{ pid, host, startedAt }`.
  Второй запуск — **код 4** без побочных эффектов. Устаревшие блокировки
  (> 2 ч / мёртвый pid) снимаются. Dry-run без блокировки.
- **Dry-run не вызывает `/file/temp-url`.** Даже с `--audio-too --dry-run` —
  только счётчик «скачали бы».
- **CLI.** `logout` в help; флаг `--no-audio`.
- **Восстановление удалённого саммари.** Удалили `.md`, в индексе тот же
  `summaryHash` — следующий sync пересоздаёт файл (`updated: 1`).
- **Новые тесты** (61 server + 14 extension; проверено 2026-05-18):
  - все 7 видов error classifier;
  - `plaud_changed` end-to-end (список и саммари) → exit 3;
  - фильтрация записей без нормализуемого id;
  - emoji/unicode, зарезервированные Windows (COM1/LPT1/NUL/AUX/PRN), бюджет имени;
  - приоритет режима аудио (defaults, env, CLI);
  - блокировка sync, обход в dry-run;
  - восстановление вручную удалённого `.md`;
  - CLI: нет сессии (2), read-only export root.

## Изменённые файлы

| Область | Файлы |
|---------|-------|
| Новые модули | `server/src/sync/runLock.js`, `server/src/cli/audioMode.js` |
| Ядро | `cli/index.js`, `sync/syncRunner.js` (восстановление удалённого файла) |
| Тесты | `syncRunner.errors.test.js`, `cliAudioMode.test.js`, `cliCommands.test.js`, `config.test.js` + расширения существующих |
| Документация | `.env.example`, `server/README.md`, `stabilization-audit.md`, этот файл, `server-deploy.md`, `troubleshooting.md` |
| Submodule расширения | **без изменений** |

## Поведение после изменений

| Тема | Поведение |
|------|-----------|
| Sync по умолчанию | Только Markdown саммари, без аудио |
| Содержимое `.md` | Текст саммари Plaud, без frontmatter экспортёра |
| Имена | `YYYY-MM-DD - {название}.md`, ≤ 242 символа, полный путь ≤ 240 |
| Ошибки | `{vault}/_errors/*.md`, с редакцией, дедуп по hash |
| Повторный sync | Пропуск без изменений, обновление при смене, rename при смене заголовка; восстановление пропавшего `.md` |
| Смена API Plaud | `plaud_changed`, exit 3 |
| Параллельный запуск | Второй — exit 4, без записи |
| Dry-run | Без записи; без запроса URL аудио |

## Как запустить

Из корня репозитория (не `docs/`):

```bash
cd "$(git rev-parse --show-toplevel)"
npm install --workspaces
npx playwright install chromium
cp .env.example .env
npm run server:auth
npm run server:sync -- --dry-run
npm run server:sync                  # только саммари
npm run server:sync -- --audio-too   # аудио разово
npm run server:sync -- --no-audio    # только саммари даже при env opt-in
npm run server:status
node server/src/cli/index.js logout
```

## Как тестировать

```bash
npm test                # 61 тест server
npm run lint
npm run verify
npm run test:submodule  # 14 тестов расширения
```

## Деплой

См. [`server-deploy.md`](./server-deploy.md). Целевой сервер — Ubuntu 22.04 на VPS
(`YOUR_SERVER_HOST`, типично 1 vCPU / 1 GB RAM). Кратко:

- systemd `Type=oneshot` с `ExecStart=npm run server:sync` без изменений по смыслу;
- `sync.lock` принадлежит пользователю unit; чистите вручную только если процесс
  умер, а авто-снятие ещё не сработало;
- аудио на сервере — **оба** env-флага в `EnvironmentFile` / `.env`; один флаг —
  намеренно no-op;
- Playwright на сервере с 1 GB RAM не запускаем — `session.json` готовим на Mac
  и переносим `scp`. См. блок «Целевой сервер» в `server-deploy.md`.

## Оставшиеся риски

- Смена API Plaud — ручное обновление кода (теперь видно как `plaud_changed`).
- Очень глубокий `PLAUD_OBSIDIAN_VAULT_PATH` (~240 символов) — мало места для
  basename; имя может стать очень коротким.
- Срок JWT ограничен Plaud — периодический `server:auth` всё ещё нужен.
- Блокировка локальная; два инстанса на одном NFS — один писатель или сетевая
  блокировка в будущем.

## Ручные проверки

1. Реальный `server:auth` на продакшн-аккаунте Plaud.
2. Полный sync на сервере с 10+ записями — чистый Markdown и стабильные имена.
3. Sandbox: `PLAUD_EXPORT_SUMMARY_ONLY=false` + `PLAUD_EXPORT_AUDIO=true` — аудио в
   `_attachments/`.
4. Два `server:sync` одновременно — один с кодом `4`, без записи.
5. Истечение сессии — `_errors/auth_error*.md`, exit `2`.
6. Некорректный ответ Plaud — `_errors/plaud_changed*.md`, exit `3`.
7. Расширение Chrome загружается (`npm run test:submodule`).
