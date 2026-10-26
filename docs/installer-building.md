# Portable-поставка YAPLIX: сборка и проверка

Пользовательский сценарий — [INSTALL](../INSTALL.md). INSTALL-002 заменяет DEB
из INSTALL-001 на per-user установку. Нельзя менять ОС, системные зависимости,
существующие программы, firewall, AppArmor или глобальный Node. Нельзя требовать
административные права. DEB из `.local/install-001` остаётся историческим артефактом;
системно его не устанавливать.

## Единая сборка Lite и Full

На целевой ОС используйте `scripts/build-installers.py`: он последовательно
вызывает существующие `package-desktop.py` и `package-installer.py`, проверяет
закреплённый SHA256 официального Node 24.18.0 и пишет оба пакета с checksums в
новый каталог. Это инструмент разработчика; готовому пакету Python, npm,
компилятор и NSIS не нужны.

```sh
python3 scripts/build-installers.py --platform linux \
  --node-archive /absolute/node-v24.18.0-linux-x64.tar.xz \
  --shasums /absolute/SHASUMS256.txt \
  --browsers /absolute/playwright-browsers \
  --output .local/new-installer-build
```

В Windows укажите `--platform windows`, официальный `win-x64.zip`, Windows browser
cache и новый каталог вывода; сборка NSIS/nodew выполняется на Windows. Сборка
на Ubuntu не подтверждает Windows runtime. Выполняйте `npm ci` и `npm run build`
с Node 24.18.0 до сборки. Сверьте `.sha256` с фактическими пакетами. Для
GitHub Releases загрузите только проверенные `.run`/`.exe` и `.sha256` от одного
точного commit, укажите source SHA и результаты runtime acceptance в описании;
не добавляйте бинарники в Git и не публикуйте неподтверждённый Windows PASS.

При запуске из исходного клона `install.sh`/`install-windows.ps1` находят
изолированный Node в профиле или загружают официальный архив с закреплённым
SHA256. SHA256 извлечённого исполняемого файла тоже закреплён и сверяется при
каждом повторном запуске; при обновлении Node синхронизируйте version и digest
в `install.sh`, `install-windows.ps1`, `package-desktop.py` после проверки
официальных архивов. `install-source.mjs` принимает только чистый Git-клон,
проверяет наличие Chrome перед npm, использует личный npm-кэш, временно делает
`npm ci`, build и production-only
payload, затем вызывает общий `install-ui.mjs`/`install-engine.mjs`. Исходный
клон и системный Node не меняются; временная сборка удаляется после мастера.
Пакетный `.run`/`.exe` сразу передаёт готовый payload этому же ядру.

## Минимальная архитектура

Сохраняются Node 24.18.0, Hono, встроенная SQLite, обычный браузер и существующий
`scripts/desktop.mjs` / `app-runtime.ts`. Никаких Electron, Qt, Docker, VM, новых
серверных компонентов приложения или менеджеров системных пакетов.

Linux `.run` — небольшой ELF bootstrap с архивом приложения. Bootstrap использует
только libc и стандартные Ubuntu tar/xz/sha256sum, сверяет встроенный SHA256 до
исполнения payload, распаковывает его в личный временный каталог, запускает
встроенный Node и удаляет только свой временный каталог после выхода мастера.
GUI мастера — статическая страница в системном браузере, обслуживаемая временным
loopback HTTP listener. После готовности страница переходит в прежний интерфейс
YAPLIX. Код установщика не является новым backend приложения.
Windows NSIS — только per-user экстрактор; та же Node-цепочка выполняет работу.
Никаких root scripts, UAC elevation, реестра системных настроек и apt.

`scripts/install-engine.mjs` реализует CHECK → PLAN → PREPARE → INSTALL → VERIFY →
LAUNCH. `install-adapter.mjs` проверяет ОС/архитектуру, Node из пакета, библиотеки,
целостность payload, доступность записи, свободное место, текущую версию и
read-only quick_check базы. CHECK не открывает Store и не запускает миграции.
Интернет не проверяется, когда загрузки не нужны: обе поставки автономны.

Файлы программы размещаются в `~/.local/share/yaplix-program/versions/<hash>`;
данные — отдельно в `~/.local/share/yaplix`. Учитывается XDG_DATA_HOME.
Windows: `%LOCALAPPDATA%\Programs\YAPLIX` и `%LOCALAPPDATA%\YAPLIX` соответственно.
Установщик записывает только свои каталоги, свои меню в пользовательском профиле
и временные файлы. В тестах все эти пути перенаправляются в репозиторий через
`--test-profile ABSOLUTE_PATH`; штатная SQLite не открывается.

