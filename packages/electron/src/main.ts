import { app, BrowserWindow, ipcMain, dialog, nativeTheme } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerFnoIpc } from './fno/ipc.js';

const isDev = !app.isPackaged;

const DEV_SERVER_ORIGIN = 'http://localhost:5173';

function resolveRendererEntry(): string {
  const candidates = [
    // Packaged build: electron-builder copies `packages/ui/dist` into
    // `<Resources>/ui` via `extraResources` (see package.json "build").
    ...(app.isPackaged ? [path.join(process.resourcesPath, 'ui', 'index.html')] : []),
    // Unpackaged `electron .` after `pnpm --filter @er-visualizer/ui build`.
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

let rendererEntryUrl: string | null = null;

/** `file://` URL of the packaged renderer document, resolved once. */
function getRendererEntryUrl(): string {
  rendererEntryUrl ??= pathToFileURL(resolveRendererEntry()).href;
  return rendererEntryUrl;
}

/**
 * True when `raw` is the app's own renderer document: the Vite dev server in
 * development, otherwise exactly the renderer entry file — not any file:// URL,
 * which would let a navigated-to local page drive the IPC surface. Query and
 * hash are ignored (the SPA may use them); the path must match.
 */
function isTrustedRendererUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (isDev) return url.origin === DEV_SERVER_ORIGIN;
  if (url.protocol !== 'file:') return false;
  url.search = '';
  url.hash = '';
  const expected = getRendererEntryUrl();
  // Windows paths are case-insensitive, and drive letters vary in case.
  return process.platform === 'win32'
    ? url.href.toLowerCase() === expected.toLowerCase()
    : url.href === expected;
}

function createWindow() {
  // Match the renderer's boot background (`--er-bg-soft`, index.html) so there
  // is no flash of the wrong theme before the HTML paints. The renderer honours
  // an explicit stored choice, which this cannot read — the OS scheme is the
  // right guess, and any mismatch lasts only until the page loads.
  const initialBg = nativeTheme.shouldUseDarkColors ? '#0f1011' : '#f7f7f8';

  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1000,
    minHeight: 600,
    title: 'D365FO ER Visualizer',
    backgroundColor: initialBg,
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Mark the renderer as *our* shell. The UI used to sniff "Electron" out of the
  // user agent, which also matches any Electron-based browser (VS Code's Simple
  // Browser, Claude's browser pane, …) and made those refuse the browser sign-in
  // flow. This token only ever appears in this window.
  win.webContents.setUserAgent(`${win.webContents.getUserAgent()} ERVisualizerShell/1.0`);

  // A preload that throws leaves `window.electronAPI` undefined and the renderer
  // only reports "auth bridge unavailable" much later. Surface the real cause.
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[electron] preload failed to load: ${preloadPath}`, error);
  });

  // Content-Security-Policy as a response header. This only reaches responses
  // that have headers — the Vite dev server. The packaged renderer loads over
  // file://, where this hook never fires; there the <meta> CSP that `vite
  // build` writes into index.html (packages/ui/vite.config.ts) is the policy.
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev
      ? "default-src 'self' http://localhost:5173 ws://localhost:5173; script-src 'self' 'unsafe-inline' http://localhost:5173; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' http://localhost:5173 ws://localhost:5173 https://login.microsoftonline.com https://*.dynamics.com;"
      : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://login.microsoftonline.com https://*.dynamics.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none';";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  // Block navigation anywhere but the renderer itself (a reload), and popups.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  if (isDev) {
    win.loadURL(DEV_SERVER_ORIGIN);
    win.webContents.openDevTools();
  } else {
    win.loadURL(getRendererEntryUrl());
  }

  return win;
}

app.whenReady().then(() => {
  registerFnoIpc({ isTrustedRendererUrl });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: Open file dialog
ipcMain.handle('open-file-dialog', async event => {
  const senderUrl = event.senderFrame?.url;
  if (!senderUrl || !isTrustedRendererUrl(senderUrl)) {
    throw new Error('File dialog is only available to the application window');
  }
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
