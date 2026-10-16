# Windows и Ubuntu 24.04

Основная разработка YAPLIX идёт на Windows, целевая система демонстрации —
**Ubuntu 24.04 LTS**. Стек локального MVP: Node 24.18+ (24.x), TypeScript,
Hono, встроенный SQLite. Установка npm ci, запуск npm start — по [README](../README.md).
Путь клона свободный; абсолютные пути рабочего компьютера не являются условием запуска.

## Переносимость основы

- .gitattributes и .editorconfig задают UTF-8/LF и последний перевод строки. core.autocrlf=false задаётся локально; глобальные настройки не меняем.
- Hook — POSIX sh, без PowerShell и стороннего runtime. Git for Windows включает shell; Linux использует /bin/sh.
- Hook сохраняется с Git mode 100755; при потере права на Linux нужен chmod +x .githooks/pre-push.
- Python-проверки используют стандартную библиотеку и относительные пути. На Windows команда python, на Ubuntu — python3 (версия 3.11+).
- Регистр имён важен на Linux. Проверка выявляет коллизии отслеживаемых путей и несовпадение регистра относительных Markdown-ссылок даже на Windows.

## Проверка клона

Клонирование и установка hooks описаны в [development-setup.md](development-setup.md). Из корня на Ubuntu:

```sh
git --version
python3 --version
python3 scripts/check_repo.py
python3 -m unittest discover -s scripts/tests -v
git ls-files --eol
git ls-files --stage .githooks/pre-push
git diff --check
```

На Windows замените python3 на python; все команды Git одинаковы. Свою ветку обновляйте по [CONTRIBUTING.md](../CONTRIBUTING.md) при чистом дереве. Инструменты ОС устанавливает владелец компьютера при необходимости; новых системных установок TASK-001 не требует.

CI настроен на Windows и Ubuntu 24.04, но конфигурация workflow не доказывает успешное исполнение. Локальное выполнение через Git for Windows не является проверкой Linux. Даже успешный hosted CI не заменяет репетицию на физическом ноутбуке Ubuntu 24.04 по [demo-readiness.md](demo-readiness.md).

Lockfile фиксирует зависимости; Playwright проверяет автономный авторский HTML
в Chromium desktop/mobile, WebKit mobile/tablet и Firefox desktop. Физический WebView требует отдельной проверки. Реальные LLM-артефакты
испытываются отдельно от authored fixture; границы указаны в demo-readiness. Генерация и gameplay имеют разные
требования к сети. Детали — в [архитектуре](architecture.md).

Frontend/backend — один процесс npm start; .env читается автоматически.
Авторские офлайн-примеры не требуют внешних сервисов; DEMO fixtures остаются в API/тестах.
Для новой генерации нужны server Chromium и ключ выбранного облака по README;
Ollama Cloud — default, OpenRouter Free выбирается вручную. Legacy Auto не переключает provider.
CI не вызывает реальные модели.

## Mobile First: платформа и способ проверки

| Среда | Автоматизированная проверка | Оставшаяся проверка |
| --- | --- | --- |
| Android Chrome / System WebView | Chromium, touch/DPR, 320×568, 360×800, 390×844, 430×932 | Физический Android и embedded WebView |
| iOS Safari / WKWebView | Playwright WebKit, те же mobile размеры | Физический iPhone, клавиатура, safe-area, загрузка HTML |
| Android tablet / iPadOS | Chromium/WebKit 768×1024, portrait/landscape | Физический планшет |
| Chrome / Edge desktop | Chromium 1366×768 | Установленный Edge, аппаратные особенности |
| Firefox desktop | Firefox 1366×768 | Физический Linux notebook |
| Safari desktop | Общий WebKit engine проверен на mobile/tablet | macOS Safari |
| Telegram Mini App Android/iOS | Synthetic SDK/HMAC/HTTPS на Chromium/WebKit | Реальные Telegram клиенты и HTTPS URL |

Это engine emulation, а не идентичные устройства. Версии движков зафиксированы
Playwright lockfile; hosted Windows/Ubuntu FULL настроен на все 12 профилей.
Actions временно выключены по MICRO-019: [границы локальных проверок](ci-economy.md).
Клиент не использует Node, Ollama, внешние шрифты, библиотеки или install step.
Запуск/генерация требуют сети до сервера; inference находится на сервере.
После загрузки gameplay не зависит от связи; события при долгом offline могут
не сохраниться, UI сообщает ошибку. Экспорт автономен и не требует postMessage.
Telegram WebView может ограничивать download/file:// — используйте системный
браузер, это не обходится разрешением privileged origin недоверенной игре.

