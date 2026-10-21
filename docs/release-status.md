# Возможности и очередь релиза

Снимок на **21 октября 2026**, main `a56fe00adc8ee215998cc1da3a9c4d6b92408f95`. Данные GitHub прочитаны напрямую; никаких merge/закрытий в этой подготовке не выполняется. Эта ветка меняет документацию и медиа, не функции продукта.

## Что входит в main

| Возможность | Реализация и доказательство | Ограничение |
| --- | --- | --- |
| Генерация полного HTML5 и изменение | [generation](../src/generation.ts), [engine](../src/live.ts), [synthetic provider E2E](../tests/strict-providers.spec.ts) | Свежий LIVE на этом main не выполнялся |
| Библиотека, история и restart | [Store](../src/store.ts), [MVP tests](../tests/mvp.test.ts), [browser scenario](../tests/mvp.spec.ts) | Пользовательская БД этой подготовкой не проверяется |
| Canvas 2D/WebGL и metadata | [контракт](canvas-rendering-contract.md), [parser regressions](../tests/browser-metadata.test.ts) | Не сертифицирует произвольный gameplay |
| Авторские офлайн-игры | [gallery](../src/gallery.ts), [игры](../assets/games/) | Authored/unverified, не LIVE |
| Экспорт, backup | [API](../src/api.ts), [Store](../src/store.ts) | Автономный файл открывают offline |
| Локальный QR | [phone](../src/phone.ts), [инструкция](phone.md) | Одна версия, частная LAN; Firewall вручную |
| Ollama Cloud / OpenRouter | [transport](../src/transport.ts), [проверки политики](../tests/provider-policy.test.ts) | Только разрешённые маршруты; квоты внешние |
| Личный ChatGPT | [setup](chatgpt-setup.md), [durable tests](../tests/chatgpt.test.ts) | Loopback, один POST/job; offline tests не доказывают LIVE |
| Telegram / HTTPS share | [Telegram](telegram.md), [sharing](../src/sharing.ts) | Один владелец, HTTPS; полная physical приёмка не заявлена |

PR #46 (metadata), #49 (ChatGPT), #50 (авторы) и #51 (Canvas) уже merged. Ранее записанные «PR ещё не слит» и общий metadata-блокер заменены актуальными описаниями. Датированные отчёты оставлены в архиве.

## Все открытые Issues и PR до этой публикации

| Объект | Статус / зависимость | Предложение владельцу |
| --- | --- | --- |
| [#52 Arena MVP](https://github.com/Sashido01/YAPLIX/issues/52) | OPEN, результат в #53, в main отсутствует | Закрыть completed после согласованного merge #53 и smoke итоговой main |
| [#53 Arena MVP](https://github.com/Sashido01/YAPLIX/pull/53) | Draft → main, `364bd2194890df3a205f82086402b652c6f9b372` | Отдельное ревью и решение о merge; сохранение рейтинга и физическое демо не перепроверены здесь |
| [#55 LAN Setup](https://github.com/Sashido01/YAPLIX/issues/55) | OPEN, результат в #56 | Закрыть после интеграции #56 и принятия границ реального UAC/rollback |
| [#56 LAN Setup](https://github.com/Sashido01/YAPLIX/pull/56) | Draft → `codex/arena-mvp`, `1d7c72907497b50eb38640d2a6ee91e0e7874cc6` | После решения по #53 проверить новую базу и интеграцию; реальный elevated Apply остаётся непроверенным |
| [#54 Visual redesign](https://github.com/Sashido01/YAPLIX/pull/54) | Draft → main, `2e77b5650e15a5ed9d5dc175521dfe6a63053d77` | Визуальное решение владельца и проверка совместно с Arena/LAN; не называть оформлением main |
| [#34 Gameplay research](https://github.com/Sashido01/YAPLIX/pull/34) | Draft → main, `7b61d97faf2ea44f1c5af672feb47003da518782`; NO_GO универсального T1, T2 human acceptance pending | Если исследование исключается из текущего релиза — закрыть PR без merge с сохранением ветки и истории; если нужно продолжение T2 — оставить открытым |

Для #34 подготовлен смысл закрытия: «Универсальный gameplay-validator не принят по результатам калибровки; recorder остаётся исследовательским инструментом. В текущий релиз не интегрируем, история и evidence сохранены; человеческие пилоты не объявляем пройденными». Это предложение, а не опубликованный комментарий. GitHub `not planned` применяется к Issues; исследовательский PR закрывается без merge.

Итого: **2 открытых Issues и 4 Draft PR** до нового документационного PR. #37 уже CLOSED без merge; #34 не сливать для очистки списка. Ноль Issues/PR возможен только после решения по реальным кандидатам, завершения принятого scope и закрытия этой документационной ветки. Автоматические closing keywords намеренно не добавляются.

## GitHub presentation

Репозиторий PRIVATE, default branch main, LICENSE отсутствует; это соответствует [правовому статусу](licensing.md). Вклад и контакты — [AUTHORS](../AUTHORS.md), [SECURITY](../SECURITY.md), [CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md). Приватные адреса контактов не выдумываются.

Исходный About: `IT Sprint 2026 — team hackathon project`, topics отсутствовали, homepage не задан. Подготовленный Description: «YAPLIX — HTML5-игры из текстовой идеи: генерация, доработка, история версий и автономный экспорт. ИТ-спринт 2026». Homepage не нужен без проверенного публичного адреса. Лицензия и видимость не меняются. Результат настройки и проверки GitHub записан в [отчёте](repository-cleanup.md).
