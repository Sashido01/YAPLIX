# RELEASE-INTEGRATION-001 — кандидат для финального ревью

21 октября 2026. Отдельные ветка `codex/release-integration-001` и worktree `D:\YAPLIX\.local\worktrees\release-integration-001`. Основной checkout остаётся на `codex/arena-mvp`; пользовательские данные не переносились. Main не изменён. Публичный release не создаётся.

| Статус | Результат |
| --- | --- |
| MAIN | Базовый main сохранён; основной checkout не переключался |
| MERGED | Исходные PR объединены только в кандидат; merge в main запрещён |
| RUN | Штатный launcher, игра, export и restart проверены в clean clone; smoke-процессы остановлены |
| VERIFIED | Автоматические результаты ниже; финальный head и GitHub readback — в Draft PR |
| MVP | Единый кандидат подготовлен к финальному ревью, не публичный release и не универсальная gameplay-сертификация |
| LIVE | NOT_RUN; реальных inference/OAuth/A-B нет |
| DOCS | Кандидатные руководства и два настоящих screenshots; исторические отчёты отмечены отдельно |
| NEXT | Ревью Draft, полный прогон на принятом финальном SHA и отдельная физическая приёмка владельцем |

## Состав

Точный base: `a56fe00adc8ee215998cc1da3a9c4d6b92408f95` — актуальный `origin/main` при начале интеграции.

