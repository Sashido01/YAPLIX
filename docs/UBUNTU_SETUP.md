# YAPLIX на Ubuntu 24.04

Portable-поставка YAPLIX-INSTALL-002: [установка и запуск](../INSTALL.md), [сборка пакетов](installer-building.md).
Ubuntu: per-user установка без изменения ОС; независимое устройство и Windows — NOT_VERIFIED.

Проверка YAPLIX-UBUNTU-001, 24 октября 2026. Состояние веток и границы доказательств:
[PROJECT_CONTEXT](PROJECT_CONTEXT.md). Общие API, backup и Windows-команды уже
описаны в [development-setup](development-setup.md) и [README](../README.md).
Ни один результат этой локальной задачи не опубликован в GitHub.

## Инструменты

- Git и доступ к приватному `Sashido01/YAPLIX`; `gh auth status` должен проходить
  в обычном терминале с доступом к существующему proxy/keyring.
- Node **24.18+ (24.x)** и npm. Node 22 на данном хосте не подходит launcher.
- Python 3.11+ для repository checks; здесь проверен Python 3.12.
- Linux-браузеры Playwright для тестов; для production LIVE нужен Chromium.
  Телефону Node/SQLite/Chromium не нужны.

Проверенные команды: `node --version`, `npm --version`, `gh auth status`.
В задаче использованы Node 24.18.0 и его npm 11.16.0. Системный Node сохранён.
Установщик Node в системные каталоги не запускался.

В этой перенесённой копии откройте терминал из корня проекта:

```sh
. .local/ubuntu-prep/activate.sh
node --version
npm --version
```

Этот локальный файл добавляет проверенный Node и извлечённые библиотеки
WebKit только в окружение текущего shell. Он не входит в GitHub; путь к скачанным
инструментам записан в `.local/ubuntu-prep/CURRENT_RUN`. Не удаляйте каталог
текущего прогона: он содержит активные инструменты, резерв переноса и evidence.

Для новой Ubuntu-машины можно установить Node штатным способом самостоятельно
или повторить использованный здесь вариант без глобальной установки:

```sh
mkdir -p .local/ubuntu-tools
cd .local/ubuntu-tools
curl -fsSLO https://nodejs.org/dist/v24.18.0/node-v24.18.0-linux-x64.tar.xz
curl -fsSLO https://nodejs.org/dist/v24.18.0/SHASUMS256.txt
grep '  node-v24.18.0-linux-x64.tar.xz$' SHASUMS256.txt | sha256sum -c -
tar -xf node-v24.18.0-linux-x64.tar.xz
cd ../..
export PATH="$PWD/.local/ubuntu-tools/node-v24.18.0-linux-x64/bin:$PATH"
```

Скачивание, сверка SHA-256 и извлечение этой версии проверены в каталоге прогона;
вариант выше с другим именем каталога отдельно не исполнялся. Только Linux x64.
Для ARM нужен соответствующий официальный архив и его контрольная сумма.

## Чистый приватный клон

При уже настроенном доступе GitHub:

```sh
gh auth status
gh repo clone Sashido01/YAPLIX yaplix -- --branch main
cd yaplix
node --version
npm ci
npm run typecheck
npm run build
npm run app
```

Клонирование `main`, `npm ci`, typecheck, build и launcher проверены независимо
в `.local/ubuntu-prep/<run>/clean-clone`. Lock-файл не менялся. Исходный `main`
не содержит Arena из Draft PR #53. Не копируйте `.env`, SQLite, `node_modules`
или `.local/playwright` из перенесённой копии в чистый тест.

Основной запуск из корня проекта — `./yaplix.sh`: скрипт автоматически ставит локальный Node.js 24.x (без nvm и sudo, системный Node не трогает), проверяет SHA-256 скачанного runtime, готовит зависимости, сам выбирает свободный порт из диапазона 3000–3010 при занятом (чужой процесс не трогает) и печатает фактический адрес — фиксированный `localhost:3000` не гарантируется. Откройте напечатанный адрес.
Для ручного server: `npm run build`, затем `npm start`. Windows-инструкции в этом разделе не применяются. Остановка: Ctrl+C;
дождитесь закрытия SQLite и освобождения порта. `npm run app -- --no-open`
проверен для запуска без автоматического открытия вкладки.

Для проверки без inference и Telegram можно запустить launcher так:

