(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const vizCanvas = $('#viz');
  const vctx = vizCanvas.getContext('2d');
  const scrubCanvas = $('#scrubber');
  const sctx = scrubCanvas.getContext('2d');

  const MAX_VIDEOS = 5;
  const CROSSFADE_MS = 900;
  const bgVideoEls = [$('#bg-video'), $('#bg-video-2')];

  const DEFAULT_SETTINGS = {
    bgColor: '#0b0e14',
    bgVideos: [null],
    dim: 0.55,
    blur: 6,
    textColor: '#eef4ff',
    accent: '#5eead4',
    vizTop: '#4ee0ff',
    vizBottom: '#ff2970',
    barCount: 72,
    smoothing: 0.86,
    hueShift: true,
    intensity: 0.8,
    volume: 0.8,
    muted: false,
    shake: true,
    aurora: true,
    particles: true,
    showLogo: true,
    showDock: true,
    marqueeX: 50,
    marqueeY: 29
  };

  function loadSettings() {
    try {
      const raw = localStorage.getItem('neoneq.settings');
      if (!raw) return { ...DEFAULT_SETTINGS };
      const saved = JSON.parse(raw);
      const merged = { ...DEFAULT_SETTINGS, ...saved };
      if (merged.bgVideo && !merged.bgVideos) merged.bgVideos = [merged.bgVideo];
      if (!Array.isArray(merged.bgVideos) || merged.bgVideos.length === 0) merged.bgVideos = [null];
      merged.bgVideos = merged.bgVideos.slice(0, MAX_VIDEOS).map((p) => (typeof p === 'string' ? p : null));
      delete merged.bgImage;
      delete merged.bgImagePath;
      delete merged.bgVideo;
      return merged;
    } catch (e) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  const settings = loadSettings();
  const state = {
    buffer: null,
    peaks: null,
    source: null,
    analyser: null,
    gainNode: null,
    ctx: null,
    baseOffset: 0,
    startCtxTime: 0,
    offset: 0,
    playing: false,
    scrubbing: false,
    wasPlaying: false,
    previewOffset: null,
    track: null,
    hideTimer: null,
    fullscreen: false,
    recording: false,
    recTap: null,
    recTimer: null,
    recCap: null,
    recCapCtx: null
  };

  const lv = { bass: 0, mid: 0, hi: 0 };
  const energyHist = [];
  const smoke = [];
  const particles = [];
  const rings = [];
  const displayBars = [];
  const peakVals = [];
  let pulse = 0;
  let tremor = 0;
  let lastKickTs = 0;
  let scanY = 0;

  const MAX_PARTICLES = 760;
  const MAX_SMOKE = 240;
  const freqByte = new Uint8Array(4096);
  const timeByte = new Uint8Array(8192);
  let curFft = 512;

  const body = document.body;
  const marquee = $('#marquee');
  const titleEl = $('#title');
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
  const settingsEl = $('#settings');
  const toastEl = $('#toast');
  const totalSlider = $('#volume');

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function fmtTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }
  function nextPow2(v) { let p = 16; while (p < v) p <<= 1; return Math.min(p, 8192); }

  function ensureCtx() {
    if (!state.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      state.ctx = new AC();
    }
    if (state.ctx.state === 'suspended') state.ctx.resume();
    return state.ctx;
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16)
    };
  }
  function rgbToHex(r, g, b) {
    const to = (v) => String(clamp(Math.round(v), 0, 255).toString(16)).padStart(2, '0');
    return `#${to(r)}${to(g)}${to(b)}`;
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return { h, s, l };
  }
  function hslToRgb(h, s, l) {
    h = (h % 1 + 1) % 1;
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
      r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      g: Math.round(hue2rgb(p, q, h) * 255),
      b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
    };
  }
  function shiftHue(hex, amount) {
    const { r, g, b } = hexToRgb(hex);
    const { h, s, l } = rgbToHsl(r, g, b);
    const out = hslToRgb(h + amount, s, l);
    return rgbToHex(out.r, out.g, out.b);
  }
  function mixColor(cA, cB, t) {
    return {
      r: cA.r + (cB.r - cA.r) * t,
      g: cA.g + (cB.g - cA.g) * t,
      b: cA.b + (cB.b - cA.b) * t
    };
  }
  function rgbaStr(c, a) { return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})`; }

  const fx = { accent: { r: 94, g: 234, b: 212 }, vizTop: { r: 78, g: 224, b: 255 }, vizBot: { r: 255, g: 41, b: 112 }, bg: { r: 11, g: 14, b: 20 } };
  function refreshFx() {
    fx.accent = hexToRgb(settings.accent);
    fx.vizTop = hexToRgb(settings.vizTop);
    fx.vizBot = hexToRgb(settings.vizBottom);
    fx.bg = hexToRgb(settings.bgColor);
  }

  let activeVidIdx = 0;
  let activePlIdx = 0;
  let switchTimer = null;
  let appliedListKey = null;

  function videoList() {
    return (settings.bgVideos || []).map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean);
  }

  function hasVideos() {
    return videoList().length > 0;
  }

  function mediaUrl(p) {
    return 'media://file' + encodeURI(p);
  }

  function stopVideoEl(el) {
    try { el.pause(); } catch (e) { /* noop */ }
    el.removeAttribute('src');
    try { el.load(); } catch (e) { /* noop */ }
    el.style.opacity = 0;
  }

  function startVideoEl(el, path) {
    el.src = mediaUrl(path);
    el.load();
    const pr = el.play();
    if (pr) pr.catch(() => {});
  }

  function prepareNextVideo() {
    const list = videoList();
    if (list.length < 2) return;
    const nextPl = (activePlIdx + 1) % list.length;
    const nextEl = bgVideoEls[1 - activeVidIdx];
    nextEl.src = mediaUrl(list[nextPl]);
    nextEl.load();
  }

  function startPlaylist() {
    clearTimeout(switchTimer);
    const list = videoList();
    if (!list.length) {
      bgVideoEls.forEach(stopVideoEl);
      activeVidIdx = 0;
      activePlIdx = 0;
      return;
    }
    activePlIdx = Math.min(activePlIdx, list.length - 1);
    bgVideoEls[activeVidIdx].style.opacity = 1;
    stopVideoEl(bgVideoEls[1 - activeVidIdx]);
    startVideoEl(bgVideoEls[activeVidIdx], list[activePlIdx]);
    prepareNextVideo();
  }

  function handleVideoEnded() {
    const list = videoList();
    if (!list.length) return;
    if (list.length < 2) {
      const el = bgVideoEls[activeVidIdx];
      el.currentTime = 0;
      el.play().catch(() => {});
      return;
    }
    const nextPl = (activePlIdx + 1) % list.length;
    const nextEl = bgVideoEls[1 - activeVidIdx];
    const oldEl = bgVideoEls[activeVidIdx];
    startVideoEl(nextEl, list[nextPl]);
    nextEl.style.opacity = 1;
    oldEl.style.opacity = 0;
    activeVidIdx = 1 - activeVidIdx;
    activePlIdx = nextPl;
    prepareNextVideo();
    switchTimer = setTimeout(() => stopVideoEl(oldEl), CROSSFADE_MS + 250);
  }

  function applyBgVisual() {
    const list = videoList();
    const key = list.join('|');
    body.classList.toggle('has-vid', list.length > 0);
    if (list.length && key !== appliedListKey) {
      appliedListKey = key;
      startPlaylist();
    } else if (!list.length) {
      appliedListKey = null;
      startPlaylist();
    }
  }

  function applySettings() {
    const root = document.documentElement.style;
    root.setProperty('--bg-color', settings.bgColor);
    root.setProperty('--text', settings.textColor);
    root.setProperty('--accent', settings.accent);
    root.setProperty('--viz-top', settings.vizTop);
    root.setProperty('--viz-bottom', settings.vizBottom);
    root.setProperty('--dim', String(settings.dim));
    root.setProperty('--blur', `${settings.blur}px`);

    $('#set-bgcolor').value = settings.bgColor;
    $('#hex-bgcolor').textContent = settings.bgColor;
    $('#set-dim').value = settings.dim;
    $('#val-dim').textContent = `${Math.round(settings.dim * 100)}%`;
    $('#set-blur').value = settings.blur;
    $('#val-blur').textContent = `${settings.blur}px`;
    $('#set-text').value = settings.textColor;
    $('#hex-text').textContent = settings.textColor;
    $('#set-accent').value = settings.accent;
    $('#hex-accent').textContent = settings.accent;
    $('#set-viztop').value = settings.vizTop;
    $('#hex-viztop').textContent = settings.vizTop;
    $('#set-vizbot').value = settings.vizBottom;
    $('#hex-vizbot').textContent = settings.vizBottom;
    $('#set-bars').value = settings.barCount;
    $('#val-bars').textContent = settings.barCount;
    $('#set-smooth').value = settings.smoothing;
    $('#val-smooth').textContent = settings.smoothing.toFixed(2);
    $('#set-hue').checked = !!settings.hueShift;
    $('#set-inten').value = Math.round(settings.intensity * 100);
    $('#val-inten').textContent = `${Math.round(settings.intensity * 100)}%`;
    $('#set-shake').checked = settings.shake;
    $('#set-aurora').checked = settings.aurora;
    $('#set-particles').checked = settings.particles;
    $('#set-logo').checked = settings.showLogo;
    $('#set-dock').checked = settings.showDock;
    body.classList.toggle('no-logo', !settings.showLogo);
    body.classList.toggle('no-dock', !settings.showDock);
    marquee.style.left = `${settings.marqueeX}%`;
    marquee.style.top = `${settings.marqueeY}%`;
    $('#volume').value = settings.volume;
    $$('input[type="range"]').forEach(updateRangeFill);
    updateSizeNote();

    applyBgVisual();
    updateAnalyser();
    updateGain();
  }

  function saveSettings() {
    try {
      localStorage.setItem('neoneq.settings', JSON.stringify(settings));
    } catch (e) { /* ignore quota */ }
  }

  function updateAnalyser() {
    if (!state.analyser) return;
    state.analyser.fftSize = nextPow2(Math.max(settings.barCount * 4, 128));
    state.analyser.smoothingTimeConstant = settings.smoothing;
  }

  function updateGain() {
    if (state.gainNode) state.gainNode.gain.value = settings.muted ? 0 : settings.volume;
  }

  function updateRangeFill(input) {
    const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty('--fill', `${pct}%`);
  }

  function updateSizeNote() {
    const el = $('#size-note');
    if (el) el.textContent = `Current window: ${window.innerWidth} × ${window.innerHeight} px (press F for fullscreen)`;
  }

  function currentTime() {
    if (state.scrubbing && state.previewOffset != null) return state.previewOffset;
    if (state.playing && state.buffer && state.ctx) {
      return Math.min(state.baseOffset + (state.ctx.currentTime - state.startCtxTime), state.buffer.duration);
    }
    return state.offset;
  }

  function stopCurrent() {
    if (state.source) {
      const s = state.source;
      state.source = null;
      try { s.stop(); } catch (e) { /* already stopped */ }
      try { s.disconnect(); } catch (e) { /* noop */ }
    }
    if (state.analyser) {
      try { state.analyser.disconnect(); } catch (e) { /* noop */ }
      state.analyser = null;
    }
    if (state.gainNode) {
      try { state.gainNode.disconnect(); } catch (e) { /* noop */ }
      state.gainNode = null;
    }
  }

  function spawnSource(offset) {
    const ctx = ensureCtx();
    stopCurrent();

    const analyser = ctx.createAnalyser();
    analyser.fftSize = nextPow2(Math.max(settings.barCount * 4, 128));
    analyser.smoothingTimeConstant = settings.smoothing;

    const gain = ctx.createGain();
    gain.gain.value = settings.muted ? 0 : settings.volume;

    const src = ctx.createBufferSource();
    src.buffer = state.buffer;
    src.connect(analyser);
    analyser.connect(gain);
    wireAudioOut(gain);

    const startAt = clamp(offset, 0, Math.max(0, state.buffer.duration - 0.02));
    src.start(0, startAt);

    state.source = src;
    state.analyser = analyser;
    state.gainNode = gain;
    state.baseOffset = startAt;
    state.startCtxTime = ctx.currentTime;

    src.addEventListener('ended', () => {
      if (state.source !== src) return;
      state.playing = false;
      state.offset = state.buffer.duration;
      state.source = null;
      state.analyser = null;
      state.gainNode = null;
      updatePlayBtn();
      body.classList.remove('playing');
    });
  }

  function play() {
    if (!state.buffer) return;
    ensureCtx();
    if (state.playing) return;
    if (state.offset >= state.buffer.duration - 0.06) state.offset = 0;
    state.playing = true;
    spawnSource(state.offset);
    updatePlayBtn();
    body.classList.add('playing');
  }

  function pause() {
    if (!state.playing) return;
    state.offset = currentTime();
    state.playing = false;
    stopCurrent();
    updatePlayBtn();
    body.classList.remove('playing');
  }

  function togglePlay() {
    state.playing ? pause() : play();
  }

  function seekTo(t) {
    if (!state.buffer) return;
    state.offset = clamp(t, 0, state.buffer.duration);
    if (state.playing) spawnSource(state.offset);
  }

  function updatePlayBtn() {
    playBtn.textContent = state.playing ? '\u275A\u275A' : '\u25B6';
    muteBtn.classList.toggle('muted', !!settings.muted);
    muteBtn.textContent = settings.muted ? '\u2715\u266A' : '\u266A';
  }

  function computePeaks(buffer) {
    const width = 700;
    const ch0 = buffer.getChannelData(0);
    const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
    const len = ch0.length;
    const block = Math.max(1, Math.floor(len / width));
    const peaks = new Float32Array(width * 2);
    for (let i = 0; i < width; i++) {
      let min = 1, max = -1;
      const start = i * block;
      const end = Math.min(len, start + block);
      for (let j = start; j < end; j++) {
        const v = ch1 ? (ch0[j] + ch1[j]) / 2 : ch0[j];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      peaks[i * 2] = min;
      peaks[i * 2 + 1] = max;
    }
    return peaks;
  }

  function buildTrackMeta(payload, duration) {
    const m = (payload.meta || {});
    let title = m.title || null;
    let artist = m.artist || null;
    let album = m.album || null;
    if (!title && !artist) {
      const base = payload.fileName.replace(/\.[^.]+$/, '');
      const parts = base.split(/ - /);
      if (parts.length >= 2) {
        artist = parts[0].trim();
        title = parts.slice(1).join(' - ').trim();
      } else {
        title = base.trim();
      }
    }
    return { title: title || payload.fileName, artist, album, cover: m.coverDataUrl || null, duration };
  }

  async function load(payload) {
    if (!payload) return;
    if (payload.error) { toast(payload.error); return; }
    toast('Decoding…');
    try {
      const ctx = ensureCtx();
      const buffer = await ctx.decodeAudioData(payload.buffer);
      state.buffer = buffer;
      state.peaks = computePeaks(buffer);
      state.offset = 0;
      stopCurrent();
      state.playing = false;
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

      try {
        localStorage.setItem('neoneq.lastTrack', JSON.stringify({ path: payload.path, fileName: payload.fileName }));
      } catch (e) { /* noop */ }

      play();
      toast(`${state.track.title}${state.track.artist ? ' — ' + state.track.artist : ''}`);
    } catch (err) {
      toast('Could not decode that file.');
      console.error(err);
    }
  }

  async function chooseVideoAt(i) {
    const res = await window.api.selectBackgroundVideo();
    if (!res) return;
    if (res.error) { toast(res.error); return; }
    settings.bgVideos[i] = res;
    saveSettings();
    renderVideoPickers();
    applyBgVisual();
    toast('Video background set');
  }

  function addVideoPath(p) {
    if (!Array.isArray(settings.bgVideos)) settings.bgVideos = [null];
    if (settings.bgVideos.length >= MAX_VIDEOS) { toast('Maximum of 5 background videos'); return; }
    const idx = settings.bgVideos.findIndex((v) => !v);
    if (idx >= 0) {
      settings.bgVideos[idx] = p;
    } else {
      settings.bgVideos.push(p);
    }
    saveSettings();
    renderVideoPickers();
    applyBgVisual();
    toast('Video background added');
  }

  function clearVideoAt(i) {
    settings.bgVideos[i] = null;
    saveSettings();
    renderVideoPickers();
    applyBgVisual();
  }

  function removeVideoAt(i) {
    settings.bgVideos.splice(i, 1);
    if (!settings.bgVideos.length) settings.bgVideos = [null];
    saveSettings();
    renderVideoPickers();
    applyBgVisual();
  }

  function addVideoPicker() {
    if (settings.bgVideos.length >= MAX_VIDEOS) {
      toast('Maximum of 5 background videos');
      return;
    }
    settings.bgVideos.push(null);
    renderVideoPickers();
    saveSettings();
  }

  function baseName(p) {
    return p ? String(p).split(/[\\/]/).pop() : '';
  }

  function renderVideoPickers() {
    const c = $('#vid-pickers');
    c.innerHTML = '';
    settings.bgVideos.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'vid-picker-row';

      const label = document.createElement('label');
      label.textContent = `Video ${i + 1}`;

      const fileEl = document.createElement('span');
      fileEl.className = 'vid-file';
      fileEl.textContent = p ? baseName(p) : '— none —';

      const btns = document.createElement('div');
      btns.className = 'inline-btns';

      const choose = document.createElement('button');
      choose.className = 'ghost small';
      choose.textContent = 'Choose…';
      choose.addEventListener('click', () => chooseVideoAt(i));

      const clear = document.createElement('button');
      clear.className = 'ghost small';
      clear.textContent = 'Clear';
      clear.disabled = !p;
      clear.addEventListener('click', () => clearVideoAt(i));

      const remove = document.createElement('button');
      remove.className = 'ghost small remove-vid';
      remove.textContent = '\u2715';
      remove.title = 'Remove this picker';
      remove.style.display = settings.bgVideos.length > 1 ? '' : 'none';
      remove.addEventListener('click', () => removeVideoAt(i));

      btns.append(choose, clear, remove);
      row.append(label, fileEl, btns);
      c.appendChild(row);
    });
    const addBtn = $('#btn-vid-add');
    addBtn.style.display = settings.bgVideos.length >= MAX_VIDEOS ? 'none' : '';
  }

  bgVideoEls.forEach((el) => {
    el.addEventListener('error', () => {
      if (hasVideos()) toast('Could not play one of the background videos.');
    });
    el.addEventListener('ended', handleVideoEnded);
  });

  async function openTrack() {
    const payload = await window.api.selectAudio();
    if (payload) await load(payload);
  }

  async function restoreAll() {
    try {
      const raw = localStorage.getItem('neoneq.lastTrack');
      if (raw) {
        const last = JSON.parse(raw);
        if (last.path) {
          const payload = await window.api.readAudioFile(last.path);
          if (payload && payload.error) {
            localStorage.removeItem('neoneq.lastTrack');
          } else if (payload) {
            await load(payload);
            return;
          }
        }
      }
    } catch (e) { /* noop */ }

    if (hasVideos()) applyBgVisual();
  }

  let lastToastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(lastToastTimer);
    lastToastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  function updateClock() {
    if (!state.buffer) { tileTime.textContent = '0:00'; return; }
    tileTime.textContent = fmtTime(currentTime());
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h));
    vctx.beginPath();
    vctx.moveTo(x + rr, y);
    vctx.arcTo(x + w, y, x + w, y + h, rr);
    vctx.arcTo(x + w, y + h, x, y + h, rr);
    vctx.arcTo(x, y + h, x, y, rr);
    vctx.arcTo(x, y, x + w, y, rr);
    vctx.closePath();
  }

  function drawAurora(L, W, H, now, intensity) {
    if (!settings.aurora) return;
    const t = now / 1000;
    const cx = W / 2, cy = H * 0.42;
    const blobs = [
      { c: fx.vizTop, dx: Math.sin(t * 0.5) * W * 0.2, dy: Math.cos(t * 0.7) * H * 0.09, r: Math.max(W, H) * 0.42 },
      { c: fx.accent, dx: Math.cos(t * 0.35 + 2) * W * 0.18, dy: Math.sin(t * 0.5 + 1) * H * 0.11, r: Math.max(W, H) * 0.34 },
      { c: fx.vizBot, dx: Math.sin(t * 0.2 + 4) * W * 0.24, dy: Math.cos(t * 0.4 + 3) * H * 0.08, r: Math.max(W, H) * 0.38 }
    ];
    const music = 0.05 + (lv.mid + lv.hi) * intensity * 0.14;
    for (const b of blobs) {
      const g = vctx.createRadialGradient(cx + b.dx, cy + b.dy, 0, cx + b.dx, cy + b.dy, b.r);
      g.addColorStop(0, rgbaStr(b.c, 0.06 + (b.c === fx.vizTop ? music * 0.6 : 0)));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      vctx.fillStyle = g;
      vctx.fillRect(0, 0, W, H);
    }
  }

  function drawBeams(L, W, H, intensity) {
    const alpha = clamp(lv.bass * 1.8 + pulse * 0.35, 0, 0.5);
    if (alpha < 0.01) return;
    const g = vctx.createLinearGradient(0, L.baseY, 0, L.bandTop);
    g.addColorStop(0, rgbaStr(fx.vizTop, alpha * 0.9));
    g.addColorStop(0.55, rgbaStr(fx.accent, alpha * 0.25));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    vctx.fillStyle = g;
    vctx.beginPath();
    vctx.moveTo(L.bx, L.baseY);
    vctx.lineTo(L.bx + L.bw, L.baseY);
    vctx.lineTo(L.bx + L.bw * 0.62, L.bandTop);
    vctx.lineTo(L.bx + L.bw * 0.38, L.bandTop);
    vctx.closePath();
    vctx.fill();
  }

  function drawSpectrum(L, W, H, live, now) {
    const n = settings.barCount;
    while (displayBars.length < n) displayBars.push(0);
    while (peakVals.length < n) peakVals.push(0);

    const barW = L.bw / n;
    const gap = Math.max(0.6, barW * 0.3);
    const hueAmount = settings.hueShift ? (now / 220000) % 1 : 0;
    const dBytes = curFft >> 1;

    const grad = vctx.createLinearGradient(0, L.baseY, 0, L.bandTop);
    grad.addColorStop(0, shiftHue(settings.vizBottom, hueAmount));
    grad.addColorStop(0.5, shiftHue(settings.vizTop, hueAmount + 0.08));
    grad.addColorStop(1, shiftHue(settings.vizTop, hueAmount));

    const sway = Math.sin(now / 900) * Math.min(L.bw * 0.012, 26);

    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const idx = Math.min(dBytes - 1, Math.floor(Math.pow(t, 1.32) * dBytes));
      const target = live && dBytes ? freqByte[idx] / 255 : 0;
      const vBig = target * 1.0;
      if (target > displayBars[i]) displayBars[i] += (vBig - displayBars[i]) * 0.65;
      else displayBars[i] += (vBig - displayBars[i]) * 0.16;
      displayBars[i] = clamp(displayBars[i], 0, 1);

      if (displayBars[i] > peakVals[i]) peakVals[i] = displayBars[i];
      else peakVals[i] = clamp(peakVals[i] - 0.006, 0, 1);

      const h = Math.max(2, Math.pow(displayBars[i], 1.12) * L.maxH);
      const ph = Math.max(0, Math.pow(peakVals[i], 1.05) * L.maxH);
      const centerDist = (t - 0.5) * 2;
      const bend = centerDist * centerDist * sway;
      const x = L.bx + i * barW + gap / 2 + bend;
      const w = Math.max(0.8, barW - gap);

      vctx.fillStyle = grad;
      vctx.shadowColor = rgbaStr(fx.accent, 0.3 + pulse * 0.3);
      vctx.shadowBlur = 10;
      roundRect(x, L.baseY - h, w, h, Math.min(w / 2, 5));
      vctx.fill();

      vctx.shadowBlur = 0;
      if (ph > 2) {
        vctx.fillStyle = 'rgba(255,255,255,0.92)';
        roundRect(x, L.baseY - ph - 3, w, 3, 1.5);
        vctx.fill();
      }
    }
    vctx.shadowBlur = 0;
    vctx.fillStyle = rgbaStr(mixColor(fx.accent, fx.vizTop, 0.5), 0.28 + pulse * 0.2);
    vctx.fillRect(L.bx, L.baseY - 1, L.bw, 2);
  }

  function drawWaveform(L, W, H, live, now) {
    const n = curFft;
    if (n < 2) return;
    const amp = Math.min(H * 0.055, 46) * (state.playing ? 1 : 0.5);
    const beat = 1 + pulse * 2.2;
    const points = [];
    const hueAmount = settings.hueShift ? (now / 220000) % 1 : 0;
    for (let i = 0; i < n; i += 2) {
      const x = L.bx + (i / (n - 1)) * L.bw;
      const v = live ? (timeByte[i * 2 < n ? i * 2 : i] - 128) / 128 : Math.sin(i * 0.05 + now / 1400) * 0.03;
      points.push([x, L.waveY + v * amp * beat]);
    }

    vctx.lineWidth = 2.5;
    vctx.strokeStyle = shiftHue(settings.accent, hueAmount);
    vctx.shadowColor = rgbaStr(fx.accent, 0.9);
    vctx.shadowBlur = 18;
    vctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      if (i === 0) vctx.moveTo(points[i][0], points[i][1]);
      else vctx.lineTo(points[i][0], points[i][1]);
    }
    vctx.stroke();
    vctx.shadowBlur = 0;

    vctx.globalAlpha = 0.10 + pulse * 0.08;
    vctx.fillStyle = shiftHue(settings.accent, hueAmount);
    vctx.beginPath();
    vctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) vctx.lineTo(points[i][0], points[i][1]);
    vctx.lineTo(L.bx + L.bw, L.baseY - 8);
    vctx.lineTo(L.bx, L.baseY - 8);
    vctx.closePath();
    vctx.fill();
    vctx.globalAlpha = 1;
  }

  function drawBandPanel(L, W, H, now) {
    vctx.fillStyle = 'rgba(10, 14, 22, 0.30)';
    vctx.fillRect(L.bx - 12, L.bandTop - 16, L.bw + 24, L.baseY - L.bandTop + 32);
    const edge = vctx.createLinearGradient(0, L.bandTop - 16, L.bw, L.bandTop - 16);
    edge.addColorStop(0, 'rgba(255,255,255,0.02)');
    edge.addColorStop(0.5, `rgba(255,255,255,${0.05 + lv.mid * 0.06})`);
    edge.addColorStop(1, 'rgba(255,255,255,0.02)');
    vctx.fillStyle = edge;
    vctx.fillRect(L.bx - 0, L.bandTop - 16, L.bw, 1);
    vctx.strokeStyle = 'rgba(255,255,255,0.06)';
    vctx.lineWidth = 1;
    vctx.strokeRect(L.bx - 12 + 0.5, L.bandTop - 15.5, L.bw + 23, L.baseY - L.bandTop + 30);
  }

  function drawRings(L, W, H, now) {
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.radius += r.speed;
      r.alpha *= 0.93;
      if (r.alpha < 0.01 || r.radius > Math.max(W, H)) { rings.splice(i, 1); continue; }
      vctx.strokeStyle = rgbaStr(r.c, r.alpha);
      vctx.lineWidth = r.lineWidth * r.alpha + 0.5;
      vctx.shadowColor = rgbaStr(r.c, r.alpha);
      vctx.shadowBlur = 20;
      vctx.beginPath();
      vctx.ellipse(W / 2, L.waveY, r.radius * 1.6, r.radius, 0, 0, Math.PI * 2);
      vctx.stroke();
      vctx.shadowBlur = 0;
    }
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
    const spawn = state.playing
      ? (0.9 + settings.intensity * 2.6 + pulse * 32)
      : 0.25;
    if (spawn > 0 && particles.length < MAX_PARTICLES && Math.random() < spawn * 0.045) {
      const count = 1 + Math.floor(Math.random() * 3) + (pulse > 0.6 ? 4 : 0);
      const burst = Math.min(MAX_PARTICLES - particles.length, count);
      for (let k = 0; k < burst; k++) {
        const x = L.bx + Math.random() * L.bw;
        particles.push({
          x,
          y: L.baseY - Math.random() * H * 0.1,
          vx: (Math.random() - 0.5) * 0.7,
          vy: -(0.6 + Math.random() * 1.6 + pulse * 2.4),
          life: 80 + Math.random() * 100,
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
      p.life -= 1;
      p.x += p.vx + Math.sin(p.life * 0.12) * 0.5;
      p.y += p.vy;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      const a = (p.life / p.maxLife);
      const scale = p.r * (0.7 + a * 0.5);
      vctx.globalCompositeOperation = 'lighter';
      vctx.fillStyle = p.bright ? 'rgba(255,255,255,0.85)' : rgbaStr(p.c, a * 0.75);
      vctx.save();
      vctx.translate(p.x, p.y);
      p.rot += p.vr;
      if (p.shape !== 'dot') vctx.rotate(p.rot);
      traceShape(vctx, p.shape, scale);
      vctx.fill();
      vctx.restore();
      vctx.globalCompositeOperation = 'source-over';
    }
  }

  function drawSmoke(L, W, H, now) {
    if (!settings.particles) return;
    const smokeSpawn = state.playing
      ? (0.05 + settings.intensity * 0.14 + pulse * 1.2)
      : 0.04;
    if (smoke.length < MAX_SMOKE && Math.random() < smokeSpawn) {
      const count = 1 + (pulse > 0.6 ? Math.floor(Math.random() * 2) : 0);
      for (let k = 0; k < count; k++) {
        const col = Math.random() < 0.7 ? '255,255,255' : `${fx.accent.r},${fx.accent.g},${fx.accent.b}`;
        smoke.push({
          x: L.bx + Math.random() * L.bw,
          y: L.baseY + Math.random() * H * 0.04,
          vx: (Math.random() - 0.5) * 0.25,
          vy: -(0.08 + Math.random() * 0.24),
          life: 180 + Math.random() * 140,
          maxLife: 320,
          r: 6 + Math.random() * 14,
          col,
          peak: 0.05 + Math.random() * 0.07
        });
      }
    }
    for (let i = smoke.length - 1; i >= 0; i--) {
      const s = smoke[i];
      s.life -= 1;
      s.y += s.vy;
      s.x += s.vx + Math.sin(s.life * 0.012) * 0.35;
      if (s.life <= 0) { smoke.splice(i, 1); continue; }
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

  function drawScanline(W, H, now) {
    scanY = (scanY + 0.6) % (H + 160);
    const y = scanY - 80;
    const g = vctx.createLinearGradient(0, y, 0, y + 80);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, `rgba(255,255,255,${0.045 + lv.hi * 0.05})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    vctx.fillStyle = g;
    vctx.fillRect(0, y, W, 80);
  }

  function drawVignette(W, H, now) {
    const pulseA = clamp(pulse * 0.25, 0, 0.3);
    const g = vctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.32, W / 2, H * 0.45, Math.max(W, H) * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${0.34 + pulseA})`);
    vctx.fillStyle = g;
    vctx.fillRect(0, 0, W, H);
    if (pulseA > 0.02) {
      vctx.fillStyle = rgbaStr(fx.accent, pulseA * 0.25);
      vctx.fillRect(0, 0, W, H);
    }
  }

  function drawGlowBackdrop(W, H) {
    const grad = vctx.createRadialGradient(W / 2, H * 0.34, 0, W / 2, H * 0.34, Math.max(W, H) * 0.75);
    grad.addColorStop(0, rgbaStr(fx.accent, 0.10 + lv.bass * 0.08 + pulse * 0.10));
    grad.addColorStop(0.45, rgbaStr(fx.accent, 0.03));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    vctx.fillStyle = grad;
    vctx.fillRect(0, 0, W, H);
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

  function analyzeSpectrum(live) {
    if (!state.analyser || !live) { return; }
    const dB = freqByte.subarray(0, curFft >> 1);
    const n = dB.length;
    let bass = 0, mid = 0, hi = 0;
    const bn = Math.max(3, Math.round(n * 0.08));
    for (let i = 1; i < bn; i++) bass += dB[i];
    const mn0 = bn, mn1 = Math.max(bn + 1, Math.round(n * 0.3));
    for (let i = mn0; i < mn1; i++) mid += dB[i];
    for (let i = mn1; i < n; i++) hi += dB[i];
    bass /= (bn - 1) * 255;
    mid /= (mn1 - mn0) * 255;
    hi /= (n - mn1) * 255;
    lv.bass += (bass - lv.bass) * 0.3;
    lv.mid += (mid - lv.mid) * 0.3;
    lv.hi += (hi - lv.hi) * 0.3;

    energyHist.push(bass);
    if (energyHist.length > 48) energyHist.shift();
    let avg = 0;
    for (const e of energyHist) avg += e;
    avg /= energyHist.length;

    const nowTs = performance.now();
    if (nowTs - lastKickTs > 110 && bass > 0.11 && bass > avg * 1.28) {
      lastKickTs = nowTs;
      pulse = 1;
      tremor = 0.8;
      rings.push({
        radius: 20,
        speed: 9,
        alpha: 0.5,
        lineWidth: 3,
        c: mixColor(fx.vizTop, fx.vizBot, Math.random())
      });
    }
  }

  function drawMusic(L, W, H, live, now) {
    if (state.analyser && live) {
      const fft = state.analyser.fftSize;
      curFft = fft;
      state.analyser.getByteFrequencyData(freqByte.subarray(0, fft >> 1));
      state.analyser.getByteTimeDomainData(timeByte.subarray(0, fft));
      analyzeSpectrum(true);
    }
    drawBandPanel(L, W, H, now);
    drawBeams(L, W, H, settings.intensity);
    drawSpectrum(L, W, H, live, now);
    drawWaveform(L, W, H, live, now);
    drawRings(L, W, H, now);
  }

  function drawIdle(L, W, H, now) {
    const t = now / 1000;
    for (let i = 0; i < 3; i++) {
      const r = ((t * 28) % 190) + 30 + i * 60;
      vctx.strokeStyle = rgbaStr(fx.accent, 0.10);
      vctx.lineWidth = 1;
      vctx.beginPath();
      vctx.ellipse(W / 2, H * 0.42, r * 1.6, r, Math.sin(t * 0.3 + i) * 0.18, 0, Math.PI * 2);
      vctx.stroke();
    }
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

    const dur = state.buffer ? state.buffer.duration : 0;
    const peaks = state.peaks;
    if (!peaks || !dur) {
      sctx.fillStyle = 'rgba(255,255,255,0.05)';
      sctx.fillRect(0, 0, W, H);
    } else {
      const pairs = peaks.length / 2;
      const mid = H / 2;
      const cursor = state.scrubbing && state.previewOffset != null ? state.previewOffset : (state.buffer ? currentTime() : 0);
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
    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth, H = window.innerHeight;
    if (vizCanvas.width !== W * dpr || vizCanvas.height !== H * dpr) {
      vizCanvas.width = W * dpr;
      vizCanvas.height = H * dpr;
    }
    vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    vctx.clearRect(0, 0, W, H);

    drawGlowBackdrop(W, H);

    const live = state.playing && !state.scrubbing;
    const L = layout(W, H);

    vctx.save();
    const camT = now / 1000;
    let zoom = 1 + Math.sin(camT * 0.21) * 0.010;
    let rot = (Math.random() - 0.5) * tremor * 0.012;
    if (state.playing && settings.shake) zoom += lv.mid * 0.02 + pulse * 0.012;
    const ddx = Math.sin(camT * 0.43) * W * 0.010;
    const ddy = Math.cos(camT * 0.31) * H * 0.010;
    vctx.translate(W / 2 + ddx, H / 2 + ddy);
    if (rot !== 0) vctx.rotate(rot);
    vctx.scale(zoom, zoom);
    vctx.translate(-W / 2, -H / 2);

    if (settings.aurora) drawAurora(L, W, H, now, settings.intensity);

    if (state.track && state.buffer) {
      drawMusic(L, W, H, live, now);
    } else {
      drawIdle(L, W, H, now);
    }
    drawScanline(W, H, now);
    drawParticles(L, W, H, now);
    drawSmoke(L, W, H, now);
    vctx.restore();

    drawVignette(W, H, now);
    drawScrubber();

    if (hasVideos()) {
      const pump = state.playing ? 1 + lv.bass * 0.16 + pulse * 0.05 : 1.02;
      bgVideoEls.forEach((el) => { el.style.transform = `scale(${pump.toFixed(4)})`; });
    }

    pulse *= 0.90;
    tremor *= settings.shake ? 0.88 : 0.6;

    const sec = Math.floor(currentTime());
    if (sec !== lastSec) {
      lastSec = sec;
      updateClock();
    }
  }

  function setPreviewFromEvent(e) {
    const rect = scrubCanvas.getBoundingClientRect();
    const frac = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    state.previewOffset = frac * state.buffer.duration;
  }

  scrubCanvas.addEventListener('pointerdown', (e) => {
    if (!state.buffer) return;
    state.scrubbing = true;
    state.wasPlaying = state.playing;
    if (state.playing) {
      state.offset = currentTime();
      state.playing = false;
      stopCurrent();
      body.classList.remove('playing');
    }
    scrubCanvas.setPointerCapture(e.pointerId);
    setPreviewFromEvent(e);
  });
  scrubCanvas.addEventListener('pointermove', (e) => {
    if (state.scrubbing) setPreviewFromEvent(e);
  });
  scrubCanvas.addEventListener('pointerup', () => {
    if (!state.scrubbing) return;
    state.scrubbing = false;
    state.offset = clamp(state.previewOffset ?? state.offset, 0, state.buffer.duration);
    state.previewOffset = null;
    if (state.wasPlaying) play();
    else updateClock();
  });
  scrubCanvas.addEventListener('pointercancel', () => {
    if (state.scrubbing) {
      state.scrubbing = false;
      state.previewOffset = null;
    }
  });

  playBtn.addEventListener('click', togglePlay);
  $('#btn-rew').addEventListener('click', () => seekTo(currentTime() - 10));
  $('#btn-fwd').addEventListener('click', () => seekTo(currentTime() + 10));
  muteBtn.addEventListener('click', () => {
    settings.muted = !settings.muted;
    updateGain();
    updatePlayBtn();
    saveSettings();
  });
  totalSlider.addEventListener('input', () => {
    settings.volume = parseFloat(totalSlider.value);
    updateRangeFill(totalSlider);
    if (settings.muted && settings.volume > 0) settings.muted = false;
    updateGain();
    updatePlayBtn();
    saveSettings();
  });

  $('#btn-open').addEventListener('click', openTrack);
  $('#btn-pick').addEventListener('click', openTrack);

  async function pickNextVideoSlot() {
    const list = settings.bgVideos;
    const idx = list.findIndex((p) => !p);
    if (idx >= 0) { await chooseVideoAt(idx); return; }
    if (list.length < MAX_VIDEOS) {
      list.push(null);
      renderVideoPickers();
      saveSettings();
      await chooseVideoAt(list.length - 1);
      return;
    }
    toast('Maximum of 5 background videos');
  }
  $('#btn-pick-vid').addEventListener('click', pickNextVideoSlot);
  $('#btn-vid-add').addEventListener('click', addVideoPicker);

  $('#btn-fs').addEventListener('click', () => window.api.setFullscreen(!state.fullscreen));
  $('#btn-settings').addEventListener('click', () => openSettings());
  $('#btn-settings-plain').addEventListener('click', () => openSettings());
  $('#btn-close-settings').addEventListener('click', () => closeSettings());
  settingsEl.addEventListener('click', (e) => {
    if (e.target === settingsEl) closeSettings();
  });

  function openSettings() { settingsEl.classList.remove('hidden'); }
  function closeSettings() {
    if (settingsEl.classList.contains('hidden')) return;
    settingsEl.classList.add('hidden');
  }

  $('#btn-reset').addEventListener('click', () => {
    const keep = { bgVideos: settings.bgVideos };
    Object.assign(settings, {
      ...DEFAULT_SETTINGS,
      bgVideos: keep.bgVideos
    });
    applySettings();
    saveSettings();
    toast('Colors reset');
  });

  $$('.canvas-presets [data-size]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [w, h] = btn.dataset.size.split('x').map(Number);
      window.api.setContentSize(w, h);
      toast(`Canvas set to ${w} × ${h}`);
    });
  });

  function bindSetting(input, key, transform) {
    input.addEventListener('input', () => {
      settings[key] = transform(input.value);
      if (key === 'smoothing' || key === 'barCount') updateAnalyser();
      applySettings();
      saveSettings();
    });
  }
  bindSetting($('#set-bgcolor'), 'bgColor', (v) => v);
  bindSetting($('#set-dim'), 'dim', (v) => parseFloat(v));
  bindSetting($('#set-blur'), 'blur', (v) => parseInt(v, 10));
  bindSetting($('#set-text'), 'textColor', (v) => v);
  bindSetting($('#set-accent'), 'accent', (v) => v);
  bindSetting($('#set-viztop'), 'vizTop', (v) => v);
  bindSetting($('#set-vizbot'), 'vizBottom', (v) => v);
  bindSetting($('#set-bars'), 'barCount', (v) => parseInt(v, 10));
  bindSetting($('#set-smooth'), 'smoothing', (v) => parseFloat(v));
  bindSetting($('#set-inten'), 'intensity', (v) => parseInt(v, 10) / 100);
  $('#set-hue').addEventListener('change', (e) => {
    settings.hueShift = e.target.checked;
    saveSettings();
  });
  $('#set-shake').addEventListener('change', (e) => {
    settings.shake = e.target.checked;
    saveSettings();
  });
  $('#set-aurora').addEventListener('change', (e) => {
    settings.aurora = e.target.checked;
    saveSettings();
  });
  $('#set-particles').addEventListener('change', (e) => {
    settings.particles = e.target.checked;
    saveSettings();
  });
  $('#set-logo').addEventListener('change', (e) => {
    settings.showLogo = e.target.checked;
    body.classList.toggle('no-logo', !settings.showLogo);
    saveSettings();
  });
  $('#set-dock').addEventListener('change', (e) => {
    settings.showDock = e.target.checked;
    body.classList.toggle('no-dock', !settings.showDock);
    saveSettings();
  });
  $('#btn-title-center').addEventListener('click', () => {
    settings.marqueeX = 50;
    settings.marqueeY = 29;
    marquee.style.left = '50%';
    marquee.style.top = '29%';
    saveSettings();
    toast('Title centered');
  });

  window.addEventListener('keydown', (e) => {
    const settingsOpen = !settingsEl.classList.contains('hidden');
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
      if (e.key === 'Escape') e.target.blur();
      const ctrlShortcut = e.ctrlKey || e.metaKey;
      const stillGlobal = ctrlShortcut || ['m', 'M', 'f', 'F', 'F11', 'h', 'H', 'r', 'R'].includes(e.key);
      if (!stillGlobal) return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (e.key === 'o' || e.key === 'O' || e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      openTrack();
      return;
    }
    if (ctrl && e.key === ',') {
      e.preventDefault();
      settingsOpen ? closeSettings() : openSettings();
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
      seekTo(currentTime() + (e.key === 'ArrowLeft' ? -delta : delta));
      return;
    }
    if (e.key === 'm' || e.key === 'M') {
      settings.muted = !settings.muted;
      updateGain();
      updatePlayBtn();
      saveSettings();
      return;
    }
    if (e.key === 'r' || e.key === 'R') {
      if (!e.ctrlKey && !e.metaKey) {
        toggleRecord();
        return;
      }
    }
    if (e.key === 'f' || e.key === 'F' || e.key === 'F11') {
      e.preventDefault();
      toggleFullscreen();
      return;
    }
    if (e.key === 'h' || e.key === 'H') {
      body.classList.toggle('hideui');
      const hidden = body.classList.contains('hideui');
      toast(hidden
        ? 'UI hidden (H to restore)'
        : 'UI shown' + (settings.showDock === false ? ' — Player controls: Settings (Ctrl+,) › Player controls' : ''));
      return;
    }
    if (e.key === 'Escape') {
      if (settingsOpen) closeSettings();
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
    else if (action === 'settings') openSettings();
  });

  function wireAudioOut(gain) {
    if (!gain) return;
    try { gain.disconnect(); } catch (e) { /* noop */ }
    gain.connect(state.recording && state.recTap ? state.recTap : state.ctx.destination);
  }

  function startAudioTap() {
    if (state.recTap) return;
    const ctx = ensureCtx();
    const tap = ctx.createScriptProcessor(1024, 2, 2);
    tap.onaudioprocess = (e) => {
      if (!state.recording) return;
      const inL = e.inputBuffer.getChannelData(0);
      const inR = e.inputBuffer.getChannelData(1);
      e.outputBuffer.getChannelData(0).set(inL);
      e.outputBuffer.getChannelData(1).set(inR);
      const n = inL.length;
      const pcm = new Int16Array(n * 2);
      for (let i = 0; i < n; i++) {
        let l = inL[i];
        let r = inR[i];
        l = l > 1 ? 1 : (l < -1 ? -1 : l);
        r = r > 1 ? 1 : (r < -1 ? -1 : r);
        pcm[i * 2] = l < 0 ? (l * 0x8000) | 0 : (l * 0x7fff) | 0;
        pcm[i * 2 + 1] = r < 0 ? (r * 0x8000) | 0 : (r * 0x7fff) | 0;
      }
      window.api.recordAudio(pcm);
    };
    tap.connect(ctx.destination);
    state.recTap = tap;
    if (state.gainNode) wireAudioOut(state.gainNode);
  }

  function detachAudioTap() {
    if (!state.recTap) return;
    try { state.recTap.disconnect(); } catch (e) { /* noop */ }
    state.recTap.onaudioprocess = null;
    state.recTap = null;
  }

  function captureComposite() {
    const rc = state.recCapCtx;
    if (!rc) return;
    const W = window.innerWidth, H = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (state.recCap.width !== w || state.recCap.height !== h) {
      state.recCap.width = w;
      state.recCap.height = h;
    }
    rc.setTransform(dpr, 0, 0, dpr, 0, 0);
    rc.clearRect(0, 0, W, H);
    rc.fillStyle = settings.bgColor;
    rc.fillRect(0, 0, W, H);
    if (hasVideos()) {
      const blur = Number(settings.blur) || 0;
      if (blur > 0) rc.filter = `blur(${blur}px)`;
      rc.globalAlpha = 1;
      for (const el of bgVideoEls) {
        if (!el.videoWidth) continue;
        rc.globalAlpha = parseFloat(getComputedStyle(el).opacity) || 0;
        if (rc.globalAlpha <= 0) continue;
        rc.drawImage(el, 0, 0, W, H);
      }
      rc.filter = 'none';
      rc.globalAlpha = 1;
    }
    rc.globalAlpha = settings.dim;
    rc.fillStyle = settings.bgColor;
    rc.fillRect(0, 0, W, H);
    rc.globalAlpha = 1;
    const hl = rc.createRadialGradient(W * 0.5, H * 0.32, 0, W * 0.5, H * 0.32, Math.max(W, H) * 0.55);
    hl.addColorStop(0, 'rgba(255,255,255,0.05)');
    hl.addColorStop(0.62, 'rgba(255,255,255,0)');
    rc.fillStyle = hl;
    rc.fillRect(0, 0, W, H);
    const vg = rc.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, Math.hypot(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0.42)');
    vg.addColorStop(0.72, 'rgba(0,0,0,0)');
    rc.fillStyle = vg;
    rc.fillRect(0, 0, W, H);
    rc.drawImage(vizCanvas, 0, 0, W, H);
    drawOverlayLayers(rc);
  }

  function overlayInfo(el) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { cs, r, visible: cs.display !== 'none' && parseFloat(cs.opacity || 1) > 0.01 };
  }

  function parseTextShadows(str) {
    const list = [];
    const parts = str.match(/[^,]+/g) || [];
    for (const part of parts) {
      const m = part.match(/((?:rgba?|hsla?)\([^)]*\))\s*([-\d.]+)px\s*([-\d.]+)px\s*([-\d.]+)px/);
      if (m) list.push({ color: m[1], dx: parseFloat(m[2]), dy: parseFloat(m[3]), blur: parseFloat(m[4]) });
    }
    return list;
  }

  function drawOverlayText(rc, el, align, alpha) {
    const o = overlayInfo(el);
    if (!o.visible || !el.textContent) return;
    const cs = o.cs;
    rc.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    rc.textBaseline = 'middle';
    rc.textAlign = align || 'center';
    try { rc.letterSpacing = cs.letterSpacing; } catch (e) { /* noop */ }
    const cx = o.r.left + o.r.width / 2;
    const cy = o.r.top + o.r.height / 2;
    const a = alpha == null ? parseFloat(cs.opacity || 1) : alpha;
    rc.globalAlpha = a;
    rc.fillStyle = cs.color;
    for (const s of parseTextShadows(cs.textShadow)) {
      rc.shadowColor = s.color;
      rc.shadowOffsetX = s.dx;
      rc.shadowOffsetY = s.dy;
      rc.shadowBlur = s.blur;
      rc.fillText(el.textContent, cx, cy);
    }
    rc.shadowColor = 'transparent';
    rc.shadowOffsetX = 0;
    rc.shadowOffsetY = 0;
    rc.shadowBlur = 0;
    rc.fillText(el.textContent, cx, cy);
    rc.globalAlpha = 1;
    try { rc.letterSpacing = '0px'; } catch (e) { /* noop */ }
  }

  function drawBrandOverlay(rc) {
    const o = overlayInfo(brandEl);
    if (!o.visible) return;
    const playing = body.classList.contains('playing');
    const now = performance.now() / 1000;
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim();
    const vizTop = css.getPropertyValue('--viz-top').trim();
    const cy = o.r.top + o.r.height / 2;
    const delays = [0, 0.15, 0.3, 0.1, 0.42];
    const barW = 3, hint = 13;
    const grad = rc.createLinearGradient(0, cy - hint / 2, 0, cy + hint / 2);
    grad.addColorStop(0, vizTop || accent || '#fff');
    grad.addColorStop(1, accent || '#fff');
    rc.fillStyle = grad;
    rc.globalAlpha = 0.92;
    let x = o.r.left;
    for (let i = 0; i < 5; i++) {
      const h = playing ? 4 + 9 * (0.5 - 0.5 * Math.cos(2 * Math.PI * ((now + delays[i]) % 1))) : 4;
      rc.beginPath();
      rc.roundRect(x, cy + hint / 2 - h, barW, h, 2);
      rc.fill();
      x += barW + 3;
    }
    rc.font = '700 14px Orbitron, sans-serif';
    rc.textBaseline = 'middle';
    rc.textAlign = 'left';
    try { rc.letterSpacing = '6px'; } catch (e) { /* noop */ }
    const tx = x + 12;
    rc.shadowColor = 'rgba(255,255,255,0.22)';
    rc.shadowBlur = 16;
    rc.fillStyle = o.cs.color;
    rc.fillText('SYNEMAR', tx, cy);
    rc.shadowColor = 'transparent';
    rc.shadowBlur = 0;
    rc.shadowOffsetX = 0;
    rc.shadowOffsetY = 0;
    rc.globalAlpha = 1;
    try { rc.letterSpacing = '0px'; } catch (e) { /* noop */ }
  }

  function drawOverlayLayers(rc) {
    drawBrandOverlay(rc);
    const o = overlayInfo(marquee);
    if (!o.visible) return;
    if (!titleEl.textContent && !artistEl.textContent && !albumEl.textContent) return;
    if (titleEl.textContent) drawOverlayText(rc, titleEl);
    for (let i = 0; i < metaSubEl.children.length; i++) drawOverlayText(rc, metaSubEl.children[i]);
  }

  function startRecCapture() {
    if (state.recTimer) return;
    if (!state.recCap) {
      state.recCap = document.createElement('canvas');
      state.recCapCtx = state.recCap.getContext('2d');
    }
    state.recTimer = setInterval(() => {
      if (!state.recording) return;
      captureComposite();
      const data = state.recCap.toDataURL('image/jpeg', 0.9);
      window.api.recordFrame(data.split(',')[1]);
    }, 1000 / 30);
  }

  function stopRecCapture() {
    if (!state.recTimer) return;
    clearInterval(state.recTimer);
    state.recTimer = null;
  }

  async function startRecord() {
    if (state.recording) return;
    const begin = await window.api.recordStart({ sampleRate: ensureCtx().sampleRate || 44100 });
    if (!begin || begin.error) {
      toast(begin && begin.error ? `Could not start the recorder: ${begin.error}` : 'Could not start the recorder.');
      return;
    }
    state.recording = true;
    startAudioTap();
    if (state.gainNode) wireAudioOut(state.gainNode);
    startRecCapture();
    updateRecButton();
    toast('Recording… press the ● button or R to stop');
  }

  async function stopRecord() {
    if (!state.recording) return;
    state.recording = false;
    toast('Finalizing…');
    stopRecCapture();
    detachAudioTap();
    if (state.gainNode) wireAudioOut(state.gainNode);
    const fin = await window.api.recordStop();
    updateRecButton();
    toast(fin && fin.ok
      ? `Recording saved: ${fin.path}`
      : (fin && fin.error ? `Recording failed: ${fin.error}` : 'Could not save the recording.'));
  }

  function toggleRecord() {
    if (state.recording) stopRecord();
    else startRecord();
  }

  function updateRecButton() {
    const btn = $('#btn-rec');
    if (!btn) return;
    btn.classList.toggle('on', !!state.recording);
    btn.title = state.recording ? 'Stop recording (R)' : 'Record screen + audio (R)';
  }

  $('#btn-rec').addEventListener('click', toggleRecord);

  window.api.onRecError((message) => {
    const was = state.recording;
    state.recording = false;
    stopRecCapture();
    detachAudioTap();
    if (state.gainNode) wireAudioOut(state.gainNode);
    updateRecButton();
    toast(was ? `Recording failed: ${message}` : (message || 'Recording failed'));
  });

  function setupDragDrop() {
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      body.classList.add('dragging');
    });
    window.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget) body.classList.remove('dragging');
    });
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      body.classList.remove('dragging');
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      await handleDropped(file, file.path || '');
    });
  }

  async function handleDropped(file, filePath) {
    const name = file.name || filePath;
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (window.api && filePath && ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'].includes(ext)) {
      const payload = await window.api.readAudioFile(filePath);
      await load(payload);
    } else if (window.api && filePath && ['mp4', 'webm', 'mov', 'm4v', 'mkv'].includes(ext)) {
      addVideoPath(filePath);
    } else {
      toast(`Can't use “${name}”.`);
    }
  }

  function setupTitleDrag() {
    let dragging = false, startX = 0, startY = 0, baseL = 0, baseT = 0;
    marquee.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      baseL = parseFloat(marquee.style.left) || settings.marqueeX;
      baseT = parseFloat(marquee.style.top) || settings.marqueeY;
      marquee.setPointerCapture(e.pointerId);
      marquee.classList.add('dragging');
      e.preventDefault();
    });
    marquee.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const x = Math.max(0, Math.min(100, baseL + ((e.clientX - startX) / window.innerWidth) * 100));
      const y = Math.max(0, Math.min(100, baseT + ((e.clientY - startY) / window.innerHeight) * 100));
      marquee.style.left = `${x}%`;
      marquee.style.top = `${y}%`;
    });
    const stop = () => {
      if (!dragging) return;
      dragging = false;
      marquee.classList.remove('dragging');
      settings.marqueeX = parseFloat(marquee.style.left) || settings.marqueeX;
      settings.marqueeY = parseFloat(marquee.style.top) || settings.marqueeY;
      saveSettings();
      toast('Title position saved');
    };
    marquee.addEventListener('pointerup', stop);
    marquee.addEventListener('pointercancel', stop);
  }

  function scheduleCursorHide() {
    clearTimeout(state.hideTimer);
    body.classList.remove('no-cursor');
    state.hideTimer = setTimeout(() => {
      if (state.playing && state.fullscreen && !state.scrubbing) body.classList.add('no-cursor');
    }, 2600);
  }
  window.addEventListener('pointermove', scheduleCursorHide);
  window.addEventListener('resize', () => { lastSec = -1; updateSizeNote(); });

  function init() {
    refreshFx();
    applySettings();
    renderVideoPickers();
    setupDragDrop();
    setupTitleDrag();
    updateRecButton();
    requestAnimationFrame(frame);
    window.api.isFullscreen().then((f) => {
      state.fullscreen = !!f;
      body.classList.toggle('fullscreen', !!f);
    });
    applyAppIcon();
    restoreAll();
  }

  async function applyAppIcon() {
    const svg = await window.api.getAppIconSvg();
    if (!svg) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || 512;
      c.height = img.naturalHeight || 512;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0, c.width, c.height);
      window.api.setAppIconPng(c.toDataURL('image/png'));
    };
    img.src = svg;
  }

  init();
})();