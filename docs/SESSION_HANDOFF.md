# MICRO-020 — LIVE connectivity, PARTIAL

16 октября 2026. Исходный main `7a170c7e1a09caf9bc94c71824cf21051d68c6e3`
(PR #25), после `git pull --ff-only`, ветка `codex/micro-020-live-connectivity`.
До работы tracked tree чистое, только пользовательский untracked
`docs/Keys_Bilayn.pdf`. Merge SHA подтверждается в PR receipt/итоговом ответе.

## Причина и исправление

Четыре исторических POST MICRO-019: Ollama interruption 11026 ms, OpenRouter
timeouts 45006/45007/45006 ms. Старые логи содержат provider/model/error,
длительность и пустой checkpoint, но не TCP/TLS/status/headers/first byte.
Инициатор исторического обрыва и причина недоступности **не установлены**.
Нельзя приписывать их VPN, proxy, квоте или найденному SSE дефекту.

Два локально воспроизведённых дефекта CloudTransport исправлены:

- После SSE `[DONE]` клиент продолжал ждать remote EOF и получал ложный timeout
  при открытом body. Теперь terminal marker завершает чтение и reader отменяется;
  обязательные model/finish_reason=stop и static/browser gates сохранены.
- Обрыв non-streaming body после headers ошибочно становился invalid JSON.
  Теперь read failure — `LLM_CONNECTION_INTERRUPTED`, а полный malformed JSON
  остаётся `LLM_INVALID_RESPONSE`.

Оба regression tests падали до исправления и проходят после. Это локальное
доказательство, а не установленная причина MICRO-019. Архитектура, prompts,
allowlist, retry/cooldown/deadline, TLS и default timeouts не менялись.

## Network и LLM

Node 24.18.0 / bundled Undici 7.28.0 / native fetch без provider SDK.
DNS обоих hostname вернул IPv4; IPv6 отказ не наблюдался. TLS 1.3 authorized,
GET `/models` — 200 через Node/curl/PowerShell; клиент проекта — ready.
HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NODE_USE_ENV_PROXY не заданы; NO_PROXY задан.
Системные proxy/VPN/routes/firewall не изменены. EACCES в песочнице исчез при
разрешённом запуске вне неё: это ограничение инструмента, не provider evidence.
GET 200 не подменяет inference.

**1 из 2 дополнительных разрешённых inference POST**: UI «Собери игру три в ряд»,
explicit Ollama Cloud `gemma4:31b`, exact `https://ollama.com/v1/chat/completions`.
Изолированная новая `.local/micro020/live-1.sqlite`, исходно 0 jobs.
Дисковый global counter <=2, дополнительный предел 1 POST/run/job, repairs=0;
нет автоматических retries и межпровайдерного fallback в live-тесте.
OpenRouter inference не вызывался. Бесплатная квота Ollama разрешена владельцем;
планы/credits не менялись.

HTTP 200 SSE headers через 619 ms, первый body byte через 623 ms от dispatch;
конец HTTP body примерно через 11.9 s. Request с catalog preflight — 14908 ms.
Получен **1 полный HTML: 12662 UTF-8 bytes / 4032 output tokens**, actual model
gemma4:31b. Job завершился через 19007 ms. В trace есть некоррелированный connect
timeout другого запроса: он не опровергает inference 200/полный HTML и не
объясняет старые отказы. Cleanup AbortController после проверки не прервал ответ.

## Gameplay и сохранение

Browser gate отверг неизменённый HTML: `JAVASCRIPT_EXCEPTION`,
`Cannot set properties of null (setting 'textContent')`. Ошибочный атрибут
`<output data-yaplix-state" ...>` не соответствует `[data-yaplix-state]`;
stateEl равен null, запись в draw вызывает исключение.

Playwright mobile touch: поле 8x8 видно, Start открывает поле, выбор клетки
подтверждён; настоящая соседняя перестановка даёт match и score/HUD 0→60.
Затем 6 пустых клеток, isAnimating=true, moves остаётся 20: gravity/refill и
дальнейшая игра сломаны. Видимая цель 1000 очков за 20 ходов; победа/restart
до играбельного состояния NOT VERIFIED. HTML/очки/RNG не подменялись; состояние
читалось только для диагностики, действия выполнялись touch. Это отдельный
gameplay defect, не network timeout.

**0 новых игровых версий**: gate не допустил failed HTML в библиотеку.
Идея, полный checkpoint, origin и история сохранены в изолированной SQLite,
job `08e8268c-63bd-4881-b1a1-67e71342af68`, needs_attention.
Сценарий «проверенная игра → сохранение версии → повторное открытие» не пройден.
Второй POST не использован: дополнительные LLM repairs gameplay требуют нового
разрешения по MICRO-020. Полный checkpoint доступен без inference.

## Проверки и сохранность

Typecheck/build PASS. Целевые transport/engine/jobs/retry/restart/route и
security/platform/MVP tests 101/101 PASS. Короткий browser smoke 4/4: Chromium320 и
WebKit390, selector/draft reload и controlled LIVE background worker.
Последний использует synthetic transport; physical Android/iOS/Telegram не проверены.
Итоговые test counts и локальный secret scan фиксируются в PR receipt.
Полный CI, долгие browser matrices и performance benchmarks не запускались.

Пользовательская `.local/task-004/live.sqlite`: 21 games / 39 versions / 14 jobs,
активных 0, stages: 6 completed / 5 needs_attention / 3 cancelled.
Read-only hashes HTML/metadata/jobs и integrity/FK сравниваются до/после.
Тестовые записи только в отдельных fixtures. `.env`, PDF, пользовательские
SQLite/jobs и неизвестные ignored файлы сохраняются.

Private ignored evidence: `.local/micro020/network.json`, `data-before.json`,
`data-after.json`, `inference-count.json`, `trace-1.json`, `live-job-1.json`,
`received-game.html`, `gameplay.json`, `touch.json`, PNG и test logs.
Эта локальная диагностика и полученная игра не публикуются.

## CI и следующий шаг

Repository actions/permissions.enabled=false; hosted checks не запускались
и не объявляются зелёными. FAST/FULL и release FULL policy сохранены;
Actions включать только по команде владельца: [процедура](ci-economy.md).

VERDICT **PARTIAL**: Ollama ответ подтверждён; историческая причина неизвестна,
игра сломана и не сохранена как passed version. Следующий шаг — отдельно
разрешённое исправление gameplay и приёмка через настоящие действия, сохранение
и повторное открытие. Новый inference ради gameplay без разрешения запрещён.
Экспериментальный Orchestrator, Telegram и внешние репозитории не затрагивались.
