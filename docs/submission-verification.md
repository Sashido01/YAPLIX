# Проверки кандидата к оценке GitHub — 26 октября 2026

Этот документ относится к объединённому локальному кандидату на основе Arena #58/#59 и Ubuntu portable installer. Точный commit, текущий `origin/main` и полный список файлов находятся в локальном `.local/submission-001/REPORT.md`; этот служебный отчёт и тестовые данные в Git не включаются.

## Подтверждено на текущей Ubuntu

- Node 24.18.0: `npm ci`, `npm run typecheck`, `npm run build` — PASS. Установка зависимостей не изменила lockfile.
- Production `browserCheck` с Full Chromium revision 1248, `chromiumSandbox:true`, CSP и offline opaque iframe принял авторскую игру `arena-target.html`: Canvas 2D, профили 320/390/844 px. Это локально созданный HTML, не ответ LLM.
- Перед сохранением того же HTML прошли `validateDocument` и `browserCheck`. Версия записана в изолированную SQLite, Store закрыт и открыт снова; `/api/versions/:id` и HTML export вернули точные исходные байты. SQLite integrity — PASS. Локальная запись не является LIVE inference.
- Исправленный установочный probe с бинарником поставляемого Chromium вернул `sandboxReady:true` в изолированном probe-каталоге. Уже установленный CORE-002 пакет имеет прежний код; для применения исправления его нужно пересобрать из этого кандидата.
- Две другие авторские игры (`ember-blocks`, `prism-maze`) остаются готовыми офлайн-примерами. Строгий gate новой генерации отклонил их DOM-интерфейс (`BROWSER_DOM_GAME_UI`); обещания, что они проходят новый gate, нет.
- Целевые Arena, SQLite, installer, launcher и browser-target unit tests прошли после создания требуемых изолированных тестовых каталогов. Итоговые числа и независимая проверка после commit записаны в локальном отчёте.

## Почему Full validator раньше не запускался

Playwright 1.64.0 в headless-режиме искал `chromium_headless_shell-1248`, отсутствующий в Full payload. Пакет содержит обычный `chromium-1248/chrome-linux64/chrome`. Production checker, экспериментальный gameplay checker и установочный probe теперь выбирают этот фиксированный поставляемый бинарник. Lite сохраняет явный `channel:'chrome'`; при ошибке запуска нет перехода на другой браузер или отключения sandbox. Длинный путь временного Chromium-профиля может дать отдельную ошибку `Socket path too long`; проверка выше использовала короткий изолированный data root.

## Границы

Реальных LLM POST, OAuth/model GET, физических Android/iOS/Telegram, независимого компьютера, Windows installer, графического double-click и hosted Actions для этого commit не было. Старые отчёты относятся к указанным в них SHA. Проверки исходников и локальные тесты не заменяют специализированный secret scan, если `gitleaks` недоступен. Публичная лицензия не выдана; [правовой статус](licensing.md). Готовые `.run`/`.exe` не входят в Git; инструкции сборки — [installer-building.md](installer-building.md).
