import React, { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useAuth } from '../lib/auth';
import {
  isWechatLoginAvailable,
  beginWechatLogin,
  isCzlWechatLoginAvailable,
  beginCzlLogin,
  isGithubLoginAvailable,
  beginGithubLogin,
  isGiteeLoginAvailable,
  beginGiteeLogin,
} from '../lib/socialAuth';

export default function SocialLoginPage({ onBack }: { onBack: () => void }) {
  const { login } = useAuth();
  const { t } = useI18n();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState<string | null>(null);

  const handleProvider = async (provider: string, start: () => void) => {
    setError('');
    setLoading(provider);
    try {
      start();
    } catch {
      setError(t('social.loginFailed'));
    } finally {
      setLoading(null);
    }
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

      <div className="space-y-3">
        {error && <p className="text-xs text-red-500">{error}</p>}

        {(isWechatLoginAvailable() || isCzlWechatLoginAvailable()) && (
          <SocialLoginRow
            label="微信"
            icon={<WechatIcon />}
            loading={loading === 'wechat'}
            onClick={() => handleProvider('wechat', isCzlWechatLoginAvailable() ? beginCzlLogin : beginWechatLogin)}
          />
        )}

        {isGithubLoginAvailable() && (
          <SocialLoginRow
            label="GitHub"
            icon={<GithubIcon />}
            loading={loading === 'github'}
            onClick={() => handleProvider('github', beginGithubLogin)}
          />
        )}

        {isGiteeLoginAvailable() && (
          <SocialLoginRow
            label="Gitee"
            icon={<GiteeIcon />}
            loading={loading === 'gitee'}
            onClick={() => handleProvider('gitee', beginGiteeLogin)}
          />
        )}
      </div>
    </div>
  );
}

function SocialLoginRow({ label, icon, loading, onClick }: { label: string; icon: React.ReactNode; loading: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full flex items-center gap-4 p-4 rounded-2xl border border-outline-variant/10 bg-surface-container-low active:scale-[0.98] transition-all disabled:opacity-50"
    >
      <div className="w-10 h-10 rounded-full bg-white border border-outline-variant/20 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <span className="flex-1 text-sm font-semibold text-on-surface text-left">{label}</span>
      {loading && <span className="text-xs text-on-surface-variant">处理中...</span>}
    </button>
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
