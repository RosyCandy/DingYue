import React, { useEffect, useState } from 'react';
import { ChevronLeft, Loader2, CheckCircle2, Link2, Unlink } from 'lucide-react';
import { GoogleLogin } from '@react-oauth/google';
import { useI18n } from '../lib/i18n';
import {
  isCzlWechatLoginAvailable,
  beginCzlLogin,
  beginGithubLogin,
  beginGiteeLogin,
  SOCIAL_BIND_RESULT_KEY,
} from '../lib/socialAuth';
import { isNativePlatform, signInWithGoogleNative, NativeGoogleSignInCanceledError } from '../lib/nativeGoogleAuth';
import { api, SocialBinding, SocialBindingProvider } from '../lib/api';

// 第三方登录页 = 绑定管理页：展示每个渠道的绑定状态与账号名，
// 支持绑定 / 解绑。解绑后立即不能用该方式登录；绑定时如果该第三方
// 账号已被其他 DingYue 账号占用，后端会返回冲突提示。
export default function SocialLoginPage({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const [bindings, setBindings] = useState<SocialBinding[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const czlAvailable = isCzlWechatLoginAvailable();
  const native = isNativePlatform();

  const load = async () => {
    try {
      const list = await api.getSocialBindings();
      setBindings(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('social.loadFailed'));
      setBindings([]);
    }
  };

  useEffect(() => {
    // OAuth 跳转的绑定流程在 App.tsx 回调里完成，结果通过 sessionStorage 带回本页展示
    const raw = sessionStorage.getItem(SOCIAL_BIND_RESULT_KEY);
    if (raw) {
      sessionStorage.removeItem(SOCIAL_BIND_RESULT_KEY);
      try {
        const result = JSON.parse(raw);
        if (result?.ok) setNotice(t('social.bindSuccess'));
        else setError(result?.message || t('social.bindFailed'));
      } catch {
        // 忽略损坏的结果数据
      }
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startBind = (provider: 'wechat' | 'github' | 'gitee') => {
    setError('');
    setNotice('');
    if (provider === 'wechat') beginCzlLogin(true);
    else if (provider === 'github') beginGithubLogin(true);
    else beginGiteeLogin(true);
  };

  const bindGoogle = async (credential: string) => {
    setError('');
    setNotice('');
    setBusy('google');
    try {
      await api.bindSocialGoogle(credential);
      setNotice(t('social.bindSuccess'));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('social.bindFailed'));
    } finally {
      setBusy(null);
    }
  };

  const handleNativeGoogleBind = async () => {
    setError('');
    setNotice('');
    setBusy('google');
    try {
      const idToken = await signInWithGoogleNative();
      await bindGoogle(idToken);
    } catch (err) {
      if (!(err instanceof NativeGoogleSignInCanceledError)) {
        setError(err instanceof Error ? err.message : t('social.bindFailed'));
      }
    } finally {
      setBusy(null);
    }
  };

  const handleUnbind = async (provider: SocialBindingProvider) => {
    if (!window.confirm(t('social.confirmUnbind'))) return;
    setError('');
    setNotice('');
    setBusy(provider);
    try {
      await api.unbindSocial(provider);
      setNotice(t('social.unbindSuccess'));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('social.bindFailed'));
    } finally {
      setBusy(null);
    }
  };

  const bindingOf = (provider: SocialBindingProvider): SocialBinding | undefined =>
    bindings?.find((item) => item.provider === provider);

  const statusText = (binding: SocialBinding | undefined): string => {
    if (!bindings) return '';
    if (binding?.bound) {
      return t('social.boundAs').replace('{name}', binding.displayName || t('social.bound'));
    }
    return t('social.notBound');
  };

  return (
    <div className="px-6 max-w-2xl mx-auto pb-10">
      <div className="flex items-center gap-1 py-4 -mx-2">
        <button onClick={onBack} aria-label={t('settings.back')}
                className="p-2 rounded-full hover:bg-surface-container-low active:scale-90 transition-all">
          <ChevronLeft size={22} className="text-on-surface" />
        </button>
        <h2 className="text-lg font-bold text-on-surface">{t('social.title')}</h2>
      </div>

      <p className="text-xs text-on-surface-variant px-1 pb-3">{t('social.bindHint')}</p>
      {notice && (
        <p className="flex items-center gap-1 text-primary text-xs px-1 pb-2">
          <CheckCircle2 size={14} /> {notice}
        </p>
      )}
      {error && <p className="text-red-500 text-xs px-1 pb-2">{error}</p>}

      {bindings === null ? (
        <div className="py-10 flex justify-center text-on-surface-variant">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {czlAvailable && (
            <BindingRow
              label="微信"
              icon={<WechatIcon />}
              binding={bindingOf('wechat')}
              statusText={statusText(bindingOf('wechat'))}
              busy={busy === 'wechat'}
              onBind={() => startBind('wechat')}
              onUnbind={() => void handleUnbind('wechat')}
            />
          )}
          <BindingRow
            label="Google"
            icon={<GoogleIcon />}
            binding={bindingOf('google')}
            statusText={statusText(bindingOf('google'))}
            busy={busy === 'google'}
            onBind={() => (native ? void handleNativeGoogleBind() : undefined)}
            onUnbind={() => void handleUnbind('google')}
            webBindSlot={
              native ? undefined : (
                <GoogleLogin
                  type="icon"
                  shape="circle"
                  size="medium"
                  logo_alignment="center"
                  onSuccess={async ({ credential }) => {
                    if (credential) await bindGoogle(credential);
                  }}
                  onError={() => setError(t('social.bindFailed'))}
                />
              )
            }
          />
          <BindingRow
            label="GitHub"
            icon={<GithubIcon />}
            binding={bindingOf('github')}
            statusText={statusText(bindingOf('github'))}
            busy={busy === 'github'}
            onBind={() => startBind('github')}
            onUnbind={() => void handleUnbind('github')}
          />
          <BindingRow
            label="Gitee"
            icon={<GiteeIcon />}
            binding={bindingOf('gitee')}
            statusText={statusText(bindingOf('gitee'))}
            busy={busy === 'gitee'}
            onBind={() => startBind('gitee')}
            onUnbind={() => void handleUnbind('gitee')}
          />
        </div>
      )}
    </div>
  );
}

function BindingRow({
  label, icon, binding, statusText, busy, onBind, onUnbind, webBindSlot,
}: {
  label: string;
  icon: React.ReactNode;
  binding?: SocialBinding;
  statusText: string;
  busy: boolean;
  onBind: () => void;
  onUnbind: () => void;
  webBindSlot?: React.ReactNode;
}) {
  const { t } = useI18n();
  const bound = Boolean(binding?.bound);
  return (
    <div className="w-full flex items-center gap-4 p-4 rounded-2xl border border-outline-variant/10 bg-surface-container-low">
      <div className="w-10 h-10 rounded-full bg-white border border-outline-variant/20 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-on-surface">{label}</p>
        <p className="text-xs text-on-surface-variant mt-0.5 truncate flex items-center gap-1">
          {bound && <Link2 size={12} className="shrink-0" />}
          {statusText}
        </p>
      </div>
      {busy ? (
        <Loader2 size={16} className="animate-spin text-on-surface-variant shrink-0" />
      ) : bound ? (
        <button
          onClick={onUnbind}
          className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full border border-red-200 text-red-600 text-xs font-bold active:scale-95 transition-all"
        >
          <Unlink size={12} />
          {t('social.unbind')}
        </button>
      ) : webBindSlot ? (
        webBindSlot
      ) : (
        <button
          onClick={onBind}
          className="shrink-0 px-4 py-1.5 rounded-full bg-primary text-white text-xs font-bold active:scale-95 transition-all"
        >
          {t('social.bind')}
        </button>
      )}
    </div>
  );
}

function WechatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#07C160" d="M9.5 4C5.36 4 2 6.69 2 10c0 1.89 1.08 3.56 2.78 4.66l-.7 2.1 2.44-1.23c.87.26 1.82.4 2.78.4.09 0 .18 0 .27-.01A6.4 6.4 0 0 1 9.5 15c0-3.31 3.13-6 7-6 .27 0 .54.01.8.04C16.71 6.15 13.4 4 9.5 4zM7 8.25a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zm5 0a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z"/><path fill="#07C160" d="M22 14.5c0-2.76-2.69-5-6-5s-6 2.24-6 5 2.69 5 6 5c.83 0 1.62-.13 2.35-.36l2.1 1.06-.6-1.8C21.16 17.63 22 16.14 22 14.5zm-8-.5a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zm4 0a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z"/></svg>
  );
}

function GithubIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#181717"><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"/></svg>
  );
}

function GiteeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#C71D23"><path d="M11.984 18.364c-.939 0-1.496-.476-1.496-1.484V8.8c0-.658.35-1.026.944-1.026.594 0 .94.368.94 1.026v8.08c0 .658-.346 1.024-.94 1.024-.593 0-.943-.366-.943-1.024v-.375h1.89v.375c0 1.008.557 1.484 1.496 1.484.94 0 1.496-.476 1.496-1.484V8.8c0-.658.35-1.026.944-1.026.594 0 .94.368.94 1.026v8.08c0 1.008-.557 1.484-1.496 1.484-.94 0-1.496-.476-1.496-1.484v-.375H11.984z"/></svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
  );
}
