# MICRO-028N — Physical Phone LAN/QR Connectivity Recovery

Исторический отчёт. Последующая поддержка постоянного порта и Windows Hotspot —
[MICRO-028N.2](micro-028n2-demo-wifi.md). Описанное ниже поведение случайного порта
относится к этой прежней проверке; её physical evidence не подменяет Hotspot A–D.

17 октября 2026. **PASS для проверенной LAN-сессии**.
Physical Android / Brave: **PASS по подтверждению владельца** после согласованного
восстановления. До восстановления страница не открылась на Android
с Chrome и Brave. Владелец описывает телефон как «Android от 2022 года»;
точные модель/OS/browser version, Wi-Fi IPv4/шлюз и текст ошибки не установлены.
Новых LLM inference/repair POST: **0**. Это диагностика и согласованная настройка
Windows, не исправление production-кода. Новая QR-сессия меняет порт: правило
52604 не является постоянным разрешением для будущих QR.

## Baseline и STOP-GATE

`main` после `git pull --ff-only`: `70fff011a8f01598863010366b3503fbd9d63396`.
От него создана `fix/micro-028n-phone-lan`. PR #34 остаётся Draft на
`test/micro-028-validator-calibration`; PR #35 — OPEN на
`codex/visual-library-neon-pixel`. Их изменения не переносились.
Посторонний untracked `docs/Keys_Bilayn.pdf` не входит в manifest.

Основная категория: **FIREWALL_BLOCK** — подтверждён конфликт действующей
политики Windows с фактическим YAPLIX executable/listener. Не установлено,
что это единственная преграда: нет packet/drop trace и параметров сети телефона.
Отказ наблюдается при открытии страницы, до подтверждённого token POST/cookie.
Причина не требует программного обхода; Stage F не применялся. После разрешённого
изменения Windows владелец подтвердил полный physical сценарий; merge gate
по телефону открыт. Проверка системного изменения — before/after owner evidence,
не packet capture и не универсальная гарантия для других сетей/устройств.

## Stage A — цепочка существующего кода

| Этап | Что проверяется сейчас | Оставшаяся граница |
| --- | --- | --- |
| Выбор версии | `phone-connect-ui.ts` выбирает explicit открытый versionId; `Store.getVersion` проверяет существование | Не доказывает пригодность управления конкретной игры на телефоне |
| Выбор сети | `network.ts`: Windows `Get-NetAdapter -Physical`, Status Up, private IPv4; исключены VPN/virtual; несколько сетей требуют выбора | Не проверяет маршрут/изоляцию от телефона и профиль Firewall |
| Listener | `phone.ts`: bind только выбранного IPv4, `port:0`, maxConnections 32, bounded timeouts | OS выбирает свободный временный порт; refresh меняет порт; правила для постоянного порта не следуют за ним |
| Self-probe | GET фактического origin `/phone`, HTTP success и `phone-ui.js`, timeout 3 s; failure закрывает listener | Проверяет только ПК → собственный адрес; не проверяет входящий трафик телефона и загрузку JS на его браузере |
| QR | `qr.ts`: private HTTP, exact `/phone`, 43-character fragment, без query/userinfo; SVG | Отдельного подтверждения чтения QR камерой нет |
| Открытие | Shell/CSS/JS доступны на ограниченном listener без cookie | HTTP 200 с ПК не доказывает внешнюю достижимость; нет журнала remote request stages |
| Token POST | `phone-ui.ts` удаляет hash из history, затем bounded POST `/phone/access`; сервер сравнивает SHA-256 timing-safe | Не поддерживается передача секрета в query; shell с ручного URL без fragment ожидаемо не авторизует игру |
| Cookie | 256-bit random cookie, HttpOnly, SameSite=Strict, Path=/phone, Max-Age до TTL | HTTP trusted LAN: Secure cookie здесь не используется; новая redemption заменяет единственную cookie-сессию |
| Версия | GET `/phone/version` с cookie, exact выбранные HTML/versionId, no-store; lastOpenedAt | lastOpenedAt означает запрос версии, не physical/gameplay PASS |
| Игра | `runtime.ts`: opaque `allow-scripts` iframe, CSP, UUID compatibility для HTTP, touch/rotation/restart shell | Нельзя гарантировать произвольный LLM HTML; в этой сессии owner подтвердил Android/Brave Start/Touch/Progress/Restart, другие устройства не проверены |
| Refresh/revoke | Refresh закрывает прежний listener, меняет token/port; TTL 30 min, shutdown и DELETE закрывают соединения | Уже загруженный offline HTML может работать до TTL/reload; revoke не является удалённой остановкой уже исполняемого HTML |
| Смена IP | Enable повторно проверяет доступные адреса | «Обновить список сетей и статус» при той же версии не всегда перевключает listener; старый QR может остаться после смены IP. В данном случае неправильный IP не наблюдался; исправление вне установленной причины |

