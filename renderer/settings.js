(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Settings = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function create(opts) {
    const { marquee, customText } = opts;
    const body = document.body;
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => Array.from(document.querySelectorAll(s));

    const DEFAULT_SETTINGS = {
      bgColor: '#0b0e14',
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
      crtScanlines: false,
      filmGrain: false,
      vhsWobble: false,
      showLogo: true,
      showDock: true,
      marqueeX: 50,
      marqueeY: 29,
      customText: '',
      showCustomText: true,
      customX: 50,
      customY: 50
    };

    function loadSettings() {
      try {
        const raw = localStorage.getItem('neoneq.settings');
        if (!raw) return { ...DEFAULT_SETTINGS };
        const saved = JSON.parse(raw);
        const merged = { ...DEFAULT_SETTINGS, ...saved };
        delete merged.bgVideos;
        delete merged.bgImage;
        delete merged.bgImagePath;
        return merged;
      } catch (e) {
        return { ...DEFAULT_SETTINGS };
      }
    }

    const settings = loadSettings();

    function save() {
      try {
        localStorage.setItem('neoneq.settings', JSON.stringify(settings));
      } catch (e) { /* ignore quota */ }
    }

    let audioEngine = null;
    let videoBg = null;
    let ui = null;

    function apply() {
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
      $('#set-crt').checked = settings.crtScanlines;
      $('#set-grain').checked = settings.filmGrain;
      $('#set-wobble').checked = settings.vhsWobble;
      $('#set-logo').checked = settings.showLogo;
      $('#set-dock').checked = settings.showDock;
      body.classList.toggle('no-logo', !settings.showLogo);
      body.classList.toggle('no-dock', !settings.showDock);
      marquee.style.left = `${settings.marqueeX}%`;
      marquee.style.top = `${settings.marqueeY}%`;
      $('#set-custom-text').value = settings.customText;
      $('#set-custom').checked = !!settings.showCustomText;
      customText.textContent = settings.customText;
      body.classList.toggle('no-custom', !settings.showCustomText || !settings.customText);
      customText.style.left = `${settings.customX}%`;
      customText.style.top = `${settings.customY}%`;
      $('#volume').value = settings.volume;
      $$('input[type="range"]').forEach(ui.fillRange);
      ui.updateSizeNote();

      videoBg.apply();
      audioEngine.updateAnalyser();
      audioEngine.updateGain();
    }

    function hexToRgb(hex) {
      const n = parseInt(hex.replace('#', ''), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function rgbToHex(r, g, b) {
      return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
    }

    function rgbToHsl(r, g, b) {
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      let h = 0; let s = 0;
      const l = (max + min) / 2;
      if (d) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
      }
      return [h, s, l];
    }

    function hslToRgb(h, s, l) {
      if (!s) { const v = Math.round(l * 255); return [v, v, v]; }
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      return [
        Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
        Math.round(hue2rgb(p, q, h) * 255),
        Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
      ];
    }

    function initColorPicker() {
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
          grad.addColorStop(i / 6, rgbToHex(...rgb));
        }
        hueCtx.fillStyle = grad;
        hueCtx.fillRect(0, 0, hueCanvas.width, hueCanvas.height);
      }

      function drawSL() {
        const w = slCanvas.width;
        const h = slCanvas.height;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const rgb = hslToRgb(hue, x / (w - 1), 1 - y / (h - 1));
            slCtx.fillStyle = rgbToHex(...rgb);
            slCtx.fillRect(x, y, 1, 1);
          }
        }
      }

      function updateIndicators() {
        slWrap.style.setProperty('--sl-x', sat * 100 + '%');
        slWrap.style.setProperty('--sl-y', (1 - lit) * 100 + '%');
        hueWrap.style.setProperty('--hue-y', hue * 100 + '%');
      }

      function updateSwatch() {
        const rgb = hslToRgb(hue, sat, lit);
        const hex = rgbToHex(...rgb);
        swatch.style.background = hex;
        hexInput.value = hex;
      }

      function commit(hex) {
        if (!activeInput || !activeKey) return;
        activeInput.value = hex;
        settings[activeKey] = hex;
        apply();
        save();
      }

      function setFromSL(x, y) {
        const rect = slCanvas.getBoundingClientRect();
        sat = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
        lit = Math.max(0, Math.min(1, 1 - (y - rect.top) / rect.height));
        drawSL();
        updateIndicators();
        updateSwatch();
        commit(rgbToHex(...hslToRgb(hue, sat, lit)));
      }

      function setFromHue(y) {
        const rect = hueCanvas.getBoundingClientRect();
        hue = Math.max(0, Math.min(1, (y - rect.top) / rect.height));
        drawSL();
        updateIndicators();
        updateSwatch();
        commit(rgbToHex(...hslToRgb(hue, sat, lit)));
      }

      function openPicker(input) {
        activeInput = input;
        activeKey = input.dataset.key;
        const [r, g, b] = hexToRgb(input.value);
        [hue, sat, lit] = rgbToHsl(r, g, b);
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
      }

      overlay.addEventListener('click', (e) => { if (e.target === overlay) closePicker(); });
      $('#cpicker-close').addEventListener('click', closePicker);

      hexInput.addEventListener('input', () => {
        const v = hexInput.value.trim();
        if (/^#[0-9a-f]{6}$/i.test(v)) {
          const [r, g, b] = hexToRgb(v);
          [hue, sat, lit] = rgbToHsl(r, g, b);
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

    function bindSetting(input, key, transform) {
      input.addEventListener('input', () => {
        settings[key] = transform(input.value);
        if (key === 'smoothing' || key === 'barCount') audioEngine.updateAnalyser();
        apply();
        save();
      });
    }

    function wire(deps) {
      audioEngine = deps.audioEngine;
      videoBg = deps.videoBg;
      ui = deps.ui;

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
        save();
      });
      $('#set-shake').addEventListener('change', (e) => {
        settings.shake = e.target.checked;
        save();
      });
      $('#set-aurora').addEventListener('change', (e) => {
        settings.aurora = e.target.checked;
        save();
      });
      $('#set-particles').addEventListener('change', (e) => {
        settings.particles = e.target.checked;
        save();
      });
      $('#set-crt').addEventListener('change', (e) => {
        settings.crtScanlines = e.target.checked;
        save();
      });
      $('#set-grain').addEventListener('change', (e) => {
        settings.filmGrain = e.target.checked;
        save();
      });
      $('#set-wobble').addEventListener('change', (e) => {
        settings.vhsWobble = e.target.checked;
        save();
      });
      $('#set-logo').addEventListener('change', (e) => {
        settings.showLogo = e.target.checked;
        body.classList.toggle('no-logo', !settings.showLogo);
        save();
      });
      $('#set-dock').addEventListener('change', (e) => {
        settings.showDock = e.target.checked;
        body.classList.toggle('no-dock', !settings.showDock);
        save();
      });
      $('#btn-title-center').addEventListener('click', () => {
        settings.marqueeX = 50;
        settings.marqueeY = 29;
        marquee.style.left = '50%';
        marquee.style.top = '29%';
        save();
        ui.toast('Title centered');
      });
      $('#set-custom-text').addEventListener('input', (e) => {
        settings.customText = e.target.value;
        customText.textContent = settings.customText;
        body.classList.toggle('no-custom', !settings.showCustomText || !settings.customText);
        save();
      });
      $('#set-custom').addEventListener('change', (e) => {
        settings.showCustomText = e.target.checked;
        body.classList.toggle('no-custom', !settings.showCustomText || !settings.customText);
        save();
      });
      $('#btn-custom-center').addEventListener('click', () => {
        settings.customX = 50;
        settings.customY = 50;
        customText.style.left = '50%';
        customText.style.top = '50%';
        save();
        ui.toast('Custom text centered');
      });
      $('#btn-reset').addEventListener('click', () => {
        Object.assign(settings, { ...DEFAULT_SETTINGS });
        apply();
        save();
        ui.toast('Colors reset');
      });
      initColorPicker();
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

    return { settings, save, apply, wire, applyAppIcon };
  }

  return { create };
});