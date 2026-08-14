const { contextBridge, ipcRenderer } = require('electron');

// Synchronously request app config from main process during preload init
let appConfig = { apiBaseUrl: 'http://54.253.139.103/api' };

try {
  const syncConfig = ipcRenderer.sendSync('get-app-config-sync');
  if (syncConfig && typeof syncConfig === 'object') {
    appConfig = syncConfig;
  }
} catch (err) {
  console.warn('[Preload] Could not load sync config from main process:', err);
}

contextBridge.exposeInMainWorld('MEALS_CONFIG', appConfig);

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onMaximizeChange: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, isMax) => callback(isMax);
    ipcRenderer.on('window-maximized-change', listener);
    return () => ipcRenderer.removeListener('window-maximized-change', listener);
  },
  reload: () => ipcRenderer.send('window-reload'),
  toggleDevTools: () => ipcRenderer.send('window-toggle-devtools'),
  toggleFullScreen: () => ipcRenderer.send('window-toggle-fullscreen'),
  zoomIn: () => ipcRenderer.send('window-zoom-in'),
  zoomOut: () => ipcRenderer.send('window-zoom-out'),
  zoomReset: () => ipcRenderer.send('window-zoom-reset'),
  getConfig: () => ipcRenderer.invoke('get-app-config'),
  saveConfig: (newConfig) => ipcRenderer.invoke('save-app-config', newConfig),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
});
