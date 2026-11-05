'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const isMac = process.platform === 'darwin';
const REPO_URL = 'https://github.com/YOURUSER/birb';
const TEXT_EXT = ['txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'json', 'xml', 'yml', 'yaml', 'ini', 'conf', 'cfg',
  'html', 'css', 'js', 'ts', 'ps1', 'bat', 'cmd', 'sh', 'py'];

app.setName('Birb');

let win = null;
let rendererReady = false;
const queue = [];          // things to open once the page has said it is ready
let lastDir = null;

/* ---------- opening files from outside ---------- */

// Turn command line arguments into things for the page to open.
// "birb notes.txt" -> { path }, "cmd | birb -" -> --stdin=<temp file> -> { name, text }
function itemsFromArgv(argv, cwd) {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  const items = [];
  for (const a of args) {
    if (a.startsWith('--stdin=')) {
      const tmp = a.slice(8);
      try { items.push({ name: 'stdin.txt', text: fs.readFileSync(tmp, 'utf8') }); } catch (e) { /* gone */ }
      try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
    } else if (a.startsWith('-') || a === '.') {
      continue;
    } else {
      items.push({ path: path.resolve(cwd || process.cwd(), a) });
    }
  }
  return items;
}

function dispatch(items) {
  if (!items.length) return;
  items.forEach(i => { if (i.path) app.addRecentDocument(i.path); });
  if (win && rendererReady) {
    win.webContents.send('open', items);
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
  } else {
    queue.push(...items);
    if (!win && app.isReady()) createWindow();
  }
}

/* ---------- window ---------- */

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadState() {
  let s = { width: 1100, height: 760 };
  try { Object.assign(s, JSON.parse(fs.readFileSync(stateFile(), 'utf8'))); } catch (e) { /* first run */ }
  if (s.x !== undefined && s.y !== undefined) {
    const onScreen = screen.getAllDisplays().some(d => {
      const b = d.workArea;
      return s.x < b.x + b.width - 80 && s.x + s.width > b.x + 80 && s.y >= b.y - 10 && s.y < b.y + b.height - 80;
    });
    if (!onScreen) { delete s.x; delete s.y; }
  }
  return s;
}
function saveState() {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, max: win.isMaximized() }));
  } catch (e) { /* not important */ }
}

function createWindow() {
  const st = loadState();
  rendererReady = false;
  win = new BrowserWindow({
    x: st.x, y: st.y, width: st.width, height: st.height,
    minWidth: 560, minHeight: 380,
    backgroundColor: '#161914',
    title: 'Birb',
    show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  win.once('ready-to-show', () => { if (st.max) win.maximize(); win.show(); });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  // the page never navigates anywhere; links go to the real browser
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  if (process.env.BIRB_DEBUG) win.webContents.openDevTools({ mode: 'detach' });

  win.on('close', saveState);
  win.on('closed', () => { win = null; rendererReady = false; });
}

/* ---------- menu ---------- */

function buildMenu() {
  if (!isMac) { Menu.setApplicationMenu(null); return; }
  // Keyboard shortcuts live in the page itself, so these items carry no accelerators of their own.
  const press = id => () => { if (win) win.webContents.executeJavaScript(`document.getElementById('${id}').click()`); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'File', submenu: [
      { label: 'New Tab', click: press('bNew') },
      { label: 'Open…', click: press('bOpen') },
      { type: 'separator' },
      { label: 'Save', click: press('bSave') },
      { label: 'Save As…', click: press('bSaveAs') },
      { type: 'separator' },
      { role: 'close' }
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Find and Replace…', click: press('bFind') },
      { label: 'Table View (CSV)', click: press('bTable') },
      { type: 'separator' },
      { label: 'Toggle Word Wrap', click: press('bWrap') },
      { label: 'Toggle Dark / Light', click: press('bTheme') },
      { label: 'Zen Mode', click: press('bZen') },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [
      { label: 'Birb on GitHub', click: () => shell.openExternal(REPO_URL) }
    ] }
  ]));
}

/* ---------- file bridge ---------- */

ipcMain.on('renderer-ready', () => {
  rendererReady = true;
  if (queue.length && win) win.webContents.send('open', queue.splice(0));
});

ipcMain.handle('dialog:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    defaultPath: lastDir || app.getPath('documents'),
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Text files', extensions: TEXT_EXT }, { name: 'All files', extensions: ['*'] }]
  });
  if (r.canceled || !r.filePaths.length) return [];
  lastDir = path.dirname(r.filePaths[0]);
  r.filePaths.forEach(p => app.addRecentDocument(p));
  return r.filePaths;
});

ipcMain.handle('dialog:save', async (_e, suggestedName) => {
  const name = path.basename(String(suggestedName || 'untitled.txt'));
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(lastDir || app.getPath('documents'), name),
    filters: [{ name: 'All files', extensions: ['*'] }]
  });
  if (r.canceled || !r.filePath) return null;
  lastDir = path.dirname(r.filePath);
  return r.filePath;
});

ipcMain.handle('fs:read', async (_e, p) => {
  try {
    const buf = await fs.promises.readFile(p);
    let text = buf.toString('utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return { text, size: buf.length };
  } catch (e) {
    // "birb new-file.txt" on a file that does not exist yet: open it empty, Save will create it
    if (e.code === 'ENOENT') return { text: '', size: 0, missing: true };
    throw e;
  }
});

ipcMain.handle('fs:write', async (_e, p, text) => {
  await fs.promises.writeFile(p, text, 'utf8');
  app.addRecentDocument(p);
});

/* ---------- life cycle ---------- */

app.on('open-file', (e, p) => { e.preventDefault(); dispatch([{ path: p }]); });   // macOS: double-click, Open With, drop on dock icon

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv, cwd) => {
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    dispatch(itemsFromArgv(argv, cwd));
  });
  app.whenReady().then(() => {
    if (isMac && !app.isPackaged && app.dock) {
      try { app.dock.setIcon(path.join(__dirname, 'build', 'icon-mac.png')); } catch (e) { /* ignore */ }
    }
    buildMenu();
    queue.push(...itemsFromArgv(process.argv, process.cwd()));
    createWindow();
    app.on('activate', () => { if (!win) createWindow(); });
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
