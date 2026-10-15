# TASK-014 — Network Environment Parity и Telegram HTTPS — отчёт

Дата: 2026-10-15. Задача: точные причины «в Harness работает, из plain PowerShell
нет» для YAPLIX/Telegram Quick Tunnel, минимал-фикс только в YAPLIX, без правок
систем/VPN/Xray/Harness. Статус: причина воспроизведена и локально исправлена;
полный внешний сценарий (свежий запуск YAPLIX.cmd с живым меню Telegram) —
см. VERIFIED/NOT VERIFIED ниже.

## ROOT CAUSE (первая секция, подтверждено воспроизведением)

1. **cloudflared 2026.10.0 + одновременные HTTP_PROXY и HTTPS_PROXY** — провижининг
   Quick Tunnel (`POST https://api.trycloudflare.com/tunnel`) падает
   `context deadline exceeded` (~15 s). Воспроизведено pinned бинарником через
   Xray `127.0.0.1:10809`: без прокси — OK (~6 s), только `HTTPS_PROXY` — OK
   (~5.6 s), оба — FAIL. Это совпадает с пользовательским логом 17:25:54. Не
   VPN/DNS/Cloudflare API: все цели локально отвечали и напрямую, и через прокси
   (GET 405, POST 200, api.cloudflare.com 404, api.telegram.org 302).
2. **Прокси-переменные в plain PowerShell приходят из v2RayTun**, не из Harness:
   launcher `DeepSeek Harness.cmd` ставит `HTTPS_PROXY` только своему дереву
   процессов (закрепление 2026-10-15, отчёт `.launcher-state/proxy-check`);
   новый процесс из Explorer-поддерева получает `HTTPS_PROXY=http://127.0.0.1:10809`
   и `NODE_USE_ENV_PROXY=1` от v2RayTun.exe (проверено spawn из explorer),
   при `WinINET ProxyEnable=0` и пустых User/Machine прокси-переменных (HKLM
   содержит только `NO_PROXY`). Ручная попытка пользователя добавить
   `HTTP_PROXY`+`HTTPS_PROXY` создала точную комбинацию из п.1.
3. **`NODE_USE_ENV_PROXY=1` и мёртвый Xray** — второй вероятный фактор отказа
   публичного health из plain PS: Node-зонды через Xray к `*.trycloudflare.com`
   отвечали 200 и при прокси, и напрямую; отказ возможен при недоступности самого
   Xray/VPN в момент попытки (Xray живёт в дереве v2RayTun). Замер с живым
   туннелем: `/healthz` 200 и прямым Node-ф fetch, и через Xray — путь
   edge→Node не является виновником при живой сети.
4. **Stale URL в Telegram — ручная настройка BotFather**, вне кода: bot-код
   публикует web_app только после `/healthz` с exact instance; `npm run
   telegram:check` показал `menuType:commands, menuUrl:null` — код не держит
   мёртвую ссылку. Постоянный `nobody-encyclopedia-trends-charm...` живёт в
   Main Mini App/Menu Button BotFather и требует ручной очистки (docs/telegram.md).

## ENV COMPARISON

| Источник | HTTPS_PROXY | HTTP_PROXY | NODE_USE_ENV_PROXY | NO_PROXY |
| --- | --- | --- | --- | --- |
| HKLM (Machine) | нет | нет | нет | `localhost,127.0.0.1,192.168.0.0/24,::1,[::1]` |
| HKCU (User) | нет | нет | нет | нет (только TG_PROXY=127.0.0.1:1080, не используется YAPLIX) |
| Harness-сессия (launcher) | `http://127.0.0.1:10809` | нет | да (наследуется в сессию) | как HKLM |
| Новый pwsh из Explorer (proxy-режим plain PS) | `http://127.0.0.1:10809` | нет | `1` | как HKLM — источник: v2RayTun.exe |
| «Честно чистый» процесс (env block очищен) | нет | нет | нет | нет |

Дочерние Node-процессы наследуют окружение родителя напрямую (замер
`env-comparison.json`); YAPLIX backend получает всё окружение shell (app.mjs
`env:process.env`), включая NODE_USE_ENV_PROXY при proxy-режиме. Loopback не
проксируется: `NO_PROXY=localhost,127.0.0.1,...` исключает 127.0.0.1; CIDR-элемент
Node/undici/Go не понимают и просто игнорируют (LAN parity — отдельная история).

## NODE

`publicHealth` (tunnel-runtime.ts) — plain `fetch` c `redirect:'error'`; при
`NODE_USE_ENV_PROXY=1` идёт через Xray. Замер через живой туннель с настоящим
origin: **200 `/healthz` и direct, и через Xray**. `--use-env-proxy` читает
переменные на момент старта процесса (замена после старта не подхватывается,
ECONNREFUSED vs статус: boot-snapshot подтверждён) — для YAPLIX это означает:
кто хочет Node-зонд через прокси, обязан выставить переменные до запуска backend,
что и происходит при наследовании.

