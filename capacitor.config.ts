import type { CapacitorConfig } from '@capacitor/cli';

const developmentServerUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  // ⚠️ appId 必须在发布前改成你自己的、全局唯一的反向域名标识
  // 一旦提交到 App Store / Google Play 上架后基本无法再修改
  appId: 'com.duoduo.app',
  appName: 'DuoDuo',
  webDir: 'dist',
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
