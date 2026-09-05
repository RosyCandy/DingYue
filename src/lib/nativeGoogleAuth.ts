import { Capacitor } from '@capacitor/core';
import { ErrorCode, GoogleSignIn } from '@capawesome/capacitor-google-sign-in';

// 注意：不管是 iOS 还是 Android，这里必须传入 Google Cloud Console 里
// "Web 应用" 类型的 Client ID（和 main.tsx 里 GoogleOAuthProvider 用的是同一个），
// 而不是 iOS/Android 各自的 Client ID。iOS/Android 的 Client ID 只需要在
// Google Cloud Console 里存在（用于校验 Bundle ID / 包名 + 签名指纹），
// 不需要写进代码里。
const WEB_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

let initPromise: Promise<void> | null = null;

export const isNativePlatform = () => Capacitor.isNativePlatform();

const ensureInitialized = () => {
  if (!initPromise) {
    initPromise = GoogleSignIn.initialize({ clientId: WEB_CLIENT_ID }).catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
};

export class NativeGoogleSignInCanceledError extends Error {}

/**
 * 触发原生 Google 登录（Android 用 Credential Manager，iOS 用 Google Sign-In SDK），
 * 返回可以直接发给后端 /api/auth/google 校验的 ID Token。
 */
export async function signInWithGoogleNative(): Promise<string> {
  await ensureInitialized();
  try {
    const result = await GoogleSignIn.signIn();
    return result.idToken;
  } catch (error: any) {
    if (error?.code === ErrorCode.SignInCanceled) {
      throw new NativeGoogleSignInCanceledError('用户取消了 Google 登录');
    }
    throw error;
  }
}
