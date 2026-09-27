// DingYue 桌面版主进程：加载线上站点（自动跟随网页端更新），
// 站内跳转在窗口内完成，外部链接交给系统浏览器。
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

const SITE_URL = 'https://ngaasiu.studio';

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 420,
    minHeight: 640,
    title: 'DingYue',
    icon: path.join(__dirname, '..', 'resources', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#f5f3ec',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  void mainWindow.loadURL(SITE_URL);

  // 页面标题固定为应用名，避免跟随网页 title 变化
  mainWindow.on('page-title-updated', (event) => event.preventDefault());

  // 外部链接（GitHub/Gitee 授权、邮箱等）用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(SITE_URL)) {
      mainWindow.loadURL(url);
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(SITE_URL)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
