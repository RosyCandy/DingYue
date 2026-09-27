// DingYue 桌面版主进程：加载线上站点（自动跟随网页端更新）。
// 站内与 OAuth 授权域名在应用内窗口导航（保证登录后能回到应用），
// 其余外部链接交给系统浏览器。
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

const SITE_URL = 'https://ngaasiu.studio';
// OAuth 授权链路会在窗口内跳到这些域名，最终重定向回站点完成登录
const NAV_ALLOWlist = [
  SITE_URL,
  'https://github.com',
  'https://gitee.com',
  'https://connect.czl.net',
  'https://www.czl.net',
  'https://open.weixin.qq.com',
  'https://long.open.weixin.qq.com',
  'https://accounts.google.com',
  'https://myaccount.google.com',
];

const isAllowed = (url) => {
  try {
    return NAV_ALLOWlist.some((prefix) => new URL(url).origin + '/' === prefix + '/' || url.startsWith(prefix));
  } catch {
    return false;
  }
};

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

  mainWindow.on('page-title-updated', (event) => event.preventDefault());

  // 新开的窗口/弹窗（如 Google Identity Services 的 OAuth 弹窗）：
  // 允许名单内就在应用内打开，否则交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowed(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowed(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// Linux 虚拟机/无 GPU 环境兼容：关闭硬件加速避免渲染进程起不来（黄屏/白屏），
// 关闭 Chromium 沙箱（部分 Debian 内核未启用 user namespaces，导致窗口空白）
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

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
