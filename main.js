const { app, BrowserWindow, ipcMain, dialog, Menu, protocol, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const fss = require('fs');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const mp3tags = require('./mp3tags');

const AUDIO_FILTERS = [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'] }];
const VIDEO_FILTERS = [{ name: 'Video', extensions: ['mp4', 'webm', 'mov', 'm4v', 'mkv'] }];
const MAX_AUDIO_BYTES = 512 * 1024 * 1024;
const MAX_COVER_BYTES = 10 * 1024 * 1024;
const VIDEO_TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.mkv': 'video/x-matroska'
};

const APP_ICON_SVG = (() => {
  try {
    return 'data:image/svg+xml;base64,' + fss.readFileSync(path.join(__dirname, 'app.svg')).toString('base64');
  } catch {
    return null;
  }
})();

if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) {
  app.commandLine.appendSwitch('no-sandbox');
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: false }
  }
]);

let mainWindow = null;

let recActive = false;
let recRun = null;
let recAudioBufs = [];

function recOutputDir() {
  const candidates = [app.getPath('videos'), app.getPath('downloads'), app.getPath('home')];
  for (const c of candidates) if (c) return c;
  return process.cwd();
}

function recStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function recFinalize() {
  if (!recRun) return { error: 'No recording is active' };
  const run = recRun;
  const tmpDir = run.tmpDir;
  const outPath = run.outPath;
  const videoPath = path.join(tmpDir, 'video.mjpeg');
  const audioPath = path.join(tmpDir, 'audio.pcm');
  const audioBufs = recAudioBufs;
  recRun = null;
  recAudioBufs = [];
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

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Open Track…', accelerator: 'CmdOrCtrl+O', click: () => mainWindow && mainWindow.webContents.send('menu:open-track') },
        { label: 'Settings', accelerator: 'CmdOrCtrl+,', click: () => mainWindow && mainWindow.webContents.send('menu:settings') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Fullscreen', accelerator: 'F11', click: () => mainWindow && mainWindow.setFullScreen(!mainWindow.isFullScreen()) },
        { label: '1080p', click: () => mainWindow && setWindowContentSize(1920, 1080) },
        { label: 'Square 1080', click: () => mainWindow && setWindowContentSize(1080, 1080) },
        { label: 'Vertical 1080', click: () => mainWindow && setWindowContentSize(1080, 1920) },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function setWindowContentSize(w, h) {
  if (!mainWindow) return;
  if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  mainWindow.unmaximize();
  mainWindow.setContentSize(w, h);
  mainWindow.center();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: '#0b0e14',
    autoHideMenuBar: true,
    show: false,
    title: 'Synemar',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('system:fullscreen', true));
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('system:fullscreen', false));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function bufferToArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function parseFilenameMeta(fileName) {
  const base = path.basename(fileName).replace(/\.[^.]+$/, '');
  const parts = base.split(/ - /);
  if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
    return { title: parts.slice(1).join(' - ').trim(), artist: parts[0].trim(), album: null };
  }
  return { title: base.trim(), artist: null, album: null };
}

function coverToDataUrl(picture, maxBytes = MAX_COVER_BYTES) {
  if (!picture || !picture.data || !picture.data.length) return null;
  if (picture.data.length > maxBytes) return null;
  let format = picture.format || 'image/jpeg';
  if (format.startsWith('data:')) return `data:${format};base64,${Buffer.from(picture.data).toString('base64')}`;
  if (!/^image\//.test(format)) format = `image/${format.replace(/^\./, '')}`;
  return `data:${format};base64,${Buffer.from(picture.data).toString('base64')}`;
}

async function parseTags(filePath, buffer) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === '.mp3' && buffer) {
      const parsed = mp3tags.parseMP3(buffer);
      if (parsed && (parsed.title || parsed.artist)) return parsed;
    }
  } catch (err) { /* ignore, fall through */ }

  try {
    const jsmediatags = require('jsmediatags');
    const data = await new Promise((resolve, reject) => {
      jsmediatags.read(filePath, {
        onSuccess: resolve,
        onError: (err) => reject(err)
      });
    });
    const tags = (data && data.tags) || {};
    return {
      title: tags.title || tags.trackTitle || null,
      artist: tags.artist || tags.albumArtist || null,
      album: tags.album || null,
      picture: tags.picture ? { format: tags.picture.format || 'image/jpeg', data: tags.picture.data } : null
    };
  } catch (err) {
    return null;
  }
}

