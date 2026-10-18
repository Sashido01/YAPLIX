# MICRO-029 — ChatGPT Plus / Sign in with ChatGPT feasibility

19 октября 2026. База: main `05b7a59a545497fc04246245a016c64b95d25e87`.
Отдельная ветка `codex/micro-029-chatgpt-feasibility`; Draft PR без merge.
Это исследование авторизации, не новый production provider. MICRO-036.3/PR #46
развивается отдельно; его исправления не копируются в эту ветку.

## FACT

Официальная [документация SIWC](https://developers.openai.com/siwc/quickstart)
описывает identity и отдельное разрешение ChatGPT plan usage. Наличие Plus само
по себе не доказывает доступ конкретного клиента или модели. Для local personal
проектов описан public-client flow без API key/client secret; paid/remote варианты
требуют отдельного допуска. См. [официальный cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt).

Исследованы текущие [генератор](../src/live.ts), [durable jobs](../src/jobs.ts),
[сетевой транспорт](../src/llm-network.ts) и [архитектура](architecture.md).
Они остаются без изменений. Новый модуль не импортируется API/server/UI,
не реализует Generator/CodeTransport и не читает SQLite/checkpoints/.env.

### Выбор реализации и лицензии

| Подход | Факты и вывод для этого этапа |
| --- | --- |
| `@siwc/local` | [Официальный DevKit](https://github.com/openai/sign-in-with-chatgpt-devkit/blob/main/README.md) поставляет SDK как local workspace. [Package manifest](https://github.com/openai/sign-in-with-chatgpt-devkit/blob/main/packages/local/package.json) помечен private, требует Node >=22. Это не основание устанавливать произвольный одноимённый пакет из npm. |
| Лицензия DevKit | [Noncommercial License v1.0](https://github.com/openai/sign-in-with-chatgpt-devkit/blob/main/LICENSE) ограничивает использование/распространение некоммерческими целями. Бесплатность продукта сама по себе не даёт коммерческих прав. Для коммерческого использования кода нужна отдельная договорённость; лицензия не даёт сервисного доступа. |
| Шифрование DevKit | [Security guide](https://github.com/openai/sign-in-with-chatgpt-devkit/blob/main/docs/security.md) требует application-supplied encryption provider; plaintext fallback отсутствует. Пример использует Electron/macOS, YAPLIX — обычный Node server. Нужен отдельный Windows/Linux vault adapter. |
| Выбранный подход | Самостоятельный небольшой public-client OAuth по официальному протоколу, с закреплённой JOSE 6.2.12 для проверки JWT. Код/SDK/branding DevKit не копировались и не подключались. Это устраняет зависимость от его workspace/Electron adapter, но не отменяет условия сервиса или будущий review доступа/распространения. |

### Проверенные официальные контракты

- [Host и client](https://developers.openai.com/siwc/token-sharing-open-source):
  стабильный случайный UUID host ID допустим; host ID не является credential.
  Он относится к установке, client ID — к регистрации аккаунта/workspace.
- [Регистрация и вход](https://developers.openai.com/siwc/token-sharing-open-source/sign-in):
  PKCE S256, state и nonce; первоначально `dynamic_agent_client`, затем issued
  client ID из callback. Callback — HTTP `127.0.0.1`, неизменный `/auth/callback`,
  порт может различаться между попытками. Новый issued ID не равен sentinel.
- [Сессии и refresh](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions):
  refresh использует сохранённый issued ID, refresh token и resource; scope
  не расширяется. Замена вращающихся токенов должна быть атомарной, refresh —
  сериализованным. В этом прототипе refresh и долговременные токены не реализованы.
- [Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference):
  access token живёт час, refresh — 30 дней с заменой при успешном обновлении.
  Сроки нельзя превращать в обещание доступа или гарантированных лимитов.
- [Responses](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference):
  будущая интеграция должна использовать `https://api.openai.com/v1/responses`,
  OAuth bearer, аккаунтный каталог моделей и `response.completed` как terminal
  success. Auth или GET models сами по себе не подтверждают inference.
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations):
  HTTP требует `store:false`, `stream:true`, массива input с нужным контекстом;
  текущие generation knobs нельзя переносить напрямую. В частности,
  `max_output_tokens`, `temperature` и `previous_response_id` здесь не подходят.
  Нельзя переключаться на ChatGPT backend-api или использовать session cookies.

## CHANGED

- [Изолированный модуль](../src/experimental/siwc.ts): стабильный host ID,
  одноразовый loopback listener, PKCE/state/nonce, discovery с pin endpoints,
  dynamic registration и reuse issued client ID, проверка подписи JWT через JWKS,
  issuer/audience/expiry/iat/nonce/sub/azp и granted scopes. Подмена аккаунта при
  reauthorization отклоняется. Initial registration ID может сохраняться как
  pending с `subject:null`; это не доверенная identity и не grant.
- [Ручной CLI](../scripts/siwc-auth.ts): только `--prepare` / `--authorize`.
  Открывает системный браузер, не автоматизирует его и не печатает OAuth URL.
  Нет inference, model discovery, repair или автоматических повторов.
- [Тесты](../tests/siwc.test.ts): реальные локальные callback sockets,
  синтетически подписанные JWT и подменённая только HTTP-граница OpenAI.
- Единственная новая dependency — JOSE 6.2.12 с lockfile. Production-провайдеры,
  jobs, network policy, frontend и пользовательские данные не менялись.

## TESTS

Windows, Node 24.18.0: typecheck/build PASS, полный unit suite **286/286**,
профильные OAuth-тесты **23/23** PASS. `npm audit --omit=dev`: 0 vulnerabilities;
поиск SIWC module/scope/token-endpoint в `build/public`: 0 совпадений.
Проверяются успешный вход/reuse ID и host, PKCE, deny, state/duplicate params,
missing code/permission/scopes, invalid signature/issuer/audience/expiry/nonce/sub,
account/client swap, неверный discovery, network/token failures, browser failure,
timeout/cancel, Host/path/method guards, освобождение callback и временного lock.
В stdout/stderr возвращаются фиксированные коды, без credential/error body.
Постоянные файлы тестов не содержат token/code/verifier.

`--prepare` успешно выполнен из source и compiled CLI: registered:false,
authorization:NOT_RUN, inference:NOT_RUN. Оба используют одну installation path.
Ошибку Windows trailing separator при первоначальном тесте устранила нормализация
корня через `resolve`; таймауты приложения не увеличивались.

Repository checker, diff-check и Gitleaks проверяются перед публикацией; их
итоговый результат и точный head приведены в Draft PR.
Hosted Actions отключены по MICRO-019: это NOT_VERIFIED, не green Ubuntu/Windows CI.

## AUTH

Реальный OpenAI вход **NOT_RUN**. Реальные OAuth token exchange, inference и repair
POST — **0**. Право использования Plus/конкретных моделей **NOT_VERIFIED**.

Ручной сценарий первой авторизации владельцем после review:

1. Выбрать эту ветку, установить зависимости из lockfile, выполнить
   `npm run typecheck` и `npm run build`.
2. Выполнить `node scripts/siwc-auth.ts --prepare`. Это только подготовка
   несекретного host ID в `.local/siwc-feasibility/host.json`, без сети/браузера.
3. На той же машине с GUI и Node выполнить
   `node scripts/siwc-auth.ts --authorize`. В системном браузере выбрать свой
   ChatGPT account/workspace, проверить имя YAPLIX и requested permissions.
   Не передавать callback URL/code в чат или поддержку.
4. При согласии дождаться фиксированного сообщения в браузере и CLI
   `authorization:VERIFIED`, `planPermissionGranted:true`, `inference:NOT_RUN`.
   Отказ пользователя или отсутствующий scope — отказ этапа, без inference.
5. CLI немедленно забывает токены и завершает процесс. Сохраняется только host
   и несекретный issued-client/verified-subject mapping. Следующий запуск требует
   reauthorization; регистрация клиента и host ID переиспользуются.
6. Доступ Plus всё ещё не объявлять подтверждённым. Следующий этап — отдельное
   разрешение владельца с точным inference budget и проверкой terminal result;
   подключение production только после review и результатов MICRO-032.

Если после crash остался `authorization.lock`, сначала убедиться, что своего
auth процесса больше нет. Прототип не удаляет чужой/непроверенный lock автоматически.

## SECURITY

Токены — только private memory fields, не сериализуются и не возвращаются CLI/UI.
Нет plaintext credential storage; PKCE/code/state/nonce не пишутся на диск.
Host и registration не являются секретами; subject — минимальный identity mapping,
без email/profile data. На Unix запрашиваются 0700/0600, на Windows токены в файлы
вообще не попадают. Временные lock/tmp принадлежат только этой попытке.

Доступны только pinned official discovery/authorize/token/JWKS endpoints.
Redirects fetch запрещены, response size и request/attempt duration ограничены,
insecure TLS env запрещён. Listener привязан к `127.0.0.1`, проверяет Host,
path/origin/method/remote IP, не отражает query/error/token. State одноразовый.
Callback response — no-store, CSP none, no-referrer. Production API не имеет
маршрутов подключения/чтения токенов. Существующие `.env`, SQLite, checkpoints,
игры, Firewall, PR #34/#37, PDF и HELD-OUT не затрагивались.

## LIMITATIONS

- Windows: verified local Node/build/offline tests; системный opener — rundll32.
  Настоящий браузерный вход не запускался. Не использовать как service session.
- Ubuntu: Node 24 ESM/JOSE не требуют native addon. GUI-сессия и xdg-open нужны
  для manual sign-in на том же host. Ubuntu runtime/GUI здесь NOT_VERIFIED;
  headless/WSL/remote browser не заявлены рабочими.
- Нет OS vault adapter, disk token persistence, refresh/revocation, multi-account
  picker или автоматического восстановления auth после restart. Эти функции
  требуют отдельного этапа; plaintext fallback добавлять нельзя.
- Пока используется обычный Node fetch; отдельный proxy transport не настроен.
  Не менять глобальный proxy/TLS для обхода сбоя и не приписывать network cause.
- Prototype проверяет documented `oaiapp_` IDs и RS256/ES256 JWT; реальный OAuth
  контракт аккаунта нужно подтвердить ручным входом. Нет API key или cookies.
- Plus имеет общий межприложенческий five-hour allowance по текущей документации
  sessions; отдельной квоты для YAPLIX не обещается. Credits/планы не покупаются.
- Текущий P0 metadata на main исправляется только в PR #46, не этой веткой.

## NEXT

Review Draft PR и выбор lifecycle для OS-protected credentials. Затем ручная
авторизация владельцем. После результатов MICRO-032 — отдельный bounded inference
proof и самостоятельное решение о production-интеграции. До этого STOP.
