(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Help = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function create() {
    const overlayEl = document.getElementById('help-overlay');
    const closeBtn = document.getElementById('btn-close-help');

    if (!overlayEl || !closeBtn) return { open() {}, close() {}, isOpen() { return false; }, toggle() {} };

    function open() { overlayEl.classList.remove('hidden'); overlayEl.setAttribute('aria-hidden', 'false'); }
    function close() {
      if (overlayEl.classList.contains('hidden')) return;
      overlayEl.classList.add('hidden');
      overlayEl.setAttribute('aria-hidden', 'true');
    }
    function isOpen() { return !overlayEl.classList.contains('hidden'); }
    function toggle() { isOpen() ? close() : open(); }

    closeBtn.addEventListener('click', close);
    overlayEl.addEventListener('click', (e) => {
      if (e.target === overlayEl) close();
    });

    return { open, close, isOpen, toggle };
  }

  return { create };
});