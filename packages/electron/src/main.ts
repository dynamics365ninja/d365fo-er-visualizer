import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

const isDev = !app.isPackaged;

function resolveRendererEntry(): string {
  const candidates = [
    path.resolve(import.meta.dirname, '../../ui/dist/index.html'),
    path.resolve(import.meta.dirname, '../ui/dist/index.html'),
    path.resolve(import.meta.dirname, '../ui/index.html'),
  ];

  const entry = candidates.find(candidate => fs.existsSync(candidate));
  if (!entry) {
    throw new Error('Renderer entry not found. Build the UI package before starting Electron.');
  }

  return entry;
}

function createWindow() {
  // Respect the user's OS theme for the initial paint to avoid a dark flash in light mode.
  const prefersLight = process.platform === 'win32'
    ? false // Windows: stay neutral; the renderer will repaint instantly.
    : false;
  const initialBg = prefersLight ? '#ffffff' : '#1e1e1e';

  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1000,
    minHeight: 600,
    title: 'D365FO ER Visualizer',
    backgroundColor: initialBg,
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Strict Content-Security-Policy for packaged renderer. Dev uses Vite HMR so we relax slightly.
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev
      ? "default-src 'self' http://localhost:5173 ws://localhost:5173; script-src 'self' 'unsafe-inline' http://localhost:5173; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' http://localhost:5173 ws://localhost:5173;"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none';";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  // Block navigation to external URLs and popups.
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev && url.startsWith('http://localhost:5173');
    if (!allowed && !url.startsWith('file://')) {
      event.preventDefault();
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(resolveRendererEntry());
  }

  return win;
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: Open file dialog
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog({
    filters: [{ name: 'XML Files', extensions: ['xml'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths.map(fp => ({
    path: fp,
    content: fs.readFileSync(fp, 'utf-8'),
  }));
});
