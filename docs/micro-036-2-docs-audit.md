# MICRO-036.2 — docs audit и физическая приёмка

18 октября 2026 (Europe/Moscow). База main:
`942387eb1fc06792767bddf2ae766cd0ed4676ff`.
Ветка `codex/micro-036-2-docs-audit`. Только Markdown, PR в main **без merge**.
Этот SHA — проверенный production baseline, не HEAD будущего docs commit.

## Факты и границы

- `git status --short`: tracked clean; единственный untracked — PDF владельца.
  `git pull --ff-only`: Already up to date. Новая ветка создана от этого main.
- Read-only PR API: #44 MERGED, merge SHA равен базе выше;
  [#34](https://github.com/Sashido01/YAPLIX/pull/34) OPEN Draft,
  head `7b61d97faf2ea44f1c5af672feb47003da518782`;
  [#37](https://github.com/Sashido01/YAPLIX/pull/37) OPEN Draft,
  head `e4a6db09a0065a95d946f50c46c891db15fc27ca`. Draft PR не менялись.
  Первый GraphQL GET #34 дал timeout; REST GET подтвердил Draft, timeout не verdict.
- Actions GET: `enabled:false`, `sha_pinning_required:false`.
  Hosted Windows/Ubuntu/secret-scan недоступны по MICRO-019; не PASS.
- Владелец в запросе MICRO-036.2 сообщил о физическом Android/Brave подключении,
  запуске «Волк ловит яйца», refresh QR с повторным входом и прекращении доступа
  после отключения. Это **owner-confirmed / HUMAN_REPORTED**, не independently
  observed. Источник — сообщение владельца в этой задаче, не HTTP200 или эмуляция.
- Не подтверждены этим сообщением touch/progress/Restart/win/loss, численный порт
  на устройстве, стабильность после restart YAPLIX, изменение token bytes,
  отказ именно старого token после refresh, iOS/WKWebView/Telegram.

## Версия и provenance игры

`git grep` в baseline tracked текстах до этих правок не нашёл «Волк», «яйца/яиц» или цепочки
название → gameId/versionId → HTML hash → generation job/provider/model.
Поэтому точное сопоставление локальной версии и LLM происхождение — NOT_VERIFIED.
Не установлено и обратное: игра не объявляется authored/manual/mock.

Доступ через локальный API тоже читал бы пользовательскую базу; его не выполняли.
Пользовательские SQLite/HTML, `.env`, PDF и ignored research не читались/не менялись. Ограничение
соблюдено без выгрузки полной библиотеки. Для дальнейшего уточнения достаточно
отдельно разрешённой metadata-only проверки выбранной версии и связанного job,
без исходного HTML, секретов или изменения базы. Внешний вид/название и успешный
запуск не заменяют provenance. Перенос текущего physical PASS на другую игру
или на исторические LLM результаты не выполняется.

## Блокер контракта Full HTML

FACT: [checkFullHtml](../src/full-html-check.ts) проверяет 320×700, 390×700,
844×390 и возвращает `profiles:[320,390,844]`. Legacy scope возвращает два.
[parseArtifact](../src/contracts.ts) принимает только точный `[320,390]`.
[GenerationEngine](../src/live.ts) вызывает parseArtifact для нового accepted
result и revalidated checkpoint; [Store](../src/store.ts) повторяет parseArtifact
перед insert. Следовательно, successful Full HTML evidence на этой границе
отклоняется ещё до принятой версии. Это отдельный blocker свежего Full HTML
create/edit/Continue, не доказательство сетевой недоступности облака.

VERIFIED: новый metadata-only probe без Browser, сети и SQLite. Из корня клона
в PowerShell, Node 24 (не загружает `.env`):

```powershell
@'
import {parseArtifact} from './src/contracts.ts';
import {artifact} from './tests/helpers.ts';
const attempt={route:'primary',provider:'ollama.com',requestedModel:'gemma4:31b',
 model:'gemma4:31b',outcome:'accepted',errorCode:null,elapsedMs:1};
const sample={...artifact,method:'llm_code',provider:'ollama.com',model:'gemma4:31b',
 generationStatus:'succeeded',validationStatus:'passed'};
for(const profiles of [[320,390],[320,390,844]]){
 try{parseArtifact({...sample,generation:{attempts:[attempt],fallback:false,
 elapsedMs:1,browser:{profiles,offline:true,errors:0,scope:'full-html'}}});
 console.log(JSON.stringify({profiles,result:'ACCEPTED'}));}
 catch(error){console.log(JSON.stringify({profiles,result:error.code}));}
}
'@ | node --input-type=module -
```

Наблюдаемый вывод: `[320,390]` → ACCEPTED;
`[320,390,844]` → INVALID_GENERATION_METADATA.
Это synthetic proof границы metadata, не actual LLM/browser E2E. Injected checker
в `tests/micro023.test.ts` возвращает два профиля, поэтому passing units не
закрывают текущую интеграцию. Старые отчёты и сохранённые metadata не переписаны.

NEXT: отдельная production-задача согласования обоих scopes с реальным
checker → parseArtifact → сохранение/переоткрытие, включая landscape evidence
и сохранность старых версий. Не обходить проблему удалением третьего профиля
или ослаблением gate. Этот PR её только документирует.

## Противоречия и исправления

| Было / найдено | Исправление документации | Оставшаяся граница |
| --- | --- | --- |
| В MICRO-036 отчёте physical NOT_VERIFIED и план Maze 6×6 | Добавлен текущий owner-confirmed scope для «Волк ловит яйца»; старый план помечен историческим | Независимого наблюдения и идентификатора версии нет |
| Сдача MICRO-036.1 «без merge» могла читаться как состояние сейчас | Зафиксирован реальный merge #44 в 942387eb; MICRO-036.2 отдельно без merge | HEAD нового docs PR не называется production HEAD |
| architecture: оба gate только 320/390 | Уточнены portrait/landscape, touch-only Full HTML, hit-test/overlay и строгий смысл reachability | Arbitrary gameplay и physical devices из gate не следуют |
| game-validation: Full HTML taps/keys, два viewport | Исправлены три viewport, отсутствие keyboard fallback, повторное наблюдение controls после tap | Проверяются лишь наблюдавшиеся состояния |
| Checker success описан как достаточный для Ready | Задокументирован подтверждённый metadata blocker и отдельная задача исправления | Новый Full HTML LIVE-ready на текущем HEAD не заявлен |
| Нет актуального compact статуса, handoff начинался MICRO-027 | Текущий dated snapshot добавлен в SESSION_HANDOFF и README; старые записи сохранены | Данные snapshot не обновляются сами после будущих merge |
| Таблицы кейса без явных статусов и разграничения evidence | Таблица M1–M8/B1–B7 с VERIFIED/PARTIAL/NOT_VERIFIED и ссылками | Источник — ранее записанная расшифровка; PDF заново не сверялся |
| Длинный checklist выдавался за 3–5 минут; общий LAN key смешивался с phone QR | Сценарий 4:30: обычный Create, ограниченное ожидание, явный saved LLM fallback, phone revoke | Репетиции нет; fallback-кандидат не подтверждён в текущей библиотеке |
| AUTHORS заявляет 3 участников, но два вклада не заполнены | M5 отмечен PARTIAL, декларация отделена от подтверждённого состава | Нужны сведения о реальных участниках с их согласия |
| Отсутствие genre classifier могло скрывать optional Game Intent | Описаны локальные opt-in intent hints, без отдельного LLM POST | Это не универсальный разбор/гарантия качества |

## Проверки и сохранность

Новые проверки MICRO-036.2:

- Typecheck и build — PASS, production source не менялся.
- Critical units: 18/18 PASS (`phone`, `generation-network`, `micro023`);
  используют memory/isolated test SQLite. Injected checker этих units не
  опровергает отдельно подтверждённый metadata blocker.
- Short phone smoke: 6/6 PASS, Chromium390/WebKit390; isolated Store/listener,
  QR/touch/rotation/restart/reopen/revoke и error UI, не физическое устройство.
- Repository checker — PASS; Python tests 19/19, CI policy tests 8/8 — PASS.
- Gitleaks 8.24.3: history 108 commits и publication manifest Markdown — PASS,
  no leaks. Manifest исключает PDF/пользовательские данные/ignored research.
- `git diff --check` — PASS. Финальный staged manifest — только README и docs/*.md.

Counts MICRO-036.1 в прежнем отчёте остаются историческими, не выдаются за
новый запуск полного набора в MICRO-036.2. Hosted FULL/Ubuntu и полный browser
suite в этой docs-задаче не запускались и не заявлены.

Источники аудита: tracked Markdown, production/test source, история Git и
read-only PR/Actions API. Никаких внешних LLM service GET/inference/repair, отправок сообщений,
запуска пользовательского backend, чтения production данных или изменений
Firewall/VPN/сети. Новый isolated synthetic metadata probe не сохраняет версии.
Предыдущие ignored research не использовались; локальные новые логи проверки
и security tool не являются новым LIVE evidence.

## NEXT

Review отдельного docs-only PR, **не merge**. Затем отдельно: metadata contract
fix, metadata-only provenance проверка выбранной игры, подтверждённый saved LLM
fallback, репетиция с отдельно разрешённым inference бюджетом, оставшиеся
физические проверки. Product/demo readiness PARTIAL, свежий LIVE NOT_VERIFIED,
owner-confirmed phone scope принят. Бюджет этой задачи: **0 inference POST**.
