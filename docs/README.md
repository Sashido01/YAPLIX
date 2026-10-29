# Документация YAPLIX

## Начало работы

- [README и обзор проекта](../README.md)
- [Установка Ubuntu portable](../INSTALL.md)
- [Разработка и локальное обслуживание](development-setup.md)
- [Сборка desktop-пакетов](installer-building.md)
- [Ubuntu setup и проверенные команды](UBUNTU_SETUP.md)
- [Диагностика и журналы](diagnostics.md)

## Архитектура и игровые контракты

- [Архитектура](architecture.md)
- [Production game validation](game-validation.md)
- [Canvas/WebGL rendering contract](canvas-rendering-contract.md)
- [Natural-language intent](nl-game-intent.md)
- [Game Vocabulary](game-vocabulary.md)
- [Оценочные корпуса и benchmark](nl-evaluation/README.md)
- [Arena](arena.md)

## Безопасность и эксплуатация

- [Security policy](../SECURITY.md)
- [Сеть и proxy](llm-network.md)
- [ChatGPT setup и ограничения](chatgpt-setup.md)
- [Telegram](telegram.md)
- [Известные ошибки](known-errors.md)
- [Текущий статус и release readiness](release-status.md)
- [Демо readiness](defense-readiness.md)
- [Cross-platform и device boundaries](cross-platform.md)
- [CI economy](ci-economy.md)
- [Licensing](licensing.md)

## Контекст и отчёты

- [Текущий project context](PROJECT_CONTEXT.md)
- [Статус редизайна UI-002](UI_002_STATUS.md)
- [Session handoff](SESSION_HANDOFF.md)
- [Предыдущий docs audit MICRO-036.2](archive/micro-036-2-docs-audit.md)
- [Решения по репозиторию](archive/decisions)
- [Командная разработка и release workflow](../CONTRIBUTING.md)
- Текущий технический итог YAPLIX-FINAL-001 хранится в игнорируемом
  `.local/yaplix-final-001/REPORT.md`; он содержит пользовательские traces и не
  входит в документацию клона или release.
- Task/MICRO reports в `docs/` — исторические snapshots. Используйте записанный
  в каждом отчёте HEAD/date; они не заменяют текущий release status.
- `.local/` содержит игнорируемые доказательства отдельных запусков. Эти файлы
  чувствительны и не являются частью clone/release документации.

Операции без durable `jobId` ищите по [operationId в диагностике](diagnostics.md#операционный-trace).

## Устаревшие сведения

Указания о `main 942387e`, незамёрдженном PR #46, старых release gates и статусах
из отчёта MICRO-036.2 являются историческими. Дата, SHA и границы каждого
эксперимента сохраняются в исходном документе; актуальная сводка находится в
[release status](release-status.md) и в [project context](PROJECT_CONTEXT.md).
