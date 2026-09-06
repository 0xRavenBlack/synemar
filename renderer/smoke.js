(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Smoke = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_SMOKE = 240;
  const LIFETIME = 320;
  const BURST_PULSE_FLOOR = 0.6;
  const MIN_ALPHA = 0.004;
  const SWAY_FREQ = 0.012;

  function create(opts) {
    const { settings, fx, getPlaying, getPulse, getDt } = opts;
    const smoke = [];

    function spawn(pulse, dt, L, H) {
      const count = 1 + (pulse > BURST_PULSE_FLOOR ? Math.floor(Math.random() * 2) : 0);
      for (let k = 0; k < count; k++) {
        const col = Math.random() < 0.7 ? '255,255,255' : `${fx.accent.r},${fx.accent.g},${fx.accent.b}`;
        smoke.push({
          x: L.bx + Math.random() * L.bw,
          y: L.baseY + Math.random() * H * 0.04,
          vx: (Math.random() - 0.5) * 0.25,
          vy: -(0.08 + Math.random() * 0.24),
          life: LIFETIME,
          maxLife: LIFETIME,
          r: 6 + Math.random() * 14,
          col,
          peak: 0.05 + Math.random() * 0.07
        });
      }
    }

    function draw(ctx, L, W, H) {
      if (!settings.particles) return;
      const pulse = getPulse();
      const dt = getDt();
      const rate = getPlaying()
        ? (0.05 + settings.intensity * 0.14 + pulse * 1.2)
        : 0.04;
      if (smoke.length < MAX_SMOKE && Math.random() < rate * dt) {
        spawn(pulse, dt, L, H);
      }
      for (let i = smoke.length - 1; i >= 0; i--) {
        const s = smoke[i];
        s.life -= dt;
        s.y += s.vy * dt;
        s.x += (s.vx + Math.sin(s.life * SWAY_FREQ) * 0.35) * dt;
        if (s.life <= 0) { smoke[i] = smoke[smoke.length - 1]; smoke.pop(); continue; }
        const t = 1 - (s.life / s.maxLife);
        const alpha = Math.sin(Math.PI * t) * s.peak;
        if (alpha <= MIN_ALPHA) continue;
        const rad = s.r * (0.55 + t * 1.7);
        ctx.globalCompositeOperation = 'source-over';
        const g = ctx.createRadialGradient(s.x, s.y, rad * 0.15, s.x, s.y, rad);
        g.addColorStop(0, `rgba(${s.col}, ${alpha})`);
        g.addColorStop(1, `rgba(${s.col}, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(s.x - rad, s.y - rad, rad * 2, rad * 2);
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    return { draw };
  }

  return { create };
});