`scripts/lan.ts` — другой, явный режим owner LAN с ключом и заданным портом;
он не управляет временным phone listener. `server.ts` сохраняет общий Store и
graceful shutdown. Owner API на phone listener не монтируется.
Origin/Host/forwarded проверки, token TTL и read-only allowlist не ослаблялись.

Android HTTP: код уже имеет crypto.randomUUID fallback через getRandomValues;
cookie передаётся same-origin после fragment redemption. Chromium HTTP regression
не воспроизводит auth defect. Owner подтвердил эту Android/Brave сессию;
версии неизвестны, другие устройства не проверены. Браузерная ошибка не может
объяснить отказ до получения shell
без дополнительных фактов. URL/token/cookie/body не добавлялись в логи.

## Stage B — FinPlay, только чтение исходников

Разрешённый reference найден в `D:\21%\FinPlay_0_00_0`.
Прочитаны относящиеся к LAN launcher/diagnostics, routes, QR и mobile templates.
Скрипты/сервисы не запускались; `.env`, базы и пользовательские данные не читались;
файлы reference не изменялись. Код автоматически не копировался.

| Аспект | FinPlay | Решение для YAPLIX |
| --- | --- | --- |
| IP | `run_lan.py`: UDP socket route к 8.8.8.8, fallback hostname | Не переносить: default route может принадлежать VPN; физическая inventory YAPLIX строже |
| Bind/port | Waitress `0.0.0.0:8000` | Не переносить all-interface bind; постоянный порт облегчает диагностику, но не устраняет Block |
| Firewall | `START_FINPLAY.ps1` запускает RunAs и создаёт Private TCP/8000 Allow | В Windows такое правило действительно найдено. Оно могло помогать при Private profile; исторический успех этим не доказан. Авто-RunAs и широкие адресные фильтры не переносить |
| QR/login | PNG QR на `/join/<code>`, имя → `/api/join`, Flask session/player token | Переносимы понятный ручной URL и разделение network/login. Room/session writes, host token в query несовместимы с phone read-only scope |
| Gameplay | Собственные HTML/JS, same-origin `/api/state` polling и `/api/choice` | Это клиент серверной игры, не sandbox произвольного HTML. Не заменяет opaque iframe/CSP YAPLIX |

Практическое отличие: FinPlay заранее открывает конкретный порт в Private.
YAPLIX не меняет Windows и использует временный порт. Ни постоянный порт,
ни иной QR-код сами по себе не обходят явный запрет Node.js.

## Stage C — наблюдение Windows

На этапе первоначальной диагностики read-only PowerShell выполнен без RunAs/
изменения конфигурации. Sandbox сначала
отвергал CIM cmdlets; повтор вне ограниченного sandbox не запускал новый
RunAs/UAC. Поздняя проверка установила уже существовавший административный token;
отсутствие административных прав первоначальной диагностики не утверждается.

- Активный физический адаптер: `Беспроводная сеть`, index 4, Realtek Wi-Fi.
  IPv4 `192.168.0.12/24`, gateway `192.168.0.1`, connected subnet route
  `192.168.0.0/24` через index 4; default route через этот gateway.
- Профиль этой сети **Public**. VPN v2RayTun и виртуальные адаптеры есть,
  но phone inventory вернула только физический `192.168.0.12`.
  Их наличие не доказывает причину сбоя.
- В первом снимке YAPLIX не слушал. После запуска владельцем owner listener:
  `127.0.0.1:3000`; phone listener: **`192.168.0.12:53094`**, PID **20588**.
  `Win32_Process.ExecutablePath`: **`C:\Program Files\nodejs\node.exe`**.