```sh
LIVE_PROVIDER=none TELEGRAM_BOT_TOKEN='' TELEGRAM_ALLOWED_USER_IDS='' \
TELEGRAM_UPDATES=off YAPLIX_DB=.local/ubuntu-offline/data.sqlite npm run app -- --no-open
```

Комбинация этих параметров проверена smoke-скриптом с отдельной БД и свободным
портом. Process env имеет приоритет над `.env`. Авторские игры доступны через
«Игры» и помечены «офлайн»; их сохранение не подтверждает LIVE-генерацию.
Существующий `.env` и пользовательскую БД не заменяйте. При необходимости нового
env используйте `.env.example`, только если `.env` ещё отсутствует.

## Перенос Windows → Ubuntu

Сначала `git status --short --branch`. Сохраните данные, `.env`, DB/WAL/SHM,
эксперименты и незакоммиченные изменения. Основную ветку при аудите не переключайте.

1. Активируйте подходящий Node.
2. Сохраните Windows `node_modules` под новым именем внутри `.local/`, затем
   выполните `npm ci`. Наблюдавшийся отказ: `tsc` вызывает `node.exe`.
   После установки Linux dependencies typecheck/build проходят.
3. Сохраните Windows `.local/playwright` отдельно, затем выполните
   `npm run browsers:install`. Playwright может вернуть exit 0 по старым
   `INSTALLATION_COMPLETE`, хотя Linux executable отсутствует.
4. Пересоберите `npm run build`; старый `build` не служит доказательством запуска.
5. Старые worktree `.git` могут содержать `D:/YAPLIX/...`. Сохраняйте их данные,
   index и refs. Не запускайте prune/clean/reset; сначала инвентаризация и backup,
   затем отдельная проверенная задача `git worktree repair` при необходимости.

В этой задаче исходные dependencies/build/browsers сохранены в текущем каталоге
прогона как `migrated-node_modules`, `migrated-build`, `migrated-playwright`.
Windows-скрипты остаются. Обратная совместимость исходников не менялась;
фактический Windows-run в этой задаче не проводился.

## Chromium sandbox и библиотеки браузеров

```sh
npm run checker:install
# Для frontend-проверок также Firefox/WebKit:
npm run browsers:install
```

Команды установки браузеров проверены. Exit 0 не гарантирует наличие OS libraries:
здесь WebKit сообщил об отсутствии `libevent-2.1-7t64` и `libavif16`.
Также потребовались транзитивные `libgav1-1` и `libyuv0`.
Вместо системной установки пакеты скачаны через `apt-get download`, извлечены
через `dpkg-deb -x` в каталог прогона; `LD_LIBRARY_PATH` задаётся только процессу.
Версии и SHA-256 сохранены в `tools/browser-debs/manifest.json` текущего прогона.
Сами приложения/lock-зависимости не обновлялись.

Для другой Ubuntu 24.04 этот локальный вариант можно повторить в новом каталоге:

```sh
mkdir -p .local/browser-debs .local/browser-libs
cd .local/browser-debs
apt-get download libevent-2.1-7t64=2.1.12-stable-9ubuntu2.2 libavif16=1.0.4-1ubuntu3 \
  libgav1-1=0.18.0-1build3 'libyuv0=0.0~git202401110.af6ac82-1'
for package in ./*.deb; do dpkg-deb -x "$package" ../browser-libs; done
cd ../..
export LD_LIBRARY_PATH="$PWD/.local/browser-libs/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
for variant in minibrowser-wpe minibrowser-gtk; do
  for library in "$PWD"/.local/browser-libs/usr/lib/x86_64-linux-gnu/*.so*; do
    target=".local/playwright/webkit-2370/$variant/sys/lib/$(basename "$library")"
    test -e "$target" || ln -s "$library" "$target"
  done
done
```

Скачивание/извлечение и ссылки указанных пакетов проверены под другим именем каталога.
WebKit wrapper перезаписывает LD_LIBRARY_PATH, поэтому одного export недостаточно:
ссылки нужны именно в его локальном sys/lib. Номер webkit-2370 относится к
закреплённому Playwright 1.64.0; после обновления браузера remedy проверяется заново.
Доступность версий в apt может измениться; не обходите проверку пакетов/TLS.
Обычный системный вариант `node scripts/browser-tests.mjs install --with-deps
chromium webkit firefox` описан upstream-проектом, но **не запускался**: он меняет
системные пакеты и требует отдельного разрешения владельца.

