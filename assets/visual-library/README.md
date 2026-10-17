# YAPLIX Visual Library v2.0

Переиспользуемые визуальные эффекты и эталонные демо для HTML5 Canvas игр. Оптимизировано для мобильных устройств.

## Структура
- **`effects.js`** — ядро библиотеки (~3KB minified), экспортирует `window.YaplixFx`.
- **`neon-arcade.html`** — базовое демо: свечение, круглые частицы, trail-эффект.
- **`pixel-retro.html`** — базовое демо: пиксель-арт, блочные частицы с гравитацией.
- **`neon-survivor.html`** — полноценная мини-игра: уклонение от врагов, сбор предметов, 4-направленное управление, состояния победы/поражения и полный сброс.
- **`pixel-breaker.html`** — полноценная мини-игра (Arkanoid): физика отскока мяча, разрушение кирпичей, горизонтальное управление.
- **`standalone-example.html`** — технический пример полностью автономной сборки (библиотека встроена инлайном в `<head>`).

## API (`window.YaplixFx`)

### Настройка
| Функция | Назначение |
|---|---|
| `setupCanvas(canvasId)` | Инициализация canvas с DPR-скейлингом. Возвращает `{ canvas, ctx, getSize() }`. |
| `setupUnifiedInput(controlsId, opts?)` | Единый ввод: клавиатура (стрелки, WASD, русская раскладка), touch, mouse. Опционально: `{ vertical: true }` для поддержки up/down. |
| `setupLoop(callback)` | Утилита для game loop с автоматическим ограничением `dt` (макс. 100мс). Возвращает `{ start(), stop(), isRunning() }`. |

### Эффекты частиц
| Класс/метод | Назначение |
|---|---|
| `Particle` | Неоновая частица (опциональное свечение `glow`, затухание). **По умолчанию `glow=0` для производительности.** |
| `PixelParticle` | Пиксельная частица (блок + гравитация). |
| `spawnExplosion(x, y, color, Class, count, opts?)` | Фабрика взрыва: возвращает массив частиц. |
| `Particle.drawAll(ctx, particles)` | Batch-рендеринг: один `save()`/`restore()` на весь массив. |
| `PixelParticle.drawAll(ctx, particles)` | Batch-рендеринг для пиксельных частиц. |

### Утилиты
| Функция | Назначение |
|---|---|
| `clamp(v, min, max)` | Ограничение значения. |
| `collides(a, b)` | AABB-коллизия для объектов `{x, y, size}`. |
| `clampDelta(dt, max=100)` | Ограничение `dt` для предотвращения "телепортации" после неактивности вкладки. |

## Производительность

### Оптимизации для мобильных
1. **`shadowBlur` отключён по умолчанию** в `Particle`. Включайте явно через `{ glow: 10 }` только для неоновых эффектов.
2. **Batch-рендеринг**: используйте `Particle.drawAll()` вместо `forEach(p => p.draw())` — это уменьшает количество `save()`/`restore()` в N раз.
3. **Ограничение `dt`**: `setupLoop()` автоматически ограничивает `dt` до 100мс, предотвращая проблемы после возврата на вкладку.
4. **Лимит объектов**: в демо ограничен `MAX_TARGETS = 10`, чтобы избежать утечки памяти.

### Рекомендации
- Для мобильных игр используйте `PixelParticle` (без `shadowBlur`) или `Particle` с `glow: 0`.
- Избегайте более 50 активных частиц на слабых устройствах.
- Используйте `clampDelta()` или `setupLoop()` для стабильного FPS.

## Пример использования

```javascript
const Fx = window.YaplixFx;
const { ctx, getSize } = Fx.setupCanvas('gameCanvas');
const { input } = Fx.setupUnifiedInput('controls', { vertical: true });

let particles = [];
const loop = Fx.setupLoop((dt) => {
  const { width, height } = getSize();
  
  // Update
  if (input.left) player.x -= 5;
  if (Fx.collides(player, enemy)) {
    particles.push(...Fx.spawnExplosion(enemy.x, enemy.y, '#f00', Fx.Particle, 20, { glow: 10 }));
  }
  particles.forEach(p => p.update());
  particles = particles.filter(p => !p.dead);
  
  // Draw
  ctx.clearRect(0, 0, width, height);
  Fx.Particle.drawAll(ctx, particles);
});

loop.start();