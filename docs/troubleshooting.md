# Устранение неполадок

## Google блокирует вход при `server:auth`

Войдите в Plaud **email/паролем**, не через Google. Должен быть установлен **Google Chrome** (экспортёр запускает его по умолчанию).

Если мешает старый профиль:

```bash
rm -rf server/.data/playwright-profile
npm run server:auth
```

## Сессия (exit code 2)

На Mac: `npm run server:auth`, затем `scp session.json` на сервер — [getting-started.md](getting-started.md).

На сервере **не** запускайте `server:auth` (1 GB RAM, OOM).

## scp: Permission denied

`scp ... YOUR_SSH_USER@YOUR_SERVER_HOST:/tmp/session.json` возвращает `Permission denied, please try again.` — это **SSH-уровень**, а не права на файлы. Чек-лист:

1. Проверьте логин/пароль через обычный `ssh`. Если он тоже не пускает — пароль ошибочный или провайдер сменил его.

   ```bash
   ssh YOUR_SSH_USER@YOUR_SERVER_HOST 'echo ok'
   ```

2. Если в `ssh` сразу пишет `root@host: Permission denied (publickey)` без запроса пароля — в `/etc/ssh/sshd_config` стоит `PermitRootLogin prohibit-password` или `PasswordAuthentication no`. Войдите через панель провайдера, поправьте на `PermitRootLogin yes` + `PasswordAuthentication yes` и `sudo systemctl reload ssh`. Безопаснее — настроить ключ (ниже).

3. Чтобы перестать вводить пароль и не упираться в эти ошибки — один раз положите свой публичный ключ на сервер:

   ```bash
   ssh-copy-id YOUR_SSH_USER@YOUR_SERVER_HOST
   ```

   После этого `ssh`/`scp` пускают по ключу `~/.ssh/id_rsa` без пароля.

4. Угловые скобки (`<user>`, `<host>`) в команде дают `zsh: no such file or directory: …` — это перенаправление ввода, а не плейсхолдер. Подставляйте логин/хост напрямую (например `YOUR_SSH_USER@YOUR_SERVER_HOST`).

## Plaud изменил API (exit code 3)

Смотрите `{export}/_errors/*.md` и логи. Нужно обновить `server/src/plaud/plaudApiClient.js` под новый API.

## EACCES sync.lock на сервере

**Симптом:** `npm run server:status` от `plaud` показывает сессию (`session.snapshot.present: true`), а `npm run server:sync` падает:

```text
EACCES: permission denied, open '/srv/plaud-exporter/server/.data/sync.lock'
```

В `_errors/` может быть отчёт с `kind: write_error`, `stage: sync`.

**Причина:** каталог `server/.data` создан или принадлежит **root** (часто после `sudo mkdir` + `chown` только на `session.json`), либо sync когда-то запускали не от `plaud`. Пользователь `plaud` читает `session.json`, но не может создавать в каталоге `sync.lock` и `sync-index.json`.

### Пошагово

1. Подключитесь к серверу по SSH.

2. Проверьте владельца каталога и файлов:

   ```bash
   ls -la /srv/plaud-exporter/server/.data
   ```

   Ожидается: каталог `drwx------ plaud plaud`, `session.json` — `-rw------- plaud plaud`.  
   Если у `.data` владелец `root` — это и есть ошибка.

3. Исправьте права на служебный каталог:

   ```bash
   sudo chown -R plaud:plaud /srv/plaud-exporter/server/.data
   sudo chmod 700 /srv/plaud-exporter/server/.data
   sudo chmod 600 /srv/plaud-exporter/server/.data/session.json
   ```

4. Удалите зависший lock, если он остался от запуска под root:

   ```bash
   sudo rm -f /srv/plaud-exporter/server/.data/sync.lock
   ```

5. Убедитесь, что каталог выгрузки тоже доступен `plaud`:

   ```bash
   sudo chown -R plaud:plaud /srv/plaud-exporter/exports
   ls -la /srv/plaud-exporter/exports
   ```

6. Повторите проверку **только от пользователя plaud** (не `npm run server:sync` от root):

   ```bash
   sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:status'
   sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:sync'
   ```

7. После успешного sync снова посмотрите `.data` — должны появиться `sync-index.json` и при необходимости `sync.lock` (кратко на время sync), все с владельцем `plaud`:

   ```bash
   ls -la /srv/plaud-exporter/server/.data
   ```

**Чтобы не повторилось:** на сервере `git`, `npm`, `server:sync` — только `sudo -u plaud …`. Не запускайте sync в `/srv/plaud-exporter` от root. При переносе сессии с Mac — `chown -R plaud:plaud` на весь `server/.data`, см. [getting-started.md](getting-started.md).

## Файлы не появляются

```bash
npm run server:status    # session.present, exportRoot
```

Права на `PLAUD_EXPORT_ROOT` у пользователя `plaud`. Ошибки — в `_errors/`.

## Sync уже идёт (exit code 4)

Не запускайте `server:sync` вручную одновременно с systemd timer. Подождите или проверьте `server/.data/sync.lock`.

## `npm: command not found` на сервере

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

## `dubious ownership` в git

Команды только от `plaud`: `sudo -u plaud git -C /srv/plaud-exporter …`. При необходимости: `sudo chown -R plaud:plaud /srv/plaud-exporter`.
