(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./util'), require('./color'));
  } else {
    root.Scrubber = factory(root.Util, root.ColorUtil);
  }
})(typeof self !== 'undefined' ? self : this, function (Util, ColorUtil) {
  const { clamp } = Util;
  const { rgbaStr } = ColorUtil;

  function create(opts) {
    const { audioEngine, fx, onResume, onClockUpdate, setPlayingClass, canvas, tip } = opts;
    const ctx = canvas.getContext('2d');

    let scrubbing = false;
    let wasPlaying = false;
    let previewOffset = null;
    let lastAriaValue = -1;

    function isScrubbing() { return scrubbing; }

    function currentTime(audioTime) {
      if (scrubbing && previewOffset != null) return previewOffset;
      return audioTime;
    }

    function moveTip(frac) {
      if (!tip) return;
      const buffer = audioEngine.state.buffer;
      if (!buffer) return;
      const rect = canvas.getBoundingClientRect();
      const offset = frac * buffer.duration;
      tip.textContent = Util.fmtTime(offset);
      tip.classList.remove('hidden');
      const tipRect = tip.getBoundingClientRect();
      let left = rect.left + frac * rect.width - tipRect.width / 2;
      const maxLeft = rect.right - tipRect.width;
      left = Util.clamp(left, 0, Math.max(0, maxLeft));
      tip.style.left = `${left}px`;
    }

    function hideTip() {
      if (tip) tip.classList.add('hidden');
    }

    function setPreviewFromEvent(e) {
      const buffer = audioEngine.state.buffer;
      if (!buffer) return;
      const rect = canvas.getBoundingClientRect();
      const frac = Util.clamp((e.clientX - rect.left) / rect.width, 0, 1);
      previewOffset = frac * buffer.duration;
      moveTip(frac);
    }

    function endScrub(commit) {
      if (!scrubbing) return;
      scrubbing = false;
      hideTip();
      const buffer = audioEngine.state.buffer;
      if (commit && buffer) audioEngine.setOffset(clamp(previewOffset ?? audioEngine.state.offset, 0, buffer.duration));
      previewOffset = null;
      if (commit && buffer && wasPlaying) onResume();
      else onClockUpdate();
    }

    function draw() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = window.devicePixelRatio || 1;
      const W = Math.round(rect.width), H = Math.round(rect.height);
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const dur = audioEngine.state.buffer ? audioEngine.state.buffer.duration : 0;
      const peaks = audioEngine.state.peaks;
      if (!peaks || !dur) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(0, 0, W, H);
        return;
      }
      const pairs = peaks.length / 2;
      const mid = H / 2;
      const cursor = scrubbing && previewOffset != null ? previewOffset : audioEngine.currentTime();
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
        ctx.fillStyle = played ? rgbaStr(fx.accent, 0.9) : 'rgba(255,255,255,0.16)';
        ctx.fillRect(x, top, w, Math.max(1, bot - top));
      }
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.fillRect(0, 0, cursorX, H);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cursorX, 2);
      ctx.lineTo(cursorX, H - 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(cursorX, H / 2, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    function updateAria() {
      const buffer = audioEngine.state.buffer;
      const dur = buffer ? buffer.duration : 0;
      const val = dur ? Math.round((currentTime(audioEngine.currentTime()) / dur) * 100) : 0;
      if (val !== lastAriaValue) {
        lastAriaValue = val;
        canvas.setAttribute('aria-valuenow', String(val));
      }
    }

    function wire() {
      canvas.addEventListener('pointerdown', (e) => {
        if (!audioEngine.state.buffer) return;
        scrubbing = true;
        wasPlaying = audioEngine.state.playing;
        if (audioEngine.state.playing) {
          audioEngine.setOffset(audioEngine.currentTime());
          audioEngine.setPlaying(false);
          audioEngine.stopCurrent();
          setPlayingClass(false);
        }
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture may fail if pointer already captured */ }
        setPreviewFromEvent(e);
      });
      canvas.addEventListener('pointermove', (e) => {
        if (scrubbing) setPreviewFromEvent(e);
        else moveTip(Util.clamp((e.clientX - canvas.getBoundingClientRect().left) / canvas.getBoundingClientRect().width, 0, 1));
      });
      canvas.addEventListener('pointerleave', () => {
        if (!scrubbing) hideTip();
      });
      canvas.addEventListener('pointerup', () => { endScrub(true); });
      canvas.addEventListener('pointercancel', () => { endScrub(false); });
      window.addEventListener('pointerup', () => { endScrub(true); });
      window.addEventListener('pointercancel', () => { endScrub(false); });
      window.addEventListener('blur', () => { endScrub(false); });
    }

    return { draw, wire, currentTime, isScrubbing, updateAria };
  }

  return { create };
});