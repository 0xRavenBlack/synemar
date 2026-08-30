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

function buildV24Frames(frames) {
  const chunks = [];
  for (const [id, data] of frames) {
    chunks.push(Buffer.concat([Buffer.from(id, 'latin1'), syncSafeWrite(data.length), Buffer.from([0, 0]), data]));
  }
  return Buffer.concat(chunks);
}

function buildV22Frames(frames) {
  const chunks = [];
  for (const [id, data] of frames) {
    const size = Buffer.from([
      (data.length >> 16) & 0xff,
      (data.length >> 8) & 0xff,
      data.length & 0xff
    ]);
    chunks.push(Buffer.concat([Buffer.from(id, 'latin1'), size, data]));
  }
  return Buffer.concat(chunks);
}

const v24Body = buildV24Frames([
  ['TIT2', Buffer.concat([Buffer.from([0x03]), Buffer.from('Mirage', 'utf8')])],
  ['TPE1', Buffer.concat([Buffer.from([0x03]), Buffer.from('Neon Drift', 'utf8')])],
  ['TALB', Buffer.concat([Buffer.from([0x03]), Buffer.from('Static Bloom', 'utf8')])]
]);
const v24Header = Buffer.concat([
  Buffer.from('ID3', 'latin1'),
  Buffer.from([0x04, 0x00, 0x10]),
  syncSafeWrite(v24Body.length)
]);
const v24Footer = Buffer.concat([
  Buffer.from('3DI', 'latin1'),
  Buffer.from([0x04, 0x00, 0x00]),
  syncSafeWrite(v24Body.length)
]);
const v24 = Buffer.concat([v24Header, v24Body, v24Footer, Buffer.from('111222333444555666777888999aaabbbccc', 'hex')]);
const v24tags = parseMP3(v24);
assert.strictEqual(v24tags.title, 'Mirage', 'v2.4+footer title');
assert.strictEqual(v24tags.artist, 'Neon Drift', 'v2.4+footer artist');
assert.strictEqual(v24tags.album, 'Static Bloom', 'v2.4+footer album');

const v23Body = buildV23Frames([
  ['TIT2', title],
  ['TPE1', artist]
]);
const v23ExtHeader = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x02]),
  Buffer.from([0x00, 0x00])
]);
const v23Header = Buffer.concat([
  Buffer.from('ID3', 'latin1'),
  Buffer.from([0x03, 0x00, 0x40]),
  syncSafeWrite(v23ExtHeader.length + v23Body.length)
]);
const v23Ext = Buffer.concat([v23Header, v23ExtHeader, v23Body]);
const v23ExtTags = parseMP3(v23Ext);
assert.strictEqual(v23ExtTags.title, 'Neon Dreams', 'v2.3+extended header title');
assert.strictEqual(v23ExtTags.artist, 'Aurora Wave', 'v2.3+extended header artist');

const v22Body = buildV22Frames([
  ['TT2', title],
  ['TP1', artist],
  ['TAL', albumLe]
]);
const v22Header = Buffer.concat([
  Buffer.from('ID3', 'latin1'),
  Buffer.from([0x02, 0x00, 0x00]),
  syncSafeWrite(v22Body.length)
]);
const v22 = Buffer.concat([v22Header, v22Body]);
const v22tags = parseMP3(v22);
assert.strictEqual(v22tags.title, 'Neon Dreams', 'v2.2 title');
assert.strictEqual(v22tags.artist, 'Aurora Wave', 'v2.2 artist');
assert.strictEqual(v22tags.album, 'Synth Nights', 'v2.2 album');

assert.strictEqual(parseMP3(Buffer.from('not an mp3')), null, 'garbage');

console.log('mp3tags: all tests passed');