UI поддерживает 44 px цели, font-size 16 px для ввода, safe-area и compact
landscape. На телефоне навигация занимает отдельную строку под прокручиваемым
содержимым и не перекрывает игровые кнопки. `visualViewport` скрывает её при перекрытии клавиатурой;
сокращение viewport не пересоздаёт iframe. У authored DEMO нет анимационного
цикла/звука: фон не потребляет непрерывную игровую перерисовку. Для LLM это
инструкция и отдельная приёмка каждого артефакта, не универсальная гарантия.

## Производительность: измерение 13 октября 2026

`npm run performance:smoke` запускает production server, сохраняет JSON в
`.local/performance/current.json` и проверяет размеры. Для другого уже работающего
локального сервера задайте `PERF_URL`; секретный LAN endpoint в этом тесте не нужен.
Профиль: Chromium 156.0.8078.4 на Windows, viewport 390×844, DPR 2,
CPU AMD Ryzen 5 7500F (12 logical cores), CPU throttle ×4, CDP Slow 4G: latency 150 ms, download 1.6 Mbps, upload 750 kbps.
Сервер прогрет; каждый из семи повторов — новый browser context, cache disabled.
Baseline снят до оптимизации и повторён на неизменённом TASK-004 checkout тем же
runner. After измерен отдельно от полного browser suite. Это лабораторный профиль,
не реальная сеть/аппаратная скорость телефона.

| Метрика | Baseline TASK-004 | After TASK-005 |
| --- | --- | --- |
| Первый экран с загруженным списком, p75 | 1014.2 ms | 630.7 ms |
| Выбор готовой игры → доступная кнопка Start, p75 | 1011.0 ms | 966.7 ms |
| Локальный API /games без сетевого throttling, p75 из 10 | 2.64 ms | 3.31 ms |
| Touch pointerdown → изменение счёта DEMO, p75 | 2.9 ms | 4.9 ms |
| JS первоначальной загрузки, gzip | 6313 bytes | 6061 bytes |
| CSS первоначальной загрузки, gzip | 1185 bytes | 1939 bytes |
| Критические HTML/CSS/JS, gzip | 9262 bytes | 10022 bytes |
| Статические запросы первоначального экрана | 5 | 3 |

UI стал функциональнее: авторизация, отмена, экраны, размеры артефакта. CSS/HTML
увеличились; JS и число запросов уменьшились. Baseline gzip — расчёт на тех же
байтах, прежний сервер отдавал их без сжатия; after реально отдаёт gzip.
Первый экран ускорился примерно на 38%; API/touch колебания не выдаются за
улучшение. JS heap после gameplay: baseline около 5.60 MB, after около 5.45 MB;
это CDP heap, не полный RAM процесса. Parent long tasks: baseline отсутствуют,
after 0–1 на повтор, 50–56 ms. rAF интервалы измерительного sampler: медиана
16.7 ms в обоих вариантах. DEMO рисует по действиям/resize: эти интервалы
характеризуют browser scheduling, а не обещание постоянных 60 FPS/экономии батареи.

DEMO: HTML 4378 bytes, встроенный JS 2522, CSS 880, внешних зависимостей нет.
Размеры конкретного LLM HTML и inference latency приведены в demo-readiness;
они не входят во время загрузки оболочки. Память и CPU произвольного LLM-кода
не гарантируются opaque iframe. Явное открытие другой игры или pagehide удаляет прежний realm/listener;
bounded UI cache хранит максимум три версии, очередь максимум 128 событий.

Бюджеты: JS ≤150000, CSS ≤30000, критические ресурсы ≤250000 bytes gzip.
Превышение размера блокирует performance check. p75 interactive 3000 ms — цель;
shared hosted runner выводит предупреждение при превышении, не меняет лимит.
Тесты touch/изоляции/сохранения состояния обязательны независимо от скорости.
HTML >100 KB показывает warning, существующий hard limit 200 KB сохранён.
Небольшая выборка и синтетический throttling не доказывают field p75.


После 40 циклов открыть/закрыть с принудительным CDP GC: ни одного оставшегося
iframe; heap стабилизируется около 2.13 MB после прогрева/кэша (10/20/30/40
циклов записываются в JSON). Это ограниченная проверка retention родителя,
не доказательство отсутствия любых утечек в движке или неизвестной LLM игре.

## TASK-006: новая DEMO и ленивое подключение телефона

