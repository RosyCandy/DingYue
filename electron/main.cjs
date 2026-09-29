// DingYue 桌面版主进程：加载应用内置界面（desktop-files/dist/，与移动端同一套本地资源），
// 离线也能秒开登录页；API 请求走公网地址（构建时注入 dist）。
// OAuth 授权（GitHub/Gitee/微信/Google）在窗口内跳转完成，授权回调被拦截
// 转回本地界面消费 code，全程不跳系统浏览器。
const { app, BrowserWindow, shell, Menu, protocol, net, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const SITE_ORIGIN = 'https://ngaasiu.studio';
// OAuth 授权链路域名：在应用内窗口导航
const NAV_ALLOW = [
  SITE_ORIGIN,
  'https://github.com',
  'https://gitee.com',
  'https://connect.czl.net',
  'https://www.czl.net',
  'https://open.weixin.qq.com',
  'https://long.open.weixin.qq.com',
  'https://accounts.google.com',
  'https://myaccount.google.com',
];
// 授权完成后 provider 重定向回的回调页：拦截并转回本地界面消费 code
const CALLBACK_PAGES = ['https://ngaasiu.studio/oauth-callback.html', 'https://ngaasiu.studio/czl-callback.html', 'https://ngaasiu.studio/?'];

const isAllowed = (url) => {
  try {
    return NAV_ALLOW.some((prefix) => url.startsWith(prefix));
  } catch {
    return false;
  }
};

// OAuth 子窗口（桥接登录窗 / Google 选号弹窗）统一伪装成 Chrome UA：
// accounts.google.com 会拦截 Electron UA（「此浏览器或应用可能不安全」）。
// 用独立 session partition 承载子窗口——UA 在会话级设置后，子窗口的首次
// 请求就生效（webContents.setUserAgent 对已经开始的首次导航无效）。
// 主窗口保持默认 session + 默认 UA，isDesktopElectron() 等检测依赖它。
const OAUTH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const OAUTH_PARTITION = 'persist:oauth-child';

// 子窗口（及其再弹出的窗口）统一套用导航策略。
// 回调页拦截只对主窗口有意义：子窗口里 OAuth 由页面内 JS 完成，不落回调页。
function setupChildWindow(childWindow) {
  childWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowed(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  childWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowed(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { partition: OAUTH_PARTITION } }
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Google GIS 从桥接窗口里再弹出的选号窗：递归套用同一套策略
  childWindow.webContents.on('did-create-window', (grandChild) => {
    setupChildWindow(grandChild);
  });
}

// 本地界面的根目录（打包后在 asar 内，开发态在项目根）
const UI_ROOT = fs.existsSync(path.join(__dirname, '..', 'desktop-files', 'dist'))
  ? path.join(__dirname, '..', 'desktop-files', 'dist')
  : path.join(__dirname, '..', '..', 'dist');

// 自定义 app:// 协议：file:// 下 ES Module 会被 CORS 拦截导致界面永远停在启动页，
// 必须以 privileged standard scheme 提供本地资源（支持相对路径/模块脚本/localStorage）
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 420,
    minHeight: 640,
    title: 'DingYue',
    autoHideMenuBar: true,
    backgroundColor: '#f5f3ec',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  void mainWindow.loadURL('app://index.html');

  mainWindow.on('page-title-updated', (event) => event.preventDefault());

  // OAuth 回调页 / 通行密钥桥接页：provider 或桥接页会把窗口导航走，这里拦截，
  // 把参数带回本地界面消费；app:// 内部跳转（含 app://quit）直接放行到本地界面
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === 'app://quit') {
      event.preventDefault();
      app.quit();
      return;
    }
    if (url.startsWith('app://')) {
      event.preventDefault();
      mainWindow.loadURL(url);
      return;
    }
    if (CALLBACK_PAGES.some((prefix) => url.startsWith(prefix))) {
      event.preventDefault();
      const query = url.split('?')[1] || '';
      mainWindow.loadURL(`app://index.html${query ? `?${query}` : ''}`);
      return;
    }
    if (!isAllowed(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // GIS/授权弹窗：允许名单内的新窗口在应用内打开（桥接登录窗等）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowed(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { partition: OAUTH_PARTITION } }
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 应用内打开的子窗口（桥接登录窗等）也要套策略 + Chrome UA
  mainWindow.webContents.on('did-create-window', (childWindow) => {
    setupChildWindow(childWindow);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// Linux 虚拟机/无 GPU 环境兼容：关闭硬件加速与沙箱，避免窗口空白
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

app.whenReady().then(() => {
  // OAuth 子窗口会话：Chrome UA 从第一个请求就生效（Google 拦 Electron UA）
  void session.fromPartition(OAUTH_PARTITION).setUserAgent(OAUTH_USER_AGENT);

  // app://index.html → dist/index.html；app://assets/xxx → dist/assets/xxx
  protocol.handle('app', (request) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url).pathname);
      if (pathname === '/' || pathname === '') pathname = '/index.html';
      const filePath = path.join(UI_ROOT, pathname);
      if (!filePath.startsWith(UI_ROOT)) {
        return new Response('forbidden', { status: 403 });
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
