# YAPLIX (Япликс)

**«Ты придумал. Теперь играй».**

YAPLIX — проект ИИ-платформы для генерации, распространения и эволюции браузерных игр. Пользователь описывает игру обычным текстом и получает играбельную HTML5-игру.

Проект команды из **трёх человек** для кейса Билайна «Вайбкодинг игр: ИИ-генератор браузерных игр по текстовому промпту» на «ИТ-спринт 2026». По заданию команды дистанционный этап проходит **12–29 октября 2026**, очная защита — **20 ноября 2026**; демонстрация — **3–5 минут**.

## Требования кейса

- Ввод обычного текстового описания игры.
- LLM действительно генерирует код, а не выбирает готовый шаблон.
- Результат — HTML5-игра с полноценным игровым циклом.
- Игра работает в WebView без серверных зависимостей во время игры.
- Git хранит видимую историю командной разработки; команда использует ИИ-инструменты.
- Демонстрация показывает реальный результат за 3–5 минут.

## Evolution Engine и состояние реализации

**YAPLIX Evolution Engine** — планируемое развитие: собирать игровой опыт, анализировать результаты и создавать следующие поколения игр с улучшенными механиками. Будущие направления YAPLIX Play и YAPLIX Studio, аналитика, распространение и игровые кампании описаны в [паспорте проекта](docs/project-brief.md).

**Реализована локальная интеграционная основа 0.0.1:** Hono API, SQLite с миграцией,
хранение игр/версий и SHA-256, валидация событий, статистика и сравнение версий,
серверный HTTP-адаптер BGen и sandboxed browser runtime. Это фундамент Evolution
Data, без автоматического изменения игр. Генератор развивает SKZHPRVT, Mobile
First UI — jeanhayl. Нового генератора и второго frontend здесь нет.

TASK-003 добавляет строгий запрос `requiredMethod: "llm_code"`, проверку возможностей
BGen перед вызовом, экспорт HTML с SHA-256 и воспроизводимый `npm run demo:live`.
Шаблон, Mock, fallback, неизвестная модель или неподтверждённая итерация не сохраняются
как конкурсный результат. Обычный API сохраняет отдельные режимы TASK-002.

**Настоящая генерация пока заблокирована:** 13 октября 2026 опубликованный BGen
HTTPS API отвечает на health, но `/api/capabilities` возвращает 404. Свежий BGen
`419c649` не предоставляет provenance/model, содержит GigaChat TLS bypass и
не передаёт предыдущий HTML компилятору. Live preflight завершился
`BGEN_LIVE_CONTRACT_REQUIRED`, 0 версий; LLM-запрос не отправлен. Ни один реальный
LLM/provider/model этой интеграцией не подтверждён. Физические устройства не испытаны.
Минимальный контракт для SKZHPRVT и шаги демонстрации — в
[инструкции рабочего места](docs/development-setup.md).

## Установка и запуск

Нужны **Node 24.18+ (ветка 24.x), npm, Git и Python 3.11+**.
Команды из корня проекта одинаковы на Windows и Ubuntu:

```sh
npm ci
npm run build
npm start
```

API слушает только `127.0.0.1:3000`; health — `/api/health`, база —
`.local/data/yaplix.sqlite`. Без BGEN_URL генерация возвращает BGEN_NOT_CONFIGURED;
для локальной проверки доступен импорт известного mock HTML. Конфигурация через
переменные процесса; `.env.example` — шаблон. Для чтения локального `.env`:
`node --env-file=.env src/server.ts`. Ключи генератора не передаются браузеру.

```sh
npm run typecheck
npm test
npm run browsers:install
npm run test:browser
```

Для live-запуска после принятия контракта BGen задайте BGEN_URL в окружении и
выполните `npm run demo:live`. Команда вызывает тот же API/адаптер, сохраняет два
сценария и связанную доработку в отдельной `.local/live/<run>/yaplix.sqlite`,
экспортирует HTML и записывает evidence.json. До браузерного испытания результат
остаётся `generated_unverified`; команда не сочиняет события и не ставит PASS.

На Linux при отсутствии системных библиотек Playwright:
`node scripts/browser-tests.mjs install --with-deps chromium webkit`.
Браузеры, npm cache, browser temp и отчёты сохраняются внутри `.local`.
`npm run check` выполняет typecheck, integration и browser tests; команды
TASK-001 ниже сохраняются отдельно. Тестовый HTML написан вручную, маркирован
mock и не считается результатом LLM.

## Структура

| Путь | Назначение |
| --- | --- |
| docs/ | Контекст продукта, рабочее место, защита main, подготовка демонстрации, ADR |
| src/ | Контракты, Hono API, SQLite, BGen Adapter, browser bridge |
| tests/ | API/SQLite/adapter tests и автономный авторский HTML для Playwright |
| scripts/check_repo.py | Проверка UTF-8, LF, ссылок, регистра путей и прав hook |
| scripts/tests/ | Тесты проверки репозитория и локальной защиты push |
| .githooks/pre-push | Запрет отправки изменений в удалённую refs/heads/main |
| .github/ | CI, Dependabot, шаблоны Issues и Pull Requests |

## Проверки и участие

Нужны Git и Python **3.11+**. Из корня клона на Windows:

```powershell
python scripts/check_repo.py
python -m unittest discover -s scripts/tests -v
```

На Ubuntu используйте python3. CI запускает проверки на Windows и Ubuntu 24.04; Gitleaks проверяет вероятные секреты на Linux. Фактический статус конкретного коммита смотрите в GitHub Actions.

Репозиторий [Sashido01/yaplix](https://github.com/Sashido01/yaplix) **Private**. Работайте в feature/, fix/, chore/ или docs/-ветках, открывайте PR в main, получайте review другого участника и зелёный CI до merge. Прямой push и force-push в main, а также переписывание общей истории запрещены командным регламентом.

Каждый участник устанавливает hook в своём клоне по [инструкции рабочего места](docs/development-setup.md). Локальный hook обходится и не заменяет серверную защиту; существующий ruleset на текущем тарифе для Private не обеспечивает её. Подробности — [ограничения защиты main](docs/github-ruleset.md).

## Документация

- [Концепция, требования и предполагаемые модули](docs/project-brief.md)
- [Командный процесс и review](CONTRIBUTING.md)
- [Рабочее место и установка hooks](docs/development-setup.md)
- [Архитектура, аудит BGen и границы безопасности](docs/architecture.md)
- [ADR платформы и разделение работы команды](docs/decisions/0003-platform-foundation.md)
- [Windows / Ubuntu](docs/cross-platform.md) и [чеклист демонстрации](docs/demo-readiness.md)
- [ADR](docs/decisions/0001-public-portfolio-repository.md) и [решение о CI](docs/decisions/0002-repository-ci.md)
- [Безопасность](SECURITY.md), [правила общения](CODE_OF_CONDUCT.md), [подтверждённые вклады](AUTHORS.md)
- [Права и лицензирование](docs/licensing.md), [будущая подготовка портфолио](docs/portfolio-checklist.md)

Открытая лицензия не предоставлена. Материалы кейсодателя и персональные данные допускаются только с необходимым разрешением; секреты запрещены даже в закрытом репозитории.
