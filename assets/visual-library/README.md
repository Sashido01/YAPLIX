# YAPLIX Visual Library

Переиспользуемые визуальные эффекты и два эталонных демо для HTML5 Canvas игр.

## Структура

- **`effects.js`** — сама библиотека. Подключается одним `<script src="effects.js"></script>`.
- **`neon-arcade.html`** — демо в стиле Neon Arcade (свечение, круглые частицы, trail).
- **`pixel-retro.html`** — демо в стиле Pixel Retro (пиксель-арт, блочные частицы с гравитацией).

## API библиотеки (`window.YaplixFx`)

| Функция / класс | Назначение |
|---|---|
| `setupCanvas(canvasId)` | Инициализирует canvas с DPR-скейлингом. Возвращает `{ canvas, ctx, getSize() }`. |
| `setupUnifiedInput(controlsId)` | Единый ввод: клавиатура (стрелки, A/D, русская Ф/В), touch, mouse. Возвращает `{ input, clearInput() }`. **Обязателен** для прохождения `browser-check.ts`. |
| `Particle` | Неоновая частица (glow + fade + shrink). |
| `PixelParticle` | Пиксельная частица (блок + гравитация). |
| `spawnExplosion(x, y, color, ParticleClass, count, opts?)` | Фабрика взрыва: возвращает массив частиц. |
| `clamp(v, min, max)` | Ограничение значения. |
| `collides(a, b)` | AABB-коллизия для объектов `{x, y, size}`. |

## Быстрый старт

```html
<canvas id="gameCanvas"></canvas>
<div id="controls" data-yaplix-input>...</div>
<script src="effects.js"></script>
<script>
  const Fx = window.YaplixFx;
  const { ctx, getSize } = Fx.setupCanvas('gameCanvas');
  const { input } = Fx.setupUnifiedInput('controls');

  // в цикле:
  if (input.left) player.x -= 5;
  particles.push(...Fx.spawnExplosion(x, y, '#f0f', Fx.Particle, 20));
  particles.forEach(p => p.update());
  particles = particles.filter(p => !p.dead);
  particles.forEach(p => p.draw(ctx));
</script>
```

## Важные правила YAPLIX

- Canvas: `position: fixed; width: 100%; height: 100%` — **не** `100vw` (даёт `BROWSER_HORIZONTAL_OVERFLOW`).
- Кнопка старта: `data-yaplix-start`, минимум 44×44 px.
- Зона управления: `data-yaplix-input`.
- Поддержка клавиатуры обязательна — `browser-check.ts` шлёт реальные `ArrowLeft`/`ArrowRight`.
- Никаких внешних ресурсов, никаких библиотек. Всё рисуется через Canvas API.