# Безопасность

## Где лежат секреты

| Путь | Содержимое | Права |
|------|------------|-------|
| `server/.data/session.json` | JWT Plaud, cookies, id workspace | `600`, каталог `700` |
| `server/.data/playwright-profile/` | Профиль браузера (могут быть cookies) | в `.gitignore` |
| `.env` | Пути, тюнинг, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_ID`, `TELEGRAM_ALLOWED_USERNAME` — **без паролей Plaud** | `600` |
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

Бот защищён тремя независимыми проверками — все три должны пройти, иначе апдейт молча отбрасывается без единой реакции в Telegram:

1. **`chat.type === "private"`** — бот работает только в личке. Сообщения и нажатия кнопок из групп/каналов/супергрупп игнорируются. Это закрывает сценарий «бот добавлен в группу → автоматический синк-репорт уходит всем участникам».
2. **`from.id === TELEGRAM_ALLOWED_USER_ID`** — стабильный числовой id владельца. Telegram-username можно сдать и кто-то его перехватит; user_id не меняется. Узнать свой id: `@userinfobot` или `getUpdates` после первого `/start`.
3. **`from.username === TELEGRAM_ALLOWED_USERNAME`** (опционально, защита-в-глубину) — если задан вместе с `TELEGRAM_ALLOWED_USER_ID`, должны совпасть **оба**. Только username (без id) тоже поддерживается, но при старте логируется warning — рекомендация задать id.

`/start` и `/help` от посторонних теперь **молчат** (раньше отвечали `BOT_PRIVATE_HINT`). Команды бота, callback’и инлайн-кнопок, отправка `.md`-файлов через дерево синка — всё закрыто за этими тремя проверками.

Первый `/start` от владельца **в личном чате** записывает `{chatId, username, userId}` в `owner-chat.json`. Файл **пиннится** к этому `chatId`: повторный `/start` из другого чата (например, из группы или под перехваченным username) отвергается — `saveOwnerChat` возвращает `{ status: "rejected" }` и пишет warning в лог. Это значит, что даже если кто-то заберёт username, он не сможет сдвинуть scheduled-синки на свой чат, не получив физического доступа к серверу.

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
