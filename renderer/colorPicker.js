(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./color'));
  } else {
    root.ColorPicker = factory(root.ColorUtil);
  }
})(typeof self !== 'undefined' ? self : this, function (Color) {
  const { hexToRgb, rgbToHex, rgbToHsl, hslToRgb } = Color;

  function create(opts) {
    const { settings, save, apply } = opts;
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => Array.from(document.querySelectorAll(s));

    const overlay = $('#color-picker-overlay');
    const slCanvas = $('#cpicker-sl');
    const hueCanvas = $('#cpicker-hue');
    const hexInput = $('#cpicker-hex-input');
    const swatch = $('#cpicker-swatch');
    const slCtx = slCanvas.getContext('2d');
    const hueCtx = hueCanvas.getContext('2d');
    const slWrap = slCanvas.parentElement;
    const hueWrap = hueCanvas.parentElement;
    let activeInput = null;
    let activeKey = null;
    let hue = 0;
    let sat = 1;
    let lit = 0.5;

    function drawHueStrip() {
      const grad = hueCtx.createLinearGradient(0, 0, 0, hueCanvas.height);
      for (let i = 0; i <= 6; i++) {
        const rgb = hslToRgb(i / 6, 1, 0.5);
        grad.addColorStop(i / 6, rgbToHex(rgb.r, rgb.g, rgb.b));
      }
      hueCtx.fillStyle = grad;
      hueCtx.fillRect(0, 0, hueCanvas.width, hueCanvas.height);
    }

    function drawSL() {
      const w = slCanvas.width;
      const h = slCanvas.height;
      const img = slCtx.createImageData(w, h);
      const buf = img.data;
      let p = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const rgb = hslToRgb(hue, x / (w - 1), 1 - y / (h - 1));
          buf[p] = rgb.r;
          buf[p + 1] = rgb.g;
          buf[p + 2] = rgb.b;
          buf[p + 3] = 255;
          p += 4;
        }
      }
      slCtx.putImageData(img, 0, 0);
    }

    function updateIndicators() {
      slWrap.style.setProperty('--sl-x', sat * 100 + '%');
      slWrap.style.setProperty('--sl-y', (1 - lit) * 100 + '%');
      hueWrap.style.setProperty('--hue-y', hue * 100 + '%');
    }

    function updateSwatch() {
      const rgb = hslToRgb(hue, sat, lit);
      const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      swatch.style.background = hex;
      hexInput.value = hex;
    }

    function applyColors() {
      const root = document.documentElement.style;
      root.setProperty('--bg-color', settings.bgColor);
      root.setProperty('--text', settings.textColor);
      root.setProperty('--accent', settings.accent);
      root.setProperty('--viz-top', settings.vizTop);
      root.setProperty('--viz-bottom', settings.vizBottom);
      $('#hex-bgcolor').textContent = settings.bgColor;
      $('#hex-text').textContent = settings.textColor;
      $('#hex-accent').textContent = settings.accent;
      $('#hex-viztop').textContent = settings.vizTop;
      $('#hex-vizbot').textContent = settings.vizBottom;
    }

    function commit(hex) {
      if (!activeInput || !activeKey) return;
      activeInput.value = hex;
      settings[activeKey] = hex;
      applyColors();
      save();
    }

    function setFromSL(x, y) {
      const rect = slCanvas.getBoundingClientRect();
      sat = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
      lit = Math.max(0, Math.min(1, 1 - (y - rect.top) / rect.height));
      drawSL();
      updateIndicators();
      updateSwatch();
      const rgb = hslToRgb(hue, sat, lit);
      commit(rgbToHex(rgb.r, rgb.g, rgb.b));
    }

    function setFromHue(y) {
      const rect = hueCanvas.getBoundingClientRect();
      hue = Math.max(0, Math.min(1, (y - rect.top) / rect.height));
      drawSL();
      updateIndicators();
      updateSwatch();
      const rgb = hslToRgb(hue, sat, lit);
      commit(rgbToHex(rgb.r, rgb.g, rgb.b));
    }

    function openPicker(input) {
      activeInput = input;
      activeKey = input.dataset.key;
      const { r, g, b } = hexToRgb(input.value);
      const hsl = rgbToHsl(r, g, b);
      hue = hsl.h; sat = hsl.s; lit = hsl.l;
      overlay.classList.remove('hidden');
      drawHueStrip();
      drawSL();
      updateIndicators();
      updateSwatch();
    }

    function closePicker() {
      overlay.classList.add('hidden');
      activeInput = null;
      activeKey = null;
      apply();
      save();
    }

    function isOpen() { return !overlay.classList.contains('hidden'); }

    function init() {
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closePicker(); });
      $('#cpicker-close').addEventListener('click', closePicker);

      hexInput.addEventListener('input', () => {
        const v = hexInput.value.trim();
        if (/^#[0-9a-f]{6}$/i.test(v)) {
          const { r, g, b } = hexToRgb(v);
          const hsl = rgbToHsl(r, g, b);
          hue = hsl.h; sat = hsl.s; lit = hsl.l;
          drawSL();
          updateIndicators();
          updateSwatch();
          commit(v);
        }
      });

      slCanvas.addEventListener('mousedown', (e) => {
        setFromSL(e.clientX, e.clientY);
        const move = (ev) => setFromSL(ev.clientX, ev.clientY);
        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      });
      hueCanvas.addEventListener('mousedown', (e) => {
        setFromHue(e.clientY);
        const move = (ev) => setFromHue(ev.clientY);
        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      });

      slCanvas.addEventListener('touchstart', (e) => { e.preventDefault(); setFromSL(e.touches[0].clientX, e.touches[0].clientY); });
      slCanvas.addEventListener('touchmove', (e) => { e.preventDefault(); setFromSL(e.touches[0].clientX, e.touches[0].clientY); });
      hueCanvas.addEventListener('touchstart', (e) => { e.preventDefault(); setFromHue(e.touches[0].clientY); });
      hueCanvas.addEventListener('touchmove', (e) => { e.preventDefault(); setFromHue(e.touches[0].clientY); });

      $$('.color-field input[type="color"]').forEach((input) => {
        input.addEventListener('click', (e) => {
          e.preventDefault();
          openPicker(input);
        });
      });
    }

    return { init, isOpen, close: closePicker };
  }

  return { create };
});