const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { stat } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const playerPath = path.join(__dirname, '../index.html');
const playerUrl = pathToFileURL(playerPath).href;

ipcMain.handle('reveal-video-file', async (event, filePath) => {
  if (event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url !== playerUrl) return false;
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return false;

  try {
    if (!(await stat(filePath)).isFile()) return false;
    shell.showItemInFolder(filePath);
    return true;
  } catch {
    return false;
  }
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.loadFile(playerPath);
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
