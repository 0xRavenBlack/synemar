const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

class RecordingSession {
  constructor(opts) {
    this.getOutputDir = opts.getOutputDir;
    this.onError = null;
    this.active = false;
    this.run = null;
    this.audioBufs = [];
  }

  stamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  async start(opts) {
    if (this.active) return { error: 'Already recording' };
    const fps = Math.min(60, Math.max(10, Number(opts && opts.fps) || 30));
    const sampleRate = Math.min(192000, Math.max(8000, Number(opts && opts.sampleRate) || 44100));
    const dir = this.getOutputDir();
    await fs.mkdir(dir, { recursive: true });
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'synemar-rec-'));
    const videoFh = fsSync.createWriteStream(path.join(tmpDir, 'video.mjpeg'));
    videoFh.on('error', (err) => this.abort(err));
    this.run = {
      tmpDir,
      videoFh,
      sampleRate,
      outPath: path.join(dir, `synemar-rec-${this.stamp()}.mp4`),
      fps
    };
    this.audioBufs = [];
    this.active = true;
    return { ok: true };
  }

  frame(data) {
    if (!this.active || !this.run || !data) return Promise.resolve({ ok: true });
    return new Promise((resolve) => {
      this.run.videoFh.write(Buffer.from(String(data), 'base64'), (err) => {
        if (err) resolve({ error: err.message || String(err) });
        else resolve({ ok: true });
      });
    });
  }

  audio(buf) {
    if (!this.active || !buf || !buf.byteLength) return Promise.resolve({ ok: true });
    try {
      this.audioBufs.push(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength));
      return Promise.resolve({ ok: true });
    } catch (err) {
      return Promise.resolve({ error: err.message || String(err) });
    }
  }

  async stop() {
    if (!this.active) return { error: 'No recording is active' };
    this.active = false;
    return await this.finalize();
  }

  abort(err) {
    const msg = (err && err.message) || String(err);
    const wasActive = this.active;
    if (wasActive && this.run) this.run.videoFh.destroy();
    if (this.run) fs.rm(this.run.tmpDir, { recursive: true, force: true }).catch(() => {});
    this.active = false;
    this.run = null;
    this.audioBufs = [];
    if (wasActive && this.onError) this.onError(msg);
  }

  async finalize() {
    if (!this.run) return { error: 'No recording is active' };
    const run = this.run;
    const tmpDir = run.tmpDir;
    const outPath = run.outPath;
    const videoPath = path.join(tmpDir, 'video.mjpeg');
    const audioPath = path.join(tmpDir, 'audio.pcm');
    const audioBufs = this.audioBufs;
    this.run = null;
    this.audioBufs = [];
    try {
      await new Promise((res) => run.videoFh.end(res));
      await fs.writeFile(audioPath, Buffer.concat(audioBufs));
      const fps = String(run.fps);
      await new Promise((resolve, reject) => {
        const ff = spawn('ffmpeg', [
          '-y',
          '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', fps, '-i', videoPath,
          '-f', 's16le', '-ar', String(run.sampleRate), '-ac', '2', '-i', audioPath,
          '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '192k',
          '-movflags', '+faststart',
          '-shortest',
          outPath
        ]);
        let ffErr = '';
        ff.stderr.on('data', (d) => { ffErr += d.toString(); });
        ff.on('error', (err) => {
          if (err.code === 'ENOENT') reject(new Error('ffmpeg was not found. Install it and try again.'));
          else reject(err);
        });
        ff.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg failed (exit ${code}): ${ffErr.split('\n').slice(-2).join(' ')}`));
        });
      });
      await fs.rm(tmpDir, { recursive: true, force: true });
      return { ok: true, path: outPath };
    } catch (err) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      return { error: err.message || String(err) };
    }
  }
}

module.exports = { RecordingSession };