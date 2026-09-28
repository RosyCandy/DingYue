// 桌面端（Electron）桥接：app:// 本地界面受 Web 安全策略限制，部分能力必须
// 在真实站点 origin 下完成——
//   • Google OAuth：Google 政策不允许 app:// 这类自定义协议作为发起 origin；
//   • WebAuthn 通行密钥：rpID = ngaasiu.studio，origin 必须是 https://ngaasiu.studio。
// 方案：主窗口里 window.open 一个加载线上站点的应用内子窗口（electron 壳的
// setWindowOpenHandler 已放行站点域名，无需改主进程），子窗口通过 postMessage +
// 随机 nonce 双向握手，把登录令牌 / 通行密钥注册结果传回主窗口后自动关闭。
// 主窗口的离线秒开、本地 UI、黄屏修复全部保持不变。

import { SITE_ORIGIN } from './api';

export type DesktopBridgeMode =
  | 'login'        // 完整登录页，任意方式登录成功后回传令牌
  | 'google'       // 自动触发 Google 登录（用线上 Web OAuth 客户端）
  | 'google-bind'  // 已登录账户绑定 Google（需主窗口传入当前会话 token）
  | 'passkey';     // 通行密钥注册（需主窗口传入当前会话 token）

export interface DesktopBridgeAuthResult {
  token: string;
  user: { id: number; email: string; name: string; avatar: string | null };
}

export interface DesktopBridgePasskeyResult {
  ok: boolean;
  passkeyCount?: number;
  error?: string;
}

const BRIDGE_TIMEOUT_MS = 10 * 60 * 1000; // 子窗口最长存活 10 分钟

// 子窗口就绪后，主窗口回发的初始化消息（token 仅 passkey 模式需要）
interface BridgeInitMessage {
  type: 'dy-bridge-init';
  nonce: string;
  token?: string;
}

/** 桌面 Electron 环境判定（主窗口与桥接子窗口通用） */
export const isDesktopElectron = (): boolean =>
  typeof window !== 'undefined' && /Electron/i.test(navigator.userAgent);

/** 当前窗口是否是被桌面主窗口打开的桥接子窗口 */
export const getBridgeParams = (): { mode: DesktopBridgeMode; nonce: string } | null => {
  if (typeof window === 'undefined') return null;
  const search = new URLSearchParams(window.location.search);
  const mode = search.get('bridge') as DesktopBridgeMode | null;
  const nonce = search.get('nonce');
  if (!mode || !nonce) return null;
  if (mode !== 'login' && mode !== 'google' && mode !== 'passkey') return null;
  return { mode, nonce };
};

/**
 * 主窗口侧：打开桥接子窗口并等待结果。
 * 返回 null 表示用户直接关闭了子窗口（视为取消，静默处理）。
 */
export function openDesktopBridge<T>(
  mode: DesktopBridgeMode,
  opts: { token?: string } = {}
): Promise<T | null> {
  return new Promise((resolve) => {
    const nonce = crypto.randomUUID();
    const url = `${SITE_ORIGIN}/?bridge=${mode}&nonce=${encodeURIComponent(nonce)}`;
    // 注意：不能用 noopener 特性——会切断 window.opener，握手就断了。
    // Electron 的 setWindowOpenHandler 已按域名白名单放行，安全性由 nonce 校验。
    const popup = window.open(url, '_blank', 'width=480,height=720');

    if (!popup) {
      // 弹窗被拦截（理论上不会发生：来自用户点击手势）
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (payload: T | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearInterval(closedGuard);
      clearTimeout(timeoutGuard);
      try { popup.close(); } catch { /* already closed */ }
      resolve(payload);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== popup) return; // 只信任我们打开的那个子窗口
      const data = event.data as any;
      if (!data || typeof data !== 'object' || data.nonce !== nonce) return;

      if (data.type === 'dy-bridge-ready') {
        const init: BridgeInitMessage = { type: 'dy-bridge-init', nonce };
        if (opts.token) init.token = opts.token;
        popup.postMessage(init, SITE_ORIGIN);
        return;
      }
      if (data.type === 'dy-bridge-result') {
        finish((data.payload ?? null) as T | null);
      }
    };

    window.addEventListener('message', onMessage);

    // 子窗口被用户手动关闭 / 加载失败兜底
    const closedGuard = setInterval(() => {
      if (popup.closed) finish(null);
    }, 500);

    // 总超时：防止子窗口意外挂起导致 Promise 永不落地
    const timeoutGuard = setTimeout(() => finish(null), BRIDGE_TIMEOUT_MS);
  });
}

/**
 * 桥接子窗口侧：向主窗口声明就绪，并等待初始化消息（可能携带 token）。
 */
export function bridgeHandshake(
  nonce: string,
  onInit: (init: { token?: string }) => void
): () => void {
  const opener = window.opener as Window | null;
  if (!opener) return () => {};

  const onMessage = (event: MessageEvent) => {
    if (event.source !== opener) return;
    const data = event.data as any;
    if (!data || typeof data !== 'object' || data.nonce !== nonce) return;
    if (data.type === 'dy-bridge-init') {
      onInit({ token: data.token });
    }
  };
  window.addEventListener('message', onMessage);
  opener.postMessage({ type: 'dy-bridge-ready', nonce }, '*' as unknown as string);

  return () => window.removeEventListener('message', onMessage);
}

/**
 * 桥接子窗口侧：把结果回传主窗口并尝试关闭自己。
 */
export function bridgeReturnResult(nonce: string, payload: unknown): void {
  const opener = window.opener as Window | null;
  if (opener) {
    opener.postMessage({ type: 'dy-bridge-result', nonce, payload }, '*' as unknown as string);
  }
  // 脚本关闭由脚本打开的窗口是允许的；万一被浏览器拦下，主窗口兜底轮询也会关掉它
  setTimeout(() => {
    try { window.close(); } catch { /* ignore */ }
  }, 150);
}
