# YAPLIX Visual Library v2.0

Переиспользуемые визуальные эффекты и эталонные демо для HTML5 Canvas игр. Оптимизировано для мобильных устройств.

## Структура
- **`effects.js`** — ядро библиотеки (~3KB minified), экспортирует `window.YaplixFx`.
- **`neon-arcade.html`** — базовое демо: свечение, круглые частицы, trail-эффект.
- **`pixel-retro.html`** — базовое демо: пиксель-арт, блочные частицы с гравитацией.
- **`neon-survivor.html`** — полноценная мини-игра: уклонение от врагов, сбор предметов, 4-направленное управление, интуитивное touch-управление "follow finger", состояния победы/поражения и полный сброс.
- **`pixel-breaker.html`** — полноценная мини-игра (Arkanoid): физика отскока мяча, разрушение кирпичей, горизонтальное управление, адаптация при повороте экрана.
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
4. **Лимит объектов**: в демо ограничено `MAX_OBJECTS = 20` (враги/сферы) и `MAX_PARTICLES = 200` (частицы), чтобы избежать утечки памяти при длительной игре.

### Рекомендации
- Для мобильных игр используйте `PixelParticle` (без `shadowBlur`) или `Particle` с `glow: 0`.
- Избегайте более 50 активных частиц на слабых устройствах.
- Используйте `clampDelta()` или `setupLoop()` для стабильного FPS.
- Всегда добавляйте лимиты на количество игровых объектов и частиц.

## Мобильная совместимость

### Проверенные разрешения
- ✅ 320×568 (iPhone SE)
- ✅ 360×640 (Android стандарт)
- ✅ 390×844 (iPhone 13/14)
- ✅ 430×932 (iPhone 14 Pro Max)

### Safe area (iPhone notch / dynamic island)
Все демо используют `env(safe-area-inset-*)` для корректного отображения на устройствах с вырезом:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<style>
  html, body {
    padding: env(safe-area-inset-top) env(safe-area-inset-right) 
             env(safe-area-inset-bottom) env(safe-area-inset-left);
  }
</style>