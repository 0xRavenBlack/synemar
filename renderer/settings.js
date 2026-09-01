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