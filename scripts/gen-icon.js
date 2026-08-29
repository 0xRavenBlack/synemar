const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const W = 512, H = 512;

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const barHeights = [];
const N = 28;
let seed = 4242;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
for (let i = 0; i < N; i++) {
  const t = i / (N - 1);
  const env = Math.exp(-Math.pow((t - 0.48) * 2.1, 2));
  barHeights.push(H * (0.10 + env * 0.42 * (0.55 + rnd() * 0.45)));
}

function hex(c) {
  return { r: parseInt(c.slice(1, 3), 16), g: parseInt(c.slice(3, 5), 16), b: parseInt(c.slice(5, 7), 16) };
}
const TOP = hex('#4ee0ff');
const BOT = hex('#ff2970');
const BG0 = hex('#0b0e14');
const BG1 = hex('#131a2b');

const pixels = Buffer.alloc(H * (1 + W * 4));
const barLeft = W * 0.16, barRight = W * 0.84;
const barW = (barRight - barLeft) / N;
const rowBuf = Buffer.alloc(W * 4);
for (let y = 0; y < H; y++) {
  const f = y / (H - 1);
  const bgr = BG0.r + (BG1.r - BG0.r) * f;
  const bgg = BG0.g + (BG1.g - BG0.g) * f;
  const bgb = BG0.b + (BG1.b - BG0.b) * f;
  pixels[y * (1 + W * 4)] = 0;
  for (let x = 0; x < W; x++) {
    let r = bgr, g = bgg, b = bgb, a = 1;
    const bx = (x - barLeft) / barW;
    const i = Math.floor(bx);
    if (i >= 0 && i < N) {
      const li = Math.max(0, i - 1), hi = Math.min(N - 1, i + 1);
      const frac = bx - Math.floor(bx);
      const hBase = barHeights[li] + (barHeights[hi] - barHeights[li]) * frac;
      const half = barW * 0.32;
      const d = Math.abs((x - (barLeft + (i + 0.5) * barW))) / half;
      let edge = 1;
      if (d > 1) edge = 0; else if (d > 0.6) edge = 1 - (d - 0.6) / 0.4;
      const barBottom = H * 0.78;
      const topEdge = barBottom - hBase;
      const gd = Math.abs(bx * (barRight - barLeft) - (x - barLeft)) / (barRight - barLeft);
      const glow = Math.max(0, 1 - gd * 4.5) * 0.12;
      if (edge > 0 && y >= topEdge && y <= barBottom) {
        const odd = (i % 2 === 0) ? -0.06 * hBase : 0;
        const local = y - (barBottom - hBase * 0.35);
        const hFrac = Math.max(0, Math.min(1, (y - (topEdge + odd)) / (barBottom - (topEdge + odd))));
        const tc = 0.4 + 0.6 * hFrac;
        r = TOP.r * tc + BOT.r * (1 - tc);
        g = TOP.g * tc + BOT.g * (1 - tc);
        b = TOP.b * tc + BOT.b * (1 - tc);
        a = edge;
      }
      r = r + TOP.r * glow; g = g + TOP.g * glow; b = b + TOP.b * glow;
    }
    const idx = x * 4;
    rowBuf[idx] = Math.min(255, r);
    rowBuf[idx + 1] = Math.min(255, g);
    rowBuf[idx + 2] = Math.min(255, b);
    rowBuf[idx + 3] = Math.round(a * 255);
  }
  rowBuf.copy(pixels, y * (1 + W * 4) + 1);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(pixels, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const outDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
const outDirWin = path.join(outDir, 'icon.ico');
fs.writeFileSync(outDirWin, png);
console.log('wrote assets/icon.png (' + png.length + ' bytes)');