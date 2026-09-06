import React, { useEffect, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { buildApiUrl } from '../lib/api';
import { GoogleLogin } from '@react-oauth/google';  // npm install @react-oauth/google
import { isNativePlatform, signInWithGoogleNative, NativeGoogleSignInCanceledError } from '../lib/nativeGoogleAuth';
import {
    isAppleLoginAvailable,
    isWechatLoginAvailable,
    isQqLoginAvailable,
    signInWithApple,
    AppleSignInCanceledError,
    beginWechatLogin,
    beginQqLogin,
    SOCIAL_LOGIN_ERROR_KEY
} from '../lib/socialAuth';
import { loginWithPasskey, isPasskeyUserCancellation } from '../lib/passkey';

type Mode = 'login' | 'register' | 'forgot';

export default function LoginPage() {
    const { login } = useAuth();
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
    const native = isNativePlatform();

    const wechatAvailable = isWechatLoginAvailable();
    const qqAvailable = isQqLoginAvailable();
    const appleAvailable = isAppleLoginAvailable();

    useEffect(() => {
        // 微信 / QQ OAuth 会跳转离开本页，错误信息通过 sessionStorage 带回来
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
                // 注册即登录：邮箱已通过验证码验证
                login(data.token, data.user);
                return;
            }
            // mode === 'forgot'
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
                // 开发模式（服务端未配置 SMTP）：验证码直接回传并自动填入
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

    const sendCredentialToBackend = async (credential: string) => {
        const res = await fetch(buildApiUrl('/auth/google'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential }) });
        const data = await res.json();
        if (!res.ok) {
            setError(data.error || 'Google 登录失败');
            return;
        }
        login(data.token, data.user);
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

    return (
        <div className="min-h-screen flex items-center justify-center bg-surface px-6 py-10">
            <div className="w-full max-w-sm space-y-6">
                <div className="text-center">
                    <h1 className="text-3xl font-black tracking-tight">DuoDuo</h1>
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
                        <input className="w-full px-4 py-3 rounded-xl bg-surface-container-low outline-none text-sm"
                               placeholder="密码" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                               value={password} onChange={e => setPassword(e.target.value)} />
                    )}
                    {mode === 'forgot' && (
                        <input className="w-full px-4 py-3 rounded-xl bg-surface-container-low outline-none text-sm"
                               placeholder="新密码（至少 6 位）" type="password" autoComplete="new-password"
                               value={newPassword} onChange={e => setNewPassword(e.target.value)} />
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

                        <div className="flex items-center justify-center gap-4">
                            {wechatAvailable && (
                                <SocialButton label="微信登录" onClick={() => beginWechatLogin()}>
                                    <svg width="22" height="22" viewBox="0 0 24 24">
                                        <path fill="#07C160" d="M9.5 4C5.36 4 2 6.69 2 10c0 1.89 1.08 3.56 2.78 4.66l-.7 2.1 2.44-1.23c.87.26 1.82.4 2.78.4.09 0 .18 0 .27-.01A6.4 6.4 0 0 1 9.5 15c0-3.31 3.13-6 7-6 .27 0 .54.01.8.04C16.71 6.15 13.4 4 9.5 4zM7 8.25a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zm5 0a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z"/>
                                        <path fill="#07C160" d="M22 14.5c0-2.76-2.69-5-6-5s-6 2.24-6 5 2.69 5 6 5c.83 0 1.62-.13 2.35-.36l2.1 1.06-.6-1.8C21.16 17.63 22 16.14 22 14.5zm-8-.5a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zm4 0a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z"/>
                                    </svg>
                                </SocialButton>
                            )}
                            {qqAvailable && (
                                <SocialButton label="QQ 登录" onClick={() => beginQqLogin()}>
                                    <svg width="22" height="22" viewBox="0 0 24 24">
                                        <ellipse cx="12" cy="10" rx="6.3" ry="8.3" fill="#12B7F5"/>
                                        <ellipse cx="9.7" cy="9.4" rx="2" ry="2.7" fill="#fff"/>
                                        <ellipse cx="14.3" cy="9.4" rx="2" ry="2.7" fill="#fff"/>
                                        <circle cx="10.1" cy="9.8" r="0.9" fill="#333"/>
                                        <circle cx="13.9" cy="9.8" r="0.9" fill="#333"/>
                                        <path d="M9.7 12.9c1.5 1.1 3.1 1.1 4.6 0l-.6 2.6h-3.4z" fill="#F5A623"/>
                                        <ellipse cx="8.6" cy="20.6" rx="2.2" ry="1.1" fill="#12B7F5"/>
                                        <ellipse cx="15.4" cy="20.6" rx="2.2" ry="1.1" fill="#12B7F5"/>
                                    </svg>
                                </SocialButton>
                            )}
                            {appleAvailable && (
                                <SocialButton label="通过 Apple 登录" onClick={() => void handleAppleLogin()} disabled={appleLoading}>
                                    {appleLoading ? (
                                        <span className="text-xs font-bold">···</span>
                                    ) : (
                                        <svg width="20" height="20" viewBox="0 0 24 24">
                                            <path fill="#000000" d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                                        </svg>
                                    )}
                                </SocialButton>
                            )}
                            {native ? (
                                <SocialButton label="通过 Google 登录" onClick={() => void handleNativeGoogleLogin()} disabled={googleLoading}>
                                    {googleLoading ? <span className="text-xs font-bold">···</span> : <GoogleIcon />}
                                </SocialButton>
                            ) : (
                                <GoogleLogin
                                    shape="square"
                                    size="large"
                                    width={48}
                                    logo_alignment="center"
                                    onSuccess={async ({ credential }) => {
                                        if (credential) await sendCredentialToBackend(credential);
                                    }}
                                    onError={() => setError('Google 登录失败')}
                                />
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
            </div>
        </div>
    );
}

function SocialButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
    return (
        <button onClick={onClick} disabled={disabled} aria-label={label}
                className="w-12 h-12 flex items-center justify-center rounded-xl border border-outline-variant/30 bg-white active:scale-95 transition-all disabled:opacity-50">
            {children}
        </button>
    );
}

function GoogleIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
    );
}
