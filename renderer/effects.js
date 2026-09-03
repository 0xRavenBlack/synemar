(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./color'), require('./util'));
  } else {
    root.Fx = factory(root.ColorUtil, root.Util);
  }
})(typeof self !== 'undefined' ? self : this, function (Color, Util) {
  const { clamp } = Util;
  const { rgbaStr, shiftHue, mixColor } = Color;

  const DEFAULTS = {
    HUE_PERIOD_MS: 220000,
    HUE_GRADIENT_OFFSET: 0.08,
    SWAY_PERIOD_MS: 900,
    SWAY_MAX: 26,
    SWAY_FRACTION: 0.012,
    BAR_MIN_GAP: 0.6,
    BAR_GAP_FACTOR: 0.3,
    BAR_MIN_WIDTH: 0.8,
    BAR_MIN_HEIGHT: 2,
    BAR_UP_DECAY: 0.65,
    BAR_DOWN_DECAY: 0.16,
    BAR_POWER: 1.12,
    PEAK_POWER: 1.05,
    FREQ_IDX_POWER: 1.32,
    PEAK_DECAY_PER_FRAME: 0.006,
    PEAK_CAP_THRESHOLD: 2,
    PEAK_CAP_HEIGHT: 3,
    PEAK_CAP_WIDTH: 3,
    PEAK_CAP_RADIUS: 1.5,
    PEAK_TOP_ALPHA: 0.92,
    BAR_CORNER_RADIUS: 5,
    BAR_SHADOW_BLUR: 10,
    BAR_SHADOW_ALPHA_BASE: 0.3,
    BAR_SHADOW_ALPHA_PULSE: 0.3,
    SPECTRUM_LINE_ALPHA_BASE: 0.28,
    SPECTRUM_LINE_ALPHA_PULSE: 0.2,
    SPECTRUM_MIX_TOP: 0.5,
    CIRCLE_CENTER_Y: 0.5,
    CIRCLE_BASE_RADIUS_FACTOR: 0.12,
    CIRCLE_MAX_RADIUS_FACTOR: 0.44,
    CIRCLE_GAP_FACTOR: 0.5,
    CIRCLE_MIN_GAP: 0.5,
    CIRCLE_MIN_WIDTH: 0.6,
    CIRCLE_MIN_HEIGHT: 2,
    CIRCLE_BAR_WIDTH_FACTOR: 2.2,
    CIRCLE_CORNER_RADIUS: 5,
    CIRCLE_BAR_ALPHA: 0.55,
    CIRCLE_START_ANGLE: -0.5,
    CIRCLE_RING_LINE_WIDTH: 2,
    CIRCLE_RING_ALPHA_BASE: 0.5,
    CIRCLE_RING_ALPHA_PULSE: 0.3,
    WAVEFORM_AMP_FACTOR: 0.055,
    WAVEFORM_AMP_MAX: 46,
    WAVEFORM_IDLE_SCALE: 0.5,
    WAVEFORM_BEAT_AMP: 2.2,
    WAVEFORM_LINE_WIDTH: 2.5,
    WAVEFORM_SHADOW_BLUR: 18,
    WAVEFORM_FILL_ALPHA_BASE: 0.10,
    WAVEFORM_FILL_ALPHA_PULSE: 0.08,
    WAVEFORM_JOIN_OFFSET: 8,
    WAVEFORM_IDLE_SPEED: 0.05,
    WAVEFORM_IDLE_PERIOD: 1400,
    WAVEFORM_IDLE_AMPLITUDE: 0.03,
    BEAM_ALPHA_BASS_MULT: 1.8,
    BEAM_ALPHA_PULSE_MULT: 0.35,
    BEAM_ALPHA_MAX: 0.5,
    BEAM_TOP_ALPHA: 0.9,
    BEAM_MID_ALPHA: 0.25,
    BEAM_NARROW_TOP: 0.62,
    BEAM_NARROW_BOTTOM: 0.38,
    PANEL_BG: 'rgba(0, 0, 0, 0)',
    PANEL_EDGE_ALPHA_BASE: 0,
    PANEL_EDGE_ALPHA_LEVEL: 0,
    PANEL_EDGE_ALPHA_FALLBACK: 0,
    PANEL_STROKE_ALPHA: 0,
    RING_DECAY_BASE: 0.93,
    RING_MIN_ALPHA: 0.01,
    RING_SHADOW_BLUR: 20,
    RING_ASPECT: 1.6,
    RING_LINE_MIN: 0.5,
    RING_SPAWN_RADIUS: 20,
    RING_SPAWN_SPEED: 9,
    RING_SPAWN_ALPHA: 0.5,
    RING_SPAWN_LINE_WIDTH: 3,
    SCANLINE_SPEED: 0.6,
    SCANLINE_HEIGHT: 80,
    SCANLINE_ALPHA_BASE: 0.045,
    SCANLINE_ALPHA_LEVEL: 0.05,
    VIGNETTE_PULSE_ALPHA: 0.25,
    VIGNETTE_PULSE_MAX: 0.3,
    VIGNETTE_INNER_FACTOR: 0.32,
    VIGNETTE_OUTER_FACTOR: 0.78,
    VIGNETTE_ALPHA: 0.34,
    VIGNETTE_TINT: 0.25,
    GLOW_ALPHA_BASE: 0.10,
    GLOW_ALPHA_BASS: 0.08,
    GLOW_ALPHA_PULSE: 0.10,
    GLOW_ALPHA_MID: 0.03,
    GLOW_CENTER_Y: 0.34,
    GLOW_RADIUS_FACTOR: 0.75,
    AURORA_MUSIC_BASE: 0.05,
    AURORA_MUSIC_LEVEL: 0.14,
    AURORA_BLOB_ALPHA: 0.06,
    AURORA_TOP_MULT: 0.6,
    AURORA_CENTER_Y: 0.42,
    IDLE_RING_SPEED: 28,
    IDLE_RING_BASE: 30,
    IDLE_RING_STEP: 60,
    IDLE_RING_ALPHA: 0.10,
    IDLE_RING_ASPECT: 1.6,
    IDLE_RING_WOBBLE: 0.18,
    IDLE_CENTER_Y: 0.42,
    CRT_LINES_SPACING: 4,
    CRT_LINES_ALPHA: 0.12,
    GRAIN_SIZE: 128,
    GRAIN_ALPHA: 0.045,
    GRAIN_SCALE: 4,
    WOBBLE_COUNT: 6,
    WOBBLE_MAX_OFFSET: 8,
    WOBBLE_BAND_HEIGHT: 6,
    WOBBLE_ALPHA: 0.015
  };

  const displayBars = [];
  const peakVals = [];
  const rings = [];
  let waveformX = null;
  let waveformY = null;
  let scanY = 0;
  let grainCanvas = null;
  let grainCtx = null;
  let grainFrame = 0;

  function ensureBars(n) {
    if (displayBars.length > n) displayBars.length = n;
    while (displayBars.length < n) displayBars.push(0);
    if (peakVals.length > n) peakVals.length = n;
    while (peakVals.length < n) peakVals.push(0);
  }

  function roundRect(vctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h));
    vctx.beginPath();
    vctx.moveTo(x + rr, y);
    vctx.arcTo(x + w, y, x + w, y + h, rr);
    vctx.arcTo(x + w, y + h, x, y + h, rr);
    vctx.arcTo(x, y + h, x, y, rr);
    vctx.arcTo(x, y, x + w, y, rr);
    vctx.closePath();
  }

  function drawAurora(vctx, L, W, H, now, opts) {
    const d = DEFAULTS;
    if (!opts.settings.aurora) return;
    const t = now / 1000;
    const cx = W / 2, cy = H * d.AURORA_CENTER_Y;
    const big = Math.max(W, H);
    const blobs = [
      { c: opts.fx.vizTop, dx: Math.sin(t * 0.5) * W * 0.2, dy: Math.cos(t * 0.7) * H * 0.09, r: big * 0.42 },
      { c: opts.fx.accent, dx: Math.cos(t * 0.35 + 2) * W * 0.18, dy: Math.sin(t * 0.5 + 1) * H * 0.11, r: big * 0.34 },
      { c: opts.fx.vizBot, dx: Math.sin(t * 0.2 + 4) * W * 0.24, dy: Math.cos(t * 0.4 + 3) * H * 0.08, r: big * 0.38 }
    ];
    const music = d.AURORA_MUSIC_BASE + (opts.lv.mid + opts.lv.hi) * opts.settings.intensity * d.AURORA_MUSIC_LEVEL;
    for (const b of blobs) {
      const g = vctx.createRadialGradient(cx + b.dx, cy + b.dy, 0, cx + b.dx, cy + b.dy, b.r);
      g.addColorStop(0, rgbaStr(b.c, d.AURORA_BLOB_ALPHA + (b.c === opts.fx.vizTop ? music * d.AURORA_TOP_MULT : 0)));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      vctx.fillStyle = g;
      vctx.fillRect(0, 0, W, H);
    }
  }

  function drawBeams(vctx, L, W, H, now, opts) {
    const d = DEFAULTS;
    const alpha = clamp(opts.lv.bass * d.BEAM_ALPHA_BASS_MULT + opts.pulse * d.BEAM_ALPHA_PULSE_MULT, 0, d.BEAM_ALPHA_MAX);
    if (alpha < 0.01) return;
    const g = vctx.createLinearGradient(0, L.baseY, 0, L.bandTop);
    g.addColorStop(0, rgbaStr(opts.fx.vizTop, alpha * d.BEAM_TOP_ALPHA));
    g.addColorStop(0.55, rgbaStr(opts.fx.accent, alpha * d.BEAM_MID_ALPHA));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    vctx.fillStyle = g;
    vctx.beginPath();
    vctx.moveTo(L.bx, L.baseY);
    vctx.lineTo(L.bx + L.bw, L.baseY);
    vctx.lineTo(L.bx + L.bw * d.BEAM_NARROW_TOP, L.bandTop);
    vctx.lineTo(L.bx + L.bw * d.BEAM_NARROW_BOTTOM, L.bandTop);
    vctx.closePath();
    vctx.fill();
  }

  function drawBandPanel(vctx, L, W, H, now, opts) {
    const d = DEFAULTS;
    vctx.fillStyle = d.PANEL_BG;
    vctx.fillRect(L.bx - 12, L.bandTop - 16, L.bw + 24, L.baseY - L.bandTop + 32);
    const edge = vctx.createLinearGradient(0, L.bandTop - 16, L.bw, L.bandTop - 16);
    edge.addColorStop(0, `rgba(255,255,255,${d.PANEL_EDGE_ALPHA_FALLBACK})`);
    edge.addColorStop(0.5, `rgba(255,255,255,${d.PANEL_EDGE_ALPHA_BASE + opts.lv.mid * d.PANEL_EDGE_ALPHA_LEVEL})`);
    edge.addColorStop(1, `rgba(255,255,255,${d.PANEL_EDGE_ALPHA_FALLBACK})`);
    vctx.fillStyle = edge;
    vctx.fillRect(L.bx - 0, L.bandTop - 16, L.bw, 1);
    vctx.strokeStyle = `rgba(255,255,255,${d.PANEL_STROKE_ALPHA})`;
    vctx.lineWidth = 1;
    vctx.strokeRect(L.bx - 12 + 0.5, L.bandTop - 15.5, L.bw + 23, L.baseY - L.bandTop + 30);
  }

  function drawSpectrum(vctx, L, W, H, live, now, opts) {
    const d = DEFAULTS;
    const n = opts.settings.barCount;
    ensureBars(n);

    const barW = L.bw / n;
    const gap = Math.max(d.BAR_MIN_GAP, barW * d.BAR_GAP_FACTOR);
    const hueAmount = opts.settings.hueShift ? (now / d.HUE_PERIOD_MS) % 1 : 0;
    const dBytes = opts.curFft >> 1;

    const grad = vctx.createLinearGradient(0, L.baseY, 0, L.bandTop);
    grad.addColorStop(0, shiftHue(opts.settings.vizBottom, hueAmount));
    grad.addColorStop(0.5, shiftHue(opts.settings.vizTop, hueAmount + d.HUE_GRADIENT_OFFSET));
    grad.addColorStop(1, shiftHue(opts.settings.vizTop, hueAmount));

    const sway = Math.sin(now / d.SWAY_PERIOD_MS) * Math.min(L.bw * d.SWAY_FRACTION, d.SWAY_MAX);

    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const idx = Math.min(dBytes - 1, Math.floor(Math.pow(t, d.FREQ_IDX_POWER) * dBytes));
      const hold = !live && opts.scrubbing;
      const target = live && dBytes ? opts.freqByte[idx] / 255 : (hold ? displayBars[i] : 0);
      const source = displayBars[i];
      const grow = target > source;
      displayBars[i] += (target - source) * (grow ? d.BAR_UP_DECAY : d.BAR_DOWN_DECAY);
      displayBars[i] = clamp(displayBars[i], 0, 1);

      if (displayBars[i] > peakVals[i]) peakVals[i] = displayBars[i];
      else if (!hold) peakVals[i] = clamp(peakVals[i] - d.PEAK_DECAY_PER_FRAME * opts.dt, 0, 1);

      const h = Math.max(d.BAR_MIN_HEIGHT, Math.pow(displayBars[i], d.BAR_POWER) * L.maxH);
      const ph = Math.max(0, Math.pow(peakVals[i], d.PEAK_POWER) * L.maxH);
      const centerDist = (t - 0.5) * 2;
      const bend = centerDist * centerDist * sway;
      const x = L.bx + i * barW + gap / 2 + bend;
      const w = Math.max(d.BAR_MIN_WIDTH, barW - gap);

      vctx.fillStyle = grad;
      vctx.shadowColor = rgbaStr(opts.fx.accent, d.BAR_SHADOW_ALPHA_BASE + opts.pulse * d.BAR_SHADOW_ALPHA_PULSE);
      vctx.shadowBlur = d.BAR_SHADOW_BLUR;
      roundRect(vctx, x, L.baseY - h, w, h, Math.min(w / 2, d.BAR_CORNER_RADIUS));
      vctx.fill();

      vctx.shadowBlur = 0;
      if (ph > d.PEAK_CAP_THRESHOLD) {
        vctx.fillStyle = `rgba(255,255,255,${d.PEAK_TOP_ALPHA})`;
        roundRect(vctx, x, L.baseY - ph - d.PEAK_CAP_HEIGHT, w, d.PEAK_CAP_HEIGHT, d.PEAK_CAP_RADIUS);
        vctx.fill();
      }
    }
    vctx.shadowBlur = 0;
    vctx.fillStyle = rgbaStr(mixColor(opts.fx.accent, opts.fx.vizTop, d.SPECTRUM_MIX_TOP), d.SPECTRUM_LINE_ALPHA_BASE + opts.pulse * d.SPECTRUM_LINE_ALPHA_PULSE);
    vctx.fillRect(L.bx, L.baseY - 1, L.bw, 2);
  }

  function drawCircleSpectrum(vctx, W, H, live, now, opts) {
    const d = DEFAULTS;
    const n = opts.settings.barCount;
    ensureBars(n);

    const cx = W / 2;
    const cy = H * d.CIRCLE_CENTER_Y;
    const maxR = Math.min(W, H) * d.CIRCLE_MAX_RADIUS_FACTOR;
    const baseR = Math.min(W, H) * d.CIRCLE_BASE_RADIUS_FACTOR;
    const step = (Math.PI * 2) / n;
    const hueAmount = opts.settings.hueShift ? (now / d.HUE_PERIOD_MS) % 1 : 0;
    const dBytes = opts.curFft >> 1;
    const arclen = (Math.PI * 2 * baseR) / n;
    const barW = Math.max(d.CIRCLE_MIN_WIDTH, arclen * d.CIRCLE_BAR_WIDTH_FACTOR);

    vctx.save();
    vctx.translate(cx, cy);

    vctx.strokeStyle = rgbaStr(opts.fx.accent, d.CIRCLE_RING_ALPHA_BASE + opts.pulse * d.CIRCLE_RING_ALPHA_PULSE);
    vctx.lineWidth = d.CIRCLE_RING_LINE_WIDTH;
    vctx.shadowColor = rgbaStr(opts.fx.accent, 0.8);
    vctx.shadowBlur = d.BAR_SHADOW_BLUR;
    vctx.beginPath();
    vctx.arc(0, 0, baseR, 0, Math.PI * 2);
    vctx.stroke();
    vctx.shadowBlur = 0;

    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      const idx = Math.min(dBytes - 1, Math.floor(Math.pow(t, d.FREQ_IDX_POWER) * dBytes));
      const hold = !live && opts.scrubbing;
      const target = live && dBytes ? opts.freqByte[idx] / 255 : (hold ? displayBars[i] : 0);
      const source = displayBars[i];
      const grow = target > source;
      displayBars[i] += (target - source) * (grow ? d.BAR_UP_DECAY : d.BAR_DOWN_DECAY);
      displayBars[i] = clamp(displayBars[i], 0, 1);

      if (displayBars[i] > peakVals[i]) peakVals[i] = displayBars[i];
      else if (!hold) peakVals[i] = clamp(peakVals[i] - d.PEAK_DECAY_PER_FRAME * opts.dt, 0, 1);

      const h = Math.max(d.CIRCLE_MIN_HEIGHT, Math.pow(displayBars[i], d.BAR_POWER) * maxR);
      const gap = Math.max(d.CIRCLE_MIN_GAP, barW * d.CIRCLE_GAP_FACTOR);
      const bh = Math.max(1, barW - gap);

      const barGrad = vctx.createLinearGradient(baseR, 0, baseR + h, 0);
      barGrad.addColorStop(0, shiftHue(opts.settings.vizBottom, hueAmount));
      barGrad.addColorStop(0.5, shiftHue(opts.settings.vizTop, hueAmount + d.HUE_GRADIENT_OFFSET));
      barGrad.addColorStop(1, shiftHue(opts.settings.vizTop, hueAmount));

      vctx.save();
      vctx.rotate(d.CIRCLE_START_ANGLE + i * step);
      vctx.globalAlpha = d.CIRCLE_BAR_ALPHA;
      vctx.fillStyle = barGrad;
      vctx.shadowColor = rgbaStr(opts.fx.accent, d.BAR_SHADOW_ALPHA_BASE + opts.pulse * d.BAR_SHADOW_ALPHA_PULSE);
      vctx.shadowBlur = d.BAR_SHADOW_BLUR;
      roundRect(vctx, baseR, -bh / 2, h, bh, Math.min(bh / 2, d.CIRCLE_CORNER_RADIUS));
      vctx.fill();
      vctx.shadowBlur = 0;

      const ph = Math.max(0, Math.pow(peakVals[i], d.PEAK_POWER) * maxR);
      if (ph > d.PEAK_CAP_THRESHOLD) {
        vctx.fillStyle = `rgba(255,255,255,${d.PEAK_TOP_ALPHA})`;
        roundRect(vctx, baseR + h, -bh / 2 - 0.5, d.PEAK_CAP_HEIGHT, bh + 1, d.PEAK_CAP_RADIUS);
        vctx.fill();
      }
      vctx.restore();
    }

    vctx.restore();
  }

  function drawWaveform(vctx, L, W, H, live, now, opts) {
    const d = DEFAULTS;
    const n = opts.curFft;
    if (n < 2) return;
    const amp = Math.min(H * d.WAVEFORM_AMP_FACTOR, d.WAVEFORM_AMP_MAX) * (opts.playing ? 1 : d.WAVEFORM_IDLE_SCALE);
    const beat = 1 + opts.pulse * d.WAVEFORM_BEAT_AMP;
    const count = Math.floor(n / 2);
    if (!waveformX || waveformX.length < count) waveformX = new Float32Array(count);
    if (!waveformY || waveformY.length < count) waveformY = new Float32Array(count);
    const hueAmount = opts.settings.hueShift ? (now / d.HUE_PERIOD_MS) % 1 : 0;
    for (let i = 0; i < count; i++) {
      const idx = i * 2;
      waveformX[i] = L.bx + (idx / (n - 1)) * L.bw;
      const v = live ? (opts.timeByte[idx < n ? idx : i] - 128) / 128 : Math.sin(idx * d.WAVEFORM_IDLE_SPEED + now / d.WAVEFORM_IDLE_PERIOD) * d.WAVEFORM_IDLE_AMPLITUDE;
      waveformY[i] = L.waveY + v * amp * beat;
    }

    vctx.lineWidth = d.WAVEFORM_LINE_WIDTH;
    vctx.strokeStyle = shiftHue(opts.settings.accent, hueAmount);
    vctx.shadowColor = rgbaStr(opts.fx.accent, 0.9);
    vctx.shadowBlur = d.WAVEFORM_SHADOW_BLUR;
    vctx.beginPath();
    for (let i = 0; i < count; i++) {
      if (i === 0) vctx.moveTo(waveformX[i], waveformY[i]);
      else vctx.lineTo(waveformX[i], waveformY[i]);
    }
    vctx.stroke();
    vctx.shadowBlur = 0;

    vctx.globalAlpha = d.WAVEFORM_FILL_ALPHA_BASE + opts.pulse * d.WAVEFORM_FILL_ALPHA_PULSE;
    vctx.fillStyle = shiftHue(opts.settings.accent, hueAmount);
    vctx.beginPath();
    vctx.moveTo(waveformX[0], waveformY[0]);
    for (let i = 1; i < count; i++) vctx.lineTo(waveformX[i], waveformY[i]);
    vctx.lineTo(L.bx + L.bw, L.baseY - d.WAVEFORM_JOIN_OFFSET);
    vctx.lineTo(L.bx, L.baseY - d.WAVEFORM_JOIN_OFFSET);
    vctx.closePath();
    vctx.fill();
    vctx.globalAlpha = 1;
  }

  function drawRings(vctx, L, W, H, now, opts) {
    const d = DEFAULTS;
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.radius += r.speed * opts.dt;
      r.alpha *= Math.pow(d.RING_DECAY_BASE, opts.dt);
      if (r.alpha < d.RING_MIN_ALPHA || r.radius > Math.max(W, H)) { rings[i] = rings[rings.length - 1]; rings.pop(); continue; }
      vctx.strokeStyle = rgbaStr(r.c, r.alpha);
      vctx.lineWidth = r.lineWidth * r.alpha + d.RING_LINE_MIN;
      vctx.shadowColor = rgbaStr(r.c, r.alpha);
      vctx.shadowBlur = d.RING_SHADOW_BLUR;
      vctx.beginPath();
      vctx.ellipse(W / 2, L.waveY, r.radius * d.RING_ASPECT, r.radius, 0, 0, Math.PI * 2);
      vctx.stroke();
      vctx.shadowBlur = 0;
    }
  }

  function drawScanline(vctx, L, W, H, now, opts) {
    const d = DEFAULTS;
    scanY = (scanY + d.SCANLINE_SPEED * opts.dt) % (H + d.SCANLINE_HEIGHT * 2);
    const y = scanY - d.SCANLINE_HEIGHT;
    const g = vctx.createLinearGradient(0, y, 0, y + d.SCANLINE_HEIGHT);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, `rgba(255,255,255,${d.SCANLINE_ALPHA_BASE + opts.lv.hi * d.SCANLINE_ALPHA_LEVEL})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    vctx.fillStyle = g;
    vctx.fillRect(0, y, W, d.SCANLINE_HEIGHT);
  }

  function drawVignette(vctx, L, W, H, now, opts) {
    const d = DEFAULTS;
    const pulseA = clamp(opts.pulse * d.VIGNETTE_PULSE_ALPHA, 0, d.VIGNETTE_PULSE_MAX);
    const g = vctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * d.VIGNETTE_INNER_FACTOR, W / 2, H * 0.45, Math.max(W, H) * d.VIGNETTE_OUTER_FACTOR);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${d.VIGNETTE_ALPHA + pulseA})`);
    vctx.fillStyle = g;
    vctx.fillRect(0, 0, W, H);
    if (pulseA > 0.02) {
      vctx.fillStyle = rgbaStr(opts.fx.accent, pulseA * d.VIGNETTE_TINT);
      vctx.fillRect(0, 0, W, H);
    }
  }

  function drawGlowBackdrop(vctx, L, W, H, now, opts) {
    const d = DEFAULTS;
    const grad = vctx.createRadialGradient(W / 2, H * d.GLOW_CENTER_Y, 0, W / 2, H * d.GLOW_CENTER_Y, Math.max(W, H) * d.GLOW_RADIUS_FACTOR);
    grad.addColorStop(0, rgbaStr(opts.fx.accent, d.GLOW_ALPHA_BASE + opts.lv.bass * d.GLOW_ALPHA_BASS + opts.pulse * d.GLOW_ALPHA_PULSE));
    grad.addColorStop(0.45, rgbaStr(opts.fx.accent, d.GLOW_ALPHA_MID));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    vctx.fillStyle = grad;
    vctx.fillRect(0, 0, W, H);
  }

  function drawIdle(vctx, L, W, H, now, opts) {
    const d = DEFAULTS;
    const t = now / 1000;
    for (let i = 0; i < 3; i++) {
      const r = ((t * d.IDLE_RING_SPEED) % 190) + d.IDLE_RING_BASE + i * d.IDLE_RING_STEP;
      vctx.strokeStyle = rgbaStr(opts.fx.accent, d.IDLE_RING_ALPHA);
      vctx.lineWidth = 1;
      vctx.beginPath();
      vctx.ellipse(W / 2, H * d.IDLE_CENTER_Y, r * d.IDLE_RING_ASPECT, r, Math.sin(t * 0.3 + i) * d.IDLE_RING_WOBBLE, 0, Math.PI * 2);
      vctx.stroke();
    }
  }

  function drawCrtScanlines(vctx, W, H) {
    const d = DEFAULTS;
    vctx.fillStyle = `rgba(0,0,0,${d.CRT_LINES_ALPHA})`;
    for (let y = 0; y < H; y += d.CRT_LINES_SPACING) {
      vctx.fillRect(0, y, W, 1);
    }
  }

  function drawFilmGrain(vctx, W, H, now) {
    const d = DEFAULTS;
    grainFrame++;
    if (!grainCanvas || grainFrame % 3 === 0) {
      const sz = d.GRAIN_SIZE;
      if (!grainCanvas) {
        grainCanvas = document.createElement('canvas');
        grainCanvas.width = sz;
        grainCanvas.height = sz;
        grainCtx = grainCanvas.getContext('2d');
      }
      const img = grainCtx.createImageData(sz, sz);
      const buf = img.data;
      for (let i = 0; i < buf.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        buf[i] = v;
        buf[i + 1] = v;
        buf[i + 2] = v;
        buf[i + 3] = 255;
      }
      grainCtx.putImageData(img, 0, 0);
    }
    vctx.save();
    vctx.globalAlpha = d.GRAIN_ALPHA;
    vctx.globalCompositeOperation = 'overlay';
    vctx.imageSmoothingEnabled = false;
    const scale = d.GRAIN_SCALE;
    const repeats = Math.ceil(W / (d.GRAIN_SIZE * scale)) + 1;
    const rows = Math.ceil(H / (d.GRAIN_SIZE * scale)) + 1;
    for (let rx = 0; rx < repeats; rx++) {
      for (let ry = 0; ry < rows; ry++) {
        vctx.drawImage(grainCanvas, rx * d.GRAIN_SIZE * scale, ry * d.GRAIN_SIZE * scale, d.GRAIN_SIZE * scale, d.GRAIN_SIZE * scale);
      }
    }
    vctx.restore();
  }

  function drawVhsWobble(vctx, W, H, now) {
    const d = DEFAULTS;
    const t = now / 1000;
    for (let i = 0; i < d.WOBBLE_COUNT; i++) {
      const seed = Math.sin(i * 127.1 + t * 0.7) * 43758.5453;
      const frac = seed - Math.floor(seed);
      const y = frac * H;
      const h = d.WOBBLE_BAND_HEIGHT + (Math.sin(i * 53.3 + t * 1.1) * 0.5 + 0.5) * 4;
      const bright = Math.sin(i * 37.7 + t * 2.3) > 0.3;
      vctx.fillStyle = bright
        ? `rgba(255,255,255,${d.WOBBLE_ALPHA * (1.5 + Math.sin(i + t) * 0.5)})`
        : `rgba(0,0,0,${d.WOBBLE_ALPHA * (2 + Math.sin(i + t) * 0.8)})`;
      vctx.fillRect(0, y, W, h);
    }
  }

  function spawnRing(c) {
    const d = DEFAULTS;
    rings.push({
      radius: d.RING_SPAWN_RADIUS,
      speed: d.RING_SPAWN_SPEED,
      alpha: d.RING_SPAWN_ALPHA,
      lineWidth: d.RING_SPAWN_LINE_WIDTH,
      c
    });
  }

  return {
    DEFAULTS,
    drawAurora,
    drawBeams,
    drawBandPanel,
    drawSpectrum,
    drawCircleSpectrum,
    drawWaveform,
    drawRings,
    drawScanline,
    drawVignette,
    drawGlowBackdrop,
    drawIdle,
    drawCrtScanlines,
    drawFilmGrain,
    drawVhsWobble,
    spawnRing
  };
});