Перед обновлением проверяется/останавливается свой прежний backend, создаётся
SQLite backup, новый кандидат копируется в отдельный каталог. Только после
API/UI и настоящего protected Chromium probe обновляются shortcuts/current.json.
Старые версии сохраняются. Журнал транзакции позволяет вернуть предыдущий указатель
и ярлыки после прерывания. Неизвестные DB/настройки не перезаписываются. Автоматический
возврат SQLite поверх новых данных не выполняется; существующие миграции Store
сохраняют свои защитные копии. Это не произвольный downgrade всех будущих схем.

Повторный запуск значка вызывает прежний desktop launcher без мастера; повторный
запуск установщика сверяет snapshot и переиспользует совпадающие файлы. Lock не
позволяет двум установщикам менять приложение параллельно. Чужие PID не уничтожаются.
Прерванный незавершённый staging не становится текущей версией.

## Лёгкий и полный варианты

**Lite:** встроенный Node + приложение и зависимости из lockfile, без Chromium.
Используется только официальный Playwright `channel: 'chrome'`, а не произвольный
`executablePath` или любой браузер пользователя. На текущей Ubuntu проверен
Google Chrome 152.0.7977.82 с playwright-core 1.64.0: sandbox true, production
strict checker, принят Canvas fixture и отклонён DOM fixture. После обновления
системного Chrome совместимость может измениться; установленный браузер YAPLIX
не обновляет. Сбой не переключает браузер и не ослабляет validator.
[Каналы Playwright](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge).

**Full:** Chromium revision 1248 и его `chromium_headless_shell-1248`, Node и
отдельные нужные библиотеки. Production validator и установочный probe явно
запускают поставляемый headless-shell с sandbox; обычный Chromium остаётся для
UI-проверок. При пересборке проверьте production browser-check на готовой
Canvas/WebGL-игре, а не только запуск браузера.
Библиотеки копируются в `lib/`, glibc/loader не подменяются. Для каждой библиотеки
проверяется checksum установленного Ubuntu-пакета через dpkg metadata, фиксируются
package/version/SHA256 и лицензия в `packaging/libraries.json` / `licenses/`.
Это provenance доверенного build host, а не новая независимая проверка upstream
архивов. Не использовать непроверенный или изменённый build host.
`LD_LIBRARY_PATH` задаётся только дочерним процессам приложения/Chromium.
Отсутствующие несовместимые компоненты не устанавливаются в ОС.

В обоих режимах `chromiumSandbox:true` обязателен. Существующий подходящий
root-owned Chromium sandbox helper может использоваться без модификации; иначе
Chromium должен иметь разрешённый ОС user namespace sandbox. User-owned setuid
helper не используется. На Ubuntu с запрещёнными user namespaces и без разрешённого
helper Full может оказаться несовместимым: установщик выдаст SANDBOX и сохранит
предыдущую версию. Никакого `--no-sandbox` или изменения AppArmor не допускается.
Full нужен только когда нет совместимого Chrome; не устанавливать оба варианта
без необходимости. Размер определяется включённым runtime, а не оболочкой.

## Воспроизводимая локальная сборка Ubuntu

Используйте Node 24.18.0 из проверенного официального архива, текущий lockfile
и `npm ci && npm run build`. Укажите пути к отдельно полученным официальному
Node archive, его SHASUMS256.txt и Linux Playwright browser cache. Проверьте,
что browser cache содержит `chromium-1248/chrome-linux64/chrome` и
`chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell`;
`npm run checker:install` может подготовить его в `.local/playwright`.
Ни один из этих входов не входит в Git. Для текущего дерева всегда создавайте
новый payload; старые локальные пакеты не содержат исправления validator.

```sh
NODE_ARCHIVE=/absolute/path/node-v24.18.0-linux-x64.tar.xz
NODE_SHASUMS=/absolute/path/SHASUMS256.txt
BROWSERS=/absolute/path/to/playwright-browsers
npm ci
npm run build
python3 scripts/package-desktop.py --platform linux --payload-only \
  --payload-output .local/submission-payload \
  --node-archive "$NODE_ARCHIVE" --shasums "$NODE_SHASUMS" --browsers "$BROWSERS"
python3 scripts/package-installer.py --payload .local/submission-payload --mode lite
python3 scripts/package-installer.py --payload .local/submission-payload --mode full
```

