# Plaud Server Exporter

Репозиторий: [github.com/ksandrpetrov/plaud-server-exporter](https://github.com/ksandrpetrov/plaud-server-exporter)

Серверный CLI выгружает **саммари** записей Plaud в Markdown для Obsidian. На VPS расписание и уведомления ведёт **Telegram-бот** (long-polling под systemd). В том же репозитории лежит Chrome-расширение **`plaud-exporter/`**, а его модули `common/syncCore.js`, `common/exportPathUtils.js` и `common/plaudFolders.js` импортируются сервером напрямую — это единственный формальный контракт между двумя средами выполнения (см. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

## Состав репозитория

| Каталог                              | Назначение                                                |
| ------------------------------------ | --------------------------------------------------------- |
| [`server/`](server/)                 | Node CLI, Playwright-авторизация, Plaud API, Telegram-бот |
| [`plaud-exporter/`](plaud-exporter/) | Расширение Chrome MV3 + общий код sync/путей              |
| [`docs/`](docs/)                     | Установка, деплой, Syncthing, безопасность                |
| [`deploy/`](deploy/)                 | systemd, logrotate, Docker Compose, Ansible, nginx-пример |

Отдельный репозиторий расширения (исторически): [ksandrpetrov/plaud-exporter](https://github.com/ksandrpetrov/plaud-exporter).

## Сервер (кратко)

|            |                                                                      |
| ---------- | -------------------------------------------------------------------- |
| Хост       | `YOUR_SERVER_HOST` (IP или hostname VPS)                             |
| ОС         | Ubuntu 22.04+ (пример: 1 vCPU, 1 GB RAM)                             |
| На сервере | `server:bot` под systemd — автосинк и отбивки в Telegram             |
| На Mac     | `server:auth` (Playwright + Chrome), перенос `session.json` по `scp` |

Аудио сервер **не** выгружает. Playwright на VPS не запускайте.

## Документация

| Документ                                               | Содержание                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| **[docs/getting-started.md](docs/getting-started.md)** | Mac, VPS, первый sync, Telegram-бот, systemd                       |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)           | Карта кода, общие модули, потоки sync, что трогать при изменении X |
| [docs/server-deploy.md](docs/server-deploy.md)         | Продакшен: systemd или Docker (чеклист)                            |
| [deploy/README.md](deploy/README.md)                   | Docker + Ansible, GHCR, CI deploy                                  |
| [docs/obsidian-sync.md](docs/obsidian-sync.md)         | Syncthing: сервер → Mac                                            |
| [docs/troubleshooting.md](docs/troubleshooting.md)     | Коды выхода, сессия, `scp`, lock, Telegram                         |
| [docs/security.md](docs/security.md)                   | Секреты, логи, ротация сессии                                      |
| [plaud-exporter/README.md](plaud-exporter/README.md)   | Chrome-расширение (установка, попап)                               |
| [server/README.md](server/README.md)                   | CLI, `.env`, Telegram, пути на диске                               |

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
npm install              # ставит deps в server/ + ставит pre-commit хук
cd plaud-exporter && npm install && cd ..

npm run check            # ОДНА команда: lint + typecheck + format:check
                         #   + lint:markdown + verify + tests + smoke
```

Отдельные шаги (если нужно гонять точечно):

```bash
npm run lint             # eslint server, --max-warnings 0
npm run lint:extension   # eslint plaud-exporter
npm run lint:markdown    # markdownlint-cli2 (docs/, README, AGENTS)
npm run typecheck        # JSDoc + tsc --checkJs (server + extension)
npm run format           # prettier --write
npm run format:check     # prettier --check (как в CI)
npm run verify           # импорты server → plaud-exporter/common/*
npm run verify:extension # MV3 dynamic imports + manifest invariants
npm test                 # server/tests (node:test)
npm run test:extension   # plaud-exporter/tests (alias: test:submodule)
npm run test:coverage    # lcov + thresholds (требует Node 22+)
```

Расширение отдельно: `cd plaud-exporter && npm run lint && npm test && npm run verify`.

Pre-commit хук (`simple-git-hooks` + `lint-staged`) ставится при `npm install`. Запускает prettier/eslint/verify-manifest на изменённые файлы. Снять: `git commit --no-verify` или `SKIP_SIMPLE_GIT_HOOKS=1 git commit`.

CI:

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) → переиспользует reusable [`checks.yml`](.github/workflows/checks.yml) на матрице Node 20.x + 22.x при push/PR в `main`: lint, typecheck, format, verify, tests, coverage (на 22.x), npm audit, Docker PR build, smoke.
- [`.github/workflows/infra-lint.yml`](.github/workflows/infra-lint.yml) — actionlint, shellcheck, hadolint, markdownlint в параллельных job-ах.
- [`.github/workflows/codeql.yml`](.github/workflows/codeql.yml) и [`.github/workflows/gitleaks.yml`](.github/workflows/gitleaks.yml) — security/secret сканы (PR + weekly cron).
- [`.github/dependabot.yml`](.github/dependabot.yml) — еженедельные апдейты npm/actions/docker, сгруппированные dev/prod/security.
- Required checks и список политик — в [docs/quality-gate.md](docs/quality-gate.md).

Deploy ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)) на push в `main`: те же reusable `checks.yml` как pre-deploy gate, сборка образа в GHCR (`:sha-*`), smoke; SSH-выкат на VPS **только** если в GitHub Variables задано `PRODUCTION_DOCKER_DEPLOY=true` (иначе systemd-бот на сервере не трогается). См. [deploy/README.md](deploy/README.md).

Локальный Docker: `cp .env.example .env` → `make docker-up` → `curl -s http://127.0.0.1:8080/healthz`.

> Каталог [`plaud-exporter/`](plaud-exporter/) — **не git-submodule**, а вендорный код в монорепо. Скрипт `npm run verify` (исторически `verify-submodule`) проверяет, что `plaud-exporter/common/*.js` существуют и относительные импорты из `server/src/` резолвятся.