- GET локального owner `/api/phone`: enabled, выбранная версия, тот же origin,
  lastOpenedAt=null. Секретный fragment только разобран в памяти, не сохранён.
  GET **`http://192.168.0.12:53094/phone`** с ПК: **200**, phone-ui.js присутствует.
- ActiveStore: enabled Inbound **Block**, TCP, **Public**, program
  **`C:\Program Files\nodejs\node.exe`**, local port/address/remote **Any**.
  Также есть отдельный UDP Block; для HTTP нужен именно TCP.
  Application filters проверены отдельно от DisplayName: активного Node Allow
  не найдено. Private FinPlay TCP/8000 Allow существует и не применим к этой сессии.
- ActiveStore Firewall включён во всех профилях, DefaultInboundAction=Block.
  LogBlocked выключен: записи отброшенного конкретного запроса не получены.
  Firewall/router/routes/VPN/profile не изменялись.

Явный Block имеет приоритет над конфликтующим Allow; Private rule не действует
при Public. Поэтому добавление одного Public Allow поверх этого Block не решает
конфликт. [Правила Windows Firewall, Microsoft](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules).

## Stage D/E — физическая проверка и категории

Владелец открыл адрес текущего phone listener и сообщил: **страница не открылась**,
позже уточнил Android, Chrome и Brave. После восстановления повторил сценарий
в **Brave**: bare URL открыл YAPLIX, QR запустил игру, затем сообщил **«всё
получилось в brave»** в ответ на Start/touch/progress/restart/rotation/reopen и
отзыв на ПК с отказом reload на телефоне. Это owner-confirmed physical evidence.
Полный QR URL из ответа владельца не переносится в отчёт, логи или Git.
По существующей цепочке fragment → POST → cookie → selected version игра
стала доступна, но содержимое POST/cookie и mobile DevTools не снимались.
Start/Touch/Progress/Restart/rotation/reopen/revoke на Android / Brave —
**PASS по сообщению владельца**. Точные hardware/OS/browser versions не получены;
Chrome после восстановления, System WebView, iOS и Telegram — **NOT_TESTED**.

| Категория | Доказательства / решение |
| --- | --- |
| FIREWALL_BLOCK | Primary: matching Public TCP Block + actual executable + Public Wi-Fi + listener/PC 200 + owner page failure; после согласованных Private profile и narrow Allow physical Brave scenario PASS. Отдельный packet attribution не выполнялся |
| WRONG_INTERFACE | В текущей сессии IP QR/API == bind == единственный physical Wi-Fi; не подтверждено |
| AP_CLIENT_ISOLATION | Нет данных роутера/второго клиента; UNKNOWN, не объявляется причиной |
| NETWORK_ROUTE | PC subnet/default route проверены; phone IPv4/gateway ещё нужны, VPN exclusion/return path не доказаны |
| PHONE_BROWSER | Владелец сообщил Android, Chrome/Brave; точные версии и error text неизвестны. Нет browser-specific defect evidence |
| QR_OR_AUTH | Active production QR независимо декодирован в памяти и совпал со state: IP/port/path, 256-bit fragment, no query/credentials. Owner physical QR login PASS; raw HTTP/cookie не снимались |
| PHONE_UI | Локальный smoke и owner physical Brave scenario PASS; универсальная совместимость не утверждается |
| UNKNOWN | Другие сети/устройства не проверены; дополнительных препятствий в успешно проверенном сценарии не наблюдалось |

## Согласованное восстановление и Owner action

После первоначальной диагностики владелец подтвердил, что Wi-Fi домашний
и доверенный, и явно согласовал Public → Private плюс узкое правило.
Профиль только физического Wi-Fi index 4 изменён **Public → Private**;
readback подтвердил Private. Исходное значение записано в
`.local/micro028n/profile-before.json`. Новый elevated process, RunAs или UAC
не запускались: текущий процесс уже имел административный token.
После повторного запуска владельцем существующей игры phone listener выдал
`http://192.168.0.12:52604/phone`. Создано и прочитано из ActiveStore правило
**`YAPLIX-MICRO028N-52604`**: enabled Inbound Allow, Private, TCP **52604**,
local **192.168.0.12**, remote **192.168.0.0/24**, программа
**`C:\Program Files\nodejs\node.exe`**, только `Беспроводная сеть`.
Receipts: `.local/micro028n/rule-before.json`, `rule-after.json`.
Существующие Public Block не менялись. Никакие новые elevated processes,
Firewall disable, all-interface listeners, VPN/route/router changes не применялись.
После согласованного изменения владелец подтвердил успешный physical Android /
Brave сценарий, затем выключил доступ на ПК и подтвердил отказ после phone reload.

