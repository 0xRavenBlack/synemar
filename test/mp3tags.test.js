const assert = require('assert');

function buildV23Frames(frames) {
  const chunks = [];
  for (const [id, data] of frames) {
    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeUInt32BE(data.length, 0);
    chunks.push(Buffer.concat([Buffer.from(id, 'latin1'), sizeBuf, Buffer.from([0, 0]), data]));
  }
  return Buffer.concat(chunks);
}

function syncSafeWrite(size) {
  return Buffer.from([
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f
  ]);
}

const title = Buffer.concat([Buffer.from([0x00]), Buffer.from('Neon Dreams', 'latin1')]);
const artist = Buffer.concat([Buffer.from([0x03]), Buffer.from('Aurora Wave', 'utf8')]);
const albumLe = Buffer.concat([Buffer.from([0x01]), Buffer.from([0xff, 0xfe]), Buffer.from('Synth Nights', 'utf16le')]);

const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const apicData = Buffer.concat([
  Buffer.from([0x00]),
  Buffer.from('image/png', 'latin1'),
  Buffer.from([0x00]),
  Buffer.from([0x03]),
  Buffer.from('cover', 'latin1'),
  Buffer.from([0x00]),
  pngMagic
]);

const body = buildV23Frames([
  ['TIT2', title],
  ['TPE1', artist],
  ['TALB', albumLe],
  ['APIC', apicData]
]);

const header = Buffer.concat([
  Buffer.from('ID3', 'latin1'),
  Buffer.from([0x03, 0x00, 0x00]),
  syncSafeWrite(body.length)
]);

const tagged = Buffer.concat([header, body, Buffer.from('000111222333444555666777888999aabbccddeeff', 'hex')]);

const { parseMP3 } = require('../mp3tags');

const tags = parseMP3(tagged);
assert.strictEqual(tags.title, 'Neon Dreams', 'title');
assert.strictEqual(tags.artist, 'Aurora Wave', 'artist');
assert.strictEqual(tags.album, 'Synth Nights', 'album');
assert.strictEqual(tags.picture.format, 'image/png', 'picture format');
assert.deepStrictEqual(tags.picture.data, pngMagic, 'picture data');

const v1 = Buffer.alloc(128);
v1.write('TAG', 0, 'latin1');
const pad = (s, len) => Buffer.concat([Buffer.from(s, 'latin1'), Buffer.alloc(len - s.length)]);
Buffer.concat([pad('Late Night Song', 30), pad('Cassette Kid', 30), pad('Analog Love', 30)]).copy(v1, 3);

const v1tags = parseMP3(v1);
assert.strictEqual(v1tags.title, 'Late Night Song', 'v1 title');
assert.strictEqual(v1tags.artist, 'Cassette Kid', 'v1 artist');
assert.strictEqual(v1tags.album, 'Analog Love', 'v1 album');

assert.strictEqual(parseMP3(Buffer.from('not an mp3')), null, 'garbage');

console.log('mp3tags: all tests passed');