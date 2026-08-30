const assert = require('assert');
const U = require('../renderer/util');

assert.strictEqual(U.clamp(5, 0, 10), 5, 'clamp in range');
assert.strictEqual(U.clamp(-1, 0, 10), 0, 'clamp low');
assert.strictEqual(U.clamp(11, 0, 10), 10, 'clamp high');

assert.strictEqual(U.fmtTime(0), '0:00', 'fmtTime zero');
assert.strictEqual(U.fmtTime(59.9), '0:59', 'fmtTime floors');
assert.strictEqual(U.fmtTime(61), '1:01', 'fmtTime minute');
assert.strictEqual(U.fmtTime(3665), '61:05', 'fmtTime hour-scale');
assert.strictEqual(U.fmtTime(-5), '0:00', 'fmtTime negative');

assert.strictEqual(U.nextPow2(16), 16, 'nextPow2 exact');
assert.strictEqual(U.nextPow2(200), 256, 'nextPow2 round up');
assert.strictEqual(U.nextPow2(4096), 4096, 'nextPow2 exact large');
assert.strictEqual(U.nextPow2(100000), 8192, 'nextPow2 capped');
assert.strictEqual(U.nextPow2(1), 16, 'nextPow2 min floor');

console.log('util: all tests passed');