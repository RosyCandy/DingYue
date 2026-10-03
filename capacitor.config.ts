import type { CapacitorConfig } from '@capacitor/cli';

const developmentServerUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  // ⚠️ appId 必须在发布前改成你自己的、全局唯一的反向域名标识
  // 一旦提交到 App Store / Google Play 上架后基本无法再修改
  appId: 'com.dingyue.app',
  appName: 'DingYue',
  webDir: 'dist',
  // 给 WebView 一个应用底色：安卓键盘弹出触发 WebView 重绘故障时露出的是
  // 页面底色而不是黑色（亮色主题的 surface 色，暗色主题由 CSS 覆盖）。
  backgroundColor: '#f9f9fe',
  server: {
    // 微信登录走 CZL 中继，而微信 qrconnect 页只做客户端 UA 检测（服务端不拦，
    // 实测桌面/移动 UA 返回同一份带二维码的 HTML），CZL 授权页在移动 UA 下却会
    // 跳到“仅微信内可用”的 H5 地址。把 WebView UA 覆盖成桌面 Chrome 后，整条
    // CZL→微信扫码流程可以在 App 内完成：安卓端微信登录直接在主 WebView 打开
    // （见 socialAuth.ts beginCzlLogin），二维码用截图或另一台设备扫码均可。
    // 末尾的 DingYueNative 标记供 czl-callback.html 识别“正在 App WebView 中”，
    // 届时直接导航回 App origin 而不是走深链。
    // ⚠️ 域名迁移（ngaasiu.studio → erieanna.tech）时需同步更新 allowNavigation。
    allowNavigation: ['connect.czl.net', 'open.weixin.qq.com', 'ngaasiu.studio', 'www.ngaasiu.studio'],
  },
  android: {
    // 桌面 Chrome UA + 自定义标记。仅影响主 WebView（Google 登录/通行密钥都是原生插件，不受影响）。
    overrideUserAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 DingYueNative',
  },
  ios: {
    overrideUserAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15 DingYueNative',
  },
  plugins: {
    CapacitorPasskey: {
      origin: process.env.PASSKEY_ORIGIN?.trim() || 'https://ngaasiu.studio',
      domains: ['ngaasiu.studio'],
      autoShim: true,
    },
  },
  ...(developmentServerUrl
    ? {
        server: {
          url: developmentServerUrl,
          cleartext: developmentServerUrl.startsWith('http://'),
          androidScheme: 'https' as const,
        },
      }
    : {}),
};

export default config;
