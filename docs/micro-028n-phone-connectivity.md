# MICRO-028N — Physical Phone LAN/QR Connectivity Recovery

17 октября 2026. **EXTERNAL_ACTION_REQUIRED**. Physical Android: **FAIL**
по сообщению владельца: страница не открылась. Модель телефона, OS/browser,
его Wi-Fi IPv4/шлюз и текст браузерной ошибки пока не получены.
Новых LLM inference/repair POST: **0**. Это диагностика, не исправление кода.

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
Причина не требует программного обхода; Stage F остановлен. Нельзя объявлять
Physical PASS или выполнять merge до успешной проверки настоящего телефона.

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
| Игра | `runtime.ts`: opaque `allow-scripts` iframe, CSP, UUID compatibility для HTTP, touch/rotation/restart shell | Нельзя гарантировать произвольный LLM HTML; физические Start/Touch/Progress/Restart не подтверждены |
| Refresh/revoke | Refresh закрывает прежний listener, меняет token/port; TTL 30 min, shutdown и DELETE закрывают соединения | Уже загруженный offline HTML может работать до TTL/reload; revoke не является удалённой остановкой уже исполняемого HTML |
| Смена IP | Enable повторно проверяет доступные адреса | «Обновить список сетей и статус» при той же версии не всегда перевключает listener; старый QR может остаться после смены IP. В данном случае неправильный IP не наблюдался; исправление вне установленной причины |

`scripts/lan.ts` — другой, явный режим owner LAN с ключом и заданным портом;
он не управляет временным phone listener. `server.ts` сохраняет общий Store и
graceful shutdown. Owner API на phone listener не монтируется.
Origin/Host/forwarded проверки, token TTL и read-only allowlist не ослаблялись.

Android HTTP: код уже имеет crypto.randomUUID fallback через getRandomValues;
cookie передаётся same-origin после fragment redemption. Chromium HTTP regression
не воспроизводит auth defect. Совместимость конкретного Android/browser ещё
не проверена; браузерная ошибка не может объяснить timeout до получения shell
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

Read-only PowerShell выполнен без RunAs/изменения конфигурации. Sandbox сначала
отвергал CIM cmdlets; повтор вне ограниченного sandbox использовал обычные
права пользователя Windows, не запуск администратора.

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

Владелец открыл адрес текущего phone listener и сообщил: **страница не открылась**.
Полный QR URL из ответа владельца не переносится в отчёт, логи или Git.
Успешные `/phone/access`, cookie и `/phone/version` на физическом телефоне
не наблюдались. Start/Touch/Progress/Restart/rotation/reopen/revoke на нём
**NOT_TESTED**; общий physical connection — **FAIL** по owner evidence.

| Категория | Доказательства / решение |
| --- | --- |
| FIREWALL_BLOCK | Primary: matching enabled Public TCP Block + actual executable + Public Wi-Fi + listener/PC 200 + owner page failure. External policy action required; packet attribution и успех после изменения ещё не проверены |
| WRONG_INTERFACE | В текущей сессии IP QR/API == bind == единственный physical Wi-Fi; не подтверждено |
| AP_CLIENT_ISOLATION | Нет данных роутера/второго клиента; UNKNOWN, не объявляется причиной |
| NETWORK_ROUTE | PC subnet/default route проверены; phone IPv4/gateway ещё нужны, VPN exclusion/return path не доказаны |
| PHONE_BROWSER | OS/browser/error text не получены; UNKNOWN |
| QR_OR_AUTH | Локальные QR decode/auth regressions проверяют контракт; physical ещё не дошёл до подтверждённой авторизации |
| PHONE_UI | Локальный smoke не воспроизвёл дефект; physical gameplay не проверен |
| UNKNOWN | Возможные дополнительные препятствия остаются до физического retest |

## Owner action — согласование отдельно от выполнения

1. В наблюдаемой сессии bare URL — **`http://192.168.0.12:53094/phone`**.
   В заключительном GET owner `127.0.0.1:3000` уже вернул connection refused:
   прежде чем повторять проверку, запустить YAPLIX и включить доступ снова;
   новый порт получить из текущего UI, не использовать исторический порт вслепую.
   Открыть bare URL вручную, без `#...`. Сообщить только текст ошибки, Wi-Fi IPv4/gateway,
   модель/OS/browser и является ли эта Wi-Fi сеть домашней доверенной.
2. Для доверенной домашней сети отдельно согласовать переход Public → Private
   и точное правило ниже. Смена профиля может активировать другие уже имеющиеся
   Private rules; это системное изменение, не часть автоматической диагностики.
   На чужой/общедоступной сети этот переход не выполнять.
3. Команда ниже подготовлена **для владельца после явного разрешения**.
   Здесь она **НЕ ВЫПОЛНЯЛАСЬ**. Private сейчас не активен; preflight остановит
   её при текущем Public. Порт берётся строго из активного phone state в памяти;
   token не выводится. Проверяется exact IP и executable; диапазон не расширяется.

```powershell
# Только после согласования владельцем, в его административном PowerShell.
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
В новой консоли использовать точное имя правила из вывода, например
`Remove-NetFirewallRule -Name 'YAPLIX-MICRO028N-53094'` для исторического порта.
Для возврата профиля использовать прежнее значение Public в настройках
только этого Wi-Fi подключения. Изменение профиля/правила здесь не разрешено
и не выполнено; широкое разрешение Node, отключение Block/Firewall, VPN kill-switch,
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
- Gitleaks: **89 commits**, reviewed manifest из двух docs — **0 находок**.
  Repo checker PASS, Python **19/19**, CI policy **8/8**, diff whitespace PASS.
  Source/security review: только docs; production security controls без изменений.
- Нового regression test для «исправленного дефекта» нет: production fix не сделан,
  Windows policy не исправляется synthetic тестом. Android physical FAIL до
  авторизации; iOS/Telegram physical NOT_TESTED; новых LLM POST **0**.
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

**MAIN** `70fff011...`; **MERGED** нет, physical merge gate закрыт.
**RUN** owner loopback + scoped phone listener наблюдались выше.
**VERIFIED** локальные контракты и Windows inventory; **MVP** physical gap открыт.
**LIVE** 0 новых POST; **DOCS** этот отчёт + compact known-errors.
**NEXT** получить bare-URL результат/сеть телефона и согласовать узкое внешнее
действие; затем повторить physical acceptance до любых merge claims.
