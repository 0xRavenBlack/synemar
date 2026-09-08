(() => {
  const $ = (s) => document.querySelector(s);

  const vizCanvas = $('#viz');
  const vctx = vizCanvas.getContext('2d');

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

  const state = { track: null, fullscreen: false };

  const manager = window.PlaylistManager.create();

  let pulse = 0;
  let tremor = 0;
  let lastFrameTs = 0;
  let dt = 1;

  const PULSE_DECAY = 0.90;
  const TREMOR_DECAY_ON = 0.92;
  const TREMOR_DECAY_OFF = 0.6;
  const PUMP_BASS = 0.16;
  const PUMP_PULSE = 0.05;
  const PUMP_IDLE = 1.02;
  const SHAKE_BASS = 0.25;
  const SHAKE_TREMOR = 0.5;
  const SHAKE_ROT_MULT = 0.12;
  const CAM_ZOOM_AMPLITUDE = 0.010;
  const CAM_ZOOM_PERIOD = 0.21;
  const CAM_X_SWAY_PERIOD = 0.43;
  const CAM_Y_SWAY_PERIOD = 0.31;
  const CAM_SWAY_AMOUNT = 0.010;

  const { clamp, fmtTime, trySafe } = window.Util;
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
      if (settings.circular !== 'off') Fx.spawnRing(mixColor(fx.vizTop, fx.vizBot, Math.random()));
    }
  });
  audioEngine.onEnded(() => {
    updatePlayBtn();
    body.classList.remove('playing');
    advanceAudio();
  });

  function fxOpts() {
    return {
      settings,
      fx,
      lv: audioEngine.state.lv,
      pulse,
      dt,
      freqByte: audioEngine.state.freqByte,
      timeByte: audioEngine.state.timeByte,
      curFft: audioEngine.state.curFft,
      playing: audioEngine.state.playing,
      scrubbing: scrubber.isScrubbing()
    };
  }

  const videoBg = window.VideoBg.create({
    manager,
    elements: bgVideoEls,
    crossfadeMs: CROSSFADE_MS,
    toast: (msg) => ui.toast(msg)
  });

  const particles = window.Particles.create({
    settings,
    fx,
    getPlaying: () => audioEngine.state.playing,
    getPulse: () => pulse,
    getDt: () => dt
  });

  const smoke = window.Smoke.create({
    settings,
    fx,
    getPlaying: () => audioEngine.state.playing,
    getPulse: () => pulse,
    getDt: () => dt
  });

  const scrubber = window.Scrubber.create({
    audioEngine,
    fx,
    canvas: $('#scrubber'),
    tip: $('#scrub-tip'),
    onResume: () => play(),
    onClockUpdate: () => updateClock(),
    setPlayingClass: (on) => body.classList.toggle('playing', on)
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

  const colorPicker = window.ColorPicker.create({
    settings,
    save: appSettings.save,
    apply: appSettings.apply
  });

  const help = window.Help.create();

  const ui = window.UI.create({
    settings,
    saveSettings: appSettings.save,
    playAudioFile: (p) => playAudioFile(p),
    addVideoFile: (p) => addVideoFile(p),
    audioEngine,
    videoBg,
    getFullscreen: () => state.fullscreen,
    getScrubbing: () => scrubber.isScrubbing(),
    audioExts: AUDIO_EXTS,
    videoExts: VIDEO_EXTS
  });

  async function probeAudioDuration(path) {
    try {
      const payload = await window.api.readAudioFile(path);
      if (!payload || payload.error || !payload.buffer) return null;
      const ctx = audioEngine.ensureCtx();
      const buffer = await ctx.decodeAudioData(payload.buffer);
      return buffer.duration;
    } catch (err) {
      return null;
    }
  }

  const playlistUI = window.PlaylistUI.create({
    manager,
    toast: (msg) => ui.toast(msg),
    audioExts: AUDIO_EXTS,
    videoExts: VIDEO_EXTS,
    probeAudioDuration,
    onSelectAudio: () => {},
    onSelectVideo: () => videoBg.apply(),
    onImport: () => {}
  });

  appSettings.wire({ audioEngine, videoBg, ui });
  colorPicker.init();
  scrubber.wire();

  manager.onAudioChanged = (track) => {
    playlistUI.renderList('audio');
    if (track) playTrack(track);
  };
  manager.onVideoChanged = () => videoBg.apply();
  manager.onListChanged = () => { playlistUI.renderList('audio'); playlistUI.renderList('video'); videoBg.apply(); };

  function currentTime() {
    return scrubber.currentTime(audioEngine.currentTime());
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
    playBtn.setAttribute('aria-pressed', audioEngine.state.playing ? 'true' : 'false');
    muteBtn.classList.toggle('muted', !!settings.muted);
    muteBtn.textContent = settings.muted ? '\u2715\u266A' : '\u266A';
    muteBtn.setAttribute('aria-pressed', settings.muted ? 'true' : 'false');
  }

  const vizBtn = $('#btn-viz');
  const vizBtnIcon = vizBtn.querySelector('.viz-icon');
  const vizBtnLabel = vizBtn.querySelector('.viz-label');
  const VIZ_MODES = {
    bar: { icon: '\u2582\u2584\u2586', label: 'Bar Visualizer' },
    radial: { icon: '\u25C9', label: 'Radial Visualizer' },
    off: { icon: '\u2298', label: 'Visualizer Off' }
  };
  const VIZ_CYCLE = ['bar', 'radial', 'off'];

  function refreshVizButton() {
    const current = settings.circular;
    const idx = VIZ_CYCLE.indexOf(current);
    const target = VIZ_MODES[VIZ_CYCLE[(idx + 1) % VIZ_CYCLE.length]];
    vizBtnIcon.textContent = target.icon;
    vizBtnLabel.textContent = target.label;
  }

  function toggleVisualizer() {
    const idx = VIZ_CYCLE.indexOf(settings.circular);
    settings.circular = VIZ_CYCLE[(idx + 1) % VIZ_CYCLE.length];
    appSettings.save();
    refreshVizButton();
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
    state.track = null;
    titleEl.textContent = '';
    artistEl.textContent = '';
    albumEl.textContent = '';
    artistEl.style.display = 'none';
    subSep.style.display = 'none';
    metaSubEl.replaceChildren(artistEl, subSep, albumEl);
    emptyEl.classList.remove('hidden');
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

  let uiDz = 0;
  function layout(W, H) {
    const dockGone = body.classList.contains('no-dock') || body.classList.contains('hideui');
    const barsToBottom = body.classList.contains('no-dock') && settings.circular === 'bar';
    const target = barsToBottom ? H - H * 0.87 : (dockGone ? Math.min(H * 0.06, 80) : 0);
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
    const o = fxOpts();
    Fx.drawBeams(vctx, L, W, H, now, o);
    if (settings.circular === 'radial') {
      Fx.drawCircleSpectrum(vctx, W, H, live, now, o);
    } else {
      Fx.drawSpectrum(vctx, L, W, H, live, now, o);
    }
    Fx.drawWaveform(vctx, L, W, H, live, now, o);
    Fx.drawRings(vctx, L, W, H, now, o);
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

    const live = audioEngine.state.playing && !scrubber.isScrubbing();
    const L = layout(W, H);
    const vizOff = settings.circular === 'off';
    const o = fxOpts();
    audioEngine.analyzeSpectrum(live);
    if (!vizOff) Fx.drawGlowBackdrop(vctx, L, W, H, now, o);

    vctx.save();
    const camT = now / 1000;
    const zoom = 1 + Math.sin(camT * CAM_ZOOM_PERIOD) * CAM_ZOOM_AMPLITUDE;
    const ddx = Math.sin(camT * CAM_X_SWAY_PERIOD) * W * CAM_SWAY_AMOUNT;
    const ddy = Math.cos(camT * CAM_Y_SWAY_PERIOD) * H * CAM_SWAY_AMOUNT;
    vctx.translate(W / 2 + ddx, H / 2 + ddy);
    vctx.scale(zoom, zoom);
    vctx.translate(-W / 2, -H / 2);

    if (settings.aurora) Fx.drawAurora(vctx, L, W, H, now, o);
    if (settings.spiral) Fx.drawSpiral(vctx, W, H, now, o);

    if (state.track && audioEngine.state.buffer) {
      if (!vizOff) drawMusic(L, W, H, live, now);
    } else if (!vizOff) {
      Fx.drawIdle(vctx, L, W, H, now, o);
    }
    Fx.drawScanline(vctx, L, W, H, now, o);
    particles.draw(vctx, L, W, H);
    smoke.draw(vctx, L, W, H);
    vctx.restore();

    Fx.drawVignette(vctx, L, W, H, now, o);
    if (settings.crtScanlines) Fx.drawCrtScanlines(vctx, W, H);
    if (settings.filmGrain) Fx.drawFilmGrain(vctx, W, H, now);
    if (settings.vhsWobble) Fx.drawVhsWobble(vctx, W, H, now);
    scrubber.draw();

    if (videoBg.hasVideos()) {
      const pump = audioEngine.state.playing ? 1 + audioEngine.state.lv.bass * PUMP_BASS + pulse * PUMP_PULSE : PUMP_IDLE;
      const shakeBass = settings.shake && audioEngine.state.playing ? Math.max(audioEngine.state.lv.bass * SHAKE_BASS, tremor * SHAKE_TREMOR) : 0;
      const shakeRot = (Math.random() - 0.5) * shakeBass * SHAKE_ROT_MULT;
      bgVideoEls.forEach((el) => {
        el.style.transform = `rotate(${shakeRot.toFixed(6)}rad) scale(${pump.toFixed(4)})`;
      });
    }
    videoBg.update(now);

    pulse *= Math.pow(PULSE_DECAY, dt);
    tremor *= Math.pow(settings.shake ? TREMOR_DECAY_ON : TREMOR_DECAY_OFF, dt);

    const sec = Math.floor(currentTime());
    if (sec !== lastSec) {
      lastSec = sec;
      updateClock();
    }
    scrubber.updateAria();
  }

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

  $('#btn-fs').addEventListener('click', () => window.api.setFullscreen(!state.fullscreen));
  $('#btn-help').addEventListener('click', () => help.toggle());
  vizBtn.addEventListener('click', toggleVisualizer);

  function trapFocus(e) {
    if (e.key !== 'Tab') return;
    const pickerOpen = colorPicker.isOpen();
    const settingsOpen = ui.isSettingsOpen();
    const playlistOpen = playlistUI.isOpen();
    const helpOpen = help.isOpen();
    let container = null;
    if (pickerOpen) container = $('#color-picker-overlay');
    else if (settingsOpen) container = $('#settings');
    else if (helpOpen) container = $('#help-overlay');
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
    if (e.key === 'Escape' && colorPicker.isOpen()) {
      colorPicker.close();
      return;
    }
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
    if (e.key === '?') {
      help.toggle();
      return;
    }
    if (e.key === 'Escape') {
      if (help.isOpen()) { help.close(); return; }
      if (settingsOpen) ui.closeSettings();
      else if (playlistOpen) playlistUI.close();
      else if (state.fullscreen) toggleFullscreen();
    }
  });

  window.addEventListener('dblclick', (e) => {
    if (help.isOpen()) return;
    if (e.target.closest('button, input, #scrubber')) return;
    toggleFullscreen();
  });

  async function toggleFullscreen() {
    state.fullscreen = !state.fullscreen;
    await window.api.setFullscreen(state.fullscreen);
  }

  window.api.onFullscreenChange((flag) => {
    state.fullscreen = flag;
  });

  window.api.onMenuAction((action) => {
    if (action === 'open-track') openTrack();
    else if (action === 'playlist') playlistUI.isOpen() ? playlistUI.close() : playlistUI.open();
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
    });
    appSettings.applyAppIcon();
    restoreAll();
  }

  init();
})();