1. Успешно проверенная сессия использовала **`http://192.168.0.12:52604/phone`**;
   прежний 53094 относится к первому запуску. После physical retest последний
   GET owner `127.0.0.1:3000` вернул connection refused: backend уже остановлен.
   Для следующего подключения запустить YAPLIX, включить доступ и проверить
   **новый** порт. Не использовать исторический 52604 вслепую.
   Открыть bare URL вручную, без `#...`. Сообщить только текст ошибки, Wi-Fi IPv4/gateway,
   модель/OS/browser и является ли эта Wi-Fi сеть домашней доверенной.
2. Переход Public → Private и точное правило ниже согласованы владельцем;
   профиль уже изменён. Смена профиля может активировать другие уже имеющиеся
   Private rules; это системное изменение, не часть автоматической диагностики.
   На чужой/общедоступной сети этот переход не выполнять.
3. Правило для **52604** уже создано с разрешения владельца. Команда ниже —
   воспроизводимая процедура для **новой** сессии после удаления старого правила,
   не команда для повторного запуска сейчас. Preflight остановит её, если профиль
   вернулся в Public. Порт берётся строго из активного phone state в памяти;
   token не выводится. Проверяется exact IP и executable; диапазон не расширяется.

```powershell
# Только для согласованной владельцем домашней сети, с текущими правами администратора.
$ErrorActionPreference = 'Stop'
if ((Get-NetConnectionProfile -InterfaceIndex 4).NetworkCategory -ne 'Private') {
    throw 'STOP: эта сеть ещё Public; изменение профиля требует отдельного согласия'
}
$taskState = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/phone' -TimeoutSec 5
if (-not $taskState.enabled) { throw 'STOP: сначала включите доступ в YAPLIX' }
$taskPhone = [uri]$taskState.url
if ($taskPhone.Scheme -ne 'http' -or $taskPhone.Host -ne '192.168.0.12' -or $taskPhone.AbsolutePath -ne '/phone') { throw 'STOP: выбранный адрес изменился' }
$taskPort = $taskPhone.Port
$taskListener = Get-NetTCPConnection -State Listen -LocalAddress '192.168.0.12' -LocalPort $taskPort
$taskExecutable = (Get-CimInstance Win32_Process -Filter "ProcessId = $($taskListener.OwningProcess)").ExecutablePath
if ($taskExecutable -ne 'C:\Program Files\nodejs\node.exe') { throw 'STOP: executable изменился' }
$taskRuleName = "YAPLIX-MICRO028N-$taskPort"
if (Get-NetFirewallRule -Name $taskRuleName -ErrorAction SilentlyContinue) { throw 'STOP: правило уже существует' }
New-NetFirewallRule -Name $taskRuleName -DisplayName "YAPLIX phone TCP $taskPort" `
    -Direction Inbound -Action Allow -Enabled True -Profile Private -Protocol TCP `
    -Program 'C:\Program Files\nodejs\node.exe' -InterfaceAlias 'Беспроводная сеть' `
    -LocalAddress '192.168.0.12' -LocalPort $taskPort -RemoteAddress '192.168.0.0/24'
