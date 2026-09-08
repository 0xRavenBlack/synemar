const assert = require('assert');
const { trackMatches } = require('../renderer/playlistUI');

const tests = {
  'empty query matches everything'() {
    const track = { path: '/music/song.mp3', fileName: 'song.mp3' };
    assert.ok(trackMatches(track, ''));
    assert.ok(trackMatches(track, '   '));
    assert.ok(trackMatches(track, null));
    assert.ok(trackMatches(track, undefined));
  },

  'matches filename by substring (case-insensitive)'() {
    const track = { path: '/music/My Song.flac', fileName: 'My Song.flac' };
    assert.ok(trackMatches(track, 'my song'));
    assert.ok(trackMatches(track, 'SONG'));
    assert.ok(trackMatches(track, 'song.flac'));
  },

  'matches path when filename does not match'() {
    const track = { path: '/music/artist/album/track.mp3', fileName: 'track.mp3' };
    assert.ok(trackMatches(track, 'artist'));
    assert.ok(trackMatches(track, 'album'));
    assert.ok(!trackMatches(track, 'none'));
  },

  'does not match unrelated substring'() {
    const track = { path: '/music/song.mp3', fileName: 'song.mp3' };
    assert.ok(!trackMatches(track, 'xyz'));
  },

  'handles missing fields gracefully'() {
    assert.ok(trackMatches({ path: '', fileName: '' }, ''));
    assert.ok(!trackMatches({ path: '', fileName: '' }, 'something'));
    assert.ok(trackMatches({ path: '/f.mp3', fileName: '' }, 'f'));
  }
};

let failures = 0;
for (const [name, fn] of Object.entries(tests)) {
  try {
    fn();
    console.log(`playlistUI: ${name} OK`);
  } catch (e) {
    failures++;
    console.error(`playlistUI: ${name} FAILED`);
    console.error(e && e.message ? e.message : e);
  }
}

if (failures) {
  console.error(`playlistUI: ${failures} test(s) failed`);
  process.exit(1);
}
console.log('playlistUI: all tests passed');