Production checker сохраняет `chromiumSandbox:true`. На данном хосте есть
`/opt/google/chrome/chrome-sandbox`, root:root, 4755; права проверены вне песочницы.
Не отключайте sandbox/AppArmor. Read-only sandbox Codex может показывать владельца
helper как nobody и запрещать socket bind; это не фактические права Ubuntu.
Локальным проверкам портов и Chromium в Codex понадобился scoped approval.

Полный Chromium на Linux использует UNIX socket с ограничением длины пути.
Слишком глубоко вложенный клон дал `Socket path too long` и внешнее
`BROWSER_SANDBOX_UNAVAILABLE`. Созданный задачей клон целиком перенесён в
короткий `.local/ubuntu-prep/c`; старый `<run>/clean-clone` — backlink.
Не считайте этот код доказательством поломки OS sandbox без launch log.

## Проверки и proxy

```sh
npm run typecheck
npm run build
python3 scripts/check_repo.py
python3 -m unittest discover -s scripts/tests -v
git diff --check
```

Эти команды проверены. Отдельного `npm run lint` в проекте нет.
В обычной среде suite запускается `npm test`. Здесь унаследованные proxy ломали
synthetic transport tests и readiness Playwright. Исходный `NO_PROXY` содержит
`127.0.0.0/8`, а YAPLIX поддерживает точные hosts/suffixes/ports, без CIDR.
Кроме loopback, mock-классификация ошибок также ожидает direct route.
Проверенный запуск только **offline tests**, с окружением отдельного процесса:

```sh
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
    -u http_proxy -u https_proxy -u all_proxy npm test
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
    -u http_proxy -u https_proxy -u all_proxy \
    node scripts/browser-tests.mjs test tests/mvp.spec.ts tests/mobile.spec.ts \
    --project chromium-desktop --project chromium-390
```

В отчёте указаны фактически выбранные файлы и проекты. Это процессная изоляция
локальных/mock tests; для `gh`, clone, npm downloads и рабочих HTTP(S) запросов
использован существующий proxy. Глобальные env/Git proxy/auth не менялись.
Не переносите прежний Windows localhost-порт proxy на Ubuntu.

Для browser LAN-self-tests на этом хосте дополнительно использована локальная
конфигурация `<run>/direct-main.config.ts`: Chromium/WebKit получают недоступный
proxy `127.0.0.1:9` и bypass точных localhost/private адресов, Firefox —
`network.proxy.type=0`. Она действует только на созданные тестовые браузеры.
Прямой Node self-probe отвечал 200, Chromium с одним `--no-proxy-server` всё ещё
получал 502; явный bypass вернул 200 с попаданием запроса в listener.
Глобальные GNOME proxy, firewall и рабочий browser profile сохранены.

Повторить проверенную конфигурацию в текущей копии:

```sh
run_dir=$(cat .local/ubuntu-prep/CURRENT_RUN)
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
    -u http_proxy -u https_proxy -u all_proxy \
    node scripts/browser-tests.mjs test --config "$run_dir/direct-main.config.ts" \
    tests/mvp.spec.ts tests/mobile.spec.ts tests/runtime.spec.ts tests/phone.spec.ts tests/arena.spec.ts
```

Эта конфигурация и локальные cache/library remedies не являются изменением
исходников GitHub. В чистом main Arena-тестов нет; его прогон использовал первые
четыре файла. Для релиза всё равно нужны предусмотренные проектом FULL checks.

## LAN, QR и границы

Loopback — исходный режим. «На телефон» использует выбранный активный частный
адрес и scoped ссылку, стабильный порт 52604. Arena этой ветки использует 52605
и свой протокол участников; [инструкция Arena](arena.md). Один QR не означает
доступ к owner API. Выберите одну доверенную сеть компьютера и телефонов.
Firewall/VPN/маршруты автоматически не меняются. Проверка listener/QR с хоста
не доказывает физическое Android/iOS-подключение. Public use требует защищённого
HTTPS; tunnel/Telegram публикация в этой задаче не выполнялись.

Реальные LLM/OAuth/model GET, физические Android/iOS/Telegram и Windows runtime
имеют статус NOT_VERIFIED этой задачи. Данные offline fixtures не являются
доказательством внешней AI-генерации или корректности произвольной LLM-игры.
