import React, { useEffect, useRef, useState } from 'react';
import { Fingerprint, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { buildApiUrl, api } from '../lib/api';
import { useGoogleLogin, GoogleLogin } from '@react-oauth/google';
import { isNativePlatform, signInWithGoogleNative, NativeGoogleSignInCanceledError } from '../lib/nativeGoogleAuth';
import { beginDesktopGoogleLogin } from '../lib/socialAuth';
import { getBridgeParams, bridgeHandshake, bridgeReturnResult } from '../lib/desktopBridge';
import {
    isAppleLoginAvailable,
    isWechatLoginAvailable,
    isQqLoginAvailable,
    isCzlWechatLoginAvailable,
    signInWithApple,
    AppleSignInCanceledError,
    beginWechatLogin,
    beginQqLogin,
    beginCzlLogin,
    beginGithubLogin,
    beginGiteeLogin,
    SOCIAL_LOGIN_ERROR_KEY
} from '../lib/socialAuth';
import { loginWithPasskey, registerPasskeyWithToken, isPasskeyUserCancellation } from '../lib/passkey';
import { version as appVersion } from '../../package.json';

type Mode = 'login' | 'register' | 'forgot';

export default function LoginPage() {
    const { login: authLogin } = useAuth();
    const [mode, setMode] = useState<Mode>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [code, setCode] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [loading, setLoading] = useState(false);
    const [googleLoading, setGoogleLoading] = useState(false);
    const [appleLoading, setAppleLoading] = useState(false);
    const [codeSending, setCodeSending] = useState(false);
    const [countdown, setCountdown] = useState(0);
    const [passkeyLoading, setPasskeyLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const native = isNativePlatform();
    const isDesktop = native === false && /Electron/i.test(navigator.userAgent);

    // 网页端 Google 登录：点击时才动态加载 GIS 并弹 OAuth 窗口，按钮本身是离线本地图标
    const googleWebLogin = useGoogleLogin({
        flow: 'implicit',
        scope: 'openid email profile',
        onSuccess: (tokenResponse) => void sendTokenToBackend(tokenResponse.access_token),
        onError: () => setError('Google 登录失败'),
    });

    const wechatAvailable = isWechatLoginAvailable();
    const qqAvailable = isQqLoginAvailable();
    const appleAvailable = isAppleLoginAvailable();
    const czlAvailable = isCzlWechatLoginAvailable();
    const wechatEntryAvailable = wechatAvailable || czlAvailable;
    const githubAvailable = true;  // GitHub 按钮始终显示
    const giteeAvailable = true;  // Gitee 按钮始终显示

    // ── 桌面桥接子窗口模式 ─────────────────────────────────────────────
    // 本页面可能被桌面主窗口以子窗口形式打开（?bridge=google&nonce=...），
    // 在真实站点 origin 下替桌面端完成 Google 登录 / 通行密钥注册。
    // 任何方式登录成功都通过 wrappedLogin 回传令牌；子窗口随后自动关闭。
    const bridge = getBridgeParams();

    const login = (token: string, user: any) => {
        if (bridge) {
            bridgeReturnResult(bridge.nonce, { token, user });
            return;
        }
        authLogin(token, user);
    };

    // passkey 桥接：桌面端 app:// origin 无法通过 WebAuthn 的 rpID 校验，
    // 在这里用主窗口传来的会话 token 完成注册后把结果传回去。
    const [passkeyBridgeState, setPasskeyBridgeState] = useState<'waiting' | 'working' | 'done'>('waiting');

    // google-bind 桥接：接收主窗口传来的会话 token，用于调用绑定接口
    const [googleBindToken, setGoogleBindToken] = useState('');

    useEffect(() => {
        if (!bridge || bridge.mode !== 'google-bind') return;
        const cleanup = bridgeHandshake(bridge.nonce, ({ token }) => {
            setGoogleBindToken(token || '');
        });
        return cleanup;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!bridge || bridge.mode !== 'passkey') return;
        const cleanup = bridgeHandshake(bridge.nonce, async ({ token }) => {
            if (!token) {
                bridgeReturnResult(bridge.nonce, { ok: false, error: 'missing token' });
                return;
            }
            setPasskeyBridgeState('working');
            try {
                const result = await registerPasskeyWithToken(token);
                setPasskeyBridgeState('done');
                bridgeReturnResult(bridge.nonce, { ok: true, passkeyCount: result.passkeyCount });
            } catch (err) {
                const silent = isPasskeyUserCancellation(err);
                setPasskeyBridgeState('done');
                bridgeReturnResult(bridge.nonce, {
                    ok: false,
                    cancelled: silent,
                    error: err instanceof Error ? err.message : String(err)
                });
            }
        });
        return cleanup;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // google 桥接：握手完成后自动弹出 Google 选号窗，取消/失败则退回本页手动选择
    const googleAutoStarted = useRef(false);
    useEffect(() => {
        if (!bridge || bridge.mode !== 'google' || googleAutoStarted.current) return;
        googleAutoStarted.current = true;
        const cleanup = bridgeHandshake(bridge.nonce, () => {
            setGoogleLoading(true);
            googleWebLogin();
        });
        // google 模式下主窗口不传 token；弹窗取消时恢复按钮可用
        return () => { cleanup(); setGoogleLoading(false); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const socialError = sessionStorage.getItem(SOCIAL_LOGIN_ERROR_KEY);
        if (socialError) {
            setError(socialError);
            sessionStorage.removeItem(SOCIAL_LOGIN_ERROR_KEY);
        }
    }, []);

    useEffect(() => {
        if (countdown <= 0) return;
        const timer = setTimeout(() => setCountdown((value) => value - 1), 1000);
        return () => clearTimeout(timer);
    }, [countdown]);

    const resetMessages = () => { setError(''); setNotice(''); };

    const switchMode = (next: Mode) => {
        resetMessages();
        setCode('');
        setMode(next);
    };

    const handleSubmit = async () => {
        resetMessages();
        if (mode === 'forgot' && newPassword.length < 6) {
            setError('新密码至少需要 6 位');
            return;
        }
        setLoading(true);
        try {
            if (mode === 'login') {
                const res = await fetch(buildApiUrl('/auth/login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
                const data = await res.json();
                if (!res.ok) return setError(data.error || '登录失败');
                login(data.token, data.user);
                return;
            }
            if (mode === 'register') {
                const res = await fetch(buildApiUrl('/auth/register'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, name, code }) });
                const data = await res.json();
                if (!res.ok) return setError(data.error || '注册失败');
                login(data.token, data.user);
                return;
            }
            const res = await fetch(buildApiUrl('/auth/reset-password'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code, newPassword }) });
            const data = await res.json();
            if (!res.ok) return setError(data.error || '密码重置失败');
            setNotice('密码已重置，请使用新密码登录');
            switchMode('login');
        } catch {
            setError('网络异常，请稍后重试');
        } finally {
            setLoading(false);
        }
    };

    const handleSendCode = async () => {
        resetMessages();
        if (!email.trim() || !email.includes('@')) {
            setError('请先输入有效的邮箱地址');
            return;
        }
        setCodeSending(true);
        try {
            const purpose = mode === 'forgot' ? 'reset_password' : 'register';
            const res = await fetch(buildApiUrl('/auth/send-code'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), purpose }) });
            const data = await res.json();
            if (!res.ok) return setError(data.error || '验证码发送失败');
            if (data.devCode) {
                setCode(data.devCode);
                setNotice(`开发模式验证码：${data.devCode}`);
            } else {
                setNotice('验证码已发送，请查收邮箱');
            }
            setCountdown(60);
        } catch {
            setError('网络异常，请稍后重试');
        } finally {
            setCodeSending(false);
        }
    };

    // 网页端：Google OAuth 隐式流程拿 access_token，后端调 userinfo 完成登录
    const sendTokenToBackend = async (accessToken: string) => {
        try {
            const res = await fetch(buildApiUrl('/auth/google'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken }) });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || 'Google 登录失败');
                return;
            }
            login(data.token, data.user);
        } catch {
            setError('网络异常，请稍后重试');
        }
    };

    const sendCredentialToBackend = async (credential: string) => {
        try {
            const res = await fetch(buildApiUrl('/auth/google'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error || 'Google 登录失败');
                return;
            }
            login(data.token, data.user);
        } catch {
            setError('网络异常，请稍后重试');
        }
    };

    const handleDesktopGoogleLogin = async () => {
        setGoogleLoading(true);
        resetMessages();
        try {
            // 桥接子窗口里完成 Google OAuth，令牌经 postMessage 传回
            const result = await beginDesktopGoogleLogin();
            if (result) login(result.token, result.user);
            // result 为 null 表示用户直接关闭了子窗口，静默取消
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Google 登录失败');
        } finally {
            setGoogleLoading(false);
        }
    };

    const handleNativeGoogleLogin = async () => {
        setGoogleLoading(true);
        resetMessages();
        try {
            const idToken = await signInWithGoogleNative();
            await sendCredentialToBackend(idToken);
        } catch (err) {
            if (!(err instanceof NativeGoogleSignInCanceledError)) {
                setError(err instanceof Error ? err.message : 'Google 登录失败');
            }
        } finally {
            setGoogleLoading(false);
        }
    };

    const handlePasskeyLogin = async () => {
        setPasskeyLoading(true);
        resetMessages();
        try {
            const session = await loginWithPasskey();
            login(session.token, session.user);
        } catch (err) {
            if (!isPasskeyUserCancellation(err)) {
                setError(err instanceof Error ? err.message : '通行密钥登录失败');
            }
        } finally {
            setPasskeyLoading(false);
        }
    };

    const handleAppleLogin = async () => {
        setAppleLoading(true);
        resetMessages();
        try {
            const { idToken, name } = await signInWithApple();
            const res = await fetch(buildApiUrl('/auth/apple'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identityToken: idToken, name }) });
            const data = await res.json();
            if (!res.ok) return setError(data.error || 'Apple 登录失败');
            login(data.token, data.user);
        } catch (err) {
            if (!(err instanceof AppleSignInCanceledError)) {
                setError(err instanceof Error ? err.message : 'Apple 登录失败');
            }
        } finally {
            setAppleLoading(false);
        }
    };

    const title = mode === 'login' ? '欢迎回来' : mode === 'register' ? '创建你的账户' : '找回密码';
    const submitLabel = mode === 'login' ? '登录' : mode === 'register' ? '注册' : '重置密码';

    // 通行密钥桥接子窗口：桌面端添加通行密钥时，这里只显示过渡提示，
    // 真正的系统安全密钥弹窗由本页在真实站点 origin 下触发。
    if (bridge && bridge.mode === 'passkey') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-surface px-6">
                <div className="text-center space-y-4 max-w-sm">
                    <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                        <Fingerprint className="text-primary" size={32} />
                    </div>
                    <h1 className="text-xl font-bold">正在添加通行密钥</h1>
                    <p className="text-sm text-on-surface-variant">
                        {passkeyBridgeState === 'done'
                            ? '操作已完成，本窗口即将自动关闭。'
                            : '请按照系统弹窗提示完成验证；取消后本窗口会自动关闭。'}
                    </p>
                </div>
            </div>
        );
    }

    // Google 绑定桥接子窗口：桌面端在设置页绑定 Google 时，这里展示 GIS 按钮，
    // 选号成功后用主窗口传来的会话 token 调绑定接口，结果回传后自动关闭。
    if (bridge && bridge.mode === 'google-bind') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-surface px-6">
                <div className="text-center space-y-5 max-w-sm">
                    <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                        <GoogleIcon />
                    </div>
                    <h1 className="text-xl font-bold">绑定 Google 账号</h1>
                    <p className="text-sm text-on-surface-variant">选择要绑定的 Google 账号，完成后本窗口会自动关闭。</p>
                    <div className="flex justify-center">
                        <GoogleLogin
                            onSuccess={async ({ credential }) => {
                                if (!credential) return;
                                try {
                                    await api.bindSocialGoogle(credential, googleBindToken);
                                    bridgeReturnResult(bridge.nonce, { ok: true });
                                } catch (err) {
                                    bridgeReturnResult(bridge.nonce, {
                                        ok: false,
                                        error: err instanceof Error ? err.message : 'bind failed'
                                    });
                                }
                            }}
                            onError={() => setError('Google 登录失败')}
                        />
                    </div>
                    {error && <p className="text-xs text-red-500">{error}</p>}
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-surface px-6 py-10">
            <div className="w-full max-w-sm space-y-6">
                <div className="text-center">
                    <h1 className="text-3xl font-black tracking-tight">DingYue 订阅管理助手</h1>
                    <p className="text-on-surface-variant mt-1 text-sm">{title}</p>
                </div>

                <div className="space-y-3">
                    {mode === 'register' && (
                        <input className="w-full px-4 py-3 rounded-xl bg-surface-container-low outline-none text-sm"
                               placeholder="姓名" value={name} onChange={e => setName(e.target.value)} />
                    )}
                    <input className="w-full px-4 py-3 rounded-xl bg-surface-container-low outline-none text-sm"
                           placeholder="邮箱" type="email" autoComplete="email" value={email}
                           onChange={e => setEmail(e.target.value)} />
                    {mode !== 'forgot' && (
                        <div className="relative">
                            <input className="w-full px-4 py-3 pr-12 rounded-xl bg-surface-container-low outline-none text-sm"
                                   placeholder="密码" type={showPassword ? 'text' : 'password'}
                                   autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                                   value={password} onChange={e => setPassword(e.target.value)} />
                            <PasswordVisibilityButton visible={showPassword} onToggle={() => setShowPassword(v => !v)} />
                        </div>
                    )}
                    {mode === 'forgot' && (
                        <div className="relative">
                            <input className="w-full px-4 py-3 pr-12 rounded-xl bg-surface-container-low outline-none text-sm"
                                   placeholder="新密码（至少 6 位）" type={showPassword ? 'text' : 'password'} autoComplete="new-password"
                                   value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                            <PasswordVisibilityButton visible={showPassword} onToggle={() => setShowPassword(v => !v)} />
                        </div>
                    )}

                    {mode !== 'login' && (
                        <div className="flex gap-2">
                            <input className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-surface-container-low outline-none text-sm"
                                   placeholder="邮箱验证码" inputMode="numeric" maxLength={6} value={code}
                                   onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
                            <button onClick={() => void handleSendCode()} disabled={codeSending || countdown > 0}
                                    className="shrink-0 px-3 py-3 rounded-xl border border-outline-variant/30 text-xs font-bold text-primary active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100">
                                {codeSending ? '发送中' : countdown > 0 ? `${countdown}s 后重发` : '发送验证码'}
                            </button>
                        </div>
                    )}

                    {notice && <p className="text-primary text-xs text-center">{notice}</p>}
                    {error && <p className="text-red-500 text-xs text-center">{error}</p>}

                    <button onClick={() => void handleSubmit()} disabled={loading}
                            className="w-full py-3 rounded-xl bg-primary text-white font-bold text-sm active:scale-95 transition-all disabled:opacity-50">
                        {loading ? '处理中...' : submitLabel}
                    </button>

                    {mode === 'login' && (
                        <button onClick={() => void handlePasskeyLogin()} disabled={passkeyLoading}
                                className="w-full py-3 rounded-xl border border-outline-variant/30 bg-surface-container-low text-on-surface font-bold text-sm active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                            <Fingerprint size={18} />
                            {passkeyLoading ? '处理中...' : '通行密钥登录'}
                        </button>
                    )}

                    {mode === 'login' && (
                        <p className="text-center">
                            <button onClick={() => switchMode('forgot')} className="text-xs text-on-surface-variant">
                                忘记密码？
                            </button>
                        </p>
                    )}
                </div>

                {mode !== 'forgot' && (
                    <>
                        <div className="flex items-center gap-3">
                            <div className="flex-1 h-px bg-outline-variant/30" />
                            <span className="text-xs text-on-surface-variant">或使用以下方式登录</span>
                            <div className="flex-1 h-px bg-outline-variant/30" />
                        </div>

                        <div className="flex flex-wrap items-center justify-center gap-3">
                            {wechatEntryAvailable && (
                                <SocialButton label="微信登录" onClick={() => (czlAvailable ? beginCzlLogin() : beginWechatLogin())}>
                                    <svg width="22" height="22" viewBox="0 0 24 24"><path fill="#07C160" d="M9.5 4C5.36 4 2 6.69 2 10c0 1.89 1.08 3.56 2.78 4.66l-.7 2.1 2.44-1.23c.87.26 1.82.4 2.78.4.09 0 .18 0 .27-.01A6.4 6.4 0 0 1 9.5 15c0-3.31 3.13-6 7-6 .27 0 .54.01.8.04C16.71 6.15 13.4 4 9.5 4zM7 8.25a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zm5 0a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z"/><path fill="#07C160" d="M22 14.5c0-2.76-2.69-5-6-5s-6 2.24-6 5 2.69 5 6 5c.83 0 1.62-.13 2.35-.36l2.1 1.06-.6-1.8C21.16 17.63 22 16.14 22 14.5zm-8-.5a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zm4 0a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z"/></svg>
                                </SocialButton>
                            )}
                            {appleAvailable && (
                                <SocialButton label="通过 Apple 登录" onClick={() => void handleAppleLogin()} disabled={appleLoading}>
                                    {appleLoading ? <span className="text-xs font-bold">···</span> : (
                                        <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#000000" d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
                                    )}
                                </SocialButton>
                            )}
                            <SocialButton
                                label="通过 Google 登录"
                                onClick={() => {
                                    if (native) void handleNativeGoogleLogin();
                                    else if (isDesktop) void handleDesktopGoogleLogin();
                                    else googleWebLogin();
                                }}
                                disabled={googleLoading}
                            >
                                {googleLoading ? <span className="text-xs font-bold">···</span> : <GoogleIcon />}
                            </SocialButton>
                            {githubAvailable && (
                                <SocialButton label="GitHub 登录" onClick={() => beginGithubLogin()}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#181717"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>
                                </SocialButton>
                            )}
                            {giteeAvailable && (
                                <SocialButton label="Gitee 登录" onClick={() => beginGiteeLogin()}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#C71D23"><path d="M11.984 18.364c-.939 0-1.496-.476-1.496-1.484V8.8c0-.658.35-1.026.944-1.026.594 0 .94.368.94 1.026v8.08c0 .658-.346 1.024-.94 1.024-.593 0-.943-.366-.943-1.024v-.375h1.89v.375c0 1.008.557 1.484 1.496 1.484.94 0 1.496-.476 1.496-1.484V8.8c0-.658.35-1.026.944-1.026.594 0 .94.368.94 1.026v8.08c0 1.008-.557 1.484-1.496 1.484-.94 0-1.496-.476-1.496-1.484v-.375H11.984z"/></svg>
                                </SocialButton>
                            )}
                        </div>
                    </>
                )}

                <p className="text-center text-xs text-on-surface-variant">
                    {mode === 'forgot'
                        ? '想起密码了？'
                        : mode === 'login'
                            ? '还没有账户？'
                            : '已有账户？'}
                    <button onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
                            className="text-primary font-bold ml-1">
                        {mode === 'forgot' ? '返回登录' : mode === 'login' ? '注册' : '登录'}
                    </button>
                </p>
                <p className="text-center text-[10px] text-on-surface-variant font-medium opacity-40">
                    DingYue v{appVersion}
                </p>
            </div>
        </div>
    );
}

function SocialButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
    return (
        <button onClick={onClick} disabled={disabled} aria-label={label}
                className="w-12 h-12 flex items-center justify-center rounded-full border border-outline-variant/30 bg-white active:scale-95 transition-all disabled:opacity-50">
            {children}
        </button>
    );
}

function PasswordVisibilityButton({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
    return (
        <button type="button" onClick={onToggle}
                aria-label={visible ? '隐藏密码' : '显示密码'}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full text-on-surface-variant active:scale-90 transition-all">
            {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
    );
}

function GoogleIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
    );
}
