# Ограничения защиты main в Private YAPLIX

_Состояние на TASK-001, 12 октября 2026._ Репозиторий Sashido01/yaplix — **Private**, основная ветка main. Пользователь подтвердил в GitHub, что существующий protect-main перестал принудительно применяться из-за текущего тарифа. API rulesets при аудите вернул HTTP 403: функция требует GitHub Pro либо Public. Значение Active само по себе не доказывает принудительное применение.

[Документация GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) описывает доступность rulesets: GitHub Free — для Public, поддержка Private — на соответствующих платных тарифах. **Не удаляем существующий ruleset, не меняем видимость и не покупаем тариф в этой задаче. Серверная защита не восстановлена.**

## Действующий командный процесс

Повторная read-only проверка MICRO-018, 16 октября 2026: GET branch main
вернул `protected:false`, `protection.enabled:false`, пустые required checks
и `enforcement_level:off`. Protection/rulesets GET снова вернули 403 Pro/Public.
Настройки не менялись. [FAST/FULL](ci-economy.md) сохраняет имена checks и
делает выбранные по риску тесты обязательными внутри jobs, но серверная блокировка
merge при текущем тарифе по-прежнему не подтверждена и не восстановлена.

**Повторная read-only проверка 26 октября 2026:** REST `rulesets/24780721`
вернул `protect-main`, `enforcement: active`, условие `~DEFAULT_BRANCH`, запрет
deletion/non-fast-forward и required status contexts `repository-checks`,
`secret-scan` (GitHub Actions integration 15368). Это более новое наблюдение,
чем снимок 16 октября. До RELEASE-CI-001 workflow выдавал только два matrix
контекста `repository-checks (ubuntu-24.04)` и `repository-checks (windows-latest)`;
требуемый агрегат `repository-checks` отсутствовал. Он добавлен с зависимостью
от обоих платформенных прогонов и Windows installer acceptance. GitHub Actions
на момент изменения `enabled:false`, поэтому реальные required checks текущего
PR ещё не подтверждены. Правила и настройки сервера не изменялись.

- main — стабильная ветка. Работа идёт в отдельных ветках и предлагается через PR.
- До merge обе платформы repository-checks (FAST/FULL по риску) и secret-scan проходят на актуальном head; diff, target main, конфликты и замечания проверены. Перед release обязателен manual FULL на точном commit. Владелец разрешает автономный merge; review другого участника обязателен, только если его требует серверная защита. Задача завершается после проверки main после merge.
- Прямой push, force-push и удаление main, переписывание общей истории запрещены регламентом.
- Все участники устанавливают репозиторный pre-push hook в своём клоне.

Процедура — в [CONTRIBUTING.md](../CONTRIBUTING.md), установка и тесты — в [development-setup.md](development-setup.md).

## Граница локального hook

.githooks/pre-push отвергает отправку в refs/heads/main на любой remote, включая URL и явные refspec, force и delete. Он не запрещает отправлять локальную main в другую удалённую ветку. При отсутствии изменений Git может не передать refs; такой push ничего не меняет.

Hook можно обойти git push --no-verify, переопределением core.hooksPath, отключением/изменением файла или работой из другого клона. GitHub UI, API и серверное слияние PR локальный hook не запускают. Hook **не проверяет CI, review и переписывание других веток**; это обязательства команды. Он снижает риск случайной отправки и не заменяет серверную защиту.

Не испытывайте правила push в настоящий origin/main. Автотесты используют временный локальный bare-репозиторий. Если условия аккаунта в будущем изменятся, существующий ruleset нужно отдельно проверить через GitHub и реальные признаки применения; только после этого можно заявлять серверную защиту.
