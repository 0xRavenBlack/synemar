(() => {
  const $ = (s) => document.querySelector(s);

  const vizCanvas = $('#viz');
  const vctx = vizCanvas.getContext('2d');
  const scrubCanvas = $('#scrubber');
  const sctx = scrubCanvas.getContext('2d');

  const CROSSFADE_MS = 900;
  const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'];
  const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'm4v', 'mkv'];
  const bgVideoEls = [$('#bg-video'), $('#bg-video-2')];
  bgVideoEls.forEach((el) => { el.style.transition = 'none'; });

  const body = document.body;
  const marquee = $('#marquee');
  const titleEl = $('#title');
  const customTextEl = $('#custom-text');
  const artistEl = $('#artist');
  const albumEl = $('#album');
  const subSep = $('#sub-sep');
  const brandEl = $('#brand');
  const metaSubEl = $('#meta-sub');
  const playBtn = $('#btn-play');
  const muteBtn = $('#btn-mute');
  const tileTime = $('#t-current');
  const totalTime = $('#t-total');
  const emptyEl = $('#empty');
  const volumeSlider = $('#volume');

  const appSettings = window.Settings.create({
    marquee,
    customText: customTextEl
  });
  const settings = appSettings.settings;

  const state = {
    scrubbing: false,
    wasPlaying: false,
    previewOffset: null,
    track: null,
    fullscreen: false
  };

  const manager = window.PlaylistManager.create();

  const smoke = [];
  const particles = [];
  let pulse = 0;
  let tremor = 0;
  let lastFrameTs = 0;
  let dt = 1;

  const MAX_PARTICLES = 760;
  const MAX_SMOKE = 240;

  const { clamp, fmtTime } = window.Util;

  const { hexToRgb, mixColor, rgbaStr } = window.ColorUtil;

  const fx = { accent: hexToRgb(settings.accent), vizTop: hexToRgb(settings.vizTop), vizBot: hexToRgb(settings.vizBottom), bg: hexToRgb(settings.bgColor) };
  function refreshFx() {
    fx.accent = hexToRgb(settings.accent);
    fx.vizTop = hexToRgb(settings.vizTop);
    fx.vizBot = hexToRgb(settings.vizBottom);
    fx.bg = hexToRgb(settings.bgColor);
  }

  const audioEngine = window.AudioEngine.init({
    settings,
    onKick: () => {
      pulse = 1;
      tremor = 0.8;
      Fx.spawnRing(mixColor(fx.vizTop, fx.vizBot, Math.random()));
    }
  });
  audioEngine.onEnded(() => {
    updatePlayBtn();
    body.classList.remove('playing');
    advanceAudio();
  });

  const fxOptsCache = {};
  function fxOpts() {
    const o = fxOptsCache;
    o.settings = settings;
    o.fx = fx;
    o.lv = audioEngine.state.lv;
    o.pulse = pulse;
    o.dt = dt;
    o.freqByte = audioEngine.state.freqByte;
    o.timeByte = audioEngine.state.timeByte;
    o.curFft = audioEngine.state.curFft;
    o.playing = audioEngine.state.playing;
    o.scrubbing = state.scrubbing;
    return o;
  }

  const videoBg = window.VideoBg.create({
    manager,
    elements: bgVideoEls,
    crossfadeMs: CROSSFADE_MS,
    toast: (msg) => ui.toast(msg)
  });

  const recorder = window.Recorder.create({
    settings,
    fx,
    audioEngine,
    getPulse: () => pulse,
    hasVideos: () => videoBg.hasVideos(),
    bgVideoEls,
    vizCanvas,
    brand: brandEl,
    marquee,
    title: titleEl,
    artist: artistEl,
    album: albumEl,
    metaSub: metaSubEl,
    customText: customTextEl,
    isPlayingClass: () => body.classList.contains('playing'),
    toast: (msg) => ui.toast(msg)
  });

  const ui = window.UI.create({
    settings,
    saveSettings: appSettings.save,
    playAudioFile: (p) => playAudioFile(p),
    addVideoFile: (p) => addVideoFile(p),
    audioEngine,
    videoBg,
    getFullscreen: () => state.fullscreen,
    getScrubbing: () => state.scrubbing,
    audioExts: AUDIO_EXTS,
    videoExts: VIDEO_EXTS
  });

  const playlistUI = window.PlaylistUI.create({
    manager,
    toast: (msg) => ui.toast(msg),
    audioExts: AUDIO_EXTS,
    videoExts: VIDEO_EXTS,
    onSelectAudio: () => {},
    onSelectVideo: () => videoBg.apply(),
    onImport: () => {}
  });

  appSettings.wire({ audioEngine, videoBg, ui });

  manager.onAudioChanged = (track) => {
    if (track) playTrack(track);
  };
  manager.onVideoChanged = () => videoBg.apply();
  manager.onListChanged = () => videoBg.apply();

  function currentTime() {
    if (state.scrubbing && state.previewOffset != null) return state.previewOffset;
    return audioEngine.currentTime();
  }

  function play() {
    if (!audioEngine.state.buffer) return;
    audioEngine.play();
    if (audioEngine.state.playing) {
      updatePlayBtn();
      body.classList.add('playing');
    }
  }

  function pause() {
    if (!audioEngine.state.playing) return;
    audioEngine.pause();
    updatePlayBtn();
    body.classList.remove('playing');
  }

  function togglePlay() {
    audioEngine.state.playing ? pause() : play();
  }

  function updatePlayBtn() {
    playBtn.textContent = audioEngine.state.playing ? '\u275A\u275A' : '\u25B6';
    muteBtn.classList.toggle('muted', !!settings.muted);
    muteBtn.textContent = settings.muted ? '\u2715\u266A' : '\u266A';
  }

  const vizBtn = $('#btn-viz');
  const vizBtnIcon = vizBtn.querySelector('.viz-icon');
  const vizBtnLabel = vizBtn.querySelector('.viz-label');
  const VIZ_MODES = {
    bar: { icon: '\u2582\u2584\u2586', label: 'Bar Visualizer' },
    radial: { icon: '\u25C9', label: 'Radial Visualizer' }
  };

  function refreshVizButton() {
    const target = VIZ_MODES[settings.circular ? 'bar' : 'radial'];
    vizBtnIcon.textContent = target.icon;
    vizBtnLabel.textContent = target.label;
  }

  function toggleVisualizer() {
    settings.circular = !settings.circular;
    appSettings.save();
    refreshVizButton();
  }

  function trySafe(fn) {
    try { return fn(); } catch (e) { /* noop */ }
  }

  function buildTrackMeta(payload, duration) {
    const m = (payload.meta || {});
    return { title: m.title || payload.fileName, artist: m.artist || null, album: m.album || null, cover: m.coverDataUrl || null, duration };
  }

  async function loadTrackPayload(payload, autoplay) {
    if (!payload) return false;
    if (payload.error) { ui.toast(payload.error); return false; }
    ui.toast('Decoding…');
    try {
      const ctx = audioEngine.ensureCtx();
      const buffer = await ctx.decodeAudioData(payload.buffer);
      audioEngine.load(buffer);
      state.track = buildTrackMeta(payload, buffer.duration);

      titleEl.textContent = state.track.title;
      artistEl.textContent = state.track.artist || '';
      albumEl.textContent = state.track.album || '';
      artistEl.style.display = state.track.artist || state.track.album ? '' : 'none';
      subSep.style.display = state.track.artist && state.track.album ? '' : 'none';
      totalTime.textContent = fmtTime(buffer.duration);

      marquee.classList.remove('animate');
      void marquee.offsetWidth;
      marquee.classList.add('animate');

      emptyEl.classList.add('hidden');
      body.classList.add('has-track');

      if (autoplay) play();
      ui.toast(`${state.track.title}${state.track.artist ? ' — ' + state.track.artist : ''}`);
      return true;
    } catch (err) {
      ui.toast('Could not decode that file.');
      console.error(err);
      return false;
    }
  }

  async function playTrack(track) {
    if (!track) {
      stopPlayback();
      return;
    }
    const payload = await window.api.readAudioFile(track.path);
    await loadTrackPayload(payload, true);
  }

  function stopPlayback() {
    audioEngine.clear();
    state.scrubbing = false;
    state.previewOffset = null;
    state.track = null;
    titleEl.textContent = '';
    artistEl.textContent = '';
    albumEl.textContent = '';
    artistEl.style.display = 'none';
    subSep.style.display = 'none';
    metaSubEl.textContent = '';
    emptyEl.classList.remove('hidden');
    body.classList.remove('has-track');
    body.classList.remove('playing');
    updatePlayBtn();
  }

  function advanceAudio() {
    if (!manager.state.audioTracks.length) return;
    manager.nextAudio();
  }

  async function playAudioFile(path) {
    if (!path) return;
    const existingAtIndex = manager.state.audioTracks.findIndex((t) => t.path === path);
    if (existingAtIndex >= 0) {
      if (manager.state.currentAudioIndex !== existingAtIndex) {
        manager.selectAudioAt(existingAtIndex);
      } else {
        const payload = await window.api.readAudioFile(path);
        await loadTrackPayload(payload, true);
      }
    } else {
      const added = manager.addAudioTrack(path);
      const addedAt = added ? manager.state.audioTracks.findIndex((t) => t.path === path) : -1;
      if (addedAt < 0) return;
      manager.selectAudioAt(addedAt);
    }
    playlistUI.renderList('audio');
  }

  function addVideoFile(path) {
    if (!path) return;
    manager.addVideoTrack(path);
    videoBg.apply();
    playlistUI.renderList('video');
  }

  async function openTrack() {
    const payload = await window.api.selectAudio();
    if (payload && payload.path) {
      await playAudioFile(payload.path);
    } else if (payload) {
      await loadTrackPayload(payload, true);
    }
  }

  async function restoreAll() {
    manager.load();
    manager.migrateFromLegacy();
    videoBg.apply();

    const audio = manager.currentAudio();
    if (audio) {
      const payload = await window.api.readAudioFile(audio.path);
      if (payload && !payload.error) {
        await loadTrackPayload(payload, false);
      }
    }
  }

  function updateClock() {
    if (!audioEngine.state.buffer) { tileTime.textContent = '0:00'; return; }
    tileTime.textContent = fmtTime(currentTime());
  }

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

  function drawParticles(L, W, H, now, stepping) {
    if (!settings.particles) return;
    const spawn = audioEngine.state.playing
      ? (0.9 + settings.intensity * 2.6 + pulse * 32)
      : 0.25;
    if (spawn > 0 && particles.length < MAX_PARTICLES && Math.random() < spawn * 0.045 * dt) {
      const count = 1 + Math.floor(Math.random() * 3) + (pulse > 0.6 ? 4 : 0);
      const burst = Math.min(MAX_PARTICLES - particles.length, count);
      for (let k = 0; k < burst; k++) {
        const x = L.bx + Math.random() * L.bw;
        particles.push({
          x,
          y: L.baseY - Math.random() * H * 0.1,
          vx: (Math.random() - 0.5) * 0.7,
          vy: -(0.6 + Math.random() * 1.6 + pulse * 2.4),
          life: 180,
          maxLife: 180,
          r: 1.4 + Math.random() * 4.2,
          shape: randomShape(),
          rot: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 0.09,
          c: Math.random() < 0.5 ? fx.vizTop : (Math.random() < 0.5 ? fx.accent : fx.vizBot),
          bright: Math.random() < 0.12
        });
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.x += (p.vx + Math.sin(p.life * 0.12) * 0.5) * dt;
      p.y += p.vy * dt;
      if (p.life <= 0) { particles[i] = particles[particles.length - 1]; particles.pop(); continue; }
      const a = (p.life / p.maxLife);
      const scale = p.r * (0.7 + a * 0.5);
      vctx.globalCompositeOperation = 'lighter';
      vctx.fillStyle = p.bright ? 'rgba(255,255,255,0.85)' : rgbaStr(p.c, a * 0.75);
      vctx.save();
      vctx.translate(p.x, p.y);
      p.rot += p.vr * dt;
      if (p.shape !== 'dot') vctx.rotate(p.rot);
      traceShape(vctx, p.shape, scale);
      vctx.fill();
      vctx.restore();
      vctx.globalCompositeOperation = 'source-over';
    }
  }

  function drawSmoke(L, W, H, now) {
    if (!settings.particles) return;
    const smokeSpawn = audioEngine.state.playing
      ? (0.05 + settings.intensity * 0.14 + pulse * 1.2)
      : 0.04;
    if (smoke.length < MAX_SMOKE && Math.random() < smokeSpawn * dt) {
      const count = 1 + (pulse > 0.6 ? Math.floor(Math.random() * 2) : 0);
      for (let k = 0; k < count; k++) {
        const col = Math.random() < 0.7 ? '255,255,255' : `${fx.accent.r},${fx.accent.g},${fx.accent.b}`;
        smoke.push({
          x: L.bx + Math.random() * L.bw,
          y: L.baseY + Math.random() * H * 0.04,
          vx: (Math.random() - 0.5) * 0.25,
          vy: -(0.08 + Math.random() * 0.24),
          life: 320,
          maxLife: 320,
          r: 6 + Math.random() * 14,
          col,
          peak: 0.05 + Math.random() * 0.07
        });
      }
    }
    for (let i = smoke.length - 1; i >= 0; i--) {
      const s = smoke[i];
      s.life -= dt;
      s.y += s.vy * dt;
      s.x += (s.vx + Math.sin(s.life * 0.012) * 0.35) * dt;
      if (s.life <= 0) { smoke[i] = smoke[smoke.length - 1]; smoke.pop(); continue; }
      const t = 1 - (s.life / s.maxLife);
      const alpha = Math.sin(Math.PI * t) * s.peak;
      if (alpha <= 0.004) continue;
      const rad = s.r * (0.55 + t * 1.7);
      vctx.globalCompositeOperation = 'source-over';
      const g = vctx.createRadialGradient(s.x, s.y, rad * 0.15, s.x, s.y, rad);
      g.addColorStop(0, `rgba(${s.col}, ${alpha})`);
      g.addColorStop(1, `rgba(${s.col}, 0)`);
      vctx.fillStyle = g;
      vctx.fillRect(s.x - rad, s.y - rad, rad * 2, rad * 2);
      vctx.globalCompositeOperation = 'source-over';
    }
  }

  let uiDz = 0;
  function layout(W, H) {
    const dockGone = body.classList.contains('no-dock') || body.classList.contains('hideui');
    const target = dockGone ? Math.min(H * 0.06, 80) : 0;
    uiDz += (target - uiDz) * 0.08;
    return {
      bx: 24,
      bw: W - 48,
      bandTop: H * 0.56 + uiDz,
      baseY: H * 0.87 + uiDz,
      waveY: H * 0.735 + uiDz,
      maxH: Math.max(80, Math.min(H * 0.30, 250))
    };
  }

  function drawMusic(L, W, H, live, now) {
    audioEngine.analyzeSpectrum(live);
    const o = fxOpts();
    Fx.drawBandPanel(vctx, L, W, H, now, o);
    Fx.drawBeams(vctx, L, W, H, now, o);
    if (settings.circular) {
      Fx.drawCircleSpectrum(vctx, W, H, live, now, o);
    } else {
      Fx.drawSpectrum(vctx, L, W, H, live, now, o);
    }
    Fx.drawWaveform(vctx, L, W, H, live, now, o);
    Fx.drawRings(vctx, L, W, H, now, o);
  }

  function drawScrubber() {
    const rect = scrubCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(rect.width), H = Math.round(rect.height);
    if (scrubCanvas.width !== W * dpr || scrubCanvas.height !== H * dpr) {
      scrubCanvas.width = W * dpr;
      scrubCanvas.height = H * dpr;
    }
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.clearRect(0, 0, W, H);

    const dur = audioEngine.state.buffer ? audioEngine.state.buffer.duration : 0;
    const peaks = audioEngine.state.peaks;
    if (!peaks || !dur) {
      sctx.fillStyle = 'rgba(255,255,255,0.05)';
      sctx.fillRect(0, 0, W, H);
    } else {
      const pairs = peaks.length / 2;
      const mid = H / 2;
      const cursor = state.scrubbing && state.previewOffset != null ? state.previewOffset : (audioEngine.state.buffer ? currentTime() : 0);
      const cursorX = clamp(cursor / dur, 0, 1) * W;
      const amp = H * 0.42;
      const step = W / pairs;
      for (let i = 0; i < pairs; i++) {
        const min = peaks[i * 2], max = peaks[i * 2 + 1];
        const x = i * step;
        const top = mid - Math.max(1, Math.abs(max) * amp);
        const bot = mid + Math.max(1, Math.abs(min) * amp);
        const w = Math.max(1, step * 0.62);
        const played = x < cursorX;
        sctx.fillStyle = played ? rgbaStr(fx.accent, 0.9) : 'rgba(255,255,255,0.16)';
        sctx.fillRect(x, top, w, Math.max(1, bot - top));
      }
      sctx.save();
      sctx.globalAlpha = 0.22;
      sctx.fillRect(0, 0, cursorX, H);
      sctx.restore();
      sctx.strokeStyle = 'rgba(255,255,255,0.9)';
      sctx.lineWidth = 2;
      sctx.beginPath();
      sctx.moveTo(cursorX, 2);
      sctx.lineTo(cursorX, H - 2);
      sctx.stroke();
      sctx.fillStyle = 'rgba(255,255,255,0.95)';
      sctx.beginPath();
      sctx.arc(cursorX, H / 2, 4.5, 0, Math.PI * 2);
      sctx.fill();
    }
  }

  let lastSec = -1;
  function frame(now) {
    requestAnimationFrame(frame);
    dt = lastFrameTs ? clamp((now - lastFrameTs) / (1000 / 60), 0.25, 2.5) : 1;
    lastFrameTs = now;
    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth, H = window.innerHeight;
    if (vizCanvas.width !== W * dpr || vizCanvas.height !== H * dpr) {
      vizCanvas.width = W * dpr;
      vizCanvas.height = H * dpr;
    }
    vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    vctx.clearRect(0, 0, W, H);

    const live = audioEngine.state.playing && !state.scrubbing;
    const L = layout(W, H);
    const o = fxOpts();
    Fx.drawGlowBackdrop(vctx, L, W, H, now, o);

    vctx.save();
    const camT = now / 1000;
    const zoom = 1 + Math.sin(camT * 0.21) * 0.010;
    const ddx = Math.sin(camT * 0.43) * W * 0.010;
    const ddy = Math.cos(camT * 0.31) * H * 0.010;
    vctx.translate(W / 2 + ddx, H / 2 + ddy);
    vctx.scale(zoom, zoom);
    vctx.translate(-W / 2, -H / 2);

    if (settings.aurora) Fx.drawAurora(vctx, L, W, H, now, o);

    if (state.track && audioEngine.state.buffer) {
      drawMusic(L, W, H, live, now);
    } else {
      Fx.drawIdle(vctx, L, W, H, now, o);
    }
    Fx.drawScanline(vctx, L, W, H, now, o);
    drawParticles(L, W, H, now);
    drawSmoke(L, W, H, now);
    vctx.restore();

    Fx.drawVignette(vctx, L, W, H, now, o);
    if (settings.crtScanlines) Fx.drawCrtScanlines(vctx, W, H);
    if (settings.filmGrain) Fx.drawFilmGrain(vctx, W, H, now);
    if (settings.vhsWobble) Fx.drawVhsWobble(vctx, W, H, now);
    drawScrubber();

    if (videoBg.hasVideos()) {
      const pump = audioEngine.state.playing ? 1 + audioEngine.state.lv.bass * 0.16 + pulse * 0.05 : 1.02;
      const shakeBass = settings.shake && audioEngine.state.playing ? Math.max(audioEngine.state.lv.bass * 0.25, tremor * 0.5) : 0;
      const shakeRot = (Math.random() - 0.5) * shakeBass * 0.12;
      bgVideoEls.forEach((el) => {
        el.style.transform = `rotate(${shakeRot.toFixed(6)}rad) scale(${pump.toFixed(4)})`;
      });
    }
    videoBg.update(now);

    pulse *= Math.pow(0.90, dt);
    tremor *= Math.pow(settings.shake ? 0.92 : 0.6, dt);

    const sec = Math.floor(currentTime());
    if (sec !== lastSec) {
      lastSec = sec;
      updateClock();
    }
    updateScrubberAria();
  }

  function setPreviewFromEvent(e) {
    const buffer = audioEngine.state.buffer;
    if (!buffer) return;
    const rect = scrubCanvas.getBoundingClientRect();
    const frac = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    state.previewOffset = frac * buffer.duration;
  }

  function endScrub(commit) {
    if (!state.scrubbing) return;
    state.scrubbing = false;
    const buffer = audioEngine.state.buffer;
    if (commit && buffer) audioEngine.setOffset(clamp(state.previewOffset ?? audioEngine.state.offset, 0, buffer.duration));
    state.previewOffset = null;
    if (commit && buffer && state.wasPlaying) play();
    else updateClock();
  }

  scrubCanvas.addEventListener('pointerdown', (e) => {
    if (!audioEngine.state.buffer) return;
    state.scrubbing = true;
    state.wasPlaying = audioEngine.state.playing;
    if (audioEngine.state.playing) {
      audioEngine.setOffset(audioEngine.currentTime());
      audioEngine.setPlaying(false);
      audioEngine.stopCurrent();
      body.classList.remove('playing');
    }
    try { scrubCanvas.setPointerCapture(e.pointerId); } catch (err) { /* capture may fail if pointer already captured */ }
    setPreviewFromEvent(e);
  });
  scrubCanvas.addEventListener('pointermove', (e) => {
    if (state.scrubbing) setPreviewFromEvent(e);
  });
  scrubCanvas.addEventListener('pointerup', () => { endScrub(true); });
  scrubCanvas.addEventListener('pointercancel', () => { endScrub(false); });
  window.addEventListener('pointerup', () => { endScrub(true); });
  window.addEventListener('pointercancel', () => { endScrub(false); });
  window.addEventListener('blur', () => { endScrub(false); });

  playBtn.addEventListener('click', togglePlay);
  $('#btn-rec').addEventListener('click', () => recorder.toggle());
  $('#btn-rew').addEventListener('click', () => audioEngine.seekTo(currentTime() - 10));
  $('#btn-fwd').addEventListener('click', () => audioEngine.seekTo(currentTime() + 10));
  muteBtn.addEventListener('click', () => {
    settings.muted = !settings.muted;
    audioEngine.updateGain();
    updatePlayBtn();
    appSettings.save();
  });
  volumeSlider.addEventListener('input', () => {
    settings.volume = parseFloat(volumeSlider.value);
    ui.fillRange(volumeSlider);
    if (settings.muted && settings.volume > 0) settings.muted = false;
    audioEngine.updateGain();
    updatePlayBtn();
    appSettings.save();
  });

  $('#btn-pick-vid').addEventListener('click', () => playlistUI.open());

  $('#btn-fs').addEventListener('click', () => window.api.setFullscreen(!state.fullscreen));
  vizBtn.addEventListener('click', toggleVisualizer);

  let lastScrubAriaValue = -1;
  function updateScrubberAria() {
    const buffer = audioEngine.state.buffer;
    const dur = buffer ? buffer.duration : 0;
    const val = dur ? Math.round(((state.scrubbing && state.previewOffset != null ? state.previewOffset : currentTime()) / dur) * 100) : 0;
    if (val !== lastScrubAriaValue) {
      lastScrubAriaValue = val;
      scrubCanvas.setAttribute('aria-valuenow', String(val));
    }
  }

  function trapFocus(e) {
    if (e.key !== 'Tab') return;
    const settingsOpen = ui.isSettingsOpen();
    const playlistOpen = playlistUI.isOpen();
    let container = null;
    if (settingsOpen) container = $('#settings');
    else if (playlistOpen) container = $('#playlist-overlay');
    if (!container) return;
    const focusable = Array.from(container.querySelectorAll('button, input, textarea, select, [tabindex]:not([tabindex="-1"])'))
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !container.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }

  window.addEventListener('keydown', (e) => {
    trapFocus(e);
    const settingsOpen = ui.isSettingsOpen();
    const playlistOpen = playlistUI.isOpen();
    const aEl = document.activeElement || e.target;
    if (aEl && (aEl.tagName === 'INPUT' || aEl.tagName === 'TEXTAREA' || aEl.tagName === 'SELECT')) {
      if (e.key === 'Escape') aEl.blur();
      if (!(e.ctrlKey || e.metaKey)) return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (e.key === 'o' || e.key === 'O')) {
      e.preventDefault();
      openTrack();
      return;
    }
    if (ctrl && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      playlistOpen ? playlistUI.close() : playlistUI.open();
      return;
    }
    if (ctrl && e.key === ',') {
      e.preventDefault();
      settingsOpen ? ui.closeSettings() : ui.openSettings();
      return;
    }
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      togglePlay();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const delta = e.shiftKey ? 60 : 10;
      audioEngine.seekTo(currentTime() + (e.key === 'ArrowLeft' ? -delta : delta));
      return;
    }
    if (e.key === 'm' || e.key === 'M') {
      settings.muted = !settings.muted;
      audioEngine.updateGain();
      updatePlayBtn();
      appSettings.save();
      return;
    }
    if (e.key === 'v' || e.key === 'V') {
      toggleVisualizer();
      return;
    }
    if (e.key === 'l' || e.key === 'L') {
      playlistOpen ? playlistUI.close() : playlistUI.open();
      return;
    }
    if (e.key === 'r' || e.key === 'R') {
      if (!e.ctrlKey && !e.metaKey) {
        recorder.toggle();
        return;
      }
    }
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      toggleFullscreen();
      return;
    }
    if (e.key === 'h' || e.key === 'H') {
      ui.toggleHideUi();
      return;
    }
    if (e.key === 'Escape') {
      const cpickerOpen = !$('#color-picker-overlay').classList.contains('hidden');
      if (cpickerOpen) { $('#cpicker-close').click(); return; }
      if (settingsOpen) ui.closeSettings();
      else if (playlistOpen) playlistUI.close();
      else if (state.fullscreen) toggleFullscreen();
    }
  });

  window.addEventListener('dblclick', (e) => {
    if (e.target.closest('button, input, canvas')) return;
    toggleFullscreen();
  });

  async function toggleFullscreen() {
    state.fullscreen = !state.fullscreen;
    await window.api.setFullscreen(state.fullscreen);
  }

  window.api.onFullscreenChange((flag) => {
    state.fullscreen = flag;
    body.classList.toggle('fullscreen', flag);
  });

  window.api.onMenuAction((action) => {
    if (action === 'open-track') openTrack();
    else if (action === 'playlist') playlistUI.open();
    else if (action === 'settings') ui.openSettings();
  });

  window.api.onOpenFile((filePath) => ui.openExternalPath(filePath));

  window.addEventListener('resize', () => { lastSec = -1; ui.updateSizeNote(); });

  function init() {
    refreshFx();
    appSettings.apply();
    playlistUI.init();
    ui.setupDragDrop();
    ui.setupDrag(marquee, 'marqueeX', 'marqueeY', 'Title');
    ui.setupDrag(customTextEl, 'customX', 'customY', 'Custom text');
    recorder.updateRecButton();
    refreshVizButton();
    requestAnimationFrame(frame);
    window.api.isFullscreen().then((f) => {
      state.fullscreen = !!f;
      body.classList.toggle('fullscreen', !!f);
    });
    appSettings.applyAppIcon();
    restoreAll();
  }

  init();
})();