async function buildAudioPayload(filePath) {
  const stats = await fs.stat(filePath);
  if (stats.size > MAX_AUDIO_BYTES) throw new Error('File is too large to load');
  const buffer = await fs.readFile(filePath);
  const tags = await parseTags(filePath, buffer).catch(() => null);
  const meta = tags || parseFilenameMeta(filePath);
  return {
    path: filePath,
    fileName: path.basename(filePath),
    meta: {
      title: meta.title || null,
      artist: meta.artist || null,
      album: meta.album || null,
      coverDataUrl: coverToDataUrl(meta.picture)
    },
    buffer: bufferToArrayBuffer(buffer)
  };
}

ipcMain.handle('dialog:selectAudio', async () => {
  try {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Open a track',
      properties: ['openFile'],
      filters: AUDIO_FILTERS
    });
    if (res.canceled || !res.filePaths.length) return null;
    return await buildAudioPayload(res.filePaths[0]);
  } catch (err) {
    return { error: err.message || String(err) };
  }
});

ipcMain.handle('file:readAudio', async (_e, filePath) => {
  try {
    if (typeof filePath !== 'string' || !filePath) return null;
    return await buildAudioPayload(filePath);
  } catch (err) {
    return { error: err.message || String(err) };
  }
});

ipcMain.handle('dialog:selectVideo', async () => {
  try {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a background video (MP4)',
      properties: ['openFile'],
      filters: VIDEO_FILTERS
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  } catch (err) {
    return { error: err.message || String(err) };
  }
});

ipcMain.handle('window:setFullscreen', (_e, flag) => {
  if (mainWindow) mainWindow.setFullScreen(!!flag);
});

ipcMain.handle('window:isFullscreen', () => (mainWindow ? mainWindow.isFullScreen() : false));

ipcMain.handle('window:setContentSize', (_e, w, h) => {
  if (mainWindow) setWindowContentSize(w, h);
});

ipcMain.handle('app:iconSvg', () => APP_ICON_SVG);

ipcMain.handle('app:iconPng', (_e, dataUrl) => {
  if (!mainWindow || typeof dataUrl !== 'string') return;
  const icon = nativeImage.createFromDataURL(dataUrl);
  if (!icon.isEmpty()) mainWindow.setIcon(icon);
});

ipcMain.handle('rec:start', async (_e, opts) => {
  try {
    if (recActive) return { error: 'Already recording' };
    const fps = Math.min(60, Math.max(10, Number(opts && opts.fps) || 30));
    const sampleRate = Math.min(192000, Math.max(8000, Number(opts && opts.sampleRate) || 44100));
    const dir = recOutputDir();
    await fs.mkdir(dir, { recursive: true });
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'synemar-rec-'));
    const videoFh = fss.createWriteStream(path.join(tmpDir, 'video.mjpeg'));
    recRun = {
      tmpDir,
      videoFh,
      sampleRate,
      outPath: path.join(dir, `synemar-rec-${recStamp()}.mp4`),
      fps
    };
    recAudioBufs = [];
    recActive = true;
    return { ok: true };
  } catch (err) {
    return { error: err.message || String(err) };
  }
});

ipcMain.on('rec:frame', (_e, data) => {
  if (!recActive || !recRun || !data) return;
  recRun.videoFh.write(Buffer.from(String(data), 'base64'));
});

ipcMain.handle('rec:audio', async (_e, buf) => {
  try {
    if (!recActive || !buf || !buf.byteLength) return { ok: true };
    recAudioBufs.push(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength));
    return { ok: true };
  } catch (err) {
    return { error: err.message || String(err) };
  }
});

ipcMain.handle('rec:stop', async () => {
  if (!recActive) return { error: 'No recording is active' };
  recActive = false;
  return await recFinalize();
});

function registerMediaProtocol() {
  protocol.handle('media', async (request) => {
  try {
    const u = new URL(request.url);
    const filePath = u.searchParams.get('path') || decodeURIComponent(u.pathname);
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return new Response('Not found', { status: 404 });
    if (stats.size <= 0) return new Response('Empty file', { status: 400 });

    const ext = path.extname(filePath).toLowerCase();
    const type = VIDEO_TYPES[ext] || 'video/mp4';
    const size = stats.size;

    const range = request.headers.get('range');
    let start = 0, end = size - 1, status = 200;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        if (m[1] === '') {
          end = size - 1;
          start = Math.max(0, end - parseInt(m[2] || '0', 10) + 1);
        } else {
          start = parseInt(m[1], 10);
          end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
        }
        if (start >= size) return new Response('Range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        status = 206;
      }
    }
    const length = end - start + 1;
    const stream = Readable.toWeb(fss.createReadStream(filePath, { start, end }));
    return new Response(stream, {
      status,
      headers: {
        'Content-Type': type,
        'Content-Length': String(length),
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'private, max-age=0'
      }
    });
  } catch (err) {
    console.error('media protocol error:', err && err.message);
    return new Response('Not found', { status: 404 });
  }
  });
}

app.whenReady().then(() => {
  buildMenu();
  registerMediaProtocol();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});