| Порядок | PR | Включённый head |
| --- | --- | --- |
| 1 | [#53 Arena MVP](https://github.com/Sashido01/YAPLIX/pull/53) | `364bd2194890df3a205f82086402b652c6f9b372` |
| 2 | [#56 LAN Setup](https://github.com/Sashido01/YAPLIX/pull/56) | `1d7c72907497b50eb38640d2a6ee91e0e7874cc6` |
| 3 | [#54 UI-001](https://github.com/Sashido01/YAPLIX/pull/54) | `2e77b5650e15a5ed9d5dc175521dfe6a63053d77` |
| 4 | [#57 Документация](https://github.com/Sashido01/YAPLIX/pull/57) | `1c1e55630317edbff7c98bdd522c3065ddbced65` |

История сохранена merge-коммитами в интеграционной ветке. #56 включает #53 как предка; Arena не применялась повторно. Смысловые конфликты: форма `assets/index.html` сохраняет подсказку Arena и select/placeholder UI-001; `src/ui.ts` сохраняет загрузку Arena/LAN и цветовые атрибуты заданий. README основан на коротком варианте #57, руководство Arena — на полном варианте #56. `known-errors` сохраняет обе группы решений и архивные ссылки.

Новых изменений GAME-QUALITY-001 в production prompts нет. Сохранена уже существующая в #53 условная добавка score-v1 при явном запросе Arena; сам `GAME_GENERATION_CONTRACT` не переписан. Harness и A/B не интегрированы. Реальных inference/OAuth запросов: **0**.

## Исправления, найденные при объединении

- В CSS UI-001 отсутствовала закрывающая скобка desktop media query: последующие мобильные правила попадали внутрь desktop. Parser regression получил RED с `Expected "}"`, после закрытия блока — GREEN. Browser regression проверяет реальный fixed game-focus.
- Фоновый read-only PowerShell Inspect удерживал Node при shutdown. Полный unit-прогон: 510 PASS и 2 timeout; изолированный network suite воспроизвёл оба. Отдельный AbortController отменяет только Inspect при shutdown, без вмешательства в elevated Apply. После исправления профильные 30 unit прошли, включая реальные shutdown/restart.
- Arena host оставлял Stop disabled после выбора сохранённой комнаты/ошибки. Browser RED воспроизведён. Состояние теперь следует активному listener, а не просматриваемой комнате; после успешного DELETE известно, что listener закрыт, даже если refresh не удался. Regression GREEN вместе с mobile focus: 4 PASS, 2 предусмотренных SKIP.

- Во время просмотра реального screenshot 390px обнаружено пересечение бренда и header-tools. Новый browser test получил RED (274px против начала кнопок на 209px). Сетка исправлена на два дочерних элемента, подпись до 430px перенесена под бренд. Header и game-focus на финальном коде: **24/24 PASS** во всех 12 профилях.

- Полная матрица выявила перекрытие QR на Chromium tablet: 604 PASS / 2119 SKIP / 1 FAIL. Три повтора подтвердили, что sticky header закрывает finder-маркеры. Общий unlock возвращал страницу к игре после перехода к телефону. Для этого действия сохранена цель QR; один лишь центрирующий scroll был недостаточен и не считается исправлением. Неизменённый screenshot→jsQR и phone gameplay затем прошли **3/3**, добавлен assert отсутствия перекрытия. SVG/scale/decoder/протокол не менялись.

## Автоматические проверки

Windows, Node 24.18.0. Тесты используют собственные временные базы и authored/synthetic fixtures; пользовательская SQLite не открывалась.

| Проверка | Результат |
| --- | --- |
| Установка зависимостей | `npm ci --offline --cache D:/YAPLIX/.local/npm-cache` PASS; без копирования node_modules. Недоступность npm из новой сети этим не проверена |
| Typecheck / build | PASS; production bundle собирается штатно |
| Все Node unit | **514 PASS, 0 FAIL, 0 CANCELLED, 0 SKIP** (свежий финальный повтор 21,6 s) |
| Browser полная матрица | **604 PASS / 2119 SKIP / 1 FAIL**, 28,5 min. Единственный defect QR исправлен с 3/3 контрольными повторами; свежая затронутая матрица приводится отдельно. Полный run после последней узкой правки не повторялся и не объявляется green |
| Финальная затронутая browser matrix | **162 PASS / 6 предусмотренных SKIP / 0 FAIL**, 6,1 min: micro027 / phone / MVP / mobile, все 12 профилей, на финальном runtime `175a5d2` |
| Финальный header/mobile game-focus | **24 PASS**, все 12 профилей Chromium/Firefox/WebKit, включая 320/360/390/430/tablet/desktop |
| Stop/ошибка refresh и mobile focus | **4 PASS, 2 предусмотренных SKIP**; исходный RED сохранён |
| Python / CI policy | **19/19 / 8/8 PASS**. Итоговый diff выбирает FULL (`runtime-or-unknown`), не docs-only FAST |
| Repository / diff check | PASS; CSS parser regression проверяет незакрытые блоки отдельно от TypeScript |
| Локальные Markdown-ссылки и якоря | **63 документа, 446 целей, 0 ошибок**; регистр/пути дополнительно проверяет checker |
| Архив и inventory | **25 переносов / 234 исходных записи** проверены; SHA-256 без расхождений, PNG/JSON побайтово сохранены, runtime/build/tests/CI не читают прежние пути |
| Gitleaks source / history | **0 leaks**: reviewed snapshot 271 файла и Git history 172 commits; финальный committed head проверяется повторно перед push |
| Чистый clone | **PASS** на `175a5d237e0f712ae7741e3e8416ced0030a6f60`: npm ci, typecheck/build, `npm run app -- --no-open`, gallery Arena, реальные пять попаданий/150 очков, точный HTML export, локальный файл offline без HTTP-запросов, restart/тот же versionId и HTML hash, 0 page errors |
| Screenshots | Два настоящих финальных снимка из указанного clean clone, desktop 1440×1280/full page и mobile 390×844; просмотрены |
| 7 cold mobile Slow 4G / CPU ×4 | PASS: p75 interactive **897 ms**, game launch **1 125 ms**, touch **6,5 ms**, API **3,5 ms**; JS gzip **12 659 B**, CSS **5 251 B**, все initial resources **21 746 B** |
| Hosted Actions | GET подтвердил `enabled:false`, `sha_pinning_required:false`; настройки не менялись. Hosted Windows/Ubuntu/secret-scan **NOT_VERIFIED** |

Performance — synthetic DEMO и локальный lab на `35c6366`, не обещание времени произвольной LLM-игры. Финальный QR navigation fix изменил только initial UI gzip до **12 685 B** (+26 B); CSS остался **5 251 B**. До правки header те же 7 запусков дали p75 interactive 934 ms и game launch 789 ms; прогон выполнялся при другой фоновой нагрузке тестов, поэтому разница не доказывает ускорение или замедление продукта. Исходные локальные журналы находятся в `.local/release-evidence/` этого worktree, traces — в `.local/playwright-final/`; в Git они не включаются. Первый browser run остановлен для исправлений и не считается завершённым PASS. Следующий полный run сохранил один QR FAIL; он также не переименован в green.

## Документация и архив

README и текущие руководства описывают кандидат, а не отдельные ветки или старый main. Установка/backup описывают schema v3 и before-v3 snapshot; старый runtime не должен читать новую базу. [Screenshots](media/README.md) сняты заново с интегрированного приложения на отдельной пустой базе.

[Inventory #57](repository-inventory.tsv) — исторические 234 строки базового main, а не список нового кандидата. [Таблица 25 переносов](repository-cleanup.md#файлы-и-основания-решений) сохранена. Архив — источник evidence, не мусор; дополнительных удалений не выполняется. Новые Arena/LAN файлы входят в diff кандидата и имеют потребителей в build/API/UI/tests.

## Физическая проверка и NOT_VERIFIED

**HUMAN_REPORTED:** Issue [#55](https://github.com/Sashido01/YAPLIX/issues/55) фиксирует проверку владельцем прежнего #53 на двух физических телефонах после ручного узкого Allow TCP52605: один QR, независимые партии, Фос/Сани, 150/150. Это не новая проверка интеграции, LAN helper, iOS или вместимости. Более ранний QR Android/Brave описан в [архиве](archive/micro-036-stable-phone-port.md).

**NOT_VERIFIED:** реальный elevated Apply/UAC, отмена credential prompt, системный rollback/удаление на новой машине; Linux runtime и hosted Windows/Ubuntu; физическая матрица Android/iOS/WebView/Telegram, длительная нагрузка; произвольный LLM gameplay, свежий LIVE и A/B. Браузерные mocks Firewall не меняют систему. Локальный self-GET не доказывает соединение телефона. Arena — рейтинг доверенных клиентских событий, не античит.

Hosted Actions отключены по MICRO-019; здесь они не включаются, hosted PASS не заявляется. Перед release обязателен manual FULL на точном release commit после отдельной команды владельца о восстановлении Actions.

## Перед merge

1. Просмотреть единый Draft PR и актуальные screenshots, повторить Arena на целевых телефонах.
2. Отдельно разрешить и провести приёмку реального LAN Apply/UAC/отмены/удаления/rollback; до неё #55 остаётся открыт.
3. Сверить неизменность `origin/main` и всех включённых head, проверить diff и ancestry. Перед merge повторить полную матрицу на принятом финальном SHA: полный run в этой задаче предшествовал последнему узкому QR-fix. При новом коде повторить затронутые проверки.
4. Только после нового решения владельца о merge: разрешённый merge без обхода protection, ff-only обновление main, проверка фактического merge SHA и критический smoke.
5. Прочитать GitHub status исходных PR, затем вручную решить их закрытие и Issue #52. #34 рекомендован к закрытию без merge с сохранением исследования; автоматических действий нет.

[Решения по каждому PR и Issue](release-status.md).
