const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

process.on('uncaughtException', (error) => {
  console.error('[Main UncaughtException]', error);
});

const isDev = !app.isPackaged && process.env.NODE_ENV === 'development';

function getConfigFilePath() {
  const possiblePaths = [
    path.join(path.dirname(app.getPath('exe')), 'config.json'),
    path.join(process.cwd(), 'config.json'),
    path.join(process.resourcesPath, 'config.json'),
    path.join(__dirname, 'config.json'),
    path.join(app.getAppPath(), 'config.json'),
  ];

  for (const configPath of possiblePaths) {
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }

  return path.join(app.getPath('userData'), 'config.json');
}

function loadAppConfig() {
  const possiblePaths = [
    path.join(path.dirname(app.getPath('exe')), 'config.json'),
    path.join(process.cwd(), 'config.json'),
    path.join(process.resourcesPath, 'config.json'),
    path.join(__dirname, 'config.json'),
    path.join(app.getAppPath(), 'config.json'),
    path.join(app.getPath('userData'), 'config.json'),
  ];

  for (const configPath of possiblePaths) {
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.apiBaseUrl) {
          console.log(`[Main] Loaded config.json from: ${configPath}`);
          return {
            apiBaseUrl: String(parsed.apiBaseUrl).trim(),
            ...parsed,
          };
        }
      }
    } catch (err) {
      console.warn(`[Main] Error reading config at ${configPath}:`, err.message);
    }
  }

  console.log('[Main] No external config.json found; using default server URL.');
  return {
    apiBaseUrl: 'http://3.91.7.109/api',
  };
}

let mainWindow = null;
let splashWindow = null;
let cachedConfig = null;

function createSplashWindow(windowIcon) {
  const splashFile = path.join(__dirname, 'splash.html');
  if (!fs.existsSync(splashFile)) return;

  splashWindow = new BrowserWindow({
    width: 520,
    height: 270,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    center: true,
    show: false,
    icon: windowIcon,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splashWindow.loadFile(splashFile).catch((err) => {
    console.warn('[Main] Failed to load splash.html:', err.message);
  });

  splashWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.show();
    }
  });
}

function createWindow() {
  cachedConfig = loadAppConfig();

  const appIconPath = path.join(__dirname, 'icon.png');
  const fallbackIconPath = path.join(__dirname, '../public/logo.png');
  const windowIcon = fs.existsSync(appIconPath) ? appIconPath : (fs.existsSync(fallbackIconPath) ? fallbackIconPath : undefined);

  createSplashWindow(windowIcon);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: 'MEALS - Management of Expenses, Assets, and Logistics System',
    icon: windowIcon,
    frame: false, // Frameless for custom native TitleBar
    autoHideMenuBar: true,
    backgroundColor: '#090d16',
    show: false, // Hidden while splashWindow is active
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  // Remove native Win32 application menu completely in favor of custom in-app UI menu
  Menu.setApplicationMenu(null);

  // Sync window maximized state with renderer
  const notifyMaximizeState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window-maximized-change', mainWindow.isMaximized());
    }
  };

  mainWindow.on('maximize', notifyMaximizeState);
  mainWindow.on('unmaximize', notifyMaximizeState);
  mainWindow.on('enter-full-screen', () => notifyMaximizeState());
  mainWindow.on('leave-full-screen', () => notifyMaximizeState());

  const splashStartTime = Date.now();
  const MIN_SPLASH_TIME = 1900;
  let hasShownMainWindow = false;

  const showMainWindow = () => {
    if (hasShownMainWindow) return;
    hasShownMainWindow = true;

    const elapsed = Date.now() - splashStartTime;
    const remainingTime = Math.max(0, MIN_SPLASH_TIME - elapsed);

    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.executeJavaScript(`
          const c = document.getElementById('card');
          if (c) c.classList.add('closing');
        `).catch(() => {});

        setTimeout(() => {
          if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.close();
            splashWindow = null;
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.maximize();
            mainWindow.show();
            mainWindow.focus();
          }
        }, 350);
      } else {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.maximize();
          mainWindow.show();
          mainWindow.focus();
        }
      }
    }, remainingTime);
  };

  mainWindow.once('ready-to-show', () => {
    showMainWindow();
  });

  // Fallback in case ready-to-show is delayed
  setTimeout(() => {
    showMainWindow();
  }, 3500);

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const possibleIndexPaths = [
      path.join(app.getAppPath(), 'dist', 'index.html'),
      path.join(__dirname, '../dist/index.html'),
      path.join(__dirname, 'dist/index.html'),
    ];

    let loaded = false;
    for (const indexPath of possibleIndexPaths) {
      if (fs.existsSync(indexPath)) {
        console.log(`[Main] Loading index.html from: ${indexPath}`);
        mainWindow.loadFile(indexPath).catch((err) => {
          console.error('[Main] Failed to load index:', err);
        });
        loaded = true;
        break;
      }
    }

    if (!loaded) {
      console.error('[Main] Could not find dist/index.html in any expected location.');
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Window control IPC handlers
ipcMain.on('window-minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.on('window-maximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.isMaximized() : false;
});

ipcMain.on('window-reload', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reload();
  }
});

ipcMain.on('window-toggle-devtools', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.toggleDevTools();
  }
});

ipcMain.on('window-toggle-fullscreen', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  }
});

ipcMain.on('window-zoom-in', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const current = mainWindow.webContents.getZoomLevel();
    mainWindow.webContents.setZoomLevel(current + 0.5);
  }
});

ipcMain.on('window-zoom-out', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const current = mainWindow.webContents.getZoomLevel();
    mainWindow.webContents.setZoomLevel(Math.max(-3, current - 0.5));
  }
});

ipcMain.on('window-zoom-reset', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setZoomLevel(0);
  }
});

// App configuration IPC handlers
ipcMain.on('get-app-config-sync', (event) => {
  if (!cachedConfig) {
    cachedConfig = loadAppConfig();
  }
  event.returnValue = cachedConfig;
});

ipcMain.handle('get-app-config', () => {
  if (!cachedConfig) {
    cachedConfig = loadAppConfig();
  }
  return cachedConfig;
});

ipcMain.handle('save-app-config', (event, newConfig) => {
  try {
    if (!newConfig || typeof newConfig !== 'object' || !newConfig.apiBaseUrl) {
      return { success: false, error: 'Invalid configuration' };
    }

    cachedConfig = {
      ...cachedConfig,
      ...newConfig,
      apiBaseUrl: String(newConfig.apiBaseUrl).trim(),
    };

    const targetPath = getConfigFilePath();
    fs.writeFileSync(targetPath, JSON.stringify(cachedConfig, null, 2), 'utf8');
    console.log(`[Main] Saved updated config.json to: ${targetPath}`);
    return { success: true, config: cachedConfig };
  } catch (err) {
    console.error('[Main] Failed to save config:', err);
    return { success: false, error: err.message };
  }
});

function getAppVersion() {
  try {
    const pkgPath = path.join(__dirname, '../package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.version) return pkg.version;
    }
  } catch {}
  try {
    const rootPkg = path.join(app.getAppPath(), 'package.json');
    if (fs.existsSync(rootPkg)) {
      const pkg = JSON.parse(fs.readFileSync(rootPkg, 'utf8'));
      if (pkg.version) return pkg.version;
    }
  } catch {}
  return app.getVersion() || '1.2.0';
}

ipcMain.handle('get-system-info', () => {
  return {
    appName: 'MEALS - Management of Expenses, Assets, and Logistics System',
    appVersion: getAppVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    apiBaseUrl: cachedConfig?.apiBaseUrl || 'http://3.91.7.109/api',
  };
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
