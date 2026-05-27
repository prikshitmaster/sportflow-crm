const { app, BrowserWindow, shell, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

// --dev flag means load from Vite dev server
const isDev = process.argv.includes('--dev');

// Must register custom scheme before app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'SportFlow CRM',
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    // Serve via custom protocol so React Router sees "/" not a file path
    win.loadURL('app://localhost/');
  }

  // Open external URLs in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('app://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

app.whenReady().then(() => {
  const distDir = path.join(__dirname, '../dist');

  // Explicit MIME map — Windows registry can return wrong types for .js files,
  // which causes Chromium to silently block ES modules (white screen).
  const MIME = {
    '.html':        'text/html; charset=utf-8',
    '.js':          'application/javascript; charset=utf-8',
    '.css':         'text/css; charset=utf-8',
    '.json':        'application/json',
    '.webmanifest': 'application/manifest+json',
    '.svg':         'image/svg+xml',
    '.png':         'image/png',
    '.ico':         'image/x-icon',
    '.woff2':       'font/woff2',
  };

  // Serve dist/ folder through app://localhost/
  // Falls back to index.html for SPA deep-link routes
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let filePath = path.normalize(
      path.join(distDir, decodeURIComponent(url.pathname))
    );

    // Security: prevent escaping the dist directory
    if (!filePath.startsWith(distDir)) {
      filePath = path.join(distDir, 'index.html');
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distDir, 'index.html');
    }

    const contentType = MIME[path.extname(filePath)] ?? 'application/octet-stream';
    return new Response(fs.readFileSync(filePath), {
      headers: { 'Content-Type': contentType },
    });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
