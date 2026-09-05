import React, { useState } from 'react';
import { useAuth } from '../lib/auth';
import { buildApiUrl } from '../lib/api';
import { GoogleLogin } from '@react-oauth/google';  // npm install @react-oauth/google
import { isNativePlatform, signInWithGoogleNative, NativeGoogleSignInCanceledError } from '../lib/nativeGoogleAuth';

type Mode = 'login' | 'register';

export default function LoginPage() {
    const { login } = useAuth();
    const [mode, setMode] = useState<Mode>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [googleLoading, setGoogleLoading] = useState(false);
    const native = isNativePlatform();

    const handleSubmit = async () => {
        setLoading(true); setError('');
        try {
            const endpoint = buildApiUrl(mode === 'login' ? '/auth/login' : '/auth/register');
            const body = mode === 'login' ? { email, password } : { email, password, name };
            const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const data = await res.json();
            if (!res.ok) return setError(data.error || '操作失败');
            if (mode === 'register') { setMode('login'); return; }
            login(data.token, data.user);
        } finally { setLoading(false); }
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
        setError('');
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

    return (
        <div className="min-h-screen flex items-center justify-center bg-surface px-6">
            <div className="w-full max-w-sm space-y-6">
                <div className="text-center">
                    <h1 className="text-3xl font-black tracking-tight">DuoDuo</h1>
                    <p className="text-on-surface-variant mt-1 text-sm">
                        {mode === 'login' ? '欢迎回来' : '创建你的账户'}
                    </p>
                </div>

                <div className="space-y-3">
                    {mode === 'register' && (
                        <input className="w-full px-4 py-3 rounded-xl bg-surface-container-low outline-none text-sm"
                               placeholder="姓名" value={name} onChange={e => setName(e.target.value)} />
                    )}
                    <input className="w-full px-4 py-3 rounded-xl bg-surface-container-low outline-none text-sm"
                           placeholder="邮箱" type="email" value={email} onChange={e => setEmail(e.target.value)} />
                    <input className="w-full px-4 py-3 rounded-xl bg-surface-container-low outline-none text-sm"
                           placeholder="密码" type="password" value={password} onChange={e => setPassword(e.target.value)} />

                    {error && <p className="text-red-500 text-xs text-center">{error}</p>}

                    <button onClick={handleSubmit} disabled={loading}
                            className="w-full py-3 rounded-xl bg-primary text-white font-bold text-sm active:scale-95 transition-all disabled:opacity-50">
                        {loading ? '处理中...' : (mode === 'login' ? '登录' : '注册')}
                    </button>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-outline-variant/30" />
                    <span className="text-xs text-on-surface-variant">或</span>
                    <div className="flex-1 h-px bg-outline-variant/30" />
                </div>

                <div className="flex justify-center">
                    {native ? (
                        <button
                            onClick={() => void handleNativeGoogleLogin()}
                            disabled={googleLoading}
                            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-outline-variant/30 bg-white text-sm font-bold text-gray-700 active:scale-95 transition-all disabled:opacity-50"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
                            {googleLoading ? '处理中...' : '使用 Google 账号登录'}
                        </button>
                    ) : (
                        <GoogleLogin
                            onSuccess={async ({ credential }) => {
                                if (credential) await sendCredentialToBackend(credential);
                            }}
                            onError={() => setError('Google 登录失败')}
                        />
                    )}
                </div>

                <p className="text-center text-xs text-on-surface-variant">
                    {mode === 'login' ? '还没有账户？' : '已有账户？'}
                    <button onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
                            className="text-primary font-bold ml-1">
                        {mode === 'login' ? '注册' : '登录'}
                    </button>
                </p>
            </div>
        </div>
    );
}