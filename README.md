# Plaud Server Exporter

Репозиторий: [github.com/ksandrpetrov/plaud-server-exporter](https://github.com/ksandrpetrov/plaud-server-exporter)

Инструмент, который автоматически сохраняет **текстовые саммари** ваших записей из [Plaud](https://www.plaud.ai)
(диктофон с AI-конспектами) в обычные текстовые файлы Markdown — например, прямо в базу заметок Obsidian.
Работает сам, по расписанию, а о результатах сообщает Telegram-бот.

## Что это и зачем

Plaud записывает встречи и голосовые заметки, делает по ним AI-саммари, но хранит всё в своём облаке. Этот проект
решает одну задачу: **копии всех саммари всегда лежат у вас** — в виде обычных файлов, которые открываются любым
редактором и удобно читаются в Obsidian.

В проекте три части:

- **Сервер** — программа для небольшого арендованного сервера (VPS). Сама, по расписанию, проверяет новые записи
  и сохраняет саммари в файлы.
- **Telegram-бот** — присылает отчёт о каждой синхронизации, запускает её вручную по кнопке и может прислать любой
  сохранённый файл прямо в чат.
- **Chrome-расширение** — для ручной выгрузки **аудио** и саммари из браузера.

Важное ограничение: сервер выгружает **только текст саммари**. Аудиофайлы сервер не скачивает — для них есть
расширение.

## Если термины незнакомы

| Термин               | Простыми словами                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Markdown             | Текстовый формат файлов `.md`: обычный текст с простой разметкой, открывается чем угодно  |
| Obsidian             | Популярное приложение для заметок; хранит их как папку с `.md`-файлами (она же — «vault») |
| VPS / сервер         | Небольшой арендованный компьютер в интернете, который работает круглосуточно              |
| Синхронизация (sync) | Процесс «проверить, что нового в Plaud, и сохранить это в файлы»                          |
| Терминал             | Приложение, где команды вводятся текстом (на Mac — «Терминал»/«Terminal»)                 |

## Как это работает

1. **Один раз входите в Plaud на Mac** командой `npm run server:auth`. Она сохраняет файл доступа
   (по умолчанию OAuth-токены `server/.data/oauth-tokens.json`; legacy-вариант — Playwright-снимок `session.json`).
2. **Копируете файл доступа на сервер** одной командой `scp`. Сам логин/пароль от Plaud на сервер не попадает.
3. **Дальше сервер работает сам**: Telegram-бот по расписанию (по умолчанию каждые 2 часа) запускает синхронизацию,
   новые и изменённые саммари сохраняются как `.md`-файлы. Уже выгруженное повторно не скачивается.
4. **Файлы попадают к вам**: папку с выгрузкой можно синхронизировать на Mac (например, через Syncthing) и открыть
   как vault Obsidian.

Если сервера нет — всё то же самое можно запускать вручную прямо на Mac.

## Из чего состоит репозиторий

| Каталог                                    | Что внутри                                                            |
| ------------------------------------------ | --------------------------------------------------------------------- |
| [`server/`](server/)                       | Основная программа: вход в Plaud, выгрузка саммари, Telegram-бот      |
| [`browser-extension/`](browser-extension/) | Расширение Chrome для ручной выгрузки аудио и саммари                 |
| [`docs/`](docs/)                           | Инструкции: установка, деплой, синхронизация с Obsidian, безопасность |
| [`deploy/`](deploy/)                       | Готовые конфиги для сервера: systemd, Docker, Ansible, пример nginx   |
| [`scripts/`](scripts/)                     | Служебные скрипты проверки и деплоя                                   |

## С чего начать

| Сценарий                            | Куда идти                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| Попробовать на Mac, без сервера     | [docs/getting-started.md](docs/getting-started.md), раздел «Проверка на Mac» |
| Полная схема: сервер + Telegram-бот | [docs/getting-started.md](docs/getting-started.md) целиком                   |
| Нужно выгружать аудио               | [browser-extension/README.md](browser-extension/README.md)                   |
| Читать саммари в Obsidian на Mac    | [docs/obsidian-sync.md](docs/obsidian-sync.md)                               |

Что понадобится: Node.js 22+; для полной схемы — любой небольшой VPS (Ubuntu 22.04+, хватает 1 CPU и 1 GB RAM).
Вход в Plaud выполняется **только на Mac** — на сервер копируется лишь файл доступа.

## Основные команды

Запускаются из терминала, из корня репозитория:

```bash
npm run server:auth               # вход в Plaud (только на Mac)
npm run server:sync               # разовая выгрузка саммари
npm run server:sync -- --dry-run  # пробный прогон без записи на диск
npm run server:status             # проверить настройки и доступ к Plaud
npm run server:bot                # запустить Telegram-бота (обычно на сервере)
```

Выйти из Plaud (удалить сохранённый доступ): `node server/src/cli/index.js logout`.

Как понять результат по коду выхода:

| Код | Что значит                                                 | Что делать                                            |
| --- | ---------------------------------------------------------- | ----------------------------------------------------- |
| `0` | Всё получилось                                             | Ничего                                                |
| `1` | Часть записей не выгрузилась                               | Посмотреть отчёты в `_errors/`                        |
| `2` | Нет доступа к Plaud (или нет токена бота для `server:bot`) | Снова `server:auth` на Mac и скопировать файл доступа |
| `3` | Plaud изменил своё API                                     | [docs/troubleshooting.md](docs/troubleshooting.md)    |
| `4` | Синхронизация уже идёт (например, её запустил бот)         | Просто подождать                                      |

## Куда сохраняются файлы

```text
{PLAUD_EXPORT_ROOT}/Plaud/2026-05-18 - Название встречи.md
```

- Имя файла — дата записи и её название.
- При `PLAUD_MIRROR_FOLDERS=true` (по умолчанию) папки Plaud повторяются на диске: `Plaud/{папка}/….md`.
  Папки доступны при входе через Playwright-снимок (web API); вход через OAuth использует официальный API без
  папок — подробнее в [docs/getting-started.md](docs/getting-started.md).
- Отчёты об ошибках: `{папка экспорта}/_errors/*.md`.
- Служебная память о том, что уже выгружено: `server/.data/sync-index.json` (в папку экспорта не попадает).

## Telegram-бот

Бот привязан к одному владельцу (задаётся в настройках) и работает только в личных сообщениях; чужие сообщения
молча игнорирует. Умеет:

- запускать синхронизацию кнопкой и показывать прогресс прямо в сообщении;
- показывать статус последней синхронизации;
- показывать дерево папок выгрузки и присылать любой сохранённый `.md`-файл в чат — достаточно отправить номер
  записи из списка;
- менять интервал автосинхронизации (60 / 120 / 240 / 480 минут) и включать уведомления о плановых запусках
  (по умолчанию плановые запуски работают тихо).

Подробности и настройка — [server/README.md](server/README.md#telegram-бот).

## Документация

| Документ                                                   | Содержание                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| **[docs/getting-started.md](docs/getting-started.md)**     | Пошаговая установка: Mac, сервер, первый sync, Telegram-бот |
| [server/README.md](server/README.md)                       | Все команды, настройки `.env`, устройство бота              |
| [browser-extension/README.md](browser-extension/README.md) | Chrome-расширение: установка и использование                |
| [docs/obsidian-sync.md](docs/obsidian-sync.md)             | Syncthing: как читать выгрузку в Obsidian на Mac            |
| [docs/troubleshooting.md](docs/troubleshooting.md)         | Что делать, если что-то сломалось                           |
| [docs/security.md](docs/security.md)                       | Секреты, логи, ротация доступа                              |
| [docs/server-deploy.md](docs/server-deploy.md)             | Продакшен: systemd или Docker (чеклист)                     |
| [deploy/README.md](deploy/README.md)                       | Docker + Ansible, GHCR, автодеплой из CI                    |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)               | Карта кода для разработчиков                                |
| [AGENTS.md](AGENTS.md)                                     | Рабочий контракт для AI-агентов и контрибьюторов            |

## Для разработчиков

Всё, что ниже, нужно только тем, кто меняет код.

### Установка и проверки

```bash
npm install              # зависимости server/ + pre-commit хук
cd browser-extension && npm install && cd ..

npm run check            # ОДНА команда: линтеры, типы, форматирование,
                         #   markdown, verify, тесты, docker-smoke
```

Точечные шаги, если менялся один пакет:

```bash
npm run lint             # eslint server, --max-warnings 0
npm run lint:extension   # eslint browser-extension
npm run lint:markdown    # markdownlint-cli2 (docs/, README, AGENTS)
npm run typecheck        # JSDoc + tsc --checkJs (server + extension)
npm run format           # prettier --write
npm run format:check     # prettier --check (как в CI)
npm run verify           # импорты server → browser-extension/common/* резолвятся
npm run verify:extension # MV3 dynamic imports + инварианты manifest
npm test                 # server/tests (node:test)
npm run test:extension   # browser-extension/tests
npm run test:coverage    # lcov + пороги (требует Node 22+)
```

Расширение отдельно: `cd browser-extension && npm run lint && npm test && npm run verify`.

Pre-commit хук (`simple-git-hooks` + `lint-staged`) ставится при `npm install` и гоняет
prettier/eslint/verify-manifest на изменённые файлы. Снять: `git commit --no-verify` или
`SKIP_SIMPLE_GIT_HOOKS=1 git commit`.

### Graphify: карта кодовой базы

В репозитории хранится готовый граф кода и документации в `graphify-out/`, а project-scoped skill для Codex —
в `.codex/skills/graphify/`. CLI ставится отдельно через `uv`, чтобы не попадать в runtime-зависимости сервера:

```bash
uv tool install graphifyy==0.9.26
```

Для полной семантической пересборки в Codex нужен `multi_agent = true` в секции `[features]` файла
`~/.codex/config.toml`. Основные команды:

```bash
npm run graphify -- query "sync determineSyncAction"
npm run graphify -- explain "determineSyncAction"
npm run graphify -- path "routeCallback" "runSync"
npm run graphify -- update .                 # изменения кода, локальный AST без LLM
```

CLI ищет по терминам графа, поэтому для свободного вопроса на русском используйте `$graphify` в Codex: skill
подберёт английские термины и выполнит запрос. Если менялись Markdown, YAML или изображения, используйте
`$graphify . --update`: эти форматы требуют семантической обработки. Git-hooks Graphify намеренно не ставятся —
обновление выполняется явно перед сдачей изменения. Версию повышаем одним изменением: обновляем `graphifyy==…`
в `package.json`, переустанавливаем project skill той же версией и пересобираем `graphify-out/`.

### Общий код server ↔ расширение

Семь модулей `browser-extension/common/*` (sync-решения, пути, папки, id записей, названия, записи, summary
markdown) — формальный контракт между сервером и расширением: меняешь один — обновляешь оба consumer'а и оба
набора тестов. Подробности — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) и [AGENTS.md](AGENTS.md).

Каталог [`browser-extension/`](browser-extension/) — вендорный код расширения в монорепо (не git-submodule);
`npm run verify` проверяет, что `browser-extension/common/*.js` существуют и относительные импорты из
`server/src/` резолвятся. Исторически расширение жило в отдельном репозитории:
[ksandrpetrov/plaud-exporter](https://github.com/ksandrpetrov/plaud-exporter).

### CI и деплой

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) → переиспользует reusable
  [`checks.yml`](.github/workflows/checks.yml) на матрице Node 22.x + 24.x при push/PR в `main`: lint, typecheck,
  format, verify, tests, coverage (на 24.x), npm audit, Docker PR build, smoke.
- [`.github/workflows/infra-lint.yml`](.github/workflows/infra-lint.yml) — actionlint, shellcheck, hadolint,
  markdownlint в параллельных job-ах.
- [`.github/workflows/codeql.yml`](.github/workflows/codeql.yml) и
  [`.github/workflows/gitleaks.yml`](.github/workflows/gitleaks.yml) — security/secret сканы (PR + weekly cron).
  CodeQL на private без GHAS кладёт SARIF в artifact, не в Security tab —
  см. [docs/quality-gate.md](docs/quality-gate.md#codeql-на-приватном-репозитории).
- [`.github/dependabot.yml`](.github/dependabot.yml) — еженедельные апдейты npm/actions/docker, сгруппированные
  dev/prod/security.
- Required checks и список политик — в [docs/quality-gate.md](docs/quality-gate.md).

Deploy ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)) на push в `main`: те же reusable
`checks.yml` как pre-deploy gate, сборка образа в GHCR (`:sha-*`), smoke; SSH-выкат на VPS **только** если в
GitHub Variables задано `PRODUCTION_DOCKER_DEPLOY=true` (иначе systemd-бот на сервере не трогается).
См. [deploy/README.md](deploy/README.md).

Локальный Docker: `cp .env.example .env` → `make docker-up` → `curl -s http://127.0.0.1:8080/healthz`.
