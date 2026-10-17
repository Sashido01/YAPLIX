# MICRO-028N.2 — демонстрационный Wi-Fi и QR

Статус: **PARTIAL**. Владелец подтвердил работу игры и отключения доступа;
повторный запуск именно через Hotspot остаётся NOT_VERIFIED из-за смены сети
в наблюдении. По просьбе владельца задача завершена без новых физических проверок.
Работа только в `D:\YAPLIX`; baseline main
`37b13d4edf7c44864d20106991a6ba0726b6b795`, ветка
`codex/micro-028n2-demo-wifi`. Новых реальных LLM POST: **0**.
Actions не включать. PR #34 и `assets/visual-library/` не изменяются.

## Сценарий владельца

Один раз разрешить узкое правило для своего Windows Hotspot. Далее:

1. В Windows включить «Параметры → Сеть и Интернет → Мобильный хот-спот».
2. Подключить Android к Wi-Fi ноутбука; имя/пароль смотреть в Windows, не в YAPLIX.
3. Запустить `YAPLIX.cmd`, открыть сохранённую игру, нажать «Подключить телефон».
4. Сканировать QR игры. Он не подключает к Wi-Fi и не содержит Wi-Fi password.

Повторный запуск, обновление QR и выбор другой версии используют один порт,
новый токен и новые 30 минут. Ручная настройка Firewall на каждый QR не нужна,
пока те же Node executable, Hotspot интерфейс/подсеть и настройка порта.
Если Windows изменит интерфейс/IP/подсеть либо переустановлен Node, узкое правило
нужно явно пересмотреть; YAPLIX не расширяет его автоматически.

## Реализация

- `src/phone.ts`: default TCP **52604**, локальная настройка
  `YAPLIX_PHONE_PORT=52604` в серверном `.env`; допустимы 1–65535, ноль/пустая
  строка/невалидные значения запрещены. Занятый порт → `PHONE_PORT_IN_USE`,
  без другого порта. Привязка только к выбранному private IPv4.
- В тестах отдельно внедряется OS-assigned порт 0 для изоляции fixtures;
  production configuration это не разрешает. Отдельный nonzero-port regression
  проверяет bind conflict, refresh и restart manager на одном порту.
- `src/windows-phone-network.ps1`: только read-only OS inventory. WinRT
  `NetworkOperatorTetheringManager.TetheringOperationalState=On`, активный
  Microsoft Wi-Fi Direct Virtual Adapter, non-hardware, тип 71 и preferred IPv4.
  Backend сверяет адрес с текущим Node inventory; нужен единственный допустимый
  кандидат. Off/Unavailable/неоднозначность не разрешают virtual adapter.
  VPN/WSL/Hyper-V не выбираются по похожему имени или привычному IP.
- IP не хардкодится. Физический Wi-Fi/Ethernet остаётся отдельным LAN-сценарием.
  Подтверждённый Hotspot предпочтителен при начальном выборе; явный выбор владельца
  сохраняется. При отсутствии подтверждения UI показывает настройки Windows,
  а не утверждает, что виртуальный интерфейс безопасен или поддерживается.
- PowerShell вызывается без профиля/видимого окна, без смены execution policy,
  максимум 8 s/64 KiB. Не читаются SSID/passphrase и не запускаются StartTethering,
  ICS enable/disable, Firewall/profile/route/VPN changes. Build включает PS helper
  рядом с compiled backend. Нет собственного AP или нового сервера/relay.
- TTL 30 min, 256-bit fragment token, bounded POST, HttpOnly SameSite cookie,
  exact selected version/read-only scope, Host/Origin, revoke, opaque iframe/CSP
  сохраняются. Игровой HTML, провайдеры и промпты не менялись.

## Наблюдение Windows и однократная настройка

Владелец включил Hotspot в Windows. Read-only наблюдение: WinRT **On**,
`Подключение по локальной сети* 10`, Microsoft Wi-Fi Direct Virtual Adapter #2,
GUID `{2691AE87-3F2A-4E1D-BD75-6A7CD03A9DAB}`, index 7,
IPv4 **192.168.137.1/24**. Это снимок данного ноутбука, не константа кода.
Позже WinRT сообщил **Off**; причина выключения не установлена. UI должен
предложить снова включить штатную точку доступа, без догадок об IP.

`Get-NetConnectionProfile` не вернул профиль для index 7; подтверждённая категория
Hotspot — **UNKNOWN**, Private не предполагается. Старый ICS COM не вернул
private GUID; этот путь не используется как доказательство активного Hotspot.
Read-only compiled backend при Off вернул только реальный physical Wi-Fi,
а не неактивный Wi-Fi Direct. После физической проверки compiled backend
подтвердил текущий On-path: `192.168.137.1`, kind `hotspot`, плюс physical
`192.168.0.12`. В ограниченном executor запуск PowerShell возвращал
PHONE_NETWORK_CHECK_FAILED; обычный процесс Windows прошёл без изменения кода.

Прежнее `YAPLIX-MICRO028N-52604` ограничено домашним physical Wi-Fi
`192.168.0.12`; оно не покрывает Hotspot. Старые Public Node Block остаются.
Владелец отдельно разрешил **новое** правило; оно создано и прочитано обратно
из ActiveStore. Старое домашнее правило не изменялось. Параметры выполненного
однократного действия (повторно сейчас не выполнять):

```powershell
New-NetFirewallRule -Name 'YAPLIX-DEMO-HOTSPOT-52604' `
  -DisplayName 'YAPLIX demo hotspot TCP 52604' -Direction Inbound -Action Allow `
  -Program 'C:\Program Files\nodejs\node.exe' -Protocol TCP -LocalPort 52604 `
  -InterfaceAlias 'Подключение по локальной сети* 10' `
  -LocalAddress '192.168.137.1' -RemoteAddress '192.168.137.0/24' -Profile Any
```

