const { app, BrowserWindow, ipcMain, dialog, Menu, protocol, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { register: registerMediaProtocol } = require('./lib/mediaProtocol');
const trackMeta = require('./lib/trackMeta');

const AUDIO_FILTERS = [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'] }];
const VIDEO_FILTERS = [{ name: 'Video', extensions: ['mp4', 'webm', 'mov', 'm4v', 'mkv'] }];

const APP_ICON_SVG = (() => {
  try {
    return 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(__dirname, 'app.svg')).toString('base64');
  } catch {
    return null;
  }
})();

if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) {
  console.warn('Synemar is running as root. For security, run as a normal user.');
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
let pendingOpenPath = null;

function handleIpc(channel, fn) {
  ipcMain.handle(channel, (event, ...args) =>
    Promise.resolve(fn(event, ...args)).catch((err) => ({ error: err.message || String(err) }))
  );
}

function recOutputDir() {
  const candidates = [app.getPath('videos'), app.getPath('downloads'), app.getPath('home')];
  for (const c of candidates) if (c) return c;
  return process.cwd();
}

handleIpc('dialog:selectAudio', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Open a track',
    properties: ['openFile'],
    filters: AUDIO_FILTERS
  });
  if (res.canceled || !res.filePaths.length) return null;
  return await trackMeta.buildAudioPayload(res.filePaths[0]);
});

const AUDIO_EXTENSIONS = new Set(AUDIO_FILTERS[0].extensions.map((e) => '.' + e.toLowerCase()));

function isAllowedAudioFile(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

handleIpc('file:readAudio', async (_e, filePath) => {
  if (!isAllowedAudioFile(filePath)) return { error: 'Unsupported file type' };
  return await trackMeta.buildAudioPayload(filePath);
});

handleIpc('dialog:selectVideo', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a background video (MP4)',
    properties: ['openFile'],
    filters: VIDEO_FILTERS
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

handleIpc('dialog:selectMultipleAudio', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Add audio tracks',
    properties: ['openFile', 'multiSelections'],
    filters: AUDIO_FILTERS
  });
  return res.canceled ? [] : res.filePaths;
});

handleIpc('dialog:selectMultipleVideo', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Add videos',
    properties: ['openFile', 'multiSelections'],
    filters: VIDEO_FILTERS
  });
  return res.canceled ? [] : res.filePaths;
});

handleIpc('playlist:save', async (_e, json) => {
  if (typeof json !== 'string') return null;
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Export playlist',
    defaultPath: 'synemar-playlist.json',
    filters: [{ name: 'Synemar playlist', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePath) return null;
  try {
    await fs.promises.writeFile(res.filePath, json, 'utf8');
    return null;
  } catch (err) {
    return err.message || 'Could not save playlist';
  }
});

handleIpc('playlist:open', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Import playlist',
    properties: ['openFile'],
    filters: [{ name: 'Synemar playlist', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  try {
    return JSON.parse(await fs.promises.readFile(res.filePaths[0], 'utf8'));
  } catch (err) {
    return { error: 'Could not read playlist: ' + (err.message || '') };
  }
});

handleIpc('window:setFullscreen', (_e, flag) => {
  if (mainWindow) mainWindow.setFullScreen(!!flag);
});

handleIpc('window:isFullscreen', () => (mainWindow ? mainWindow.isFullScreen() : false));

handleIpc('window:setContentSize', (_e, w, h) => {
  if (mainWindow) setWindowContentSize(w, h);
});

handleIpc('app:iconSvg', () => APP_ICON_SVG);

handleIpc('app:iconPng', (_e, dataUrl) => {
  if (!mainWindow || typeof dataUrl !== 'string') return;
  const icon = nativeImage.createFromDataURL(dataUrl);
  if (!icon.isEmpty()) mainWindow.setIcon(icon);
});

handleIpc('rec:save', async (_e, { buf, ext }) => {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const outPath = path.join(recOutputDir(), `synemar-rec-${stamp}.${String(ext) || 'webm'}`);
  await fs.promises.writeFile(outPath, Buffer.from(buf));
  return { ok: true, path: outPath };
});

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Open Track…', accelerator: 'CmdOrCtrl+O', click: () => mainWindow && mainWindow.webContents.send('menu:open-track') },
        { label: 'Playlist', accelerator: 'CmdOrCtrl+P', click: () => mainWindow && mainWindow.webContents.send('menu:playlist') },
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

  mainWindow.webContents.once('did-finish-load', async () => {
    const p = (await findArgvFile()) || pendingOpenPath;
    pendingOpenPath = null;
    if (p) mainWindow.webContents.send('app:open-path', p);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on('enter-full-screen', () => mainWindow.webContents.send('system:fullscreen', true));
  mainWindow.on('leave-full-screen', () => mainWindow.webContents.send('system:fullscreen', false));
  mainWindow.on('closed', () => { mainWindow = null; });
}

async function findArgvFile() {
  const exts = AUDIO_FILTERS[0].extensions.concat(VIDEO_FILTERS[0].extensions);
  for (const a of process.argv.slice(1)) {
    if (!a || a.startsWith('-')) continue;
    const lower = a.toLowerCase();
    if (!exts.some((e) => lower.endsWith('.' + e))) continue;
    try {
      const st = fs.statSync(a);
      if (st.isFile()) return a;
    } catch (err) { /* ignore missing/unreadable */ }
  }
  return null;
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (app.isReady()) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:open-path', filePath);
  } else {
    pendingOpenPath = filePath;
  }
});

app.whenReady().then(() => {
  buildMenu();
  registerMediaProtocol(protocol);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});