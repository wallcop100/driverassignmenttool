const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');

let sidecar = null;
let sidecarPort = 5175; // dev default — `npm run dev` starts python on 5175 itself

function startSidecar() {
  if (!app.isPackaged) return Promise.resolve(sidecarPort);
  const exe = path.join(process.resourcesPath, 'sidecar.exe');
  sidecar = spawn(exe, [], { stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sidecar did not start within 20s')), 20000);
    sidecar.stdout.on('data', (chunk) => {
      const m = /PORT (\d+)/.exec(chunk.toString());
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    sidecar.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });
  win.removeMenu();
  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

ipcMain.on('sidecar-port', (e) => { e.returnValue = sidecarPort; });

ipcMain.handle('save-file', async (e, { text, name }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: name,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (canceled || !filePath) return false;
  fs.writeFileSync(filePath, text, 'utf-8');
  return true;
});

app.whenReady().then(async () => {
  try {
    sidecarPort = await startSidecar();
  } catch (err) {
    dialog.showErrorBox('Sidecar failed to start', String(err));
    app.quit();
    return;
  }
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('quit', () => sidecar?.kill());
