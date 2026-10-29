# YAPLIX Visual Library v2.0

Локальные авторские DEMO для HTML5 Canvas. Библиотека не подключена к
ИИ-генератору. Реальные LLM API для запуска примеров не требуются.

## Структура

- `effects.js` — подключаемый script, экспортирует `window.YaplixFx` (не ES module).
- `neon-arcade.html` — свечение, круглые частицы, след; подключает `effects.js`.
- `pixel-retro.html` — пиксельные частицы с гравитацией; подключает `effects.js`.
- `neon-survivor.html` — уклонение и сбор 10 предметов, победа/поражение, restart.
- `pixel-breaker.html` — кирпичи, отскоки, жизни, победа/поражение, restart.
- `standalone-example.html` — автономный пример с полной встроенной библиотекой.

Survivor и Breaker содержат собственные сокращённые inline-копии API
(без `Particle` в Breaker). Изменение `effects.js` не обновляет их автоматически.
Три базовых демо не имеют победы, поражения и restart: `LIVES: 3` — статический HUD.
Их новая сессия запускается перезагрузкой страницы.

## Запуск и управление

Откройте HTML локально; для первых двух файлов оставьте `effects.js` рядом.
Нажмите START / «НАЧАТЬ ИГРУ». Стрелки, A/D и Ф/В двигают по горизонтали;
в Survivor также W/S, Ц/Ы и стрелки вверх/вниз. В нижней зоне других демо
удерживайте левую/правую треть экрана мышью или пальцем. В Survivor персонаж
следует за пальцем или зажатой левой кнопкой мыши на canvas.
В Breaker движение платформы запускает мяч; «ИГРАТЬ СНОВА» сбрасывает раунд.

Resize пересчитывает геометрию без сброса счёта и жизней. Breaker сохраняет
набор и `alive` кирпичей, направление мяча и состояние раунда; новый набор
создаётся только при START / restart. Изменение размеров не является сохранением
на диск: перезагрузка страницы начинает новую сессию.

## API `effects.js` (`window.YaplixFx`)

| Экспорт | Контракт |
| --- | --- |
| `setupCanvas(canvasId)` | Canvas должен существовать. Возвращает `{canvas, ctx, getSize()}`; размер окна и DPR обновляются по resize. `getSize()` → `{width, height, dpr}`. |
| `setupUnifiedInput(controlsId, opts={})` | Возвращает `{input, clearInput}`. `input` содержит left/right/up/down; вертикаль включается `{vertical:true}`. Клавиатура, touch, mousedown; отпускание/blur очищает ввод. Координаты делятся на трети viewport. |
| `Particle(x,y,color,opts={})` | `update()`, `draw(ctx)`, getter `dead`. Опции spread, decay, minSize, maxSize, glow (по умолчанию 0). |
| `PixelParticle(x,y,color,opts={})` | Те же методы; опции spread, decay, gravity, big, small. |
| `Particle.drawAll(ctx,particles)` | Один save/restore для массива; после отрисовки globalAlpha=1. |
| `PixelParticle.drawAll(ctx,particles)` | То же для пиксельных частиц. |
| `spawnExplosion(x,y,color,Class,count=15,opts={})` | Массив новых экземпляров Class. |
| `clamp(v,min,max)` | Ограничение числа (предполагается min ≤ max). |
| `collides(a,b)` | Пересечение AABB с центром x/y и полурадиусом size; касание границ не считается столкновением. |
| `clampDelta(dt,max=100)` | `Math.min(dt,max)`, верхний предел, не нормализация отрицательных dt. |
| `setupLoop(callback)` | callback(dt в мс), максимум 100 мс; `{start(),stop(),isRunning()}`. Повторный start не создаёт второй цикл. |

```html
<canvas id="gameCanvas"></canvas>
<script src="effects.js"></script>
<script>
  const { ctx, getSize } = YaplixFx.setupCanvas('gameCanvas');
  const loop = YaplixFx.setupLoop(dt => {
    const { width, height } = getSize();
    ctx.clearRect(0, 0, width, height);
  });
  loop.start();
</script>
```

## Производительность и ограничения

`glow=0`, пакетная отрисовка и ограничение dt — свойства реализации, а не
доказательство FPS или отсутствия утечек. Частицы двигаются за кадр, а не за dt:
скорость зависит от частоты кадров. Loop не останавливается автоматически в фоне,
setupCanvas/setupUnifiedInput не возвращают disposer; используйте их один раз
за жизнь страницы. Ограничение dt не гарантирует стабильный FPS.

Survivor ограничивает врагов + предметы до 20, частицы до 200; Breaker — частицы
до 200. Базовые демо ограничивают цели до 10, частицы удаляются после затухания,
но отдельного жёсткого cap частиц нет. Профилирование длительной сессии и замеры
на слабых телефонах не выполнены. Не заявляется гарантия производительности.

## Совместимость и проверка

Браузерные профили — эмуляция viewport/input. Они не доказывают работу
физических Android/iPhone, WebView/WKWebView или Telegram. Safe-area CSS и
`viewport-fit=cover` есть в Survivor/Breaker; три базовых демо их не содержат.
Поведение вырезов и экранной клавиатуры на физических устройствах не проверено.

Регрессии, smoke, ошибки JS, локальные ресурсы и проверенные профили описаны в
[QA.md](QA.md). Запуск из корня проекта (после штатной установки браузеров):

```powershell
node scripts/browser-tests.mjs test --config tests/visual-library.config.ts
```
