# Quality Gate

Документ описывает, как устроен текущий quality gate и какие проверки должны быть обязательными в branch protection main.

## Источники правды

- **Локально / в CI**: один и тот же набор шагов запускается через `npm run check` и через reusable workflow `.github/workflows/checks.yml`.
- **Pre-commit (опционально, ставится `npm install` через `prepare`)**: `simple-git-hooks` + `lint-staged` запускают prettier/eslint/manifest verify на изменённые файлы. Конфиг лежит в [.lintstagedrc.mjs](../.lintstagedrc.mjs); ESLint диспатчится по воркспейсам через [scripts/lint-staged-eslint.mjs](../scripts/lint-staged-eslint.mjs), потому что флэт-конфиг ESLint находится внутри `server/` и `plaud-exporter/`, а не в корне.
- **PR template**: [.github/PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md) — короткий чек-лист.
- **CODEOWNERS**: [.github/CODEOWNERS](../.github/CODEOWNERS) — авто-reviewer на shared/CI/деплой пути.

## Layout: что запускается и когда

```mermaid
flowchart TD
  PreCommit[pre-commit: lint-staged] -->|local| Push
  Push --> CI[ci.yml]
  PR[pull_request → main] --> CI
  CI -->|matrix 20.x + 22.x| Reusable[checks.yml]
  Reusable --> Lint[eslint --max-warnings 0]
  Reusable --> Format[prettier --check]
  Reusable --> Types[tsc --checkJs --noEmit]
  Reusable --> Verify[verify shared + verify-extension + manifest]
  Reusable --> Tests[node --test]
  Reusable --> Cov[test:coverage + thresholds + artifact]
  Reusable --> Smoke[smoke_container + deploy-script ordering tests]
  Reusable --> Audit[npm audit --omit=dev --audit-level=high]
  Reusable --> Docker[docker build --load + docker-smoke]
  CodeQL[codeql.yml weekly + PR] --> SARIF
  Gitleaks[gitleaks.yml weekly + PR] --> SecretFindings
  Infra[infra-lint.yml on PR] --> Actionlint
  Infra --> Shellcheck
  Infra --> Hadolint
  Infra --> Markdownlint
  Dependabot[dependabot.yml] --> PR
  CI -->|on push main / tags v*| Deploy[deploy.yml]
  Deploy -->|reuses checks.yml| Build
  Build --> DeploySSH[deploy-docker / deploy-systemd]
```

## Required status checks (branch protection main)

Поставить как **Required** в Branch Protection Rules:

| Check name (GitHub UI)                                     | Source                             |
| ---------------------------------------------------------- | ---------------------------------- |
| `CI / Checks (Node 20.x) / Lint, verify, test (Node 20.x)` | `.github/workflows/ci.yml` matrix  |
| `CI / Checks (Node 22.x) / Lint, verify, test (Node 22.x)` | `.github/workflows/ci.yml` matrix  |
| `Infra lint / actionlint (workflows)`                      | `.github/workflows/infra-lint.yml` |
| `Infra lint / shellcheck (scripts/, deploy/)`              | `.github/workflows/infra-lint.yml` |
| `Infra lint / hadolint (Dockerfile)`                       | `.github/workflows/infra-lint.yml` |
| `Infra lint / markdownlint (docs)`                         | `.github/workflows/infra-lint.yml` |
| `CodeQL / CodeQL JavaScript/TypeScript`                    | `.github/workflows/codeql.yml`     |
| `gitleaks / Secret scan`                                   | `.github/workflows/gitleaks.yml`   |

Дополнительно включить:

- "Require branches to be up to date before merging" — гарантирует, что главный `checks.yml` запускается на свежем main.
- "Require linear history" — упрощает откаты.
- "Restrict who can push to matching branches" — никто, кроме CI и владельца.
- "Do not allow bypassing the above settings" — обязательно.

## Локальная команда воспроизводящая CI

```bash
npm install                # ставит deps + хук simple-git-hooks
npm run check              # = lint + lint:extension + typecheck + format:check
                           #   + lint:markdown + verify + verify:extension
                           #   + test + test:extension + smoke_container
```

Coverage по умолчанию выделена в отдельную команду (Node 22+):

```bash
npm run test:coverage      # требует Node 22+: lcov + thresholds в scripts/
```

Готовый Docker smoke (требует Docker):

```bash
bash scripts/docker-smoke-image.sh plaud-exporter:smoke   # build + smoke run
```

## Ratchet plan

Гейт сознательно прагматичный, чтобы не ломать поток разработки. Параметры, которые планируется поднимать:

- `tsc --strictNullChecks: false` → `true` после прохода по сервису null-safety.
- `MD040`/`MD031`/`MD029` уже включены — далее можно подсветить ещё.
- Coverage thresholds в [scripts/coverage-thresholds.\*.json](../scripts/) могут расти по мере роста реального покрытия.
- `npm audit --audit-level=high` → `moderate`, как только подтянем оставшиеся patch-uplifts.
- Шаблоны JSDoc в god-файлах (`audioExport.js`, `popup.js`, `background.js`) — отдельный backlog, временно исключены из tsconfig.

См. [AGENTS.md](../AGENTS.md) для карты репозитория и команд.
