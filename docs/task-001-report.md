# TASK-001 — локальный аудит YAPLIX

Дата: 12 октября 2026. Все изменения, инструменты и тестовые репозитории размещены внутри рабочего клона; внешние сервисы использовались только для чтения. Push и merge в GitHub не выполнялись.

## FACT

- Исходная main была чистой: `14c1ae011e5eaca0c09fa4b29d1123028853c4b0`; локальная origin/main и live `git ls-remote` совпали. История содержала исходную подготовку и три объединённых PR.
- GitHub API подтвердил Private, default branch main и личный тип владельца. GitHub-коннектор не имел доступа (404); использован read-only gh API.
- Документация ссылалась на прежнее имя и публичный репозиторий, считала кейс неназначенным. Активных пользовательских hooks и core.hooksPath не было.
- Оба задания `repository-checks` и `secret-scan` находятся в одном workflow. Исходный запуск на main (run 37914587513) имел success у обоих jobs; это результат прежней конфигурации.
- API rulesets вернул 403 с ограничением тарифа. Существующий protect-main не изменялся; его серверное применение не подтверждено.
- До изменений локальные repository-checks и 6 тестов проходили. Код приложения и инфраструктура игровых событий отсутствовали.

## CHANGED

- Обновлены существующие README, паспорт продукта, командные инструкции и вспомогательные документы. Указаны требования Билайна, Evolution Engine, пять будущих модулей и будущий версионируемый протокол событий; стек не выбран.
- Регламент запрещает прямой/force push в main и переписывание общей истории, требует PR, review другого участника и CI последней версии. Описаны обновление веток через merge, конфликты и onboarding.
- POSIX pre-push блокирует именно удалённую refs/heads/main на любом remote; проверяет обычный push, refspec, force, создание, delete и смешанную отправку. В этом клоне включён только локальный core.hooksPath=.githooks; hook сохраняется с mode 100755 и LF.
- Checker включает extensionless hook, проверку executable mode, коллизий регистра путей и регистра Markdown-ссылок. Тестовые файлы создаются только внутри клона. Cleanup тестов имеет ограниченный повтор Windows sharing/access errors без подавления ошибок.
- Сохранены jobs и SHA Actions; repository-checks расширен на Ubuntu 24.04 и Windows. Job сканера добавлено pull-requests: read; запись комментариев, summary и SARIF-артефакты отключены. Gitleaks закреплён на прежней default-версии 8.24.3.
- Gitignore дополнен локальными конфигурациями и кэшами; существующие исходники не исключены. Исторические ADR сохранены с явной актуализацией.

## VERIFIED

- Windows, Git 2.52.0.windows.1, Python 3.14.3: repository-checks проходят; финальная версия 19 unit/integration tests прошла дважды после исправления cleanup.
- Интеграционные push выполнялись исключительно в локальные bare fixtures. При запрете refs не меняются; разрешены рабочая ветка, отправка локальной main в feature и tag main. Настоящий origin не использовался для тестовых push.
- Установленный hook проверен через `git hook run` с искусственным stdin: main отвергнут, feature разрешён. Никакой отправки при этом нет.
- Actionlint 1.7.12: ошибок workflow не найдено (без дополнительных shellcheck/pyflakes). Версии закреплённых Actions сверены по официальным release/source: checkout v7.0.1, Gitleaks Action v3 / Node 24.
- Gitleaks 8.24.3: нет находок в истории всех локальных refs и отдельном снимке исходников (tracked + untracked non-ignored). Windows ZIP Gitleaks и actionlint сверены с официальными SHA256 checksums; хранятся в игнорируемой .local.
- Общий скан каталога отдельно отметил одну строку в README скачанного Gitleaks внутри .local, вне исходников проекта. Значение не выводилось; allowlist проекта не добавлялся. Поэтому результат полного каталога не выдаётся за успешный.
- Проверены LF/UTF-8, mode hook, относительные ссылки и регистр путей, отсутствие старого имени/абсолютных локальных путей в переносимых компонентах, diff --check и явный manifest изменений.

## NOT VERIFIED

- Hosted CI изменённой ветки/будущего PR: без push не запускался.
- Реальное исполнение на Linux и Ubuntu 24.04 ноутбуке: Linux/WSL недоступен. Проверка POSIX shell на Git for Windows остаётся Windows-only.
- Серверное применение protect-main и защита GitHub UI/API: не восстановлены и не доказаны. Наличие документации/конфигурации не является PASS этих проверок.
- Играбельность, WebView, генерация LLM и демонстрация: приложение ещё не реализовано.

## GIT

Рабочая ветка: `chore/yaplix-repository-setup`. Изменения сохраняются локально в этой ветке; SHA итогового коммита и конечный статус приводятся в финальном сообщении. main, история и настройки origin сохранены. Игнорируемая .local содержит только инструменты/артефакты аудита и не входит в коммит.

## RISKS

Hook обходится --no-verify, переопределением hooksPath и другими клонами; GitHub UI/API его не исполняют. Review/CI вручную контролирует команда. Private использует квоту hosted Actions; Gitleaks не гарантирует обнаружение всех секретов. При находке нужен отзыв секрета; история не переписывается автоматически. Тесты приложения появятся после выбора стека.

## NEXT

После разрешения владельца отправить только рабочую ветку: `git push -u origin chore/yaplix-repository-setup`. Открыть PR в main, получить review и успешные `repository-checks (ubuntu-24.04)`, `repository-checks (windows-latest)`, `secret-scan` на актуальной версии. Merge — отдельный шаг по регламенту. Каждому участнику установить hooks по [инструкции](development-setup.md). Затем выбрать узкий MVP и стек, проверить основу на Ubuntu 24.04.

Источники проверки CI и ограничений: [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets), [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1), [Gitleaks Action](https://github.com/gitleaks/gitleaks-action), [протокол hooks](https://git-scm.com/docs/githooks).
