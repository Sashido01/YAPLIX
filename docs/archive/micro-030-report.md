> Исторический документ. Статусы и результаты относятся к указанным в нём дате и SHA. Актуальное состояние: [обзор документации](../README.md).

# MICRO-030 — landscape controls in generated Full HTML

17 октября 2026. Base main: `86d1185f43ad85d02c52f7fe5085862bb3bdce67`.
Ветка: `fix/generated-game-landscape`. LLM inference POST: **0**.

## Причина и изменение

Прежний `src/full-html-check.ts` проверял только 320×700 и 390×700.
У обеих змеек NL-004 управление реализовано div с pointerdown, а не button.
Сохранённые HTML повторно прошли прежний checker, хотя 844×390 обрезал управление.

Добавлен отдельный offline touch-профиль 844×390 в том же opaque sandbox/CSP.
Новая ошибка `BROWSER_CONTROLS_UNREACHABLE` классифицируется существующим движком
как FAILED и не даёт принять candidate. Регрессия движка использует synthetic
transport, без HTTP и repair.

Для отказа требуется активный элемент, ранее доступный для hit-test в одном из
portrait-профилей, полностью ушедший за viewport в landscape, без возможного
CSS scroll-контейнера. Нативные/role-кнопки распознаются семантически; для div с
cursor:pointer дополнительно проверяется настоящий input listener через CDP
самого iframe. Декоративный cursor:pointer недостаточен для отказа.

Скрытые, прозрачные, disabled, inert, aria-hidden/aria-disabled элементы
пропускаются. Неизвестные будущие состояния также не считаются дефектом.
Обход ввода больше не пытается принудительно нажимать неактивные/внеэкранные
элементы. HTML/JS игр не переписываются, состояние игры не подставляется.

## Повторная проверка NL-004

| Сохранённая игра | Прежний checker | Новый checker, 7/7 повторов | Геометрия при 844×390 |
| --- | --- | --- | --- |
| DEV-01-direct | passed | FAILED: BROWSER_CONTROLS_UNREACHABLE | up y=548, остальные y=618, высота 60 |
| DEV-01-intent | passed | FAILED: BROWSER_CONTROLS_UNREACHABLE | up y=452, остальные y=532, высота 70 |
| DEV-04-direct | passed | passed | активная область булочки доступна; кнопка покупки частично видна и не объявляется дефектом |

У обеих змеек body overflow:hidden, root overflow:visible; обычная viewport
прокрутка заблокирована. Старт выполнен реальным tap. Исходные артефакты
`.local/nl-004/` не изменялись. SHA-256 `game.html` до/после совпадают:

```text
DEV-01-direct D67EAE4EE50B3ED496068960851AAE9039C6689F09DED7B678F796F8FD328C48
DEV-01-intent A02339EC1507FF8EF13F3ECF9033B26938B0596D5D8914795FEFEA256B4707AB
DEV-04-direct 1F893E98874D26E50E6CACC62FE635FC37C613D40E13B2674B6DBA2C5F1AF5B6
```

## Бюджет и проверки

Прежний elapsedMs без launch: 1354 / 1354 / 1189 ms соответственно.
Окончательная версия, семь повторов на HTML, wall time вместе с запуском и
закрытием Chromium: 1809–2038 / 1840–1925 / 1881–1962 ms.
Общий production watchdog **18000 ms не увеличен**. Это локальный Windows
замер, не гарантия для shared runners или произвольного тяжёлого HTML.

Проверки:

- Typecheck и production build PASS.
- Unit: 258/258 PASS; Python repository tests: 19/19; CI policy: 8/8.
- Browser: generation.spec.ts + micro027.spec.ts, Chromium desktop: 22/22 PASS.
  Включают 11 новых случаев: две формы дефекта, native/fixed controls,
  исправная раскладка, viewport/nested scroll, hidden/inactive и future-state
  кнопки, декоративный div, FAILED diagnostic движка. Сами checker-вызовы
  создают touch/mobile профили независимо от desktop test project.
- RED: до исправления четыре defect fixtures принимались прежним checker.
- Repository hygiene/link checks PASS; Gitleaks 8.24.3: история и явные файлы
  изменения, 0 утечек. Архив инструмента сверён с release checksums.

Локальные evidence: `.local/micro030/`: baseline-original.json, after.json,
timings.json, hashes-before.json, PNG, unit.log, final-browser.log и scan reports.
Эти локальные материалы и сохранённые игры не публикуются в PR.

## Границы

Это узкий технический gate доступности управления, не универсальный анализ
правил игры. Scrollability намеренно переоценивается: scroll lock через JS или
touch-action, вложенный clipping, canvas-only controls, делегированные события,
новое управление только в landscape и поздние состояния могут остаться
NOT_VERIFIED. Частично доступные кнопки не отклоняются. Максимум 64 внеэкранных
кандидата на sample; неизвестная структура/смена DOM не доказывает отказ.
Готовность gameplay/win, instrumented telemetry path, физические Android/iOS,
Telegram и полный мультибраузерный FULL этой задачей не подтверждаются.

Hosted Actions: API подтвердил enabled:false; отсутствие checks не считается
зелёным CI. Применён временный MICRO-019 owner exception. Провайдеры, Intent,
platform UI, production SQLite и Draft PR #34 не изменялись. MVP целиком не
переаттестован. PR предназначен для main **без merge**.
