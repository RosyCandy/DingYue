import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { AppleSignIn, SignInScope, ErrorCode } from '@capawesome/capacitor-apple-sign-in';

// 各登录方式的可用性由环境变量开关（VITE_APPLE_CLIENT_ID / VITE_WECHAT_APP_ID / VITE_QQ_APP_ID）。
// 未配置时登录页自动隐藏对应按钮，避免出现点了必然失败的入口。
const APPLE_CLIENT_ID = import.meta.env.VITE_APPLE_CLIENT_ID || '';
const WECHAT_APP_ID = import.meta.env.VITE_WECHAT_APP_ID || '';
const QQ_APP_ID = import.meta.env.VITE_QQ_APP_ID || '';
const GITHUB_APP_ID = import.meta.env.VITE_GITHUB_APP_ID || '';
const GITEE_APP_ID = import.meta.env.VITE_GITEE_APP_ID || '';

// CZL Connect 中继登录（connect.czl.net）：个人开发者绕过微信/QQ 企业认证的折衷方案。
// 授权发起在前端，code 换用户信息在后端 /api/auth/czl 完成。
const CZL_CLIENT_ID = import.meta.env.VITE_CZL_CLIENT_ID || '';
const CZL_CLIENT_SECRET = import.meta.env.VITE_CZL_CLIENT_SECRET || '';
const CZL_BASE_URL = (import.meta.env.VITE_CZL_BASE_URL || 'https://connect.czl.net').replace(/\/+$/, '');

// 微信 / QQ 的 OAuth 只实现了 Web 扫码流程；原生端没有可靠插件，先隐藏。
export const isWechatLoginAvailable = (): boolean =>
  Boolean(WECHAT_APP_ID) && !Capacitor.isNativePlatform();

export const isQqLoginAvailable = (): boolean =>
  Boolean(QQ_APP_ID) && !Capacitor.isNativePlatform();

// CZL 中继的微信登录：Web 端直接跳转，原生端通过中转页 + 深链回 App
export const isCzlWechatLoginAvailable = (): boolean =>
  Boolean(CZL_CLIENT_ID);

// GitHub OAuth（Web 端可用，原生端也通过 WebView 跳转授权）
export const isGithubLoginAvailable = (): boolean =>
  Boolean(GITHUB_APP_ID);

// Gitee OAuth（Web 端可用，原生端也通过 WebView 跳转授权）
export const isGiteeLoginAvailable = (): boolean =>
  Boolean(GITEE_APP_ID);

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

const buildOAuthState = (prefix: 'wx' | 'qq' | 'czl' | 'github' | 'gitee'): string => {
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

// CZL Connect 中继登录，upstream_providers=wechat 把授权页限定为微信入口。
// 统一使用中转页接收 CZL 回调：App 端通过深链 duoduoapp://czl-callback 返回，
// Web 端通过中转页回退到站点首页由 useEffect 消费 code。
//
// 原生端（安卓/iOS）不用 window.location.href 整页跳转：Capacitor 会把这类跳转
// 交给系统浏览器处理，导致应用整体切出到 Chrome/Safari，体验割裂，还容易撞上
// 微信「请在微信客户端打开链接」的限制。改用系统内置浏览器（Custom Tabs /
// SFSafariViewController）以覆盖层形式打开授权页，用户仍停留在 App 内，关闭
// 或授权完成后通过 duoduoapp://czl-callback 深链自动收起，体验更接近“点一下就登录”。
export function beginCzlLogin(): void {
  if (!CZL_CLIENT_ID) return;
  const redirectUri = `${window.location.origin}/czl-callback.html`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CZL_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'read',
    state: buildOAuthState('czl'),
    upstream_providers: 'wechat'
  });
  const url = `${CZL_BASE_URL}/oauth2/authorize?${params.toString()}`;
  if (Capacitor.isNativePlatform()) {
    void Browser.open({ url, presentationStyle: 'popover' });
    return;
  }
  window.location.href = url;
}

// 授权成功后（duoduoapp://czl-callback 深链到达）应用侧调用，收起还开着的原生浏览器覆盖层。
// 浏览器本来就没打开时 close() 会静默失败，因此吞掉异常即可。
export async function closeCzlLoginBrowser(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Browser.close();
  } catch {
    // 没有打开的浏览器实例，忽略
  }
}

// GitHub OAuth（标准授权码流程）
export function beginGithubLogin(): void {
  if (!GITHUB_APP_ID) return;
  const params = new URLSearchParams({
    client_id: GITHUB_APP_ID,
    redirect_uri: getRedirectUri(),
    scope: 'read:user user:email',
    state: buildOAuthState('github')
  });
  window.location.href = `https://github.com/login/oauth/authorize?${params.toString()}`;
}

// Gitee OAuth（标准授权码流程）
export function beginGiteeLogin(): void {
  if (!GITEE_APP_ID) return;
  const params = new URLSearchParams({
    client_id: GITEE_APP_ID,
    redirect_uri: getRedirectUri(),
    scope: 'user_info',
    state: buildOAuthState('gitee')
  });
  window.location.href = `https://gitee.com/oauth/authorize?${params.toString()}`;
}

export type SocialOAuthProvider = 'wechat' | 'qq' | 'czl' | 'github' | 'gitee';

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
      : state.startsWith('czl_')
        ? 'czl'
        : state.startsWith('github_')
          ? 'github'
          : state.startsWith('gitee_')
            ? 'gitee'
            : null;
  const savedState = sessionStorage.getItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);

  if (!provider || savedState !== state) return null;
  return { provider, code };
}
