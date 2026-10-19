# A1.8 — Canvas / WebGL rendering contract

Требование кейса, переданное владельцем: оболочка генератора может использовать
любой фреймворк, сама игра — чистый HTML5 Canvas / WebGL. A1.8 вводит обязательный
контракт новых LIVE-версий, включая редактирование. Документ кейса с ключами для
этой работы не открывался. Реальные результаты провайдеров здесь не проверялись.

## Генерация и совместимость

Единый `GAME_GENERATION_CONTRACT` применяется в `direct`, `spec` и `intent`.
Canvas 2D предпочтителен для лёгких игр; WebGL допустим. Игрок, враги, предметы,
препятствия, карта и эффекты рисуются в Canvas/WebGL. DOM разрешён для меню,
HUD, кнопок управления, настроек, правил и доступности. SVG/CSS/DOM не заменяют
игровой мир. Не требуются конкретные ID, жанр, движок, библиотека или телеметрия.
HTML автономен, CSS/JS встроены; внешние ресурсы и импорты запрещены.
Промпт требует DPR backing store, portrait/landscape и desktop/touch controls.

Edit получает весь исходный HTML и исходную идею: DOM gameplay переводится в
Canvas/WebGL с сохранением правил и концепции. Исторические HTML, SQLite rows,
старые версии и экспорт не мигрируют. DEMO и импорт не получают LIVE provenance.
Неактивный experimental Orchestrator уже требует Canvas; его browserCheck также
проходит общий gate. Production server использует `configuredGenerator`.

Путь: `generationMessages → prepareDocument → validateDocument → browserCheck →
checkFullHtml → parseArtifact → Store.save → preview → export`.
Полный сохранённый checkpoint при Continue снова проходит тот же gate без POST.

## Runtime gate

Проверка проходит offline в disposable Chromium: opaque iframe `allow-scripts`,
прежняя CSP, изолированный environment без серверных ключей. HTML локально
fulfill-ится как `text/html; charset=utf-8` по случайному document URL; это
сохраняет Unicode controls и исключает гонку init-script/srcdoc,
не создавая внешнего сетевого запроса. Разрешены только iframe и standalone load
этого точного URL; остальные requests блокируются. HTML игры не переписывается.

До game script observer оборачивает нативные `getContext` и draw-вызовы,
сохраняя receiver, аргументы, результат и исключения. Наблюдаются `2d`, `webgl`,
`webgl2`; clear без draw не считается рисованием. Readback использует отдельный
32×24 probe. WebGL считывается сразу после draw, до очистки drawing buffer.
Observer и его random-key состояние существуют только в checker, не в экспорте.
Явные WebGL clear-вызовы обновляют снимок, не считаясь рисованием; сброс ширины
или высоты backing store сбрасывает прежнее rendering evidence. Это исключает
приём проверенных случаев draw → clear/reset с пустым конечным изображением.

На 320×700, 390×700, 844×390 нужны видимый, открытый для hit testing Canvas с
ненулевым backing store, подходящий размер, реальные draw-вызовы и изображение
минимум с двумя достаточно представленными цветами. После Start и настоящих
touch/control probes нужно наблюдаемое изменение того же Canvas. Два разных
статичных Canvas не подтверждают активность. Игровые probes пропускают служебные
Pause/Resume/Restart и наблюдают каждый input до следующего противоположного.
Затем отдельно загружается HTML
без parent, проверяются запуск, touch и отсутствие ошибки от keyboard input.
Прежняя landscape control reachability проверка сохранена.

Очевидный DOM world определяется по наблюдаемым SVG graphics вне UI, styled
позиционированным/трансформированным/анимированным leaf-элементам и styled grid
cells. Меню, HUD и семантические controls допускаются. Подтверждённая ошибка JS,
запрещённый request, popup или dialog блокируют приём независимо от изображения.

Ошибки `BROWSER_CANVAS_*` / `BROWSER_DOM_GAME_WORLD` сохраняют отказ и исходный
checkpoint в durable job, не создают версию и не запускают автоматический repair
или fallback, даже если repair включён. История предыдущих версий сохраняется.
Metadata `generation.browser.rendering` содержит `contract:canvas-webgl-v1`,
наблюдённые context types и три профиля; parser проверяет форму и сохраняет их
при SQLite reopen. Старые metadata без этого поля читаются без приписывания
нового rendering evidence. Legacy lifecycle profiles остаются `[320,390]`, но
их новый rendering evidence отдельно содержит `[320,390,844]`.

## Проверяемые случаи

Положительные authored fixtures: Canvas-аркада, Canvas-головоломка, WebGL triangle
с рабочими shaders, Canvas с DOM-кнопкой, touch, редактирование старой DOM-версии.
Отрицательные: DOM-only, SVG-only, пустой/скрытый/нулевой Canvas, отсутствие
draw-вызовов, статичная неработающая сцена, декоративный Canvas рядом с DOM sprite,
ошибка после Start, oversized landscape Canvas и недоступные landscape controls.
Интеграция: synthetic transport → реальные static/browser gates → durable job →
SQLite close/reopen → historical/new API export → file:// offline input.
Transport fixture не выполняет реального LLM POST и не доказывает качество LLM.

## Границы достоверности

Rendering VERIFIED означает только перечисленные наблюдения. Это не Gameplay
VERIFIED, не доказательство победы, поражения, правил, коллизий или бесконечной
играбельности. Full HTML gameplay/win/loss/restart aspects остаются NOT_VERIFIED.
Смена пикселей во время ввода не доказывает причинную связь с этим вводом:
автономная анимация тоже может менять изображение. Семантическое различение HUD,
кнопки управления и DOM игрового объекта универсально не решается геометрией.
Специально замаскированная DOM-механика рядом с анимацией остаётся ограничением;
bounded gate не является adversarial-proof сертификацией всего произвольного JS.

Observer может отклонить допустимую, но ненаблюдаемую игру: очень маленькие или
одноцветные сцены, нестандартный Start, редкие/отложенные реакции, OffscreenCanvas,
нестандартные draw extensions. Неоднозначное отсутствие render/activity evidence
не даёт PASS и требует ручного аудита исходного draft. DPR указан в промпте, но
runtime не доказывает качество пикселей или корректность всех coordinate mappings.
32×24 sampling и bounded probes не исследуют все состояния игры.

Физические Android/iOS/Telegram, реальный LLM generation/edit, интеграция с
незавершённым PR #49/A1.7, hosted Windows/Ubuntu CI и юридическое подтверждение
организатором хакатона — NOT_VERIFIED. Локальный Windows/browser результат
не заменяет эти свидетельства. Inference/OAuth/model requests этой задачи: 0.
