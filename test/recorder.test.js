const assert = require('assert');
const { RecordingSession } = require('../lib/recorder');

async function main() {
  const rec = new RecordingSession({ getOutputDir: () => '/tmp/opencode/rec-out' });
  assert.strictEqual(rec.active, false);
  assert.ok(/^\d{4}-\d{2}-\d{2}_\d{6}$/.test(rec.stamp()), rec.stamp());

  const idleFrame = await rec.frame('AA==');
  assert.deepStrictEqual(idleFrame, { ok: true }, 'frame while inactive is a no-op');
  const idleAudio = await rec.audio(null);
  assert.deepStrictEqual(idleAudio, { ok: true }, 'null audio is a no-op');
  const stopIdle = await rec.stop();
  assert.deepStrictEqual(stopIdle, { error: 'No recording is active' }, 'stop while inactive errors');
  console.log('recorder: idle no-op guards OK');

  const started = await rec.start({ fps: 30, sampleRate: 48000 });
  assert.deepStrictEqual(started, { ok: true });
  assert.strictEqual(rec.active, true);
  assert.ok(rec.run && rec.run.tmpDir.startsWith('/tmp/synemar-rec-'), rec.run && rec.run.tmpDir);
  assert.strictEqual(rec.run.fps, 30);
  assert.strictEqual(rec.run.sampleRate, 48000);
  assert.ok(rec.run.outPath.endsWith('.mp4'), rec.run.outPath);

  const dup = await rec.start({});
  assert.deepStrictEqual(dup, { error: 'Already recording' }, 'second start while active errors');

  await rec.audio(new Int16Array([100, -100, 200]));
  assert.strictEqual(rec.audioBufs.length, 1);
  assert.deepStrictEqual([...rec.audioBufs[0]], [100, 0, 156, 255, 200, 0], 'audio kept as strict-buffer copy');
  console.log('recorder: start/stamp/duplicate/audio guards OK');

  const rec2 = new RecordingSession({ getOutputDir: () => '/tmp/opencode/rec-out' });
  await rec2.start({ fps: 999, sampleRate: 1 });
  assert.strictEqual(rec2.run.fps, 60, 'fps clamped to 60');
  assert.strictEqual(rec2.run.sampleRate, 8000, 'sampleRate clamped to 8000');
  await rec2.abort();
  assert.strictEqual(rec2.active, false);
  assert.strictEqual(rec2.run, null);
  console.log('recorder: fps/sampleRate clamps OK');

  let abortedMsg = null;
  rec.onError = (m) => { abortedMsg = m; };
  await rec.abort(new Error('boom'));
  assert.strictEqual(rec.active, false);
  assert.strictEqual(rec.run, null);
  assert.strictEqual(rec.audioBufs.length, 0, 'abort clears buffered audio');
  assert.strictEqual(abortedMsg, 'boom', 'abort reports error via onError');
  console.log('recorder: all tests passed');
}

main().catch((e) => {
  console.error('recorder: FAIL', e);
  process.exit(1);
});