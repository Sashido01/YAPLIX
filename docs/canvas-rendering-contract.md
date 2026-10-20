# A1.8.6 — Strict Canvas / WebGL game contract

Новые LIVE create/edit и Continue обязаны подтвердить `canvas-webgl-strict-v2`.
Все видимые элементы игры рисуются только Canvas 2D, WebGL или WebGL2: мир,
Start/Restart/Pause, HUD, прогресс, жизни, правила, настройки, управление звуком,
победа и Game Over. Нажатия обрабатываются Canvas hitboxes с переводом CSS pixels
в backing pixels и учётом DPR. Keyboard и touch обязательны; клавиатура не должна
быть необходима на телефоне. Весь HTML автономен, без внешних библиотек/ресурсов.

Разрешены технические html/head/body/meta/title/script/style, прозрачные layout
контейнеры, невидимые ресурсы и невизуальные Canvas accessibility attributes.
Несколько Canvas разрешены, например WebGL-мир + прозрачный 2D HUD. Каждый видимый
Canvas должен действительно рисовать; изменяющийся HUD не маскирует пустой мир.
Оболочка YAPLIX и её исторический player могут продолжать использовать DOM.

## Единая генерация и история

`GAME_GENERATION_CONTRACT` общий для direct/spec/intent, create/edit и всех
production transports. Ollama Cloud, OpenRouter Free и локальный ручной ChatGPT
не получают разных требований качества. Edit передаёт полный предыдущий HTML и
исходную идею; DOM-интерфейс переводится в Canvas с сохранением концепции/правил.
Оригинальная версия, её хеш, metadata и export не переписываются.

| Evidence | Значение |
| --- | --- |
| `canvas-webgl-v1` | Исторический контракт: DOM HUD, menus, controls и terminal overlays допускались |
| `canvas-webgl-strict-v2` | Новый контракт: всё видимое игровое UI находится в Canvas/WebGL |
| Без rendering evidence | Историческая запись; строгая проверка не приписывается |

`parseArtifact(..., 'saved-metadata')` читает старые metadata без миграции или
повышения соответствия. Новая проверенная LLM-версия без v2 evidence отвергается,
включая попытку повторно сохранить исторические v1 metadata как новое evidence.
SQLite reopen/history/export читают прежние записи без перезаписи.

## Production browser gate

Путь: generationMessages → prepareDocument → static validation → browserCheck →
checkFullHtml → parseArtifact → Store.save → preview/export.
Checker использует disposable offline Chromium, OS sandbox, opaque iframe
`allow-scripts`, прежнюю CSP и очищенный environment. Только случайный точный
validation URL локально fulfill-ится до game scripts; остальные requests,
popup, native dialog и JS exceptions блокируют приём. HTML не переписывается.

Observer проверяет фактический DOM и computed styles, текстовые Range rects,
SVG/replaced elements, backgrounds/borders/shadows, `::before`/`::after`, в том
числе после каждого input. Роли status/dialog, классы hud и custom elements не
освобождают UI от проверки. MutationObserver удерживает обнаруженное нарушение
между пробами; open/closed Shadow DOM, созданный после init observer, включён в
анализ. Видимый iframe/object/embed — запрещённая не-Canvas поверхность, даже
если вложенный документ same-origin; скрытый технический документ не получает
автоматического запрета по одному факту существования. Анализ ограничен 4096
элементами: превышение — NOT_VERIFIED, а не неподтверждённое обвинение игры.

Нативные draw/getContext сохраняют receiver, аргументы, результат и exceptions.
32×24 readback не считает clear рисованием. WebGL evidence снимается microtask
после синхронных draw/clear; `preserveDrawingBuffer:false` устаревает после
текущего/предыдущего rAF кадра. Backing reset сбрасывает прежние draw/image.
Нижний Canvas не отклоняется автоматически из-за Canvas HUD: проверяется
прозрачность 2D слоя в ограниченном наборе точек. Все видимые слои должны иметь
актуальное meaningful image. Старое разрешение очищенного мира под DOM Game Over
не применяется. Краткий clear→redraw получает до двух дополнительных 50 ms
наблюдений в прежнем общем deadline 18 s.

На 320×700, 390×700 и 844×390, DPR 2 выполняются по восемь ограниченных touch
проб в нормализованных Canvas координатах, включая повторные центральные taps.
После каждой пробы проверяются DOM, render и exceptions, поэтому следующий input
не может скрыть обнаруженный пустой кадр/DOM. Начальный экран исключён из
сравнения активности: одного изменения Start недостаточно. Независимая standalone
загрузка повторяет touch и ArrowRight. Нет fixture-specific селекторов, hitboxes,
инъекции состояния, force-click или рисования checker-ом.

Универсально найти Start/Pause/Restart произвольной игры невозможно. Незнакомая
раскладка, слишком редкая анимация или недостаточные изменения дают NOT_VERIFIED,
а не доказанную поломку. Тап и изменение пикселей подтверждают ограниченное
техническое наблюдение, но не правильность gameplay, win/loss или Restart.
Эти аспекты по-прежнему NOT_VERIFIED. Будущие состояния вне окна проверки,
физические Android/iOS, Android WebView и реальные Telegram clients требуют
отдельной проверки. Full Web Audio/SFX pipeline сюда не входит.

## Отказ без потери draft

`BROWSER_DOM_GAME_UI` означает обнаруженный запрещённый DOM (FAILED).
`BROWSER_CANVAS_DOM_UNVERIFIED`, `BROWSER_CANVAS_RENDER_UNVERIFIED` и
`BROWSER_CANVAS_ACTIVITY_UNVERIFIED` означают недостаток evidence (NOT_VERIFIED).
Оба уровня блокируют Save/Ready. Durable job сохраняет raw checkpoint, draft и
диагностику, переходит в needs_attention без новой версии. Продолжение полного
checkpoint снова проходит тот же gate без POST. Canvas/DOM отказы не разрешают
LLM repair, автоматический fallback или повторный inference; старые
`BROWSER_CANVAS_*` / `BROWSER_DOM_GAME_WORLD` guards сохранены.

## Offline проверки

`strict-canvas.spec.ts` содержит negative/positive DOM и Canvas матрицу;
`canvas-contract.spec.ts` — WebGL/WebGL2 clear/reset/stale, Restart, production
jobs, SQLite/history/export/Continue; `strict-offline.spec.ts` — file://,
keyboard/touch, Pause/sound, Restart и rotation в browser matrix.
`strict-metadata.test.ts` проверяет обязательный v2 и read-only историю.
Synthetic transports не выполняют реальный provider POST и не доказывают качество
реальной LLM-генерации. Проверки с внедрённым checker evidence являются unit
проверками plumbing, а не browser proof. Исторические DOM-positive fixtures
сохранены, но при новой генерации теперь ожидают REJECT.
