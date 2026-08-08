const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

process.on('uncaughtException', (error) => {
  console.error('[Main UncaughtException]', error);
});

const isDev = !app.isPackaged && process.env.NODE_ENV === 'development';

function loadAppConfig() {
  const possiblePaths = [
    // Next to executable in installed dir
    path.join(path.dirname(app.getPath('exe')), 'config.json'),
    // Process working directory
    path.join(process.cwd(), 'config.json'),
    // Extra resources directory in electron-builder
    path.join(process.resourcesPath, 'config.json'),
    // App root directory
    path.join(__dirname, 'config.json'),
    path.join(app.getAppPath(), 'config.json'),
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
    apiBaseUrl: 'http://54.253.139.103/api',
  };
}

let mainWindow = null;
let cachedConfig = null;

function createWindow() {
  cachedConfig = loadAppConfig();

  const appIconPath = path.join(__dirname, 'icon.png');
  const fallbackIconPath = path.join(__dirname, '../public/logo.png');
  const windowIcon = fs.existsSync(appIconPath) ? appIconPath : (fs.existsSync(fallbackIconPath) ? fallbackIconPath : undefined);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: 'MEALS - Smart Canteen System',
    icon: windowIcon,
    autoHideMenuBar: false,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // Prevent CORS/file:// issues in local desktop wrapper
    },
  });

  // Simple application menu
  const menuTemplate = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow.reload(),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Exit MEALS' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About MEALS',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About MEALS',
              message: 'MEALS - Smart Canteen Management System',
              detail: `Connected to API: ${cachedConfig.apiBaseUrl}\nVersion: 1.0.0`,
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    // Resolve dist index.html path flexibly
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

// Register IPC handlers before app ready
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
