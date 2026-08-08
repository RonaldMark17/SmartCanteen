const { contextBridge, ipcRenderer } = require('electron');

// Synchronously request app config from main process during preload init
let appConfig = { apiBaseUrl: 'https://YOUR-DOMAIN.com/api' };

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
  getConfig: () => ipcRenderer.invoke('get-app-config'),
  isElectron: true,
});
