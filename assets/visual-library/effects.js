// ============================================================
// YAPLIX Visual Effects Library
// Reusable canvas effects for generated games.
// Usage: <script src="effects.js"></script> then use window.YaplixFx.*
// ============================================================
(function (global) {
  'use strict';

  // ----------------------------------------------------------
  // Canvas setup with DPR-aware scaling
  // Returns { canvas, ctx, getSize() } — call getSize() each frame.
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

    return {
      canvas, ctx,
      getSize() { return { width, height, dpr }; }
    };
  }

  // ----------------------------------------------------------
  // Unified input: keyboard (arrows + AD + RU) + touch + mouse.
  // Returns { input, clearInput() }.
  // Required by YAPLIX browser-check.ts (ArrowLeft/Right/Space).
  // ----------------------------------------------------------
  function setupUnifiedInput(controlsId) {
    const input = { left: false, right: false };
    const KEY_LEFT  = ['ArrowLeft',  'a', 'A', 'ф', 'Ф'];
    const KEY_RIGHT = ['ArrowRight', 'd', 'D', 'в', 'В'];

    const setFromX = (clientX) => {
      const w = window.innerWidth;
      input.left  = clientX <  w / 2;
      input.right = clientX >= w / 2;
    };
    const clearInput = () => { input.left = false; input.right = false; };

    window.addEventListener('keydown', (e) => {
      if (KEY_LEFT.includes(e.key))  { input.left  = true; e.preventDefault(); }
      if (KEY_RIGHT.includes(e.key)) { input.right = true; e.preventDefault(); }
      if (e.key === ' ') e.preventDefault();
    }, { passive: false });

    window.addEventListener('keyup', (e) => {
      if (KEY_LEFT.includes(e.key))  input.left  = false;
      if (KEY_RIGHT.includes(e.key)) input.right = false;
    });

    const controls = document.getElementById(controlsId);
    if (controls) {
      const touchHandler = (e) => {
        e.preventDefault();
        const t = e.touches[0];
        if (t) setFromX(t.clientX); else clearInput();
      };
      controls.addEventListener('touchstart',  touchHandler, { passive: false });
      controls.addEventListener('touchmove',   touchHandler, { passive: false });
      controls.addEventListener('touchend',    (e) => { e.preventDefault(); clearInput(); }, { passive: false });
      controls.addEventListener('touchcancel', () => clearInput());
      controls.addEventListener('mousedown',   (e) => setFromX(e.clientX));
    }
    window.addEventListener('mouseup', clearInput);
    window.addEventListener('blur', clearInput);

    return { input, clearInput };
  }

  // ----------------------------------------------------------
  // Neon particle (glow + fade + shrink). For arcade / space styles.
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
      this.glow = opts.glow ?? 15;
    }
    update() {
      this.x += this.vx; this.y += this.vy;
      this.life -= this.decay;
      this.size *= 0.95;
    }
    draw(ctx) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, this.life);
      ctx.shadowBlur = this.glow;
      ctx.shadowColor = this.color;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, Math.max(0.1, this.size), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    get dead() { return this.life <= 0; }
  }

  // ----------------------------------------------------------
  // Pixel particle (blocky + gravity). For retro / 8-bit styles.
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
      ctx.save();
      ctx.globalAlpha = Math.max(0, this.life);
      ctx.fillStyle = this.color;
      ctx.fillRect(Math.floor(this.x), Math.floor(this.y), this.size, this.size);
      ctx.restore();
    }
    get dead() { return this.life <= 0; }
  }

  // ----------------------------------------------------------
  // Explosion factory: spawns N particles of the given class.
  // Returns the new particles (caller pushes them into its array).
  // ----------------------------------------------------------
  function spawnExplosion(x, y, color, ParticleClass, count = 15, opts = {}) {
    const out = [];
    for (let i = 0; i < count; i++) out.push(new ParticleClass(x, y, color, opts));
    return out;
  }

  // ----------------------------------------------------------
  // Utility: clamp a value between min and max.
  // ----------------------------------------------------------
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // ----------------------------------------------------------
  // Utility: simple AABB collision between two {x,y,size} objects.
  // ----------------------------------------------------------
  function collides(a, b) {
    return Math.abs(a.x - b.x) < (a.size + b.size) &&
           Math.abs(a.y - b.y) < (a.size + b.size);
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
    collides
  };
})(typeof window !== 'undefined' ? window : globalThis);