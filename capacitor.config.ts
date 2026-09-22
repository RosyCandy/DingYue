import type { CapacitorConfig } from '@capacitor/cli';

const developmentServerUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  // ⚠️ appId 必须在发布前改成你自己的、全局唯一的反向域名标识
  // 一旦提交到 App Store / Google Play 上架后基本无法再修改
  appId: 'com.duoduo.app',
  appName: 'DuoDuo',
  webDir: 'dist',
  // 给 WebView 一个应用底色：安卓键盘弹出触发 WebView 重绘故障时露出的是
  // 页面底色而不是黑色（亮色主题的 surface 色，暗色主题由 CSS 覆盖）。
  backgroundColor: '#f9f9fe',
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
