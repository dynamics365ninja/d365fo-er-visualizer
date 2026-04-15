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
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1000,
    minHeight: 600,
    title: 'D365FO ER Visualizer',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

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
