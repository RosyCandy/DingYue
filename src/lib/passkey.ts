import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { api, AuthSessionPayload, SITE_ORIGIN } from './api';

/** 在已登录的账户上注册新的通行密钥 */
export async function registerPasskey(): Promise<{ verified: boolean; passkeyCount: number }> {
  const optionsJSON = await api.beginPasskeyRegistration();
  const credential = await startRegistration({ optionsJSON });
  return api.finishPasskeyRegistration(credential);
}

/**
 * 桌面端桥接返回标记：主窗口完成 WebAuthn 回到应用后，设置页据此直接打开
 * 通行密钥列表并提示成功（app:// 的 sessionStorage 在跨 origin 往返后仍保留）
 */
export const PASSKEY_BRIDGE_NAV_KEY = 'passkey_bridge_nav';

/**
 * 桌面端（Electron）：主窗口临时导航到线上桥接页 passkey-bridge.html，
 * 在真实 https origin 下触发系统 WebAuthn（Touch ID / Windows Hello），
 * 完成后桥接页把结果带回 app://index.html?passkey_bridge=…，由 App 消费。
 * 此前的「子窗口 + postMessage」方案在 Windows/macOS 上系统弹窗都调不出来。
 */
export function beginDesktopPasskeyBridge(mode: 'register' | 'login'): void {
  const params = new URLSearchParams({ mode });
  if (mode === 'register') {
    const token = localStorage.getItem('auth_token');
    if (token) params.set('token', token);
  }
  window.location.href = `${SITE_ORIGIN}/passkey-bridge.html#${params.toString()}`;
}

/**
 * 桌面桥接子窗口专用（保留给旧版本）：主窗口传入会话 token，在真实站点 origin 下完成注册。
 */
export async function registerPasskeyWithToken(token: string): Promise<{ verified: boolean; passkeyCount: number }> {
  const optionsJSON = await api.beginPasskeyRegistration(token);
  const credential = await startRegistration({ optionsJSON });
  return api.finishPasskeyRegistration(credential, token);
}

/** 用通行密钥登录（可发现凭据，无需输入邮箱） */
export async function loginWithPasskey(): Promise<AuthSessionPayload> {
  const optionsJSON = await api.beginPasskeyAuthentication();
  const credential = await startAuthentication({ optionsJSON });
  return api.finishPasskeyAuthentication(credential);
}

/** 用户主动取消或操作超时 —— 界面上应静默处理 */
export const isPasskeyUserCancellation = (error: unknown): boolean => {
  const name = (error as { name?: string })?.name;
  return name === 'NotAllowedError' || name === 'AbortError';
};

/** 该设备已经为当前账户注册过同一把通行密钥 */
export const isPasskeyAlreadyRegistered = (error: unknown): boolean => {
  const name = (error as { name?: string })?.name;
  return name === 'InvalidStateError';
};
