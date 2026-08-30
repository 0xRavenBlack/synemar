(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./util'), require('./color'));
  } else {
    root.Recorder = factory(root.Util, root.ColorUtil);
  }
})(typeof self !== 'undefined' ? self : this, function (Util, ColorUtil) {
  const { parseTextShadows } = ColorUtil;

  function trySafe(fn) {
    try { return fn(); } catch (e) { /* noop */ }
  }

  function create(opts) {
    const state = {
      recording: false,
      recTimer: null,
      recCap: null,
      recCapCtx: null,
      recBusy: false
    };
    const recPending = [];
    let starting = false;

    const {
      settings, fx, audioEngine,
      getPulse, hasVideos, bgVideoEls, vizCanvas,
      brand, marquee, title, artist, album, metaSub, customText,
      isPlayingClass, toast
    } = opts;

    function overlayInfo(el) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { cs, r, visible: cs.display !== 'none' && parseFloat(cs.opacity || 1) > 0.01 };
    }

    function drawVideoCover(ctx, el, W, H, pump) {
      const vW = el.videoWidth, vH = el.videoHeight;
      if (!vW || !vH) return;
      const scale = Math.max(W / vW, H / vH);
      const sw = W / scale, sh = H / scale;
      const sx = (vW - sw) / 2, sy = (vH - sh) / 2;
      const dW = W * pump, dH = H * pump;
      ctx.drawImage(el, sx, sy, sw, sh, (W - dW) / 2, (H - dH) / 2, dW, dH);
    }

    function drawOverlayText(rc, el, align, alpha) {
      const o = overlayInfo(el);
      if (!o.visible || !el.textContent) return;
      const cs = o.cs;
      rc.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      rc.textBaseline = 'middle';
      rc.textAlign = align || 'center';
      trySafe(() => { rc.letterSpacing = cs.letterSpacing; });
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
      trySafe(() => { rc.letterSpacing = '0px'; });
    }

    function drawBrandOverlay(rc) {
      const o = overlayInfo(brand);
      if (!o.visible) return;
      const playing = isPlayingClass();
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
      trySafe(() => { rc.letterSpacing = '6px'; });
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
      trySafe(() => { rc.letterSpacing = '0px'; });
    }

    function drawCustomOverlay(rc) {
      if (!customText.textContent) return;
      const o = overlayInfo(customText);
      if (!o.visible) return;
      drawOverlayText(rc, customText);
    }

    function drawOverlayLayers(rc) {
      drawBrandOverlay(rc);
      drawCustomOverlay(rc);
      const o = overlayInfo(marquee);
      if (!o.visible) return;
      if (!title.textContent && !artist.textContent && !album.textContent) return;
      if (title.textContent) drawOverlayText(rc, title);
      for (let i = 0; i < metaSub.children.length; i++) drawOverlayText(rc, metaSub.children[i]);
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
        const pump = audioEngine.state.playing ? 1 + audioEngine.state.lv.bass * 0.16 + getPulse() * 0.05 : 1.02;
        if (blur > 0) rc.filter = `blur(${blur * pump}px)`;
        rc.globalAlpha = 1;
        for (const el of bgVideoEls) {
          if (!el.videoWidth) continue;
          rc.globalAlpha = parseFloat(getComputedStyle(el).opacity) || 0;
          if (rc.globalAlpha <= 0) continue;
          drawVideoCover(rc, el, W, H, pump);
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

    function startRecCapture() {
      if (state.recTimer) return;
      if (!state.recCap) {
        state.recCap = document.createElement('canvas');
        state.recCapCtx = state.recCap.getContext('2d');
      }
      state.recTimer = setInterval(() => {
        if (!state.recording || state.recBusy) return;
        captureComposite();
        const data = state.recCap.toDataURL('image/jpeg', 0.9);
        state.recBusy = true;
        const p = window.api.recordFrame(data.split(',')[1]);
        recPending.push(p);
        const done = () => {
          state.recBusy = false;
          const i = recPending.indexOf(p);
          if (i >= 0) recPending.splice(i, 1);
        };
        p.then(done, done);
      }, 1000 / 30);
    }

    function stopRecCapture() {
      if (!state.recTimer) return;
      clearInterval(state.recTimer);
      state.recTimer = null;
    }

    async function start() {
      if (state.recording || starting) return;
      starting = true;
      try {
        const begin = await window.api.recordStart({ sampleRate: audioEngine.ensureCtx().sampleRate || 44100 });
        if (!begin || begin.error) {
          toast(begin && begin.error ? `Could not start the recorder: ${begin.error}` : 'Could not start the recorder.');
          return;
        }
        state.recording = true;
        audioEngine.setRecording(true);
        audioEngine.startAudioTap();
        if (audioEngine.state.gainNode) audioEngine.wireAudioOut(audioEngine.state.gainNode);
        startRecCapture();
        updateRecButton();
        toast('Recording… press the ● button or R to stop');
      } finally {
        starting = false;
      }
    }

    async function stop() {
      if (!state.recording) return;
      state.recording = false;
      audioEngine.setRecording(false);
      stopRecCapture();
      toast('Finalizing…');
      await Promise.allSettled(recPending);
      recPending.length = 0;
      audioEngine.detachAudioTap();
      if (audioEngine.state.gainNode) audioEngine.wireAudioOut(audioEngine.state.gainNode);
      const fin = await window.api.recordStop();
      updateRecButton();
      toast(fin && fin.ok
        ? `Recording saved: ${fin.path}`
        : (fin && fin.error ? `Recording failed: ${fin.error}` : 'Could not save the recording.'));
    }

    function toggle() {
      if (state.recording) stop();
      else if (!starting) start();
    }

    function updateRecButton() {
      const btn = document.getElementById('btn-rec');
      if (!btn) return;
      btn.classList.toggle('on', !!state.recording);
      btn.title = state.recording ? 'Stop recording (R)' : 'Record screen + audio (R)';
    }

    function onRecError(message) {
      const was = state.recording;
      state.recording = false;
      audioEngine.setRecording(false);
      stopRecCapture();
      recPending.length = 0;
      state.recBusy = false;
      audioEngine.detachAudioTap();
      if (audioEngine.state.gainNode) audioEngine.wireAudioOut(audioEngine.state.gainNode);
      updateRecButton();
      toast(was ? `Recording failed: ${message}` : (message || 'Recording failed'));
    }

    window.api.onRecError(onRecError);

    return {
      start,
      stop,
      toggle,
      isRecording: () => state.recording,
      updateRecButton,
      state
    };
  }

  return { create };
});