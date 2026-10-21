# Возможности и очередь релиза

На 21 октября 2026 Arena, LAN Setup, оформление UI-001 и документация объединены в `codex/release-integration-001`. База — main `a56fe00adc8ee215998cc1da3a9c4d6b92408f95`. Это кандидат для ревью, без merge в main. [Точные исходные SHA и проверки](release-integration.md).

## Что входит в кандидат

| Возможность | Реализация | Граница доказательства |
| --- | --- | --- |
| Генерация полного HTML5 и изменение | [generation](../src/generation.ts), [engine](../src/live.ts) | Тесты используют fixtures; нового LIVE нет |
| Библиотека, версии, задания, restart | [Store](../src/store.ts), [MVP tests](../tests/mvp.spec.ts) | Временные базы, без проверки пользовательской SQLite |
| Canvas 2D/WebGL и metadata | [контракт](canvas-rendering-contract.md), [parser](../tests/browser-metadata.test.ts) | Не сертифицирует произвольный gameplay |
| Три авторские офлайн-игры | [gallery](../src/gallery.ts), [HTML](../assets/games/) | Authored/unverified, не LIVE |
| Экспорт и backup | [API](../src/api.ts), [Store](../src/store.ts) | Schema v3; старому runtime нужна совместимая база |
| Локальный QR одной версии | [phone](../src/phone.ts), [инструкция](phone.md) | Частная LAN, TCP52604, не Интернет |
| Arena и сохраняемый рейтинг | [Arena](arena.md), [E2E](../tests/arena.spec.ts) | TCP52605, score-v1, доверенный клиент; не античит |
| Подготовка Windows LAN | [LAN Setup](lan-network-setup.md), [helper](../scripts/windows-lan-setup.ps1) | Автоматически только диагностика; Apply требует плана, согласия, UAC |
| Оформление и мобильный интерфейс | [CSS](../assets/style.css), [снимки](media/README.md) | Браузерные профили не доказывают работу физического устройства |
| Ollama Cloud / OpenRouter | [transport](../src/transport.ts), [policy](../tests/provider-policy.test.ts) | Только разрешённые маршруты; квоты внешние |
| Личный ChatGPT | [setup](chatgpt-setup.md), [tests](../tests/chatgpt.test.ts) | Loopback, один POST/job; OAuth и новый LIVE не запускались |
| Telegram / HTTPS shares | [Telegram](telegram.md), [sharing](../src/sharing.ts) | Один владелец, HTTPS; физическая матрица не завершена |

## Решения по открытым PR и Issues

Статусы проверены через GitHub при подготовке. Ничего не закрыто; автоматических closing keywords в интеграционном PR нет.

| Объект | Состояние | Рекомендация после принятия интеграции |
| --- | --- | --- |
| [#53 Arena](https://github.com/Sashido01/YAPLIX/pull/53) | Draft, head включён первым | Не сливать второй раз. После merge интеграции проверить ancestry и фактический GitHub status; при необходимости закрыть как включённый |
| [#56 LAN Setup](https://github.com/Sashido01/YAPLIX/pull/56) | Draft, stacked поверх #53; включён только его новый commit | После merge проверить ancestry/status, затем закрыть оставшийся Draft; ветку удалять только если она не используется worktree |
| [#54 UI-001](https://github.com/Sashido01/YAPLIX/pull/54) | Draft, включён с сохранением Arena/LAN | После merge проверить status и закрыть как включённый, без повторного merge |
| [#57 Документация](https://github.com/Sashido01/YAPLIX/pull/57) | Draft, включён последним; текущие руководства и снимки обновлены | После merge проверить status, закрыть оставшийся Draft как включённый |
| [#34 Gameplay research](https://github.com/Sashido01/YAPLIX/pull/34) | Draft, в кандидат не включён; T1 NO_GO, T2 human acceptance pending | Закрыть без merge как исследование вне релиза, сохранив ветку, историю и evidence. Продолжение recorder при необходимости вести отдельно |
| [#52 Arena MVP](https://github.com/Sashido01/YAPLIX/issues/52) | OPEN | Закрыть completed после merge, smoke main и принятия владельцем физического сценария/оговорённых ограничений |
| [#55 LAN Setup](https://github.com/Sashido01/YAPLIX/issues/55) | OPEN | Оставить до отдельно разрешённой приёмки реального Apply/UAC/отмены/удаления/rollback. Тесты с mocks не закрывают этот пробел |

GitHub может сам изменить состояние исходных PR после merge содержащей их истории. Сначала нужно прочитать фактический статус. Отдельный интеграционный Draft PR — единственная предлагаемая точка merge; сейчас merge запрещён.

## Перед финальным merge и релизом

Владелец проверяет единый интерфейс и Arena на целевых телефонах. Реальное применение Firewall/UAC требует нового отдельного разрешения. После решения о merge — проверка текущего base/head, ancestry всех четырёх исходных PR, merge без обхода protection, затем ff-only main и smoke на фактическом merge SHA.

Hosted Actions отключены по MICRO-019; локальные Windows-проверки не являются hosted Windows/Ubuntu PASS. Перед публичным release остаётся manual FULL на точном release commit после разрешённого владельцем восстановления Actions. Новый LIVE, качество произвольных игр, iOS/WebView/Telegram и Linux runtime остаются отдельными границами.

Репозиторий PRIVATE, открытая лицензия отсутствует; [правовой статус](licensing.md). About, права, visibility, планы и Actions в этой интеграции не меняются. [История подготовки документации #57](repository-cleanup.md).
