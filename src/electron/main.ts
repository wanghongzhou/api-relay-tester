import { app as electronApp, BrowserWindow, shell } from 'electron';
import { app as expressApp } from '../server/app.js';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

let mainWindow: BrowserWindow | null = null;
let server: Server | null = null;

function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    server = expressApp.listen(0, () => {
      const addr = server!.address() as AddressInfo;
      console.log(`Express server listening on port ${addr.port}`);
      resolve(addr.port);
    });
    server.on('error', reject);
  });
}

function createWindow(port: number) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 860,
    title: '模型中转测试工具',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

electronApp.whenReady().then(async () => {
  const port = await startServer();
  createWindow(port);

  electronApp.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(port);
    }
  });
});

electronApp.on('window-all-closed', () => {
  if (server) server.close();
  electronApp.quit();
});