## CLOUDFLARED

Коннектор получает `connectorEnv` из scripts/tunnel.ts. Раньше туда форвардилен
системные proxy-переменные (комментарий «Explicit system proxy variables only»);
воспроизведение показало, что именно эта комбинация (в plain-PS proxy-режиме
пользователь руками добавил HTTP_PROXY к уже существующему HTTPS_PROXY) ломает
провижининг. Тестовые конфигурации A/B/C/D по pinned бинарнику:

| Конфиг | Node probe | cloudflared | Результат |
| --- | --- | --- | --- |
| A (без прокси) | direct | без proxy env | OK |
| B (только HTTPS_PROXY) | direct | proxy env только HTTPS | OK (~5.6 s) |
| C (HTTPS+HTTP_PROXY) | через Xray | proxy env оба | POST/tunnel FAIL (15 s) |
| D (переменные сняты) | direct/через Xray | без proxy env | OK |

## TELEGRAM

- Код бота: stale-URL защиту подтверждено тестами (`telegram-bot.test.ts`) и
  живой readback: `{"bot":"@YaplixBot","tokenAccepted":true,"httpsConfigured":false,
  "allowedUsers":1,"menuType":"commands","menuUrl":null}`.
- Живой канал: замеры api.telegram.org (302 на core.telegram.org/bots при
  redirect:manual, 200 при follow) — API достижим напрямую и через Xray.
- Stale `nobody-encyclopedia-trends-charm...` — ручной BotFather Main Mini App,
  код его не обновляет и не использует. Требуется ручное действие владельца
  (документировано в telegram.md, известная ошибка в known-errors.md).

## FIXED (минимал-фикс, только YAPLIX)

- `scripts/tunnel-connector-env.ts` (новый): сборка окружения коннектора —
  proxy-переменные очищаются по умолчанию (коннектор всегда ходит напрямую;
  localhost в любом случае не проксируется), `YAPLIX_TUNNEL_CONNECTOR_PROXY=1`
  явно возвращает наследование для сетей без прямого egress. HOME/TEMP/path и
  SystemRoot сохранены; bot/LLM ключей и раньше не было.
- `scripts/tunnel.ts` использует builder.
- Тест M в tests/tunnel.test.ts закрывает dropped/forwarded/clean ветки.
- Документация: known-errors.md — новая строка причины с точным симптомом;
  telegram.md — разделение BotFather Main Mini App vs menu button, правило
  «временный URL нельзя сохранять в BotFather», обновлена политика прокси
  коннектора.
- Системы/реестр/VPN/Xray/Harness — не изменялись.

## VERIFIED (реальные измерения, не synthetic)

- Воспроизведение отказа провижининга (конфиг C) и успехов A/B на pinned
  cloudflared 2026.10.0 через реальный Xray.
- Живой Quick Tunnel + реальный origin-сервер: `/healthz` 200 (direct и Xray).
- Telegram API достижимость прямым и прокси-замером; реальный readback меню
  через `npm run telegram:check`.
- Происхождение proxy-переменных: launcher Harness (свой subtree) и v2RayTun
  (Explorer subtree), реестр — только NO_PROXY (HKLM) и TG_PROXY (HKCU).
- Локально: typecheck, 138 node-тестов, build, repo checks, 218 browser-тестов.

## NOT VERIFIED

- Полный пользовательский сценарий «YAPLIX.cmd из plain PowerShell при
  погашенном Xray» после фикса — требует отдельного запуска владельцем вне
  Harness-сессии (создание нового туннеля в этой сессии уложилось в лимит
  диагностики; реальный launch-цикл с меню не выполнялся, чтобы не создавать
  лишние Quick Tunnels).
- Поведение при VPN выключен/включён в момент старта (измерения текущей
  сессии шли при доступной сети; сценарий VPN-off в этой сессии не
  воспроизводился).
- Android/физический телефон — не тестировался (вне рамок этой задачи).

## RUN

```sh
npm run tunnel:install   # pinned cloudflared уже в .local/tools
npm run tunnel -- --menu
# при необходимости: YAPLIX_TUNNEL_CONNECTOR_PROXY=1
```

Plain PowerShell: `YAPLIX.cmd` — backend стартует без прокси-зависимости;
коннектор теперь получает proxy-очищенное окружение по умолчанию.

## GIT

- Ветка: `codex/task-014-network-parity`, PR #20 → main.
- Коммиты: fix(tunnel) isolieren connector env, ci: final newlines,
  docs: known-errors polish.
- CI: secret-scan всегда зелёный; windows/browser флейк jobs.spec.ts
  (firefox toast) перезапущен — см. итоговый комментарий PR.