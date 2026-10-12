# Рабочее место и проверки YAPLIX

Нужны **Git и Python 3.11+**. Это инструменты проверки репозитория; стек приложения пока не выбран. Новый участник сначала принимает приглашение в Private-репозиторий и настраивает GitHub-аутентификацию средствами Git; токены не вставляет в URL и файлы проекта.

## Первый клон

Из выбранной родительской папки (команды Git одинаковы на Windows/Linux):

```sh
git clone https://github.com/Sashido01/yaplix.git
cd yaplix
git config --local core.autocrlf false
git config --show-origin --get core.hooksPath
```

Отсутствие вывода последней команды и код 1 означают, что core.hooksPath не задан. Если уже настроены чужие hooks, сначала согласуйте их совместное использование: изменение core.hooksPath заменяет активный каталог hooks. Проверьте также свои активные hooks в .git/hooks, если отдельный путь не задан. В существующем клоне не повторяйте git clone.

## Установка локальной защиты main

Из корня клона каждый участник выполняет:

```sh
git config --local core.hooksPath .githooks
git config --local --get core.hooksPath
git ls-files --stage .githooks/pre-push
```

Ожидаются .githooks и Git mode 100755. На Linux при утрате исполняемого права выполните chmod +x .githooks/pre-push. Git for Windows запускает #!/bin/sh своим shell, дополнительный runtime для hook не нужен. Глобальная Git-конфигурация не меняется. После нового клонирования установка повторяется; .git/config в Git не передаётся.

Hook запрещает **любой удалённый refs/heads/main**: обычный push, явный refspec, создание, force-push и удаление. Сопоставление идёт по целевой ветке из stdin Git, а не по текущей локальной ветке или имени remote. В смешанном push запрещается вся операция. Возможности обхода и серверные ограничения — в [github-ruleset.md](github-ruleset.md). Не проверяйте защиту тестовым push в настоящий origin/main.

## Локальные проверки

Windows, PowerShell 7:

```powershell
python --version
python scripts/check_repo.py
python -m unittest discover -s scripts/tests -v
git diff --check
git status --short
```

Ubuntu/Linux: те же команды с `python3`. Скрипт проверяет **отслеживаемые файлы**; перед проверкой новых файлов добавьте явно просмотренные файлы в индекс (`git add <file>`). Тесты push используют только временные локальные репозитории внутри этого клона и никогда не обращаются к GitHub.

Для полного локального сканирования установите официальный Gitleaks **8.24.3** в удобный локальный каталог и проверьте checksum архива. Не храните бинарник в Git. Из корня с доступным gitleaks:

```sh
gitleaks git --redact --log-opts=--all .
gitleaks dir --redact .
```

Вторая команда проверяет также незакоммиченные файлы; не размещайте её отчёт в Git. Находка или ошибка инструмента запрещает считать проверку успешной. Отсутствие находок не гарантирует отсутствия всех секретов. Действия при утечке — в [SECURITY.md](../SECURITY.md).

## CI

В одном workflow находятся repository-checks (Ubuntu 24.04 и Windows) и secret-scan (Linux, Gitleaks). Триггеры: pull_request, push в main, ручной workflow_dispatch. На PR/push Action проверяет диапазон изменений из полной загруженной истории; ручной запуск сканирует историю текущего checkout. Это не равнозначно сканированию всех удалённых веток. Для полной локальной истории используйте команду с --all выше.

Actions закреплены SHA; Dependabot проверяет обновления. Токен имеет contents: read, сканер дополнительно pull-requests: read для чтения списка коммитов Private PR. Запись комментариев, SARIF-артефакты и summary сканера отключены; вывод Gitleaks редактируется (--redact). Для личного аккаунта отдельная лицензия Gitleaks Action не нужна ([документация](https://github.com/gitleaks/gitleaks-action#usage-example)). Private использует квоту GitHub Actions; исчерпание квоты не считается успешным CI.

Локальные проверки не подтверждают hosted CI новой ветки. Перед merge нужно дождаться реальных зелёных checks последней версии PR. Командный процесс — в [CONTRIBUTING.md](../CONTRIBUTING.md), подготовка ноутбука — в [cross-platform.md](cross-platform.md).
