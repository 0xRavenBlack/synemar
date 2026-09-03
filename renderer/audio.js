(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./util'));
  } else {
    root.AudioEngine = factory(root.Util);
  }
})(typeof self !== 'undefined' ? self : this, function (Util) {
  const { clamp, nextPow2 } = Util;

  function trySafe(fn) {
    try { return fn(); } catch (e) { /* noop */ }
  }

  const KICK_MIN_BASS = 0.06;
  const KICK_AVG_MULT = 1.18;
  const KICK_COOLDOWN_MS = 110;
  const ENERGY_HIST_SIZE = 48;
  const BK_DECAY = 0.3;

  function init(opts) {
    const settings = (opts && opts.settings) || {};
    const onKick = (opts && opts.onKick) || function () {};
    let onEndedCb = null;

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
      lv: { bass: 0, mid: 0, hi: 0 }
    };
    state.freqByte = new Uint8Array(4096);
    state.timeByte = new Uint8Array(8192);
    state.curFft = 512;

    const energyHist = new Float32Array(ENERGY_HIST_SIZE);
    let energyHistLen = 0;
    let energyHistHead = 0;
    let lastKickTs = 0;

    function ensureCtx() {
      if (!state.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        state.ctx = new AC();
      }
      if (state.ctx.state === 'suspended') state.ctx.resume();
      return state.ctx;
    }

    function currentTime() {
      if (state.playing && state.buffer && state.ctx) {
        return Math.min(state.baseOffset + (state.ctx.currentTime - state.startCtxTime), state.buffer.duration);
      }
      return state.offset;
    }

    function stopCurrent() {
      if (state.source) {
        const s = state.source;
        state.source = null;
        trySafe(() => { s.stop(); });
        trySafe(() => { s.disconnect(); });
      }
      if (state.analyser) {
        trySafe(() => { state.analyser.disconnect(); });
        state.analyser = null;
      }
      if (state.gainNode) {
        trySafe(() => { state.gainNode.disconnect(); });
        state.gainNode = null;
      }
    }

    function wireAudioOut(gain) {
      if (!gain) return;
      trySafe(() => { gain.disconnect(); });
      gain.connect(state.ctx.destination);
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
        if (onEndedCb) onEndedCb();
      });
    }

    function play() {
      if (!state.buffer) return;
      ensureCtx();
      if (state.playing) return;
      if (state.offset >= state.buffer.duration - 0.06) state.offset = 0;
      state.playing = true;
      spawnSource(state.offset);
    }

    function pause() {
      if (!state.playing) return;
      state.offset = currentTime();
      state.playing = false;
      stopCurrent();
    }

    function seekTo(t) {
      if (!state.buffer) return;
      state.offset = clamp(t, 0, state.buffer.duration);
      if (state.playing) spawnSource(state.offset);
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

    function load(buffer) {
      stopCurrent();
      state.buffer = buffer;
      state.peaks = computePeaks(buffer);
      state.offset = 0;
      state.playing = false;
    }

    function clear() {
      stopCurrent();
      state.buffer = null;
      state.peaks = null;
      state.offset = 0;
      state.playing = false;
    }

    function updateAnalyser() {
      if (!state.analyser) return;
      state.analyser.fftSize = nextPow2(Math.max(settings.barCount * 4, 128));
      state.analyser.smoothingTimeConstant = settings.smoothing;
    }

    function updateGain() {
      if (state.gainNode) state.gainNode.gain.value = settings.muted ? 0 : settings.volume;
    }

    function analyzeSpectrum(live) {
      if (!state.analyser || !state.playing) return;
      const fft = state.analyser.fftSize;
      state.curFft = fft;
      state.analyser.getByteFrequencyData(state.freqByte.subarray(0, fft >> 1));
      state.analyser.getByteTimeDomainData(state.timeByte.subarray(0, fft));

      const dB = state.freqByte.subarray(0, state.curFft >> 1);
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
      state.lv.bass += (bass - state.lv.bass) * BK_DECAY;
      state.lv.mid += (mid - state.lv.mid) * BK_DECAY;
      state.lv.hi += (hi - state.lv.hi) * BK_DECAY;

      energyHist[energyHistHead] = bass;
      energyHistHead = (energyHistHead + 1) % ENERGY_HIST_SIZE;
      if (energyHistLen < ENERGY_HIST_SIZE) energyHistLen++;
      let avg = 0;
      for (let i = 0; i < energyHistLen; i++) avg += energyHist[i];
      avg /= energyHistLen;

      const nowTs = performance.now();
      if (nowTs - lastKickTs > KICK_COOLDOWN_MS && bass > KICK_MIN_BASS && bass > avg * KICK_AVG_MULT) {
        lastKickTs = nowTs;
        onKick();
      }
    }

    const api = {
      state,
      onEnded(cb) { onEndedCb = cb; return api; },
      ensureCtx,
      currentTime,
      stopCurrent,
      play,
      pause,
      seekTo,
      computePeaks,
      load,
      clear,
      updateAnalyser,
      updateGain,
      wireAudioOut,
      setPlaying(flag) { state.playing = !!flag; },
      setOffset(v) { state.offset = v; },
      analyzeSpectrum
    };
    return api;
  }

  return { init, KICK_MIN_BASS, KICK_AVG_MULT, KICK_COOLDOWN_MS, ENERGY_HIST_SIZE, BK_DECAY };
});