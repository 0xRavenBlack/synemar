const assert = require('assert');
const { createPlaylist, mediaUrl } = require('../renderer/playlist');

function makeVideoEl() {
  const el = {
    style: {},
    src: '',
    currentTime: 0,
    _plays: 0,
    _loads: 0,
    _pauses: 0,
    _attr: {}
  };
  el.play = function () { el._plays++; return Promise.resolve(); };
  el.pause = function () { el._pauses++; };
  el.load = function () { el._loads++; };
  el.removeAttribute = function (name) { delete el._attr[name]; };
  el.getAttribute = function (name) { return el._attr[name]; };
  el.setAttribute = function (name, value) { el._attr[name] = value; };
  return el;
}

function makeEngine(extra) {
  let time = 0;
  const els = [makeVideoEl(), makeVideoEl()];
  const timers = [];
  const engine = createPlaylist(Object.assign({
    elements: els,
    crossfadeMs: 900,
    schedule(fn, ms) {
      const id = timers.length;
      timers.push({ fn, at: time + ms, fired: false });
      return id;
    },
    cancel(id) {
      if (typeof id === 'number') timers[id] = null;
    },
    currentTime() { return time; }
  }, extra || {}));
  function advance(ms) {
    time += ms;
    for (const t of timers) {
      if (t && !t.fired && t.at <= time) {
        t.fired = true;
        t.fn();
      }
    }
    engine.update(time);
  }
  return { els, engine, timers, advance, update: (t) => { time = t; engine.update(time); }, setTime: (t) => { time = t; } };
}

const visible = (els) => (Number(els[0].style.opacity) === 1 ? 0 : 1);

assert.strictEqual(
  mediaUrl('/mnt/My Video.mp4'),
  'media://file/?path=%2Fmnt%2FMy%20Video.mp4',
  'mediaUrl percent-encodes path'
);

{
  const { els, engine, advance } = makeEngine();
  const videos = ['/v/a.mp4', '/v/b.mp4', '/v/c.mp4'];
  const playFull = () => advance(60000);
  engine.startPlaylist(videos);

  assert.strictEqual(visible(els), 0, 'first element starts visible');
  assert.ok(els[0].src.endsWith(encodeURIComponent('/v/a.mp4')), 'first video starts first');
  assert.ok(els[1].src.endsWith(encodeURIComponent('/v/b.mp4')), 'second preloaded as next');
  assert.strictEqual(els[1]._plays, 0, 'preloaded video never auto-plays');
  assert.ok(els[1]._pauses >= 1, 'preloaded video is explicitly paused so it waits');
  assert.strictEqual(els[0]._plays, 1, 'first video started playing exactly once');

  playFull();
  engine.handleVideoEnded(videos);
  advance(1000);
  assert.strictEqual(visible(els), 1, 'crossfades to second element');
  assert.ok(els[1].src.endsWith(encodeURIComponent('/v/b.mp4')), 'second video now playing');
  assert.strictEqual(els[1]._plays, 1, 'second played exactly once on ended');
  assert.ok(els[1].currentTime === 0, 'second video starts at beginning (full length)');

  playFull();
  engine.handleVideoEnded(videos);
  advance(1000);
  assert.strictEqual(visible(els), 0, 'returns to first element for third video');
  assert.ok(els[0].src.endsWith(encodeURIComponent('/v/c.mp4')), 'third video cycles in');

  playFull();
  engine.handleVideoEnded(videos);
  advance(1000);
  assert.strictEqual(visible(els), 1, 'wraps around to first video again');
  assert.ok(els[1].src.endsWith(encodeURIComponent('/v/a.mp4')), 'endless loop back to start');
  console.log('playlist: full-length sequential + endless loop OK');
}

{
  const { els, engine } = makeEngine();
  const videos = ['/v/only.mp4'];
  engine.startPlaylist(videos);
  const playsBefore = els[0]._plays;
  engine.handleVideoEnded(videos);
  assert.strictEqual(els[0]._plays, playsBefore + 1, 'single video replays in place');
  assert.strictEqual(els[1]._plays, 0, 'single video never touches the second element');
  assert.strictEqual(els[1].src, '', 'no preload when only one video');
  console.log('playlist: single video loops in place OK');
}

{
  const { els, engine, setTime } = makeEngine();
  const videos = ['/v/x.mp4', '/v/y.mp4'];
  engine.startPlaylist(videos);

  engine.handleVideoEnded(videos);
  const activeAfterFirst = visible(els);

  setTime(500);
  engine.handleVideoEnded(videos);

  assert.strictEqual(visible(els), activeAfterFirst, 'duplicate ended within crossfade is ignored');
  assert.ok(els[activeAfterFirst]._plays <= 2, 'no runaway replay from duplicate ended');
  console.log('playlist: near-simultaneous ended does not kill/advance active video OK');
}

{
  const { els, engine, advance } = makeEngine();
  const videos = ['/v/x.mp4', '/v/y.mp4'];
  engine.startPlaylist(videos);

  engine.handleVideoEnded(videos);
  const old = 0;
  const active = 1;
  const activePausesBefore = els[active]._pauses;
  const oldPausesBefore = els[old]._pauses;

  advance(900 + 250);

  assert.strictEqual(els[old]._pauses, oldPausesBefore + 1, 'outgoing element is stopped once the crossfade elapses');
  assert.strictEqual(els[active]._pauses, activePausesBefore, 'incoming element is not stopped by the fade cleanup');
  assert.ok(els[active].src !== '', 'active element keeps its source (background is not wiped)');
  console.log('playlist: fade completes and stops only the outgoing element OK');
}

{
  let pendingReady = null;
  const { els, engine, update } = makeEngine({
    waitReady(_el, _timeoutMs, onReady) { pendingReady = onReady; }
  });
  const videos = ['/v/a.mp4', '/v/b.mp4'];
  engine.startPlaylist(videos);
  const activeBefore = visible(els);

  engine.handleVideoEnded(videos);

  assert.strictEqual(visible(els), activeBefore, 'crossfade defers while the incoming video is still buffering');
  assert.strictEqual(Number(els[activeBefore].style.opacity), 1, 'outgoing video stays fully visible during the buffering wait');
  assert.strictEqual(Number(els[1 - activeBefore].style.opacity), 0, 'incoming stays hidden until it has a frame');

  assert.ok(typeof pendingReady === 'function', 'readiness callback is registered for the incoming element');
  pendingReady();

  assert.strictEqual(visible(els), activeBefore, 'fade has begun but not yet completed on the very first frame');
  assert.strictEqual(Number(els[1 - activeBefore].style.opacity), 0, 'incoming frame starts the fade at zero visibility');

  const playsBeforeDup = els[1 - activeBefore]._plays;
  engine.handleVideoEnded(videos);
  assert.strictEqual(els[1 - activeBefore]._plays, playsBeforeDup, 'duplicate ended while a fade is in progress is ignored');

  update(1000);

  assert.notStrictEqual(visible(els), activeBefore, 'crossfade completes once the incoming video has loaded');
  assert.strictEqual(visible(els), 1 - activeBefore, 'switches to the buffering element after it becomes ready');
  assert.ok(els[1 - activeBefore]._plays >= 1, 'incoming video starts playing once ready');
  console.log('playlist: readiness-gated crossfade defers until the new frame is available OK');
}

console.log('playlist: all tests passed');
