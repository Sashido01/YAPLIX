// ============================================================
// YAPLIX Visual Effects Library v2.0
// Reusable canvas effects for generated games.
// Optimized for mobile performance.
// Exposed as window.YaplixFx
// ============================================================
(function (global) {
  'use strict';

  // ----------------------------------------------------------
  // Canvas setup with DPR-aware scaling
  // ----------------------------------------------------------
  function setupCanvas(canvasId) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    let width = 0, height = 0, dpr = 1;

    function resize() {
      dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener('resize', resize);
    resize();

    return { canvas, ctx, getSize() { return { width, height, dpr }; } };
  }

  // ----------------------------------------------------------
  // Unified input: keyboard + touch + mouse
  // Supports horizontal (left/right) and optional vertical (up/down)
  // ----------------------------------------------------------
  function setupUnifiedInput(controlsId, opts = {}) {
    const input = { left: false, right: false, up: false, down: false };
    const KEY_LEFT  = ['ArrowLeft',  'a', 'A', 'ф', 'Ф'];
    const KEY_RIGHT = ['ArrowRight', 'd', 'D', 'в', 'В'];
    const KEY_UP    = ['ArrowUp',    'w', 'W', 'ц', 'Ц'];
    const KEY_DOWN  = ['ArrowDown',  's', 'S', 'ы', 'Ы'];

    const setFromXY = (clientX, clientY) => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      input.left  = clientX <  w / 3;
      input.right = clientX > (w * 2 / 3);
      if (opts.vertical) {
        input.up   = clientY <  h / 3;
        input.down = clientY > (h * 2 / 3);
      }
    };
    const clearInput = () => { 
      input.left = false; input.right = false; 
      if (opts.vertical) { input.up = false; input.down = false; }
    };

    window.addEventListener('keydown', (e) => {
      if (KEY_LEFT.includes(e.key))  { input.left  = true; e.preventDefault(); }
      if (KEY_RIGHT.includes(e.key)) { input.right = true; e.preventDefault(); }
      if (opts.vertical) {
        if (KEY_UP.includes(e.key))   { input.up   = true; e.preventDefault(); }
        if (KEY_DOWN.includes(e.key)) { input.down = true; e.preventDefault(); }
      }
      if (e.key === ' ') e.preventDefault();
    }, { passive: false });

    window.addEventListener('keyup', (e) => {
      if (KEY_LEFT.includes(e.key))  input.left  = false;
      if (KEY_RIGHT.includes(e.key)) input.right = false;
      if (opts.vertical) {
        if (KEY_UP.includes(e.key))   input.up   = false;
        if (KEY_DOWN.includes(e.key)) input.down = false;
      }
    });

    const controls = document.getElementById(controlsId);
    if (controls) {
      const touchHandler = (e) => {
        e.preventDefault();
        const t = e.touches[0];
        if (t) setFromXY(t.clientX, t.clientY); else clearInput();
      };
      controls.addEventListener('touchstart',  touchHandler, { passive: false });
      controls.addEventListener('touchmove',   touchHandler, { passive: false });
      controls.addEventListener('touchend',    (e) => { e.preventDefault(); clearInput(); }, { passive: false });
      controls.addEventListener('touchcancel', () => clearInput());
      controls.addEventListener('mousedown',   (e) => setFromXY(e.clientX, e.clientY));
    }
    window.addEventListener('mouseup', clearInput);
    window.addEventListener('blur', clearInput);

    return { input, clearInput };
  }

  // ----------------------------------------------------------
  // Neon particle (optional glow, fade, shrink)
  // Performance: glow=0 by default for mobile
  // ----------------------------------------------------------
  class Particle {
    constructor(x, y, color, opts = {}) {
      this.x = x; this.y = y;
      const spread = opts.spread ?? 10;
      this.vx = (Math.random() - 0.5) * spread;
      this.vy = (Math.random() - 0.5) * spread;
      this.life = 1.0;
      this.decay = opts.decay ?? 0.025;
      this.color = color;
      this.size = (opts.minSize ?? 2) + Math.random() * ((opts.maxSize ?? 4) - (opts.minSize ?? 2));
      this.glow = opts.glow ?? 0; // 0 by default for performance
    }
    update() {
      this.x += this.vx; this.y += this.vy;
      this.life -= this.decay;
      this.size *= 0.95;
    }
    draw(ctx) {
      ctx.globalAlpha = Math.max(0, this.life);
      if (this.glow > 0) {
        ctx.shadowBlur = this.glow;
        ctx.shadowColor = this.color;
      }
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, Math.max(0.1, this.size), 0, Math.PI * 2);
      ctx.fill();
      if (this.glow > 0) {
        ctx.shadowBlur = 0;
      }
    }
    get dead() { return this.life <= 0; }
  }

  // Batch rendering for particles (one save/restore for all)
  Particle.drawAll = function(ctx, particles) {
    if (!particles.length) return;
    ctx.save();
    particles.forEach(p => p.draw(ctx));
    ctx.restore();
    ctx.globalAlpha = 1.0;
  };

  // ----------------------------------------------------------
  // Pixel particle (blocky + gravity)
  // ----------------------------------------------------------
  class PixelParticle {
    constructor(x, y, color, opts = {}) {
      this.x = Math.floor(x); this.y = Math.floor(y);
      const spread = opts.spread ?? 4;
      this.vx = (Math.random() > 0.5 ? 1 : -1) * (Math.random() * spread + 2);
      this.vy = (Math.random() > 0.5 ? 1 : -1) * (Math.random() * spread + 2);
      this.life = 1.0;
      this.decay = opts.decay ?? 0.03;
      this.gravity = opts.gravity ?? 0.3;
      this.color = color;
      this.size = Math.random() > 0.5 ? (opts.big ?? 6) : (opts.small ?? 3);
    }
    update() {
      this.x += this.vx; this.y += this.vy;
      this.vy += this.gravity;
      this.life -= this.decay;
    }
    draw(ctx) {
      ctx.globalAlpha = Math.max(0, this.life);
      ctx.fillStyle = this.color;
      ctx.fillRect(Math.floor(this.x), Math.floor(this.y), this.size, this.size);
    }
    get dead() { return this.life <= 0; }
  }

  PixelParticle.drawAll = function(ctx, particles) {
    if (!particles.length) return;
    ctx.save();
    particles.forEach(p => p.draw(ctx));
    ctx.restore();
    ctx.globalAlpha = 1.0;
  };

  // ----------------------------------------------------------
  // Explosion factory
  // ----------------------------------------------------------
  function spawnExplosion(x, y, color, ParticleClass, count = 15, opts = {}) {
    const out = [];
    for (let i = 0; i < count; i++) out.push(new ParticleClass(x, y, color, opts));
    return out;
  }

  // ----------------------------------------------------------
  // Utilities
  // ----------------------------------------------------------
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function collides(a, b) {
    return Math.abs(a.x - b.x) < (a.size + b.size) && Math.abs(a.y - b.y) < (a.size + b.size);
  }

  // Limit delta time to prevent huge jumps after tab inactivity
  function clampDelta(dt, max = 100) { return Math.min(dt, max); }

  // Game loop helper
  function setupLoop(callback) {
    let lastTime = 0;
    let running = false;
    let rafId = null;

    function loop(timestamp) {
      if (!running) return;
      const dt = clampDelta(timestamp - lastTime);
      lastTime = timestamp;
      callback(dt);
      rafId = requestAnimationFrame(loop);
    }

    return {
      start() {
        if (running) return;
        running = true;
        lastTime = performance.now();
        rafId = requestAnimationFrame(loop);
      },
      stop() {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
      },
      isRunning() { return running; }
    };
  }

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------
  global.YaplixFx = {
    setupCanvas,
    setupUnifiedInput,
    Particle,
    PixelParticle,
    spawnExplosion,
    clamp,
    collides,
    clampDelta,
    setupLoop
  };
})(typeof window !== 'undefined' ? window : globalThis);