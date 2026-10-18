# MICRO-036.1 — постоянный порт QR

18 октября 2026. База `main` — `b50ff43778b5b2860efa97b036fa5a6b421bab23`.
Ветка `fix/micro-036-phone-stable-port`. Результат — commit и PR в main,
без merge; Draft PR #34/#37 не используются и не изменяются.

## Порт и запуск

Production default — TCP **52604**. `PhoneConnection` использует этот фиксированный
порт при первом включении, refresh QR, disable/enable и новом запуске приложения.
Однократный override: владелец сохраняет `YAPLIX_PHONE_PORT=53000` в существующем
локальном ignored `.env` и перезапускает YAPLIX. Обычные `YAPLIX.cmd`, `npm run app`
и `npm start` уже загружают этот файл; ввод при каждом показе QR не требуется.
В этой задаче `.env` не изменялся. Переменная окружения процесса имеет приоритет
над env-file согласно обычному Node launcher; для стабильности не задавайте
разные значения в разных способах запуска.

Допустимы только десятичные целые 1–65535; пустое, 0, дробь, отрицательное,
нечисловое и превышение диапазона отклоняются с `PHONE_PORT_INVALID`.
Занятый порт возвращает `PORT_IN_USE` и понятное сообщение в существующем UI;
QR не выдаётся, случайного fallback нет. Смена порта требует отдельной проверки
узкого разрешения Firewall. Программа не создаёт и не меняет системные правила.
Bind остаётся только на выбранном доступном физическом LAN IPv4, без `0.0.0.0`.

## Безопасность и регрессии

Изменены только выбор порта и сообщение о его конфликте. Сохранены TTL 30 минут,
новый криптографически случайный токен при каждом enable/refresh, отзыв старого
токена и cookie, fragment → bounded POST → HttpOnly/SameSite cookie, выбранная
версия, CSP, opaque iframe sandbox, Origin/Host/forwarded-header validation,
Owner API отсутствует. Отключение и остановка закрывают соединения.

Тесты используют in-memory либо собственные временные базы. Listener получают
явно внедрённый ephemeral port 0 или свободный порт, выданный ОС. Production
`YAPLIX_PHONE_PORT=0` запрещён; внедрение предназначено для isolated tests.
Тесты не занимают общий production-порт как фиксированную конфигурацию.

Наблюдался RED: новый lifecycle-тест запросил определённый свободный порт,
старый код вернул другой случайный порт (59154 вместо 59153). После изменения
этот же тест прошёл: first enable → refresh → disable/enable → новый экземпляр
на том же порту; новый токен, прежние token/cookie отклоняются, версия та же.
Отдельный реальный конфликт порта проверяет `PORT_IN_USE`, отсутствие QR/fallback
и успешное включение на том же порту после освобождения.
Существующие private-IP HTTP-регрессии проверяют owner API, чужую версию,
Host/Origin/CSP/auth/TTL, отсутствие записей и закрытие listener.
Эти seams проверяют локальную реализацию, не Windows inbound или физический телефон.

## Read-only Windows диагностика

Проверено 18 октября 2026 через Windows cmdlets и фактический `process.execPath`:

| Параметр | Наблюдение |
| --- | --- |
| Активный физический Wi-Fi | `Беспроводная сеть`, ifIndex 5, Up |
| Профиль Wi-Fi | Private, IPv4 Internet |
| LAN IPv4 | `192.168.0.12` |
| Исполняемый Node | `C:\Program Files\nodejs\node.exe` |
| ActiveStore rule | `YAPLIX-MICRO028N-52604`, enabled, Inbound Allow, Private |
| Protocol/port | TCP, LocalPort 52604, RemotePort Any |
| LocalAddress | `192.168.0.12` |
| RemoteAddress | `192.168.0.0/255.255.255.0` |
| Program | `C:\Program Files\nodejs\node.exe` |
| InterfaceAlias | `Беспроводная сеть` |
| Listener conflict | `Get-NetTCPConnection -State Listen` не показал TCP 52604 |

Правило соответствует текущим IP/интерфейсу/профилю/Node/default-порту.
Оснований менять это правило по текущим данным нет. Это сопоставление параметров,
а не доказательство фактической доставки пакетов с телефона: VPN, роутер и другие
правила не объявляются исключёнными причинами. При смене этих параметров сначала
read-only повторная проверка; если нужно изменение Firewall — STOP и отдельное
разрешение владельца. Windows, VPN, Firewall и сеть не изменялись.

## Проверки качества

- Typecheck и build: PASS.
- Unit: 263/263 PASS, без skip, последовательный полный `tests/*.test.ts`.
- Focused phone/network: 12/12 PASS (10 phone + 2 generation-network).
- Repository checker, его Python tests 19/19, CI policy 8/8: PASS.
- Phone browser matrix: 36/36 PASS, все 12 проектов Chromium/Firefox/WebKit,
  mobile 320/360/390/430, tablet/desktop, touch/rotation/keyboard-sized viewport,
  QR decode, постоянный порт/новый token, owner API denial и revoke.
- MICRO-027 Chromium 390: 3/3 PASS, включая изменённый isolated phone fixture;
  synthetic transport, без обращения к реальному LLM.
- Gitleaks 8.24.3: история 107 commits — PASS, no leaks; публикационный manifest
  с текущими изменёнными файлами — PASS, no leaks.
- `git diff --check`: PASS. Review diff: замечаний к реализации не найдено.

Первый объединённый browser запуск в restricted executor остановлен после
20 s timeout на несвязанном MICRO-027 critical-error тесте; это не phone verdict.
Phone matrix и MICRO-027 повтор прошли обычным Windows-процессом, без отключения
browser sandbox, CSP или системной защиты. Полный browser suite/FULL обеих ОС
не заявляется. Actions authoritative GET: `enabled:false`, согласно временной
MICRO-019 паузе; hosted Windows/Ubuntu/secret-scan не являются PASS.

## Физическая приёмка владельцем — NOT_VERIFIED

После ревью и разрешённого включения изменения в используемую сборку:

1. Запустить YAPLIX обычным способом.
2. Открыть существующую Maze 6×6, нажать «Подключить телефон».
3. Убедиться, что URL QR показывает выбранный LAN IPv4 и порт 52604.
4. На Android/Brave в той же доверенной Wi-Fi сети открыть QR.
5. Проверить Start, touch, изменение прогресса и Restart.
6. Обновить QR: порт прежний, токен новый; старые ссылка/cookie не дают игру.
7. Перезапустить YAPLIX, открыть ту же сохранённую версию, показать QR:
   порт опять 52604, токен новый; проверить игру на телефоне.
8. Отключить доступ: телефон теряет доступ, listener закрыт.
9. Зафиксировать подтверждение владельца с результатом этих шагов;
   только после него ставить физический PASS. Не публиковать token/cookie.

Локальный HTTP 200 и browser emulation не подтверждают Android/Brave.
Production SQLite, сохранённые игры, `.env`, запрещённый PDF не читались и не
изменялись для этой задачи. Генерация, валидатор и Game Intent не изменены.
Inference/repair POST: **0**. MVP/LIVE/physical PASS из этих тестов не следует.
NEXT: review PR, затем отдельная физическая приёмка. Merge не выполняется.