Write-Output "Создано правило $taskRuleName только для TCP $taskPort"
```

Отдельная команда отката только добавленного правила:

```powershell
Remove-NetFirewallRule -Name $taskRuleName
```

Добавление и удаление показаны раздельными действиями; откат — в той же консоли.
В новой консоли использовать точное имя созданного правила:
`Remove-NetFirewallRule -Name 'YAPLIX-MICRO028N-52604'`.
Для возврата профиля использовать прежнее значение Public в настройках
только этого Wi-Fi подключения: `Set-NetConnectionProfile -InterfaceIndex 4 -NetworkCategory Public`.
Создание/удаление правила и возврат профиля — отдельные действия, а не один script.
Широкое разрешение Node, отключение Block/Firewall, VPN kill-switch,
UPnP, router changes, all-interface bind и owner API proxy не предлагаются.

После разрешённого внешнего действия: текущий bare URL должен показать YAPLIX shell
(без fragment отсутствие доступа к игре ожидаемо); затем тот же действующий QR
→ выбранная версия → Start → Touch → Progress → Restart → rotation → reopen.
На ПК «Отключить доступ», на телефоне reload должен отказать. При refresh QR
меняется и порт, временное правило надо удалить и пересоздать для нового порта.

## Stage G — локальные проверки и границы

- Typecheck и build: PASS, неизменённый production source.
- Focused `phone/network/platform/engine/mvp`: **36/36 PASS**, 0 skips.
  Реальный bind приватного IPv4; exact HTML/version, Host/Origin/forwarded denial,
  invalid/oversized/expired token, cookie flags, TTL, refresh/revoke/shutdown,
  запрет owner API/других версий/записей, library/persistence/restart contracts.
- Chromium 320/390 `phone/mobile/mvp`: **18/18 PASS**, runner exit **0**.
  После всех assertions teardown завис на synthetic `tests/browser-server.ts`;
  только этот проверенный in-memory test process завершён через SIGTERM,
  после чего runner вывел итог. Пользовательский backend не останавливался.
  Это ограничение автоматической очистки, не phone defect. Independent QR decode, HTTP auth, opaque iframe,
  touch/progress/restart, rotation/reduced viewport, reopen, expiry и revoke.
  Synthetic Store/игры, браузеры на одном ПК; это не физическое устройство.
- Первоначальный Gitleaks history: **89 commits**, финальный reviewed manifest
  из README и двух docs — **0 находок**. Финальный HEAD scan записывается в PR receipt.
  Repo checker PASS, Python **19/19**, CI policy **8/8**, diff whitespace PASS.
  Source/security review: только docs; production security controls без изменений.
- Active production QR: SVG rendered и decoded в памяти, exact state match,
  `192.168.0.12:52604/phone`, fragment shape 43 base64url chars, no query/userinfo.
  Полный URL/token/image не сохранялись; receipt `active-qr-receipt.json`.
- Нового regression test для «исправленного дефекта» нет: production fix не сделан,
  Windows policy не исправляется synthetic тестом. Android / Brave physical
  **PASS по подтверждению владельца** после восстановления; iOS/Telegram physical
  NOT_TESTED; новых LLM POST **0**.
- Actions не включались. Последний документированный state — disabled MICRO-019;
  текущий REST permissions запрос завершился network timeout, не CI PASS.
  Hosted Ubuntu/Windows, release FULL, LIVE inference не подтверждены.

Приватные receipts: `.local/micro028n/`; только безопасные результаты, без QR
fragment, cookie, access key, request bodies и приватных данных reference.
Данные игр не редактировались диагностикой; тесты используют свои Store/fixtures.
Working source и `assets/visual-library/` остаются без изменений.
Сохранённый после запуска владельцем baseline `.env`, SQLite/WAL/SHM и PDF
совпал по SHA-256 при заключительной проверке. Это сравнение именно между
двумя снимками текущей диагностики, не утверждение о прежних запусках владельца.

**MAIN** baseline `70fff011...`; финальные commit/PR/merge SHA — в Git receipt PR.
**MERGED** требует заключительного diff/security review и ff-only main smoke;
physical merge gate подтверждён владельцем.
**RUN** owner loopback + scoped phone listener наблюдались выше.
**VERIFIED** локальные контракты, Windows inventory и owner physical Brave scenario;
**MVP** эта LAN-сессия принята; другие устройства/сети остаются отдельной проверкой.
**LIVE** 0 новых POST; **DOCS** этот отчёт, compact known-errors и README.
**NEXT** для нового QR проверить новый порт и пересоздать такое же узкое правило
после удаления прежнего. Постоянный порт потребует отдельного изменения кода;
оно здесь не выполнялось, broad Node Allow не создавался.
