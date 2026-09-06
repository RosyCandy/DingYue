import {
  browserSupportsWebAuthn,
  startRegistration,
  startAuthentication,
} from '@simplewebauthn/browser';
import { api, AuthSessionPayload } from './api';

/** 当前环境是否支持 WebAuthn（决定登录页/设置页是否显示通行密钥入口） */
export const isPasskeySupported = (): boolean => browserSupportsWebAuthn();

/** 在已登录的账户上注册新的通行密钥 */
export async function registerPasskey(): Promise<{ verified: boolean; passkeyCount: number }> {
  const optionsJSON = await api.beginPasskeyRegistration();
  const credential = await startRegistration({ optionsJSON });
  return api.finishPasskeyRegistration(credential);
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