Сборщик проверяет весь исходный payload manifest, накладывает явно перечисленные
текущие исходники/результаты сборки и установочные файлы, удаляет Chromium из Lite,
фиксирует новый manifest и SHA256 ELF-пакета. Не копирует .env, базы, API-ключи,
Git, tests, пользовательские игры/worktrees. Node archive сверяется с official
SHASUMS256.txt. Изолированные пакеты здесь не скачиваются. Свежий payload включает
обязательный `scripts/windows-lan-setup.ps1` для runtime build check и его hash.
Исходный payload при отсутствии можно извлечь из сохранённого DEB в новый личный
каталог через dpkg-deb --extract; это распаковка файла, не системная установка.
Новые артефакты и checksums: `.local/install-002/packages/` (Git ignored).
Временный staging сборщика удаляется. Byte-identical reproducibility и цифровая
подпись не заявляются; исходники текущего dirty tree не являются release commit.

## Диагностика и acceptance на текущей Ubuntu

```sh
mkdir -p .local/i2tmp
TMPDIR="$PWD/.local/i2tmp" .local/install-002/packages/YAPLIX-0.0.1-ubuntu24.04-x64-lite.run --diagnose --test-profile "$PWD/.local/install-002/diagnostic-profile"
node scripts/installer-smoke.mjs .local/install-002/packages/YAPLIX-0.0.1-ubuntu24.04-x64-lite.run .local/install-002/real-profile
```

Первый вызов только диагностирует реальную ОС и изолированный профиль. Второй
действительно запускает executable и GUI, использует private owner token,
проходит установку, protected Chromium, API/UI, save/restart. `--no-open` в тесте
оставляет открытие GUI контролируемому браузеру, а не браузеру по умолчанию хоста.
Ручной double-click/разрешение запуска downloaded ELF и чистое независимое
устройство имеют отдельную границу NOT_VERIFIED. Никакой ISO/VM для работы не нужен.
Состояния UI, исключения, recovery, integrity проверяются целевыми тестами:
`node --test tests/installer.test.mjs tests/browser-target.test.ts`.

Журнал `installer/install.log` содержит bounded stage/code без промптов/ключей.
Private `view.json` содержит только временную capability GUI, не предназначен для
публикации. HTTP listener слушает 127.0.0.1, проверяет Host/Origin и owner token,
не принимает удалённые команды или произвольные пути. GUI сам начинает установку
после открытия; Retry появляется только после ошибки. Success требует API, HTML
страницы, реального sandbox probe и запуска приложения, а не exit code 0.

## Windows: общий механизм, NOT_VERIFIED

Нужны Windows Node 24.18.0 zip с official SHASUMS256.txt, Chromium той же версии
Playwright для Full, Python 3.12+, компилятор Visual Studio и NSIS 3.x для разработчика.
Сначала npm ci/build на Windows и GUI shim:

```bat
if not exist .local\install-001 mkdir .local\install-001
cl /nologo /O2 /MT packaging\nodew.c /Fo:.local\install-001\nodew.obj /Fe:.local\install-001\nodew.exe /link /SUBSYSTEM:WINDOWS
python scripts\package-desktop.py --platform windows --payload-only --node-archive PATH\node-v24.18.0-win-x64.zip --shasums PATH\SHASUMS256.txt --browsers .local\playwright
python scripts\package-installer.py --platform windows --payload .local\install-002\windows-payload --mode lite
```

Full: последняя команда с `--mode full`. NSIS извлекает payload в свой временный
каталог, вызывает общий Node installer, не пишет в Program Files/system registry.
PowerShell используется только для собственных пользовательских shortcuts/диалога.
UTF-8 BOM добавляется PS-файлам в Windows payload для PowerShell 5.1.
Здесь EXE не собран, Windows Chrome, CRT/DLL, NTFS ACL и GUI не проверялись.
Отсутствующие Windows OS-компоненты не устанавливать автоматически; сообщать
об ограничении. Подготовленная конфигурация не равна PASS на Windows.

macOS и интернет-доступ — FUTURE. Смартфоны — существующий QR в одной Wi-Fi/LAN.
Текущие локальные результаты и границы проверки: [подготовка к публикации](submission-verification.md).
