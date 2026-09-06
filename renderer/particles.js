(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./color'));
  } else {
    root.Particles = factory(root.ColorUtil);
  }
})(typeof self !== 'undefined' ? self : this, function (ColorUtil) {
  const { rgbaStr } = ColorUtil;

  const MAX_PARTICLES = 760;
  const MAX_BURST = 3;
  const BURST_PULSE_FLOOR = 0.6;
  const BURST_PULSE_EXTRA = 4;
  const SPAWN_CHANCE = 0.045;
  const LIFETIME = 180;
  const IDLE_SPAWN_RATE = 0.25;
  const SWAY_FREQ = 0.12;

  function randomShape() {
    const r = Math.random();
    if (r < 0.42) return 'dot';
    if (r < 0.55) return 'heart';
    if (r < 0.64) return 'star';
    if (r < 0.72) return 'diamond';
    if (r < 0.8) return 'triangle';
    if (r < 0.9) return 'square';
    return 'spark';
  }

  function traceShape(ctx, shape, r) {
    const vertex = (i, points, radius) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / points;
      const x = Math.cos(ang) * radius;
      const y = Math.sin(ang) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    };
    ctx.beginPath();
    if (shape === 'dot') {
      ctx.arc(0, 0, r, 0, Math.PI * 2);
    } else if (shape === 'heart') {
      const s = r / 1.55;
      ctx.moveTo(0, s * 0.35);
      ctx.bezierCurveTo(-s * 1.3, -s * 0.9, -s * 0.4, -s * 1.5, 0, -s * 0.58);
      ctx.bezierCurveTo(s * 0.4, -s * 1.5, s * 1.3, -s * 0.9, 0, s * 0.35);
    } else if (shape === 'star') {
      for (let i = 0; i < 10; i++) vertex(i, 5, i % 2 ? r * 0.45 : r);
    } else if (shape === 'diamond') {
      for (let i = 0; i < 4; i++) vertex(i, 4, r);
    } else if (shape === 'triangle') {
      for (let i = 0; i < 3; i++) vertex(i, 3, r);
    } else if (shape === 'square') {
      ctx.rect(-r, -r, r * 2, r * 2);
    } else {
      for (let i = 0; i < 8; i++) vertex(i, 4, i % 2 ? r * 0.22 : r);
    }
    ctx.closePath();
  }

  function create(opts) {
    const { settings, fx, getPlaying, getPulse, getDt } = opts;
    const particles = [];

    function spawnRate(playing, pulse) {
      return playing ? (0.9 + settings.intensity * 2.6 + pulse * 32) : IDLE_SPAWN_RATE;
    }

    function spawnBurst(L, H, pulse) {
      const count = 1 + Math.floor(Math.random() * MAX_BURST) + (pulse > BURST_PULSE_FLOOR ? BURST_PULSE_EXTRA : 0);
      const burst = Math.min(MAX_PARTICLES - particles.length, count);
      for (let k = 0; k < burst; k++) {
        const x = L.bx + Math.random() * L.bw;
        particles.push({
          x,
          y: L.baseY - Math.random() * H * 0.1,
          vx: (Math.random() - 0.5) * 0.7,
          vy: -(0.6 + Math.random() * 1.6 + pulse * 2.4),
          life: LIFETIME,
          maxLife: LIFETIME,
          r: 1.4 + Math.random() * 4.2,
          shape: randomShape(),
          rot: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 0.09,
          c: Math.random() < 0.5 ? fx.vizTop : (Math.random() < 0.5 ? fx.accent : fx.vizBot),
          bright: Math.random() < 0.12
        });
      }
    }

    function draw(ctx, L, W, H) {
      if (!settings.particles) return;
      const pulse = getPulse();
      const dt = getDt();
      const spawn = spawnRate(getPlaying(), pulse);
      if (spawn > 0 && particles.length < MAX_PARTICLES && Math.random() < spawn * SPAWN_CHANCE * dt) {
        spawnBurst(L, H, pulse);
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= dt;
        p.x += (p.vx + Math.sin(p.life * SWAY_FREQ) * 0.5) * dt;
        p.y += p.vy * dt;
        if (p.life <= 0) { particles[i] = particles[particles.length - 1]; particles.pop(); continue; }
        const a = (p.life / p.maxLife);
        const scale = p.r * (0.7 + a * 0.5);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = p.bright ? 'rgba(255,255,255,0.85)' : rgbaStr(p.c, a * 0.75);
        ctx.save();
        ctx.translate(p.x, p.y);
        p.rot += p.vr * dt;
        if (p.shape !== 'dot') ctx.rotate(p.rot);
        traceShape(ctx, p.shape, scale);
        ctx.fill();
        ctx.restore();
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    return { draw };
  }

  return { create };
});