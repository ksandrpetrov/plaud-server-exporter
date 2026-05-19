# Деплой сервера

Пошаговая настройка production-запуска на Ubuntu. Первый вход в Plaud и обновление сессии делаются на Mac; на сервере работает только `server:sync`.

## Целевой сервер

| Параметр | Обычное значение |
|----------|------------------|
| ОС | Ubuntu 22.04 LTS или новее |
| CPU / RAM | 1 vCPU, 1 GB RAM как минимальный VPS |
| Диск | Summary-only выгрузки занимают мало места, обычно KB на встречу |

Практические выводы:

- Не запускайте `npm run server:auth` на сервере: Playwright может съесть память. Auth делается на Mac, потом копируется `session.json`.
- `npm run server:sync` без audio обычно потребляет около 80-150 MB RSS и подходит для VPS на 1 GB RAM.
- Если `npm install` не проходит из-за памяти, добавьте swap на 2 GB.
- Серверный exporter не скачивает audio и не поддерживает `--audio-too`.

## Установка один раз

```bash
sudo apt update && sudo apt install -y curl ca-certificates git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

sudo useradd --system --create-home --home-dir /srv/plaud-exporter --shell /usr/sbin/nologin plaud
sudo mkdir -p /var/log/plaud-exporter
sudo chown plaud:plaud /var/log/plaud-exporter

sudo -u plaud git clone https://github.com/ksandrpetrov/plaud-server-exporter.git /srv/plaud-exporter
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm install --workspaces'

sudo -u plaud bash -lc 'cd /srv/plaud-exporter && cp .env.example .env && chmod 600 .env'
sudo -u plaud nano /srv/plaud-exporter/.env
sudo -u plaud mkdir -p /srv/plaud-exporter/exports
```

Пример `.env` на сервере:

```env
PLAUD_EXPORT_ROOT=/srv/plaud-exporter/exports
PLAUD_TIMEZONE=Europe/Moscow
PLAUD_LOG_LEVEL=info
```

## Сессия с Mac

На Mac, в локальном клоне репозитория:

```bash
npm run server:auth
scp server/.data/session.json YOUR_SSH_USER@YOUR_SERVER_HOST:/tmp/session.json
```

На сервере:

```bash
sudo install -d -o plaud -g plaud -m 700 /srv/plaud-exporter/server/.data
sudo install -o plaud -g plaud -m 600 /tmp/session.json /srv/plaud-exporter/server/.data/session.json
```

Проверка:

```bash
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:status'
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:sync -- --dry-run'
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:sync'
```

Опциональная обёртка:

```bash
sudo /srv/plaud-exporter/scripts/server-as-plaud.sh npm run server:sync
```

## Systemd timer каждые 2 часа

```bash
sudo cp /srv/plaud-exporter/deploy/systemd/plaud-exporter.service /etc/systemd/system/
sudo cp /srv/plaud-exporter/deploy/systemd/plaud-exporter.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now plaud-exporter.timer
sudo cp /srv/plaud-exporter/deploy/logrotate/plaud-exporter /etc/logrotate.d/plaud-exporter
```

Unit запускает `npm run server:sync` от пользователя `plaud`: только summary, без audio.

## Логи и статус

```bash
journalctl -u plaud-exporter.service -n 50 --no-pager
tail -n 50 /var/log/plaud-exporter/sync.log
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run server:status'
systemctl list-timers plaud-exporter.timer --no-pager
```

Ненулевые коды выхода делают `oneshot` unit failed, это удобно для мониторинга.

| Код | Значение |
|-----|----------|
| `0` | Успех |
| `1` | Ошибка sync, смотреть `_errors/` |
| `2` | Нужен re-auth на Mac и новый `scp session.json` |
| `3` | Plaud изменил API, смотреть `_errors/` |
| `4` | Пересечение запусков, проверить timer и `sync.lock` |

## Обновление кода и перезапуск

Этот flow нужен, когда вы обновили код на сервере. Он не трогает Cassini Web и бота по встречам: перезапускается только Plaud exporter service/timer.

```bash
# 1. Остановить расписание, чтобы sync не стартовал во время обновления
sudo systemctl stop plaud-exporter.timer

# 2. Если sync сейчас выполняется, дождаться завершения или остановить unit
sudo systemctl status plaud-exporter.service --no-pager
sudo systemctl stop plaud-exporter.service

# 3. Обновить код
sudo -u plaud git -C /srv/plaud-exporter status --short
sudo -u plaud git -C /srv/plaud-exporter pull --ff-only

# 4. Обновить зависимости
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm install --workspaces'

# 5. Проверить проект
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm test'
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run lint'
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run verify'
sudo -u plaud bash -lc 'cd /srv/plaud-exporter && npm run test:submodule'

# 6. Перечитать systemd unit-файлы на случай изменений
sudo systemctl daemon-reload

# 7. Запустить ручной sync один раз и проверить результат
sudo systemctl start plaud-exporter.service
sudo systemctl status plaud-exporter.service --no-pager
journalctl -u plaud-exporter.service -n 100 --no-pager

# 8. Вернуть расписание
sudo systemctl enable --now plaud-exporter.timer
systemctl list-timers plaud-exporter.timer --no-pager
```

Если `git status --short` показывает локальные изменения на сервере, не делайте `git reset --hard` вслепую. Сначала разберитесь, кто и зачем их внёс.

## Быстрый перезапуск без обновления кода

Используйте, когда нужно просто вручную запустить exporter заново:

```bash
sudo systemctl restart plaud-exporter.service
sudo systemctl status plaud-exporter.service --no-pager
journalctl -u plaud-exporter.service -n 100 --no-pager
```

Timer при этом можно не трогать: `plaud-exporter.service` одноразовый.

## Обновление Plaud-сессии

Если sync завершился с exit `2`, обновите сессию.

```bash
# На Mac
npm run server:auth
scp server/.data/session.json YOUR_SSH_USER@YOUR_SERVER_HOST:/tmp/session.json

# На сервере
sudo install -d -o plaud -g plaud -m 700 /srv/plaud-exporter/server/.data
sudo install -o plaud -g plaud -m 600 /tmp/session.json /srv/plaud-exporter/server/.data/session.json
sudo systemctl start plaud-exporter.service
journalctl -u plaud-exporter.service -n 100 --no-pager
```

После успешного запуска timer продолжит работать по расписанию.

## Соседство с другими сервисами

- Используйте отдельного пользователя `plaud` и путь `/srv/plaud-exporter`; не запускайте sync от root.
- Каталог выгрузки отдельный (`exports/`), поэтому он безопасно живёт рядом с Cassini Web и ботами при нормальном контроле диска.
- На один `server/.data` должен быть только один планировщик `server:sync`; локальный `sync.lock` защищает один хост, но не заменяет дисциплину на shared storage.

## Cron вместо systemd

Если нужен cron:

```cron
0 */2 * * * plaud cd /srv/plaud-exporter && /usr/bin/npm run server:sync >> /var/log/plaud-exporter/sync.log 2>&1
```

Не используйте cron и systemd timer одновременно для одного и того же `server/.data`.
