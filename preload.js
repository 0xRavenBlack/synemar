const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectAudio: () => ipcRenderer.invoke('dialog:selectAudio'),
  readAudioFile: (filePath) => ipcRenderer.invoke('file:readAudio', filePath),
  selectBackgroundVideo: () => ipcRenderer.invoke('dialog:selectVideo'),
  setFullscreen: (flag) => ipcRenderer.invoke('window:setFullscreen', !!flag),
  isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
  setContentSize: (w, h) => ipcRenderer.invoke('window:setContentSize', w, h),
  getAppIconSvg: () => ipcRenderer.invoke('app:iconSvg'),
  setAppIconPng: (dataUrl) => ipcRenderer.invoke('app:iconPng', dataUrl),
  recordStart: (opts) => ipcRenderer.invoke('rec:start', opts),
  recordFrame: (jpegBase64) => ipcRenderer.send('rec:frame', jpegBase64),
  recordAudio: (buf) => ipcRenderer.invoke('rec:audio', buf),
  recordStop: () => ipcRenderer.invoke('rec:stop'),
  onRecError: (cb) => {
    const handler = (_event, message) => cb(message);
    ipcRenderer.on('rec:errored', handler);
    return () => ipcRenderer.removeListener('rec:errored', handler);
  },
  onFullscreenChange: (cb) => {
    const handler = (_event, flag) => cb(flag);
    ipcRenderer.on('system:fullscreen', handler);
    return () => ipcRenderer.removeListener('system:fullscreen', handler);
  },
  onMenuAction: (cb) => {
    const handler = (_event, action) => cb(action);
    ipcRenderer.on('menu:open-track', handler);
    ipcRenderer.on('menu:settings', handler);
    return () => {
      ipcRenderer.removeListener('menu:open-track', handler);
      ipcRenderer.removeListener('menu:settings', handler);
    };
  }
});