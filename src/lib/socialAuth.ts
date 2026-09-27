import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { AppleSignIn, SignInScope, ErrorCode } from '@capawesome/capacitor-apple-sign-in';
import { SITE_ORIGIN } from './api';

// 各登录方式的可用性由环境变量开关（VITE_APPLE_CLIENT_ID / VITE_WECHAT_APP_ID / VITE_QQ_APP_ID）。
// 未配置时登录页自动隐藏对应按钮，避免出现点了必然失败的入口。
const APPLE_CLIENT_ID = import.meta.env.VITE_APPLE_CLIENT_ID || '';
const WECHAT_APP_ID = import.meta.env.VITE_WECHAT_APP_ID || '';
const QQ_APP_ID = import.meta.env.VITE_QQ_APP_ID || '';
const GITHUB_APP_ID = import.meta.env.VITE_GITHUB_APP_ID || '';
const GITEE_APP_ID = import.meta.env.VITE_GITEE_APP_ID || '';

// CZL Connect 中继登录（connect.czl.net）：个人开发者绕过微信/QQ企业认证的折衷方案。
// 授权发起在前端，code 换用户信息在后端 /api/auth/czl 完成。
// 注意：这里只需要 client_id（公开标识，会进入授权 URL），绝不要把
// client_secret 加 VITE_ 前缀暴露给前端，否则会被打包进公开的 JS 里。
const CZL_CLIENT_ID = import.meta.env.VITE_CZL_CLIENT_ID || '';
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
// 绑定流程（登录后）的结果，第三方登录页挂载时读取展示
export const SOCIAL_BIND_RESULT_KEY = 'social_bind_result';
// 绑定流程结束后让应用自动切到 设置→第三方登录 视图（替代“回到首页自己找”的糟糕体验）
export const SOCIAL_BIND_NAV_KEY = 'social_bind_nav';

// prefix 支持 'github' / 'gitee' / 'czl' / 'wx' / 'qq'，以及 'bind_' 前缀的绑定流程
const buildOAuthState = (prefix: string): string => {
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
// 统一使用中转页接收 CZL 回调：App 端通过中转页回 App，Web 端通过中转页回退到站点首页。
//
// 原生端（安卓/iOS）都直接在 App 自己的主 WebView 里完成整条 CZL→微信流程：
// capacitor.config.ts 已把 WebView UA 覆盖为桌面浏览器（带 DingYueNative 标记）并
// allowNavigation 放行 CZL/微信域名，微信展示桌面版二维码（截图/另一台设备扫码），
// 扫码完成后中转页识别标记直接导航回 App origin。iOS 早期走 SFSafariViewController
// + 移动 UA，会撞上微信「请在微信客户端打开链接」的限制，现已统一为主 WebView 方案。
export function beginCzlLogin(bind = false): void {
  if (!CZL_CLIENT_ID) return;
  const redirectUri = getCzlCallbackUri();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CZL_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'read',
    state: buildOAuthState(bind ? 'bind_czl' : 'czl'),
    upstream_providers: 'wechat'
  });
  const url = `${CZL_BASE_URL}/oauth2/authorize?${params.toString()}`;
  // 主 WebView 加载外部域名：UA 已是桌面版，CZL/微信域名在 allowNavigation 白名单里；
  // Web 端同样是整页跳转，无需分支
  window.location.href = url;
}

// 授权成功后（深链到达：duoduoapp://czl-callback 或 duoduoapp://oauth-callback）
// 应用侧调用，收起还开着的原生浏览器覆盖层。浏览器本来就没打开时 close() 会
// 静默失败，因此吞掉异常即可。
export async function closeNativeLoginBrowser(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Browser.close();
  } catch {
    // 没有打开的浏览器实例，忽略
  }
}

// 兼容旧名字，避免其它地方还在用 closeCzlLoginBrowser 这个名字。
export const closeCzlLoginBrowser = closeNativeLoginBrowser;

