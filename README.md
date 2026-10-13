# YAPLIX (Япликс)

**«Ты придумал. Теперь играй».** Локальный MVP: идея → HTML5-игра → запуск,
статистика, сохранённые версии и автономный HTML. Командный проект для кейса
Билайна «Вайбкодинг игр»; требования и будущий Evolution Engine — в
[паспорте проекта](docs/project-brief.md).

## Установка из чистого клона

Нужны Git, **Node 24.18+ в ветке 24.x** и npm. Python 3.11+ нужен для проверок
репозитория, Playwright — для browser tests. Frontend и backend запускает один
процесс: отдельный UI-репозиторий, Bun, Docker, LLM и ключи для DEMO не нужны.
Private-репозиторий требует доступа GitHub и настроенной Git-аутентификации.

Windows, PowerShell:

```powershell
git clone https://github.com/Sashido01/YAPLIX.git
Set-Location YAPLIX
npm ci
Copy-Item .env.example .env
npm run build
npm start
```

Ubuntu 24.04, terminal:

```sh
git clone https://github.com/Sashido01/YAPLIX.git
cd YAPLIX
npm ci
cp .env.example .env
npm run build
npm start
```

Откройте **http://127.0.0.1:3000/**. `npm start` читает локальный `.env`;
переменные процесса имеют приоритет. Остановить — Ctrl+C. Повторный `npm start`
открывает ту же `.local/data/yaplix.sqlite`. Не удаляйте `.local`: там игры,
версии, события, backup и установленные локальные компоненты. Секреты и данные
игнорируются Git; настройки не передаются игре.

## Пройти DEMO без ключей

1. Оставьте DEMO и нажмите «Создать игру». Это авторский «Звёздный курьер»,
   **не генерация LLM**. Число в запросе задаёт цель (1–20, по умолчанию 3).
2. «Старт», три раза «Груз» → победа; в новом запуске «Ловушка» → поражение.
   Enter/пробел и экранные кнопки работают. «Запустить заново» создаёт новую сессию.
3. В «Что изменить?» введите «Теперь собери 5 грузов». Новая версия требует пять
   очков; предыдущая доступна в списке версий. Отображается наблюдённая статистика.
4. Перезапустите backend и выберите игру в «Мои игры»: данные сохраняются.
5. «Скачать HTML» выдаёт исходный файл с тем же SHA-256. Он играет без backend
   и сети; самостоятельный DEMO-файл содержит «Перезапуск».

## LIVE: настоящий HTML/JS от LLM

Доступный путь: опубликованный **BGen prompt compiler** + явный локальный Ollama
transport. LLM создаёт весь код; templates, router, Mock и GigaChat BGen не
импортируются. Предыдущий HTML передаётся компилятору при создании версии.
Старый удалённый BGen API остаётся отдельной зависимостью с блокером безопасного
LIVE-контракта; для этого MVP он не требуется.

Установите Ollama по официальной инструкции
[Windows](https://ollama.com/download/windows) или
[Linux](https://ollama.com/download/linux). Это внешняя LLM-зависимость;
модель требует места на диске и подходящей памяти/GPU. YAPLIX не устанавливает
системные службы и не меняет их настройки. После установки/запуска Ollama:

```sh
npm run bgen:install
ollama pull qwen2.5-coder:14b
```

Установщик клонирует публичный BGen в `.local/BGen`, закрепляет SHA
`419c64968d487068a2fbed2e4bd99489cc734430` и проверяет чистоту исходников.
Имеющийся checkout не перезаписывается. Для чистого клона установка требует
сети, после неё prompt library работает локально без npm/Bun зависимостей BGen.

В `.env` задайте:

```dotenv
LIVE_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5-coder:14b
LLM_TIMEOUT_MS=300000
```

Имя модели должно точно совпадать с установленным `ollama list`. Можно явно
выбрать другую установленную coding-модель; автоматической подмены модели нет.
`npm run doctor` проверяет базу, библиотеку и доступность выбранной модели.
Перезапустите `npm start`, выберите LIVE, опишите правила и создайте игру.
Ожидание ограничено пятью минутами. Ошибка сохраняет прежнюю игру и **не включает
DEMO**. Генерация и загрузка модели зависят от компьютера; игровое качество
произвольного ответа LLM не гарантируется. Метод, provider, model и hash
фиксируются с версией; `validationStatus=unverified` не означает браузерный PASS.

`npm run demo:live` воспроизводимо вызывает две генерации и доработку первой,
сохраняет HTML/SQLite/evidence в отдельной `.local/live/<run>`. Команда проверяет
readback/export/hash, но не сочиняет события и не подтверждает игру без браузера.
Границы реальных испытаний — [чеклист демонстрации](docs/demo-readiness.md).

## Диагностика, backup и обновление

«Диагностика» показывает состояние базы и конфигурацию LIVE. «Создать резервную
копию» делает согласованный SQLite backup, проверяет integrity/FK/schema и
выдаёт имя и SHA-256. Копия включает игры, версии, сессии и события.
Те же операции из терминала:

```sh
npm run doctor
npm run backup
npm run verify:backup -- .local/backups/backup-UUID.sqlite SHA256_FROM_BACKUP
```

Сохраните файл и hash на отдельный носитель. Проверка копии читает её read-only
и требует точный hash. Лимит — 20 копий; удаляйте вручную только опознанные
собственные копии после переноса/проверки. Автоматической очистки данных нет.
Восстановление и безопасное обновление —
[инструкция рабочего места](docs/development-setup.md).

## Проверки и Git workflow

```sh
npm run bgen:install
npm run typecheck
npm test
npm run browsers:install
npm run test:browser
python scripts/check_repo.py
python -m unittest discover -s scripts/tests -v
```

На Ubuntu используйте `python3`; если Playwright не хватает системных библиотек,
`node scripts/browser-tests.mjs install --with-deps chromium webkit`.
`npm test` сначала собирает frontend для проверки настоящего production server.
Тесты используют synthetic LLM и авторские игры; CI не требует запущенной LLM.
Windows/Ubuntu Actions проверяют чистый checkout, pinned BGen, типы, SQLite/API,
production restart, DEMO UI и sandbox в Chromium/WebKit; secret-scan — отдельно.
Кэши и browser artifacts находятся в `.local`.

Задача завершена только после зелёного hosted CI, merge PR в `main`, ff-only
обновления локальной `main` и проверки результата. Владелец разрешил автономный
merge обычных задач; требуемую GitHub защитой проверку обходить нельзя.
Прямой push/force-push в main, отключение CI и изменение permissions запрещены.
Постоянное правило — [AGENTS.md](AGENTS.md), процесс — [CONTRIBUTING.md](CONTRIBUTING.md).

## Документация и границы

- [Рабочее место, API, backup/restore/update](docs/development-setup.md)
- [Windows / Ubuntu](docs/cross-platform.md), [архитектура и аудит BGen](docs/architecture.md)
- [Ограничения защиты main](docs/github-ruleset.md), [безопасность](SECURITY.md)
- [Лицензирование сторонних компонентов](docs/licensing.md), [вклады](AUTHORS.md)

MVP слушает только loopback и не имеет публичной авторизации. Недоверенная игра
работает в opaque iframe; события проверяются, но остаются клиентскими данными.
Скачанный HTML теряет HTTP CSP: открывайте его offline в отдельном браузере.
CPU/memory изоляция, физический WebView и причинная оценка «улучшения» игры не
подтверждены. Evolution сейчас хранит/сравнивает наблюдения и версии; автоматического
переобучения нет. Открытая лицензия на YAPLIX пока не предоставлена.