На том же Windows/Chromium профиле (390×844, DPR 2, CPU ×4, Slow 4G,
7 новых cold contexts) baseline сохранён до изменений, после TASK-005 merge.
Игра изменилась с кнопочного счётчика на поле с движением/столкновениями;
touch/start timings сравнивают пользовательское действие, а не одинаковый renderer.

| Метрика | Baseline TASK-005 | TASK-006 |
| --- | --- | --- |
| Первый экран, p75 | 617.5 ms | 632.3 ms |
| Выбор сохранённой игры → Start, p75 | 943.2 ms | 952.7 ms |
| API /games, p75 | 2.89 ms | 3.59 ms |
| Touch → изменение счёта, p75 | 4.3 ms | 6.0 ms |
| Начальный JS gzip | 6061 bytes | 6065 bytes |
| CSS gzip | 1939 bytes | 1995 bytes |
| Критические ресурсы gzip | 10022 bytes | 10278 bytes |

Все бюджеты сохранены. connection-ui загружается только при «Диагностика»;
QR encoder работает на сервере по запросу, его нет в начальном JS. Новая DEMO:
7622 bytes HTML, 5293 inline JS, 1123 CSS, без внешних ресурсов/постоянного rAF.
После 40 reopen/close циклов iframe=0; parent heap после принудительного GC
около 2.15 MB, прогрев/кэш ограничены тремя версиями. Эти лабораторные данные
не доказывают скорость физического телефона или любого LLM HTML.

## TASK-007: повторное измерение

Тот же runner, семь cold contexts 390x844 DPR2 Slow4G/CPUx4, отдельно от suite.

| Метрика | Before TASK-007 | After TASK-007 |
| --- | --- | --- |
| Shell p75 ms | 619.30 | 657.20 |
| Game launch p75 ms | 944.45 | 964.42 |
| Touch p75 ms | 5.90 | 5.70 |
| API p75 ms | 2.14 | 2.45 |
| Initial JS gzip bytes | 6065 | 7035 |
| CSS gzip bytes | 1991 | 2143 |
| Critical gzip bytes | 10274 | 11439 |

Добавлены provenance/share и lazy Telegram adapter. Размер вырос, budgets прежние
и выполнены. Timing колебания не выдаются за ускорение. LLM latency/Chromium checker
не входят в shell. Telegram SDK загружается только /telegram.
После 40 циклов навигации осталось 0 iframe; heap after 2176576 bytes. Это CDP heap, не полный RAM.

## TASK-009: измерение 14 октября 2026

Тот же cold mobile profile: 390×844, DPR 2, Slow 4G/CPU ×4, прогретый server,
семь новых uncached contexts. Начальный замер по stdout `performance:smoke` дал
interactive p75 664.6 ms; финальный `.local/performance/task009-final.json` — 645.6 ms.
Baseline использовал ранее накопленный каталог, post-run — новый изолированный
fixture-каталог: это наблюдаемые timings, а не причинное доказательство оптимизации.
Gzip начального JS: 7035 → 8870 bytes, CSS: 2143 → 2332, critical: 11439 → 13752.
Бюджеты 150000/30000/250000 bytes сохранены. Это browser laboratory profile,
не physical Android/iOS PASS и не время успешной LLM генерации. Два отдельных
одноразовых real OpenRouter pilots дали timeout без playable result; [границы](demo-readiness.md).

## TASK-010: измерение 14 октября 2026

Baseline `.local/performance/task010-baseline.json` и final
`.local/performance/task010-reviewed.json`: по семь cold 390×844 DPR2 contexts,
Slow 4G/CPU×4, прогретый server. LLM и browser validation вне shell timings.

| Метрика | Baseline | Final |
| --- | --- | --- |
| Shell p75 ms | 618.8 | 638.9 |
| Game launch p75 ms | 958.07 | 961.6983 |
| Touch p75 ms | 5.4 | 5.2 |
| API p75 ms | 3.08 | 3.2778 |
| Initial JS gzip bytes | 8893 | 9348 |
| CSS gzip bytes | 2332 | 2332 |
| Critical gzip bytes | 13775 | 14318 |

Загрузка games/gallery выполняется параллельно; промежуточная последовательная
версия имела около 796 ms shell p75. Final выше исходного baseline на 20.1 ms;
это не заявляется ускорением. Бюджеты 150000/30000/250000 B и timing goal 3 s
сохранены. После 40 navigation cycles probe оставил 1 iframe; этот результат
не равен историческому сценарию с 0 iframe и не доказывает отсутствие утечки.
Physical Android/iOS/WebView, энергопотребление и произвольный generated game
этим лабораторным профилем не проверены. [Реальные LLM и границы](task-010-report.md).
