(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PlaylistEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function mediaUrl(p) {
    return 'media://file/?path=' + encodeURIComponent(p);
  }

  function trySafe(fn) {
    try { return fn(); } catch (e) { /* noop */ }
  }

  function hasReadyFrame(el) {
    try {
      return el.readyState === undefined || el.readyState >= 2;
    } catch (e) {
      return true;
    }
  }

  function canListen(el) {
    return typeof el.addEventListener === 'function' && typeof el.removeEventListener === 'function';
  }

  function stopVideoEl(el) {
    trySafe(() => el.pause());
    el.removeAttribute('src');
    trySafe(() => el.load());
    setOpacity(el, 0);
    setLayer(el, false);
  }

  function startVideoEl(el, path) {
    el.src = mediaUrl(path);
    el.load();
    const pr = el.play();
    if (pr) pr.catch(() => {});
  }

  function loadVideoEl(el, path) {
    el.src = mediaUrl(path);
    el.load();
    trySafe(() => el.pause());
  }

  function waitReady(el, timeoutMs, onReady, schedule, cancel) {
    if (hasReadyFrame(el)) {
      onReady();
      return;
    }
    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (canListen(el)) el.removeEventListener('loadeddata', onData);
      cancel(timer);
      onReady();
    };
    function onData() { finish(); }
    if (canListen(el)) el.addEventListener('loadeddata', onData);
    timer = schedule(() => finish(), timeoutMs);
  }

  function setOpacity(el, v) {
    el.style.opacity = v;
  }

  function setLayer(el, on) {
    if (typeof el.classList !== 'undefined') {
      const has = el.classList.contains('video-in');
      if (on && !has) el.classList.add('video-in');
      else if (!on && has) el.classList.remove('video-in');
    }
  }

  function createPlaylist(opts) {
    const els = opts.elements;
    const crossfadeMs = opts.crossfadeMs;
    const schedule = opts.schedule || ((fn, ms) => setTimeout(fn, ms));
    const cancel = opts.cancel || ((t) => clearTimeout(t));
    const currentTime = opts.currentTime || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    const readiness = opts.waitReady || waitReady;

    let activeVidIdx = 0;
    let activePlIdx = 0;
    let fade = null;
    let lastEndedAt = -Infinity;

    function listOf(videos) {
      return (videos || []).map((p) => (typeof p === 'string' ? p.trim() : '')).filter(Boolean);
    }

    function activeEl() {
      return els[activeVidIdx];
    }

    function otherEl() {
      return els[1 - activeVidIdx];
    }

    function prepareNextVideo(list) {
      if (list.length < 2) return;
      const nextPl = (activePlIdx + 1) % list.length;
      const nextEl = otherEl();
      loadVideoEl(nextEl, list[nextPl]);
    }

    function startPlaylist(list) {
      fade = null;
      if (!list.length) {
        els.forEach(stopVideoEl);
        activeVidIdx = 0;
        activePlIdx = 0;
        return;
      }
      activePlIdx = Math.min(activePlIdx, list.length - 1);
      setOpacity(activeEl(), 1);
      setLayer(activeEl(), false);
      stopVideoEl(otherEl());
      startVideoEl(activeEl(), list[activePlIdx]);
      prepareNextVideo(list);
    }

    function tick(now) {
      if (!fade) return;
      let t = (now - fade.start) / fade.dur;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      const inc = 1 - Math.pow(1 - t, 3);
      setOpacity(fade.inEl, inc);
      setOpacity(fade.outEl, 1 - Math.pow(t, 3));
      if (t >= 1) {
        setOpacity(fade.outEl, 0);
        setLayer(fade.outEl, false);
        setLayer(fade.inEl, false);
        stopVideoEl(fade.outEl);
        fade = null;
      }
    }

    function handleVideoEnded(list) {
      if (!list.length) return;
      if (fade) return;
      if (list.length < 2) {
        const el = activeEl();
        el.currentTime = 0;
        el.play().catch(() => {});
        return;
      }
      const now = currentTime();
      if (now - lastEndedAt < crossfadeMs) return;
      lastEndedAt = now;
      const nextPl = (activePlIdx + 1) % list.length;
      const nextEl = otherEl();
      const oldEl = activeEl();
      const nextUrl = mediaUrl(list[nextPl]);
      if (nextEl.getAttribute('src') !== nextUrl) {
        loadVideoEl(nextEl, list[nextPl]);
      }
      readiness(nextEl, crossfadeMs, () => {
        switchTo(nextEl, oldEl, list, nextPl);
      }, schedule, cancel);
    }

    function switchTo(nextEl, oldEl, list, nextPl) {
      const pr = nextEl.play();
      if (pr) pr.catch(() => {});
      setOpacity(nextEl, 0);
      setOpacity(oldEl, 1);
      setLayer(nextEl, true);
      fade = { inEl: nextEl, outEl: oldEl, start: currentTime(), dur: crossfadeMs };
      activeVidIdx = 1 - activeVidIdx;
      activePlIdx = nextPl;
      prepareNextVideo(list);
    }

    return {
      handleVideoEnded(videos) {
        return handleVideoEnded(listOf(videos));
      },
      startPlaylist(videos) {
        return startPlaylist(listOf(videos));
      },
      update(now) {
        tick(now);
      }
    };
  }

  return { createPlaylist, mediaUrl, stopVideoEl, startVideoEl };
});
