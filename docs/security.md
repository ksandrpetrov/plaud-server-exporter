# Безопасность

## Где лежат секреты

| Путь | Что внутри | Права |
|------|------------|-------|
| `server/.data/session.json` | Plaud JWT, cookies, workspace id | файл `600`, каталог `700` |
| `server/.data/playwright-profile/` | Профиль браузера, может содержать cookies | в `.gitignore` |
| `.env` | Пути и настройки, **без паролей Plaud** | `600` |
| `server/.data/sync-index.json` | Пути файлов, hash, названия встреч; auth-токенов нет | желательно `600` |

**Никогда не коммитьте:** `.env`, `session.json`, `playwright-profile/`, реальные export-папки с данными.

## Чего не должно быть в логах и error-файлах

Перед записью `_errors/*.md` и structured logs сервер редактирует:

- заголовки `Authorization` и Bearer-токены;
- cookies и `Set-Cookie`;
- Plaud `pld_*` ключи из `localStorage`;
- строки, похожие на JWT;
- длинные hex-секреты.

Если нужно отправить диагностику, берите `/var/log/plaud-exporter/sync.log` и `_errors/*.md` после сбоя. Не вставляйте в переписку сырой `session.json`.

## Обновление сессии

На Mac:

```bash
npm run server:auth
scp server/.data/session.json YOUR_SSH_USER@YOUR_SERVER_HOST:/tmp/session.json
```

На сервере:

```bash
sudo install -d -o plaud -g plaud -m 700 /srv/plaud-exporter/server/.data
sudo install -o plaud -g plaud -m 600 /tmp/session.json /srv/plaud-exporter/server/.data/session.json
sudo systemctl start plaud-exporter.service
journalctl -u plaud-exporter.service -n 100 --no-pager
```

Подробный production-flow: [server-deploy.md#обновление-plaud-сессии](./server-deploy.md#обновление-plaud-сессии).

## Удаление сессии

Локально:

```bash
node server/src/cli/index.js logout
```

Профиль Playwright сохраняется для более быстрого повторного входа. Полностью удалить профиль:

```bash
rm -rf server/.data/playwright-profile
```

На сервере:

```bash
sudo rm -f /srv/plaud-exporter/server/.data/session.json
```

## Если сессия скомпрометирована

1. Удалите `server/.data/session.json` на Mac и сервере.
2. Смените пароль Plaud в веб-интерфейсе.
3. Запустите `npm run server:auth` заново на Mac.
4. Передайте новый `session.json` на сервер через flow выше.

## Безопасные операции на сервере

- Запускайте sync от пользователя `plaud`, не от root.
- После любого `sudo mv` или `sudo install` сессии проверяйте владельца:
  ```bash
  sudo chown -R plaud:plaud /srv/plaud-exporter/server/.data
  sudo chmod 700 /srv/plaud-exporter/server/.data
  sudo chmod 600 /srv/plaud-exporter/server/.data/session.json
  ```
- Ограничьте SSH-доступ; для `scp` лучше использовать ключи и `ssh-copy-id`, а не пароль.
- Не запускайте `npm run server:auth` на сервере с 1 GB RAM.

## Что можно отправлять для диагностики

Можно:

- вывод `npm run server:status` без токенов;
- `_errors/*.md` из export root, они уже redacted;
- exit code;
- последние строки `journalctl -u plaud-exporter.service -n 100 --no-pager`;
- версии Node/npm.

Нельзя:

- `server/.data/session.json`;
- содержимое `server/.data/playwright-profile/`;
- полный `.env`, если там появились приватные пути или комментарии;
- debug-логи с `PLAUD_LOG_LEVEL=debug`, пока вы вручную не проверили, что там нет секретов.
