# Командная разработка YAPLIX

`main` содержит проверенный результат. Правило владельца от 13 октября 2026:
**задача не завершена до успешного merge и проверки итоговой main**. Доступ к
Private-репозиторию и личную Git-аутентификацию настраивает участник; секреты
не помещаются в Git. Постоянные инструкции агента — [AGENTS.md](AGENTS.md).

## Начало задачи

Проверьте состояние и сохраните известные изменения, не удаляя чужую работу.
При чистом дереве:

```sh
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c codex/short-topic
```

Другие существующие feature/fix/chore/docs ветки допустимы. Не начинайте от
устаревшей ветки предыдущей задачи. Реализуйте законченный пользовательский
сценарий, обновите README/контракты, проверьте запуск, тесты, build и безопасность.
Делайте логичные коммиты; stage только явно просмотренные файлы, проверяйте
`git diff --cached` и отсутствие секретов/посторонних изменений.

## PR, CI и merge

```sh
git push -u origin HEAD
```

Создайте PR с base `main`, содержательным результатом и фактическими проверками
по [шаблону](.github/pull_request_template.md). Просмотрите diff, target branch,
конфликты и checks именно последнего head. Обязательны зелёные
`repository-checks (ubuntu-24.04)`, `repository-checks (windows-latest)` и
`secret-scan`. Исправляйте ошибки новыми коммитами, снова ждите CI.

Владелец разрешает самостоятельно выполнить стандартный merge обычной задачи
после успешных проверок. Не ждите участников ради внутренних инженерных решений.
Если GitHub protection требует review, выполните требование; обход запрещён.
Используйте разрешённый настройками merge method, предпочтительно merge commit
для сохранения истории. Не используйте `--admin`. После ошибки merge сначала
прочитайте фактическое состояние PR; не повторяйте действие вслепую.

Если main изменилась, получите её через `git fetch origin`, затем
`git merge origin/main` в чистой feature-ветке, разрешите смысловые конфликты,
повторите проверки/CI. Общую опубликованную историю не переписывайте.

## Проверка после merge

```sh
git switch main
git pull --ff-only origin main
git log -1 --format="%H %s"
git status --short
```

Проверьте merge SHA, присутствие коммитов задачи и критические smoke-тесты на
полученной main. Удалите временную local/remote feature-ветку только если она
полностью объединена и не используется другим worktree. Если merge блокируется
защитой, CI или конфликтом, сообщите точное состояние: задача остаётся незавершённой.
Финальный отчёт: MAIN, MERGED, RUN, VERIFIED, MVP, LIVE, DOCS, NEXT.

Запрещены force-push, прямой push/удаление main, reset --hard/clean для разрешения
конфликтов, отключение CI и изменение permissions. Локальный pre-push запрещает
remote refs/heads/main, но не заменяет серверную защиту:
[ограничения](docs/github-ruleset.md). Установка — [development-setup](docs/development-setup.md).

Проверки: `npm run browsers:install`, `npm run check`, Python checker/tests и
Gitleaks; на Ubuntu — python3. Synthetic, реальные LLM-вызовы и физические
устройства проверяйте и описывайте отдельно. Не выдавайте DEMO/fallback за LLM.
Секреты, персональные данные и непубличные материалы запрещены даже в Private.
Соблюдайте [SECURITY.md](SECURITY.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
и фиксируйте только подтверждённый вклад в [AUTHORS.md](AUTHORS.md).
