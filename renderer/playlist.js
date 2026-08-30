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

  function stopVideoEl(el) {
    trySafe(() => el.pause());
    el.removeAttribute('src');
    trySafe(() => el.load());
    el.style.opacity = 0;
  }

  function startVideoEl(el, path) {
    el.src = mediaUrl(path);
    el.load();
    const pr = el.play();
    if (pr) pr.catch(() => {});
  }

  function createPlaylist(opts) {
    const els = opts.elements;
    const crossfadeMs = opts.crossfadeMs;
    const schedule = opts.schedule || ((fn, ms) => setTimeout(fn, ms));
    const cancel = opts.cancel || ((t) => clearTimeout(t));
    const currentTime = opts.currentTime || (() => Date.now());

    let activeVidIdx = 0;
    let activePlIdx = 0;
    let switchTimer = null;
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
      nextEl.src = mediaUrl(list[nextPl]);
      nextEl.load();
      trySafe(() => nextEl.pause());
    }

    function startPlaylist(list) {
      cancel(switchTimer);
      switchTimer = null;
      if (!list.length) {
        els.forEach(stopVideoEl);
        activeVidIdx = 0;
        activePlIdx = 0;
        return;
      }
      activePlIdx = Math.min(activePlIdx, list.length - 1);
      activeEl().style.opacity = 1;
      stopVideoEl(otherEl());
      startVideoEl(activeEl(), list[activePlIdx]);
      prepareNextVideo(list);
    }

    function handleVideoEnded(list) {
      cancel(switchTimer);
      switchTimer = null;
      if (!list.length) return;
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
        startVideoEl(nextEl, list[nextPl]);
      } else {
        const pr = nextEl.play();
        if (pr) pr.catch(() => {});
      }
      nextEl.style.opacity = 1;
      oldEl.style.opacity = 0;
      activeVidIdx = 1 - activeVidIdx;
      activePlIdx = nextPl;
      prepareNextVideo(list);
      const target = oldEl;
      switchTimer = schedule(() => stopVideoEl(target), crossfadeMs + 250);
    }

    return {
      handleVideoEnded(videos) {
        return handleVideoEnded(listOf(videos));
      },
      startPlaylist(videos) {
        return startPlaylist(listOf(videos));
      }
    };
  }

  return { createPlaylist, mediaUrl, stopVideoEl, startVideoEl };
});
