const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  selectAudio: () => ipcRenderer.invoke('dialog:selectAudio'),
  readAudioFile: (filePath) => ipcRenderer.invoke('file:readAudio', filePath),
  selectBackgroundVideo: () => ipcRenderer.invoke('dialog:selectVideo'),
  selectMultipleAudio: () => ipcRenderer.invoke('dialog:selectMultipleAudio'),
  selectMultipleVideo: () => ipcRenderer.invoke('dialog:selectMultipleVideo'),
  savePlaylistFile: (json) => ipcRenderer.invoke('playlist:save', json),
  openPlaylistFile: () => ipcRenderer.invoke('playlist:open'),
  setFullscreen: (flag) => ipcRenderer.invoke('window:setFullscreen', !!flag),
  isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
  setContentSize: (w, h) => ipcRenderer.invoke('window:setContentSize', w, h),
  getAppIconSvg: () => ipcRenderer.invoke('app:iconSvg'),
  setAppIconPng: (dataUrl) => ipcRenderer.invoke('app:iconPng', dataUrl),
  saveRecording: (payload) => ipcRenderer.invoke('rec:save', payload),
  onFullscreenChange: (cb) => {
    const handler = (_event, flag) => cb(flag);
    ipcRenderer.on('system:fullscreen', handler);
    return () => ipcRenderer.removeListener('system:fullscreen', handler);
  },
  onMenuAction: (cb) => {
    const channelToAction = { 'menu:open-track': 'open-track', 'menu:playlist': 'playlist', 'menu:settings': 'settings' };
    const handlers = Object.entries(channelToAction).map(([channel, action]) => {
      const handler = () => cb(action);
      ipcRenderer.on(channel, handler);
      return [channel, handler];
    });
    return () => {
      handlers.forEach(([channel, handler]) => ipcRenderer.removeListener(channel, handler));
    };
  },
  onOpenFile: (cb) => {
    const handler = (_event, filePath) => cb(filePath);
    ipcRenderer.on('app:open-path', handler);
    return () => ipcRenderer.removeListener('app:open-path', handler);
  }
});