Profile Any здесь не открывает все сети: interface + local IP + remote subnet +
executable + единственный TCP port ограничивают правило только этим Hotspot.
Это избегает недоказанной категории Private и не меняет профили Windows.
Явный существующий Block всё равно сильнее Allow; если он применится к Hotspot,
нельзя удалять/ослаблять его автоматически — потребуется отдельное решение.
Перед созданием проверены exact adapter GUID/description/alias, Node executable,
отсутствие одноимённого правила и отдельное согласие владельца. IP/подсеть взяты
из прежнего наблюдения **On**; во время настройки Hotspot мог быть Off, поэтому
успешный bind и physical reachability одной настройкой не доказываются.
Последующий тест ниже подтвердил начальное подключение через Hotspot. Receipts:
`.local/micro028n2/firewall-before.json`, `firewall-after.json`.

Откат только нового правила:

```powershell
Remove-NetFirewallRule -Name 'YAPLIX-DEMO-HOTSPOT-52604'
```

Системное правило создано только после нового разрешения в этой задаче.
Новое приложение с повышением прав/RunAs/UAC не запускалось; текущий процесс
уже имел нужные права. Разрешение предыдущей задачи для домашнего Wi-Fi
не использовалось как разрешение нового Hotspot rule.

## Проверки и границы

- Typecheck/build: PASS.
- Focused phone/network/platform/engine/MVP/launcher units: **44/44 PASS**.
  Включены fixed port, invalid config, occupied port without fallback, refresh/
  manager restart, old token/cookie denial, TTL, правильный bind, exact version,
  read-only scope, Host/Origin/forwarded, revoke/shutdown и fake hotspot exclusion.
- Chromium 320/390 phone/mobile/MVP: **20/20 PASS**, exit 0. Hotspot default
  selection и понятный port-conflict UI проверены на synthetic inventory.
  После assertions завис teardown synthetic browser-server; завершён только
  подтверждённый in-memory test process. Это не production phone defect.
- QR decode/auth/touch/rotation/restart/reopen проверены локальными fixtures;
  это не physical Android/Hotspot PASS.
- Phone matrix на 12 профилях: **33 PASS + 3 Firefox FAIL до открытия страницы**
  (`Target crashed` в ограниченном executor); те же 3 сценария Firefox обычным
  процессом Windows — **3/3 PASS**, без изменения sandbox/CSP. Итого покрыты
  Chromium/WebKit 320/360/390/430/tablet, Chromium/Firefox desktop; различие
  условий исполнения сохраняется в receipts, исходный failed run не скрывается.
- Regression на неизменённом baseline `37b13d4`: занятый внедрённый порт был
  проигнорирован (`port:0`); на текущем коде тот же сценарий даёт PHONE_PORT_IN_USE.
  Receipt `fixed-port-regression.json`, synthetic, не external proof.
- Независимый source review: найден и исправлен P2 выбора сети. Обновление
  списка предпочитает появившийся Hotspot, если владелец не выбирал сеть вручную;
  повторное открытие также сравнивает hostname QR. Добавлен browser regression.
  Повторный review: замечаний нет. Secret scan: 17 явных файлов, 0 findings.
- Финальный replay после исправления: typecheck/build, **44/44 units** и
  **8/8 Chromium/WebKit 390 phone scenarios PASS**. Новый тест сначала не открыл
  свёрнутый раздел перед нажатием кнопки; fixture исправлен, повтор exit 0.
  Исторические 20 smoke и matrix выше относятся к предшествующему коду.
  Repository checker и `git diff --check` PASS. Hosted Windows/Ubuntu/secret-scan
  не запускались: Actions отключены владельцем по MICRO-019; green не заявляется.
  Реальные inference/repair POST **0**. Нет нового TLS/tunnel/cloud endpoint.

Physical acceptance (подтверждает владелец):

| Тест | Требование | Результат |
| --- | --- | --- |
| A | Android подключён именно к Wi-Fi ноутбука; QR/start/touch/progress/restart | Владелец: «всё работает»; PC зафиксировал Hotspot origin 192.168.137.1:52604 |
| B | Полное закрытие/новый YAPLIX; порт 52604; новый QR без Firewall changes | Владелец подтвердил общий сценарий, но позже PC увидел 192.168.0.12:52604; restart именно через Hotspot NOT_VERIFIED |
| C | Refresh на том же порту; старый token отказан; новый QR работает; revoke/reload отказан | Владелец подтвердил сценарий; PC после disable получил connection refused. Old-token HTTP 401 после refresh доказан units, в физической сессии отдельно NOT_VERIFIED |
| D | Игра доступна без внешнего HTTPS/tunnel; условия внешнего uplink/offline отмечены отдельно | PC зафиксировал private HTTP Hotspot origin; отключение внешнего uplink NOT_TESTED |

Metadata-only receipt: `.local/micro028n2/acceptance-network.json`. Наблюдение
увидело сначала Hotspot, затем physical Wi-Fi на том же порту и отключение.
Причина смены сети не установлена; нельзя подменять ею подтверждённый restart
на Hotspot. Уточнение не получено: владелец попросил завершить задачу.

MICRO-028N Android/Brave PASS через домашний Wi-Fi — историческое доказательство,
оно не засчитывается как A–D. OFFLINE PASS не заявляется: возможность включить
Windows Hotspot без внешнего подключения зависит от фактической Windows конфигурации.

Будущий VPS описан отдельно в [deployment-vps.md](deployment-vps.md); не реализован.
PR остаётся draft, merge не выполняется: физический restart на Hotspot не доказан.
После PASS сетевую
архитектуру не менять до завершения хакатона.
