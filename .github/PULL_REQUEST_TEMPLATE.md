<!--
  Краткий шаблон. Проверь чек-лист и удали неактуальные подсказки.
-->

## Summary

<!-- 1-3 строки: что и зачем. Без «обновил файл X». Объясни поведение. -->

## Risk / Scope

- [ ] Shared `browser-extension/common/*` (см. AGENTS.md — список 7 файлов): затронул?
- [ ] Поведение sync (`syncCore.js` / `syncRunner.js` / `audioExport.js`): изменилось?
- [ ] Plaud HTTP контракт (`recordingsApi.js`, `summariesApi.js`): новые endpoints/поля?
- [ ] Telegram UX (handlers/messages/keyboards): меняется ли UI копия?
- [ ] Деплой/инфра (Dockerfile, deploy/, scripts/ci-deploy-\*): требует release notes?

## Tests / Verification

- [ ] `npm run check` зелёный локально (lint, typecheck, format, verify, tests, smoke)
- [ ] Новые/изменённые юнит-тесты добавлены
- [ ] Manual smoke (если требуется): какой сценарий, какой результат

## Notes for review

<!-- Что особенно посмотреть, какие компромиссы приняты, что в backlog. -->
