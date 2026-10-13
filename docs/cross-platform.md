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
в Chromium desktop/mobile и WebKit mobile. Физический WebView требует отдельной проверки. Реальные LLM-артефакты
испытываются отдельно от authored fixture; границы указаны в demo-readiness. Генерация и gameplay имеют разные
требования к сети. Детали — в [архитектуре](architecture.md).

Frontend/backend — один процесс npm start; .env читается автоматически. DEMO
не требует внешних сервисов. Для LIVE установите Ollama для своей ОС, модель и
проектную BGen library по README. На Ubuntu CI установка pinned library идёт из
чистого checkout; live inference зависит от ресурсов компьютера и не входит в CI.
