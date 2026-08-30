const assert = require('assert');
const C = require('../renderer/color');

assert.deepStrictEqual(C.hexToRgb('#0b0e14'), { r: 11, g: 14, b: 20 }, 'hexToRgb');
assert.strictEqual(C.rgbToHex(11, 14, 20), '#0b0e14', 'rgbToHex');
assert.strictEqual(C.rgbToHex(300, -10, 128.6), '#ff0081', 'rgbToHex clamps + rounds');

assert.deepStrictEqual(C.rgbToHsl(255, 0, 0), { h: 0, s: 1, l: 0.5 }, 'rgbToHsl red');
assert.deepStrictEqual(C.hslToRgb(0, 1, 0.5), { r: 255, g: 0, b: 0 }, 'hslToRgb red');
assert.deepStrictEqual(C.hslToRgb(120 / 360, 1, 0.5), { r: 0, g: 255, b: 0 }, 'hslToRgb green');
assert.deepStrictEqual(C.hslToRgb(240 / 360, 1, 0.5), { r: 0, g: 0, b: 255 }, 'hslToRgb blue');
assert.deepStrictEqual(C.hslToRgb(0, 0, 0.3), { r: 77, g: 77, b: 77 }, 'hslToRgb gray');

assert.strictEqual(C.shiftHue('#ff0000', 1 / 3), '#00ff00', 'shiftHue red -> green');
assert.strictEqual(C.shiftHue('#ff0000', 0), '#ff0000', 'shiftHue identity');

assert.deepStrictEqual(C.mixColor({ r: 0, g: 0, b: 0 }, { r: 100, g: 50, b: 200 }, 0.25), { r: 25, g: 12.5, b: 50 }, 'mixColor');
assert.strictEqual(C.rgbaStr({ r: 10, g: 20, b: 30 }, 0.5), 'rgba(10, 20, 30, 0.5)', 'rgbaStr');

assert.deepStrictEqual(C.splitTopLevel('a, b, c', ','), ['a', ' b', ' c'], 'splitTopLevel simple');
assert.deepStrictEqual(C.splitTopLevel('rgba(1, 2, 3), blue', ','), ['rgba(1, 2, 3)', ' blue'], 'splitTopLevel skips parens');

assert.deepStrictEqual(C.mixPart('red 40%'), { color: 'red', pct: 0.4 }, 'mixPart with pct');
assert.deepStrictEqual(C.mixPart('blue'), { color: 'blue', pct: null }, 'mixPart bare');

assert.deepStrictEqual(C.parseColor('transparent'), { r: 0, g: 0, b: 0, a: 0 }, 'parseColor transparent');
assert.deepStrictEqual(C.parseColor('#abc'), { r: 170, g: 187, b: 204, a: 1 }, 'parseColor 3-digit hex');
assert.deepStrictEqual(C.parseColor('#12345678'), { r: 0x34, g: 0x56, b: 0x78, a: 0x12 / 255 }, 'parseColor 8-digit hex');
assert.deepStrictEqual(C.parseColor('rgba(10, 20, 30, 0.5)'), { r: 10, g: 20, b: 30, a: 0.5 }, 'parseColor rgba');
assert.deepStrictEqual(C.parseColor('hsla(210, 50%, 50%, 0.4)'), { r: 64, g: 127, b: 191, a: 0.4 }, 'parseColor hsla');
assert.strictEqual(C.parseColor('not-a-color'), null, 'parseColor invalid');
assert.strictEqual(C.parseColor(''), null, 'parseColor empty');

const mixed = C.parseColor('color-mix(in srgb, #000000, #ffffff)');
assert.strictEqual(mixed.a, 1, 'color-mix alpha');
assert.strictEqual(mixed.r, 127.5, 'color-mix r');
assert.strictEqual(mixed.g, 127.5, 'color-mix g');
assert.strictEqual(mixed.b, 127.5, 'color-mix b');

assert.deepStrictEqual(C.mixColors('#000000', '#ffffff'), { r: 127.5, g: 127.5, b: 127.5, a: 1 }, 'mixColors default 50/50');
assert.strictEqual(C.mixColors('#000000', 'garbage'), null, 'mixColors rejects bad operand');

assert.deepStrictEqual(C.parseTextShadows('rgba(255, 255, 255, 0.5) 0px 2px 8px'), [
  { color: 'rgba(255, 255, 255, 0.5)', dx: 0, dy: 2, blur: 8 }
], 'parseTextShadows single shadow');
assert.deepStrictEqual(C.parseTextShadows('#fff 0px 2px 4px, #000 1px 1px 1px'), [
  { color: 'rgba(255, 255, 255, 1)', dx: 0, dy: 2, blur: 4 },
  { color: 'rgba(0, 0, 0, 1)', dx: 1, dy: 1, blur: 1 }
], 'parseTextShadows multiple shadows');
assert.deepStrictEqual(C.parseTextShadows('none'), [], 'parseTextShadows none');
assert.deepStrictEqual(C.parseTextShadows(''), [], 'parseTextShadows empty');

console.log('color: all tests passed');