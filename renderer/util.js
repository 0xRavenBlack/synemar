(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Util = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function fmtTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  function nextPow2(v) { let p = 16; while (p < v) p <<= 1; return Math.min(p, 8192); }

  return { clamp, fmtTime, nextPow2 };
});