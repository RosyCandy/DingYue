import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { api, AuthSessionPayload } from './api';

/** 在已登录的账户上注册新的通行密钥 */
export async function registerPasskey(): Promise<{ verified: boolean; passkeyCount: number }> {
  const optionsJSON = await api.beginPasskeyRegistration();
  const credential = await startRegistration({ optionsJSON });
  return api.finishPasskeyRegistration(credential);
}

/**
 * 桌面桥接子窗口专用：主窗口传入会话 token，在真实站点 origin 下完成注册。
 * app:// origin 通不过 WebAuthn 的 rpID 校验（Windows 桌面端一直添加失败的根因），
 * 桥接窗口里 origin 是 https://ngaasiu.studio，与 rpID 匹配。
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
