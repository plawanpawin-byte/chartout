'use strict';
// Chartout main process. Local-only: no network access, files only via user-chosen dialogs.
const { app, BrowserWindow, ipcMain, dialog, session, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const TITLE = 'Chartout';
const granted = new Map(); // opaque id -> absolute path the user picked in a dialog
let win = null;

function grant(p) {
  const id = crypto.randomBytes(8).toString('hex');
  granted.set(id, p);
  return id;
}
function pathOf(id) {
  const p = granted.get(String(id));
  if (!p) throw new Error('Path was not granted by the user');
  return p;
}
module.exports = { grant, pathOf };

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    title: TITLE, backgroundColor: '#262626', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false, spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // the page blocks closing while the diagram has unsaved changes (beforeunload); ask the user here
  win.webContents.on('will-prevent-unload', (e) => {
    const r = dialog.showMessageBoxSync(win, { type: 'warning', buttons: ['Close without saving', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
      title: TITLE, message: 'This diagram has unsaved changes.', detail: 'If you close now, your changes will be lost.' });
    if (r === 0) e.preventDefault();
  });
  win.on('closed', () => { win = null; });
}

const filters = (list) => (list || []).map((f) => ({ name: f[0], extensions: f[1] }));

ipcMain.handle('file:open', async (_e, opts = {}) => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile', ...(opts.multi ? ['multiSelections'] : [])],
    filters: filters(opts.filters),
  });
  if (r.canceled) return [];
  const out = [];
  for (const p of r.filePaths) {
    const n = path.basename(p);
    try {
      const st = fs.statSync(p);
      const item = { id: grant(p), name: n, size: st.size };
      if (opts.read !== false && st.size <= (opts.maxBytes || 512 * 1024 * 1024)) item.data = fs.readFileSync(p);
      out.push(item);
    } catch (e) { throw new Error(`Cannot open "${n}": ` + (e.code === 'ENOENT' ? 'the file is gone.' : e.code === 'EISDIR' ? 'it is a folder.' : /^E(PERM|ACCES|BUSY)$/.test(e.code) ? 'it is locked or you do not have access.' : e.message)); }
  }
  return out;
});

function safeName(n) {
  const t = String(n || 'untitled').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^[ .]+|[ .]+$/g, '');
  return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i.test(t) || !t ? '_' + t : t;
}

// write to a temporary file next to the target, then rename it over the target, so a failed save never leaves a half-written file
function writeSafe(p, data) {
  const n = path.basename(p), tmp = p + '.chartout-' + process.pid + '.tmp';
  try { fs.writeFileSync(tmp, data); fs.renameSync(tmp, p); }
  catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    if (/^E(PERM|ACCES|BUSY)$/.test(e.code)) throw new Error(`Cannot save "${n}": the file is read-only or open in another program. Choose another name, or close it there first.`);
    if (e.code === 'ENOSPC') throw new Error(`Cannot save "${n}": the disk is full.`);
    if (e.code === 'ENAMETOOLONG' || e.code === 'ENOENT') throw new Error(`Cannot save "${n}": the name is too long or the folder is missing.`);
    throw new Error(`Cannot save "${n}": ` + e.message);
  }
}

ipcMain.handle('file:save', async (_e, opts = {}) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: safeName(opts.name), filters: filters(opts.filters),
  });
  if (r.canceled || !r.filePath) return null;
  if (opts.data) writeSafe(r.filePath, Buffer.from(opts.data));
  return { id: grant(r.filePath), name: path.basename(r.filePath) };
});

ipcMain.handle('file:write', async (_e, id, data) => {
  writeSafe(pathOf(id), Buffer.from(data));
  return true;
});

ipcMain.handle('file:read', async (_e, id) => fs.readFileSync(pathOf(id)));

ipcMain.handle('app:info', () => ({ name: TITLE, version: app.getVersion() }));



app.whenReady().then(() => {
  // Hard network kill-switch: this app never talks to the internet.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*'] }, (_d, cb) => cb({ cancel: true }));
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(false));
  createWindow();
});
app.on('window-all-closed', () => app.quit());
