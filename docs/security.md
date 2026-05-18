# Безопасность

## Секреты

| Файл | Содержимое |
|------|------------|
| `server/.data/session.json` | JWT и cookies Plaud |
| `server/.data/sync-index.json` | Индекс выгрузки |
| `.env` | Пути (без паролей Plaud) |

Права: `session.json` и `.env` — `600`, каталог `.data` — `700`. Не коммитьте в git.

## Обновить сессию

На Mac (логин в `scp` тот же, что в `ssh` — `YOUR_SSH_USER`; хост — `YOUR_SERVER_HOST`):

```bash
npm run server:auth
ssh YOUR_SSH_USER@YOUR_SERVER_HOST 'echo ok'                            # проверка пароля
scp server/.data/session.json YOUR_SSH_USER@YOUR_SERVER_HOST:/tmp/session.json
```

`Permission denied` при `scp` — раздел «scp: Permission denied» в [troubleshooting.md](troubleshooting.md).  
`EACCES` на `sync.lock` при рабочем `status` — [troubleshooting.md](troubleshooting.md#eacces-synclock-на-сервере).  
Перенос `session.json` на сервере (`sudo mv`, `chown -R plaud:plaud` на `server/.data`, `chmod 700` / `600`) — [getting-started.md](getting-started.md) (блок «Сессия с Mac»).

## Удалить сессию

```bash
node server/src/cli/index.js logout
```

## Компрометация

1. `logout` или удалить `server/.data/session.json`
2. Сменить пароль Plaud в веб-интерфейсе
3. `server:auth` на Mac и новый `scp`
