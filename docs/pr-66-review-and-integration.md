# Review PR #66 — выборочная интеграция редизайна

**PR:** https://github.com/Sashido01/YAPLIX/pull/66
**Автор:** @jeanhayl
**Head на момент review:** `ae13df974513fcb59604878f9b12ac50367618cd`
**Base:** `main` `b6a64abb4e973a49a3372229690a5bf49d5bb8ca`
**Изменения:** 10 файлов, +1443 / -203. Автор написал «Тесты не запускались».

## Что полезно перенести

- Визуальную иерархию: ясные заголовки, панели, отступы, контрастные CTA.
- Единую палитру и дизайн-токены (dark/cyan/gold/green).
- Видимые `focus-visible`, крупные touch targets, подсветку активных состояний.
- Отдельные улучшения `assets/phone.css` и `assets/arena.css` после проверки адаптивности.
- Идею более заметной навигации «Создание / Мои игры / Arena» — только поверх **актуального UI-002** с действующим DOM/API.

## Что нельзя принимать без отдельного исправления и тестов

1. **`scripts/install-ui.mjs`**: новый `acquire()` шлёт `SIGTERM` PID из lock и удаляет lock без проверки ownership; опасно для чужого процесса.
2. **`scripts/install-adapter.mjs`**: `SIGKILL` и `rmSync(desktop.lock / desktop.json)` без доказательства instance ownership; нарушает гарантию сохранности чужого lock и данных.
3. **`scripts/desktop.mjs`**: `--stop` шлёт `SIGTERM` по PID из lock после timeout и стирает state; использовать только authenticated owned shutdown и проверенную принадлежность instance.
4. **`scripts/install-source.mjs`**: удалена проверка clean Git tree и добавлен fallback копирования файлов без проверенной Git-истории. Это ослабляет provenance инсталлятора.
5. **`src/server.ts`**: таймаут graceful shutdown сокращён с 5/12 с до 0.5/2 с и введён `process.exit(0)` в callback. Нужны тесты сохранения SQLite и корректного завершения операций.
6. **`assets/index.html`**: PR основан на старом `main`; в нём встречаются старые `#jobs-toggle` и `#gallery`. В RELEASE-007 DEMO/gallery удалены и UI-002 изменён. Нельзя полностью заменять актуальный HTML шаблоном из PR.

## Порядок интеграции на ноутбуке

1. Зафиксировать manifest текущего dirty `/home/talonsqu/DATA/YAPLIX`, staged/unstaged/untracked, БД и локальные коммиты. Не reset/clean.
2. Создать отдельный integration worktree от свежего `origin/main` **в пределах каталога YAPLIX**.
3. Сначала перенести уже прошедшие RELEASE-007F functional changes, DEMO removal, Canvas checker, jobs, UI, installer, Arena. Проверить `check:quick` и `check:integration`.
4. От PR #66 перенести **только согласованные стили и безопасную структуру** небольшими патчами, адаптируя к актуальным селекторам. Пять runtime/install изменений выше не cherry-pick.
5. Проверить exact routes, DOM IDs, model picker, editor, Library, QR, Arena и сохранение iframe при мобильной навигации; screenshot 320/390/tablet/desktop.
6. Повторить соответствующие unit, Playwright и итоговый `check:full` на exact candidate SHA.
7. Обновить README, слайды, runbook и безопасность; Gitleaks на публичном diff.
8. После PASS создать PR и merge, не отключая Windows-installer CI и не выдавая hosted checks за PASS.

## Непроверенное

Функциональная совместимость PR #66 с локальными незакоммиченными правками RELEASE-007F не проверялась: локальная копия недоступна через GitHub. Сам PR не содержит тестовых результатов. Этот документ **не является согласием на merge PR #66 напрямую**.


## SUBMISSION-009: фактически перенесено

В Draft PR #69 выборочно адаптированы cyan/gold и цвета поверхностей для текущих
UI-002, Arena и phone; мобильная Library использует одну читаемую колонку. Автор
jeanhayl отмечен в AUTHORS.md. DOM PR #66, installers, locks, signals и server
shutdown из него не переносились. Сохраняются focus-visible, safe-area и 44px
контролы. Это выборочная адаптация, не прямой merge PR #66.
