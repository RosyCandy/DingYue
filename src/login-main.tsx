// 独立登录/注册页入口（/login.html 与 /register.html 共用）。
// 官网常驻根路径后，登录/注册从官网跳转过来，不再挤占首页；
// 登录成功后整页跳回 / 由 App 接管。原生端与桌面壳不经过这里
// （它们在 App 内直接渲染 LoginPage）。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { I18nProvider } from './lib/i18n';
import { ThemeProvider } from './lib/theme';
import { AuthProvider, useAuth } from './lib/auth';
import { CapacitorPasskey } from '@capgo/capacitor-passkey';
import LoginPage from './components/LoginPage';
import { useEffect } from 'react';
import './index.css';

void CapacitorPasskey.autoShimWebAuthn().catch(() => {
  // Web builds and older native shells can continue using the browser API.
});

function StandaloneAuthGate() {
  const { user } = useAuth();
  const isRegisterPage = window.location.pathname.endsWith('/register.html');
  // 已登录用户访问 /login.html、/register.html 直接回应用首页
  useEffect(() => {
    if (user) window.location.replace('/');
  }, [user]);
  return <LoginPage initialMode={isRegisterPage ? 'register' : 'login'} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
      <AuthProvider>
        <ThemeProvider>
          <I18nProvider>
            <StandaloneAuthGate />
          </I18nProvider>
        </ThemeProvider>
      </AuthProvider>
    </GoogleOAuthProvider>
  </StrictMode>,
);

requestAnimationFrame(() => {
  document.getElementById('boot-splash')?.remove();
});
