# Документация YAPLIX

Начните с [обзора продукта](../README.md). Текущие руководства описывают интегрированный релиз-кандидат на 21 октября 2026. Отличия от main и результаты проверок — в [отчёте интеграции](release-integration.md).

## Пользователю и жюри

| Задача | Документ |
| --- | --- |
| Установить, обновить, сохранить и восстановить данные | [Установка и обслуживание](development-setup.md) |
| Провести демонстрацию за 3–5 минут | [Сценарий демонстрации](demo-readiness.md) |
| Открыть игру по QR | [Телефон и частная сеть](phone.md) |
| Понять статус соревнований | [Arena: общий рейтинг](arena.md) |
| Подготовить Windows к QR и Arena | [Частная сеть и Firewall](lan-network-setup.md) |
| Подключить модель | [Сеть LLM](llm-network.md), [личный ChatGPT](chatgpt-setup.md) |
| Настроить бота и Mini App | [Telegram](telegram.md) |

## Разработчику

| Тема | Документ |
| --- | --- |
| Компоненты, данные и границы доступа | [Архитектура](architecture.md) |
| HTML, браузерная проверка и ограничения | [Валидация](game-validation.md), [Canvas/WebGL](canvas-rendering-contract.md) |
| Сборка, API, тесты, backup | [Рабочее место](development-setup.md) |
| Windows, Ubuntu, браузеры | [Переносимость и датированные замеры](cross-platform.md) |
| CI и серверная защита | [FAST/FULL](ci-economy.md), [GitHub ruleset](github-ruleset.md) |
| Воспроизводимые ошибки и решения | [Известные проблемы](known-errors.md) |
| Процесс разработки и безопасность | [CONTRIBUTING](../CONTRIBUTING.md), [SECURITY](../SECURITY.md) |
| Необязательный разбор идеи без LLM | [Game Intent](nl-game-intent.md), [корпуса для тестов](nl-evaluation/README.md) |

## Состояние и доказательства

[Возможности и очередь релиза](release-status.md) · [Проверки интеграции](release-integration.md) · [История очистки репозитория](repository-cleanup.md) · [Готовность к защите](portfolio-checklist.md).

В [архиве](archive/README.md) хранятся датированные исследования, прежние handoff и матрица требований кейса. Их verdict относятся к своей версии, а не ко всему текущему продукту. Исходные JSON и изображения сохранены. Официальные закрытые материалы кейса и пользовательские данные не публикуются.
