# Безопасность

## Где лежат секреты

| Путь | Содержимое | Права |
|------|------------|-------|
| `server/.data/session.json` | JWT Plaud, cookies, id workspace | `600`, каталог `700` |
| `server/.data/playwright-profile/` | Профиль браузера (могут быть cookies) | в `.gitignore` |
| `.env` | Пути, тюнинг, `TELEGRAM_BOT_TOKEN` — **без паролей Plaud** | `600` |
| `server/.data/owner-chat.json` | `chatId` владельца для уведомлений бота | рекомендуется `600` |
| `server/.data/bot-settings.json` | Интервал автосинка из меню бота | рекомендуется `600` |
| `server/.data/telegram-offset.json` | Смещение `getUpdates` (не секрет, но локальное состояние) | рекомендуется `600` |
| `server/.data/sync-index.json` | Пути, хеши, названия — не токены | рекомендуется `600` |

**Не коммитьте:** `.env`, `session.json`, `playwright-profile/`, `owner-chat.json`, деревья экспорта с реальными данными.

`TELEGRAM_BOT_TOKEN` храните только в `.env` на сервере. При утечке — отзовите токен в @BotFather и выпустите новый.

## Чего не должно быть в логах и `_errors/`

Перед записью `_errors/*.md` и структурированных логов сервер редактирует:

- заголовки `Authorization` и Bearer-токены
- cookies и `Set-Cookie`
- ключи localStorage `pld_*`
- строки в формате JWT и длинные hex-секреты
- токены Telegram (`123456789:AAF…`) и URL `api.telegram.org/bot…`

Для диагностики используйте `/var/log/plaud-exporter/bot.log` и `sync.log` после сбоя — не вставляйте сырой `session.json` и не копируйте `.env` целиком.

## Доступ к Telegram-боту

- Команды sync, статус и настройки — только для `TELEGRAM_ALLOWED_USERNAME` (без `@`, lowercase).
- Остальные пользователи для этих команд **молча игнорируются**; `/start` и `/help` отвечают короткой подсказкой, что бот приватный.
- Первый `/start` от владельца записывает `chat_id` в `owner-chat.json` — туда уходят отбивки по расписанию.

Перепривязка чата: удалите `owner-chat.json`, перезапустите бот, снова `/start`. См. [server-deploy.md](./server-deploy.md#сброс-owner-chat).

## Обновить сессию

На Mac:

```bash
npm run server:auth
scp server/.data/session.json YOUR_SSH_USER@YOUR_SERVER_HOST:/tmp/session.json
# на сервере: install + chown plaud (см. getting-started.md)
```

После замены сессии перезапустите бот: `sudo systemctl restart plaud-exporter.service`.

## Удалить сессию

```bash
node server/src/cli/index.js logout
```

Профиль Playwright сохраняется (быстрее повторный вход). Чтобы сбросить полностью:

```bash
rm -rf server/.data/playwright-profile
```

## Если сессия скомпрометирована

1. `logout` или удалите `server/.data/session.json` на Mac и на сервере.
2. Смените пароль Plaud в веб-интерфейсе.
3. Снова `server:auth` и разверните новый `session.json`.

Если утёк `TELEGRAM_BOT_TOKEN` — отзовите в BotFather, обновите `.env`, `systemctl restart plaud-exporter.service`.

## Безопасная работа на сервере

- Sync и бот — от пользователя `plaud`, не от root.
- После `sudo install` сессии владелец файлов — `plaud:plaud`, каталог `.data` — `700`.
- Ограничьте SSH; для `scp` предпочтительнее ключ (`ssh-copy-id`), не пароль.

## Что можно присылать в поддержку

Можно:

- вывод `npm run server:status` (без значений токенов)
- `_errors/*.md` из корня экспорта (уже с редактированием)
- коды выхода и строки `journalctl` / хвост `bot.log` (после проверки на токены)

Нельзя:

- `session.json`, `.env`, `owner-chat.json`
- полные debug-логи с `PLAUD_LOG_LEVEL=debug` без проверки на токены
