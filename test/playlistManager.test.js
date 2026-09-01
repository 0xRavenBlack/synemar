const assert = require('assert');
const { create } = require('../renderer/playlistManager');

function makeStorage() {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    _store: store
  };
}

function makeManager() {
  const storage = makeStorage();
  const manager = create({ storage });
  return { manager, storage };
}

const tests = {
  'starts empty'() {
    const { manager } = makeManager();
    assert.deepStrictEqual(manager.state.audioTracks, []);
    assert.deepStrictEqual(manager.state.videoTracks, []);
    assert.strictEqual(manager.currentAudio(), null);
    assert.strictEqual(manager.currentVideo(), null);
  },

  'adds audio tracks and sets current'() {
    const { manager } = makeManager();
    manager.addAudioTrack('/a/b/song.mp3');
    manager.addAudioTrack('/a/b/song2.mp3');
    assert.strictEqual(manager.state.audioTracks.length, 2);
    assert.strictEqual(manager.currentAudio().path, '/a/b/song.mp3');
    assert.strictEqual(manager.currentAudio().fileName, 'song.mp3');
  },

  'adds video tracks and sets current'() {
    const { manager } = makeManager();
    manager.addVideoTrack('/v/clip.mp4');
    assert.strictEqual(manager.currentVideo().path, '/v/clip.mp4');
  },

  'does not reload current when adding a non-selected track'() {
    const { manager } = makeManager();
    let audioChangedCalls = 0;
    manager.onAudioChanged = () => { audioChangedCalls++; };
    let listChangedCalls = 0;
    manager.onListChanged = () => { listChangedCalls++; };
    manager.addAudioTrack('/a/one.mp3');
    assert.strictEqual(audioChangedCalls, 1);
    manager.addAudioTrack('/a/two.mp3');
    assert.strictEqual(audioChangedCalls, 1, 'current did not change');
    assert.strictEqual(listChangedCalls, 1, 'list change notified');
  },

  'advances to next and wraps'() {
    const { manager } = makeManager();
    manager.addAudioTrack('/a/one.mp3');
    manager.addAudioTrack('/a/two.mp3');
    manager.addAudioTrack('/a/three.mp3');
    assert.strictEqual(manager.nextAudio().path, '/a/two.mp3');
    assert.strictEqual(manager.nextAudio().path, '/a/three.mp3');
    assert.strictEqual(manager.nextAudio().path, '/a/one.mp3');
  },

  'goes to previous and wraps'() {
    const { manager } = makeManager();
    manager.addAudioTrack('/a/one.mp3');
    manager.addAudioTrack('/a/two.mp3');
    assert.strictEqual(manager.previousAudio().path, '/a/two.mp3');
  },

  'selects a specific audio track'() {
    const { manager } = makeManager();
    manager.addAudioTrack('/a/one.mp3');
    manager.addAudioTrack('/a/two.mp3');
    const track = manager.selectAudioAt(1);
    assert.strictEqual(track.path, '/a/two.mp3');
    assert.strictEqual(manager.currentAudio().path, '/a/two.mp3');
  },

  'removing current track reindexes'() {
    const { manager } = makeManager();
    manager.addAudioTrack('/a/one.mp3');
    manager.addAudioTrack('/a/two.mp3');
    manager.addAudioTrack('/a/three.mp3');
    manager.selectAudioAt(1);
    manager.removeAudioAt(1);
    assert.strictEqual(manager.state.audioTracks.length, 2);
    assert.strictEqual(manager.currentAudio().path, '/a/three.mp3');
  },

  'moving a track adjusts current index'() {
    const { manager } = makeManager();
    manager.addAudioTrack('/a/one.mp3');
    manager.addAudioTrack('/a/two.mp3');
    manager.addAudioTrack('/a/three.mp3');
    manager.selectAudioAt(1);
    manager.moveTrack('audioTracks', 1, 2);
    assert.strictEqual(manager.state.audioTracks[2].path, '/a/two.mp3');
    assert.strictEqual(manager.currentAudio().path, '/a/two.mp3');
  },

  'exports and imports playlists'() {
    const { manager } = makeManager();
    manager.setName('My Great Playlist');
    manager.addAudioTrack('/a/one.mp3');
    manager.addAudioTrack('/a/two.mp3');
    manager.addVideoTrack('/v/clip.mp4');
    manager.selectAudioAt(1);

    const other = makeManager().manager;
    const result = other.importJSON(manager.exportJSON());
    assert.ok(result.ok);
    assert.strictEqual(other.state.name, 'My Great Playlist');
    assert.strictEqual(other.state.audioTracks.length, 2);
    assert.strictEqual(other.state.videoTracks.length, 1);
    assert.strictEqual(other.currentAudio().path, '/a/two.mp3');
  },

  'rejects invalid import JSON'() {
    const { manager } = makeManager();
    const bad = manager.importJSON('not json');
    assert.strictEqual(bad.ok, false);
    const missing = manager.importJSON(JSON.stringify({ foo: 1 }));
    assert.strictEqual(missing.ok, false);
  },

  'import always emits audio change, even when incoming list is empty'() {
    const { manager } = makeManager();
    manager.addAudioTrack('/a/one.mp3');
    let lastTrack = null;
    manager.onAudioChanged = (track) => { lastTrack = track; };
    manager.importJSON(JSON.stringify({ name: 'Empty', audioTracks: [], videoTracks: [] }));
    assert.strictEqual(manager.state.audioTracks.length, 0);
    assert.strictEqual(manager.state.currentAudioIndex, -1);
    assert.strictEqual(lastTrack, null);
  },

  'persists to storage on save'() {
    const { manager, storage } = makeManager();
    manager.addAudioTrack('/a/one.mp3');
    assert.ok(storage._store['neoneq.playlist'].includes('one.mp3'));
  },

  'loads persisted state back'() {
    const storage = makeStorage();
    const manager = create({ storage });
    manager.setName('Persisted');
    manager.addAudioTrack('/a/one.mp3');
    const manager2 = create({ storage });
    manager2.load();
    assert.strictEqual(manager2.state.name, 'Persisted');
    assert.strictEqual(manager2.state.audioTracks.length, 1);
  },

  'migrates legacy lastTrack and bgVideos'() {
    const storage = makeStorage();
    storage.setItem('neoneq.lastTrack', JSON.stringify({ path: '/old/song.mp3', fileName: 'song.mp3' }));
    storage.setItem('neoneq.settings', JSON.stringify({ bgVideos: ['/old/video1.mp4', null, '/old/video2.mp4'] }));
    const manager = create({ storage });
    manager.migrateFromLegacy();
    assert.strictEqual(manager.state.audioTracks.length, 1);
    assert.strictEqual(manager.currentAudio().path, '/old/song.mp3');
    assert.strictEqual(manager.state.videoTracks.length, 2);
    assert.strictEqual(manager.currentVideo().path, '/old/video1.mp4');
    assert.strictEqual(storage.getItem('neoneq.lastTrack'), null);
  }
};

let failures = 0;
for (const [name, fn] of Object.entries(tests)) {
  try {
    fn();
    console.log(`playlistManager: ${name} OK`);
  } catch (e) {
    failures++;
    console.error(`playlistManager: ${name} FAILED`);
    console.error(e && e.message ? e.message : e);
  }
}

if (failures) {
  console.error(`playlistManager: ${failures} test(s) failed`);
  process.exit(1);
}
console.log('playlistManager: all tests passed');
