(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ColorUtil = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.substring(0, 2), 16),
      g: parseInt(h.substring(2, 4), 16),
      b: parseInt(h.substring(4, 6), 16)
    };
  }

  function rgbToHex(r, g, b) {
    const to = (v) => String(clamp(Math.round(v), 0, 255).toString(16)).padStart(2, '0');
    return `#${to(r)}${to(g)}${to(b)}`;
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return { h, s, l };
  }

  function hslToRgb(h, s, l) {
    h = (h % 1 + 1) % 1;
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
      r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      g: Math.round(hue2rgb(p, q, h) * 255),
      b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
    };
  }

  function shiftHue(hex, amount) {
    const { r, g, b } = hexToRgb(hex);
    const { h, s, l } = rgbToHsl(r, g, b);
    const out = hslToRgb(h + amount, s, l);
    return rgbToHex(out.r, out.g, out.b);
  }

  function mixColor(cA, cB, t) {
    return {
      r: cA.r + (cB.r - cA.r) * t,
      g: cA.g + (cB.g - cA.g) * t,
      b: cA.b + (cB.b - cA.b) * t
    };
  }

  function rgbaStr(c, a) { return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})`; }

  function splitTopLevel(str, sep) {
    const parts = [];
    let depth = 0, cur = '';
    for (const ch of str) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === sep && depth === 0) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur);
    return parts;
  }

  function mixPart(str) {
    const m = str.match(/^(.*?)\s+(\d+(?:\.\d+)?)%\s*$/);
    if (m) return { color: m[1].trim(), pct: parseFloat(m[2]) / 100 };
    return { color: str.trim(), pct: null };
  }

  function mixColors(aStr, bStr) {
    const a = mixPart(aStr);
    const b = mixPart(bStr);
    const ca = parseColor(a.color);
    const cb = parseColor(b.color);
    if (!ca || !cb) return null;
    let w1 = a.pct, w2 = b.pct;
    if (w1 == null && w2 == null) { w1 = 0.5; w2 = 0.5; }
    else if (w1 == null) w1 = 1 - w2;
    else if (w2 == null) w2 = 1 - w1;
    let sum = w1 + w2;
    if (sum > 1) { w1 /= sum; w2 /= sum; }
    const alpha = ca.a * w1 + cb.a * w2;
    if (alpha <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (ca.r * ca.a * w1 + cb.r * cb.a * w2) / alpha,
      g: (ca.g * ca.a * w1 + cb.g * cb.a * w2) / alpha,
      b: (ca.b * ca.a * w1 + cb.b * cb.a * w2) / alpha,
      a: alpha
    };
  }

  function parseColor(str) {
    const s = String(str || '').trim();
    if (!s) return null;
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    if (s.startsWith('#')) {
      let h = s.slice(1);
      if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
      if (h.length !== 6 && h.length !== 8) return null;
      const n = parseInt(h, 16);
      return {
        r: (n >> 16) & 0xff,
        g: (n >> 8) & 0xff,
        b: n & 0xff,
        a: h.length === 8 ? ((n >> 24) & 0xff) / 255 : 1
      };
    }
    const mix = s.match(/^color-mix\(in\s+srgb,\s*(.+?)\s*,\s*(.+?)\s*\)$/i);
    if (mix) return mixColors(mix[1], mix[2]);
    const rgb = s.match(/^rgba?\(([^)]*)\)$/i);
    if (rgb) {
      const p = rgb[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      if (p.length >= 3 && !p.some(Number.isNaN)) return { r: p[0], g: p[1], b: p[2], a: p.length >= 4 ? p[3] : 1 };
    }
    const hsl = s.match(/^hsla?\(([^)]*)\)$/i);
    if (hsl) {
      const p = hsl[1].split(/[ ,/]+/).filter(Boolean);
      if (p.length >= 3) {
        const r = hslToRgb((parseFloat(p[0]) / 360) % 1, parseFloat(p[1]) / 100, parseFloat(p[2]) / 100);
        const a = p.length >= 4 ? parseFloat(p[3]) : 1;
        return { ...r, a: Number.isFinite(a) ? a : 1 };
      }
    }
    return null;
  }

  function parseTextShadows(str) {
    const list = [];
    for (const part of splitTopLevel(String(str || ''), ',')) {
      const m = part.match(/([-0-9.]+)px\s+([-0-9.]+)px\s+([-0-9.]+)px/);
      if (!m) continue;
      const col = parseColor(part.slice(0, m.index).trim());
      if (!col) continue;
      list.push({
        color: `rgba(${Math.round(col.r)}, ${Math.round(col.g)}, ${Math.round(col.b)}, ${col.a})`,
        dx: parseFloat(m[1]),
        dy: parseFloat(m[2]),
        blur: parseFloat(m[3])
      });
    }
    return list;
  }

  return {
    hexToRgb, rgbToHex, rgbToHsl, hslToRgb, shiftHue, mixColor, rgbaStr,
    parseColor, mixColors, mixPart, splitTopLevel, parseTextShadows
  };
});