const assert = require('assert');
const tm = require('../lib/trackMeta');

function testParse(fileName, artist, title) {
  assert.deepStrictEqual(tm.parseFilenameMeta(fileName), { title, artist, album: null });
}

async function main() {
  testParse('Artist - Song Title.mp3', 'Artist', 'Song Title');
  testParse('SingleTrack.wav', null, 'SingleTrack');
  testParse('Art - Sub - Title.flac', 'Art', 'Sub - Title');
  testParse('NoSeparetor.ogg', null, 'NoSeparetor');
  testParse('A - B - C.m4a', 'A', 'B - C');
  testParse('Spaces -  Trimmed.mp3', 'Spaces', 'Trimmed');
  console.log('trackmeta: parseFilenameMeta OK');

  const small = Buffer.from([1, 2, 3, 4]);
  assert.strictEqual(tm.coverToDataUrl(null), null);
  assert.strictEqual(tm.coverToDataUrl({}), null);
  assert.strictEqual(tm.coverToDataUrl({ data: [] }), null);
  assert.strictEqual(tm.coverToDataUrl({ data: Buffer.alloc(0) }), null);
  assert.strictEqual(tm.coverToDataUrl({ data: Buffer.alloc(11) }, 10), null);
  const pngUrl = tm.coverToDataUrl({ format: 'image/png', data: small });
  assert.ok(pngUrl.startsWith('data:image/png;base64,'), pngUrl);
  const jpegUrl = tm.coverToDataUrl({ format: 'jpeg', data: small });
  assert.ok(jpegUrl.startsWith('data:image/jpeg;base64,'), jpegUrl);
  const dataUrl = tm.coverToDataUrl({ format: 'data:image/webp;base64,', data: small });
  assert.ok(dataUrl.startsWith('data:data:image/webp;base64,;base64,'), dataUrl);
  console.log('trackmeta: coverToDataUrl OK');

  const src = Buffer.from([5, 6, 7, 8, 9, 10]);
  const sliced = src.subarray(2, 5);
  const ab = tm.bufferToArrayBuffer(sliced);
  assert.ok(ab instanceof ArrayBuffer);
  assert.strictEqual(ab.byteLength, 3);
  assert.deepStrictEqual(Array.from(Buffer.from(ab)), [7, 8, 9]);
  console.log('trackmeta: bufferToArrayBuffer offset slice OK');

  let rejected = false;
  try {
    await tm.buildAudioPayload('/definitely/not/here.mp3');
  } catch (e) {
    rejected = true;
    assert.ok(e);
  }
  assert.ok(rejected, 'buildAudioPayload should have rejected');
  console.log('trackmeta: buildAudioPayload missing file rejects OK');
  console.log('trackmeta: all tests passed');
}

main().catch((e) => {
  console.error('trackmeta: FAIL', e);
  process.exit(1);
});