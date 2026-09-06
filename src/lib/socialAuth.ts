import { Capacitor } from '@capacitor/core';
import { AppleSignIn, SignInScope, ErrorCode } from '@capawesome/capacitor-apple-sign-in';

// 各登录方式的可用性由环境变量开关（VITE_APPLE_CLIENT_ID / VITE_WECHAT_APP_ID / VITE_QQ_APP_ID）。
// 未配置时登录页自动隐藏对应按钮，避免出现点了必然失败的入口。
const APPLE_CLIENT_ID = import.meta.env.VITE_APPLE_CLIENT_ID || '';
const WECHAT_APP_ID = import.meta.env.VITE_WECHAT_APP_ID || '';
const QQ_APP_ID = import.meta.env.VITE_QQ_APP_ID || '';

// 微信 / QQ 的 OAuth 只实现了 Web 扫码流程；原生端没有可靠插件，先隐藏。
export const isWechatLoginAvailable = (): boolean =>
  Boolean(WECHAT_APP_ID) && !Capacitor.isNativePlatform();

export const isQqLoginAvailable = (): boolean =>
  Boolean(QQ_APP_ID) && !Capacitor.isNativePlatform();

// Apple：iOS 原生走 AuthenticationServices；Web / Android 走插件的 Apple JS SDK（popup）。
export const isAppleLoginAvailable = (): boolean => {
  if (Capacitor.isNativePlatform()) {
    return Capacitor.getPlatform() === 'ios' || Boolean(APPLE_CLIENT_ID);
  }
  return Boolean(APPLE_CLIENT_ID);
};

export class AppleSignInCanceledError extends Error {}

let appleInitialized = false;

/**
 * 触发 Apple 登录，返回可以直接发给后端 /api/auth/apple 校验的 ID Token 和姓名。
 */
export async function signInWithApple(): Promise<{ idToken: string; name: string }> {
  const platform = Capacitor.getPlatform();
  if (platform !== 'ios') {
    if (!APPLE_CLIENT_ID) {
      throw new Error('Apple 登录暂未配置');
    }
    if (!appleInitialized) {
      await AppleSignIn.initialize({ clientId: APPLE_CLIENT_ID });
      appleInitialized = true;
    }
  }
  try {
    const result = await AppleSignIn.signIn({
      scopes: [SignInScope.Email, SignInScope.FullName],
      ...(platform !== 'ios' ? { redirectUrl: `${window.location.origin}/` } : {})
    });
    const name = [result.givenName, result.familyName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return { idToken: result.idToken, name };
  } catch (error: any) {
    if (error?.code === ErrorCode.SignInCanceled) {
      throw new AppleSignInCanceledError('用户取消了 Apple 登录');
    }
    throw error;
  }
}

// ─────────────────────────────────────────────
// WeChat / QQ Web OAuth（跳转 + 回调）
// ─────────────────────────────────────────────

const OAUTH_STATE_KEY = 'social_oauth_state';

// OAuth 跳转后回到应用时，如果登录失败，通过 sessionStorage 把错误带给登录页展示
export const SOCIAL_LOGIN_ERROR_KEY = 'social_login_error';

const buildOAuthState = (prefix: 'wx' | 'qq'): string => {
  const state = `${prefix}_${crypto.randomUUID()}`;
  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  return state;
};

const getRedirectUri = (): string => `${window.location.origin}/`;

export function beginWechatLogin(): void {
  if (!WECHAT_APP_ID) return;
  const params = new URLSearchParams({
    appid: WECHAT_APP_ID,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: 'snsapi_login',
    state: buildOAuthState('wx')
  });
  window.location.href = `https://open.weixin.qq.com/connect/qrconnect?${params.toString()}#wechat_redirect`;
}

export function beginQqLogin(): void {
  if (!QQ_APP_ID) return;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: QQ_APP_ID,
    redirect_uri: getRedirectUri(),
    state: buildOAuthState('qq')
  });
  window.location.href = `https://graph.qq.com/oauth2.0/authorize?${params.toString()}`;
}

export type SocialOAuthProvider = 'wechat' | 'qq';

export type SocialOAuthCallback = {
  provider: SocialOAuthProvider;
  code: string;
};

/**
 * 应用启动时调用：检测 URL 上是否带有微信 / QQ 回调的 code，
 * 校验 state 防 CSRF。无论结果如何都应清理 URL 参数。
 */
export function consumeSocialOAuthCallback(): SocialOAuthCallback | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) return null;

  const provider: SocialOAuthProvider | null = state.startsWith('wx_')
    ? 'wechat'
    : state.startsWith('qq_')
      ? 'qq'
      : null;
  const savedState = sessionStorage.getItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);

  if (!provider || savedState !== state) return null;
  return { provider, code };
}