// GitHub / Gitee 原生端授权回调统一走这个中转页 + 深链，见 public/oauth-callback.html。
// redirect_uri 不带 query 参数，provider 信息通过 state 前缀（github_ / gitee_）识别，
// 和 Web 端 consumeSocialOAuthCallback 用的是同一套规则。
//
// GitHub/Gitee 都要求 authorize 的 redirect_uri 与开发者后台注册的回调地址完全一致，
// 且原生端 window.location.origin 是 WebView 内部地址（https://localhost），不能作为
// 回调。因此 Web 端和原生端统一使用站点公网域名下的中转页 /oauth-callback.html：
// 原生端由中转页唤起 duoduoapp://oauth-callback 深链回 App，Web 端由它回退到首页消费 code。
// ⚠️ GitHub / Gitee 开发者后台的回调地址必须配置为 {SITE_ORIGIN}/oauth-callback.html。
const oauthCallbackUri = (): string => `${SITE_ORIGIN}/oauth-callback.html`;

/** CZL Connect 的注册回调地址（需与 CZL 开发者后台配置一致）。 */
export const getCzlCallbackUri = (): string => `${SITE_ORIGIN}/czl-callback.html`;

/** GitHub / Gitee OAuth 的统一回调地址（需与对应平台开发者后台配置一致）。 */
export const getOAuthCallbackUri = oauthCallbackUri;

// GitHub OAuth（标准授权码流程；原生端用内置浏览器 + 深链回调，见上面 CZL 的说明）
export function beginGithubLogin(bind = false): void {
  if (!GITHUB_APP_ID) return;
  const params = new URLSearchParams({
    client_id: GITHUB_APP_ID,
    redirect_uri: oauthCallbackUri(),
    scope: 'read:user user:email',
    state: buildOAuthState(bind ? 'bind_github' : 'github')
  });
  const url = `https://github.com/login/oauth/authorize?${params.toString()}`;
  if (Capacitor.isNativePlatform()) {
    void Browser.open({ url, presentationStyle: 'popover' });
    return;
  }
  window.location.href = url;
}

// Gitee OAuth（标准授权码流程；原生端用内置浏览器 + 深链回调）
// 注意 response_type=code 必传：Gitee 不像 GitHub 会默认按 code 处理，
// 缺了会报「服务器不支持这种 response type」。
export function beginGiteeLogin(bind = false): void {
  if (!GITEE_APP_ID) return;
  const params = new URLSearchParams({
    client_id: GITEE_APP_ID,
    redirect_uri: oauthCallbackUri(),
    response_type: 'code',
    scope: 'user_info',
    state: buildOAuthState(bind ? 'bind_gitee' : 'gitee')
  });
  const url = `https://gitee.com/oauth/authorize?${params.toString()}`;
  if (Capacitor.isNativePlatform()) {
    void Browser.open({ url, presentationStyle: 'popover' });
    return;
  }
  window.location.href = url;
}

export type SocialOAuthProvider = 'wechat' | 'qq' | 'czl' | 'github' | 'gitee';

export type SocialOAuthCallback = {
  provider: SocialOAuthProvider;
  code: string;
  // true 表示这是「登录后绑定第三方账号」流程，回调应走 /api/auth/bind/* 而不是登录
  bind: boolean;
};

const resolveProviderFromState = (state: string): SocialOAuthProvider | null => {
  if (state.startsWith('wx_')) return 'wechat';
  if (state.startsWith('qq_')) return 'qq';
  if (state.startsWith('czl_')) return 'czl';
  if (state.startsWith('github_')) return 'github';
  if (state.startsWith('gitee_')) return 'gitee';
  return null;
};

// state 前缀同时编码 provider 与动作（登录 / 绑定）：bind_github_xxx / github_xxx
const resolveStateInfo = (state: string): { provider: SocialOAuthProvider; bind: boolean } | null => {
  if (state.startsWith('bind_')) {
    const provider = resolveProviderFromState(state.slice('bind_'.length));
    return provider ? { provider, bind: true } : null;
  }
  const provider = resolveProviderFromState(state);
  return provider ? { provider, bind: false } : null;
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

  const info = resolveStateInfo(state);
  const savedState = sessionStorage.getItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);

  if (!info || savedState !== state) return null;
  return { provider: info.provider, code, bind: info.bind };
}

/**
 * 原生端专用：duoduoapp://oauth-callback 深链到达时调用。provider 信息不走 query，
 * 从 state 前缀（github_ / gitee_）识别，与 Web 端 consumeSocialOAuthCallback 同一套规则。
 */
export function consumeNativeOAuthCallback(code: string | null, state: string | null): SocialOAuthCallback | null {
  if (!code || !state) return null;
  const info = resolveStateInfo(state);
  const savedState = sessionStorage.getItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);

  if (!info || savedState !== state) return null;
  return { provider: info.provider, code, bind: info.bind };
}
