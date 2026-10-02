import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  User, Bell, HelpCircle, LogOut, ChevronRight, ChevronDown, RefreshCw, Palette, Languages,
  X, Check, Loader2, Info, Mail, ArrowLeft, Fingerprint, Trash2, Pencil, ShieldCheck, FileText,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Language, useI18n } from '../lib/i18n';
import { useTheme, type Theme } from '../lib/theme';
import NotificationCenter from './NotificationCenter';
import SocialLoginPage from './SocialLoginPage';
import { useBackHandler } from '../lib/backButton';
import { useAuth } from '../lib/auth';
import { api, resolveAssetUrl, HelpArticle, LocalizedText, PasskeyItem, SecurityOverview, UserSettings } from '../lib/api';
import { Subscription } from '../constants';
import { SOCIAL_BIND_NAV_KEY } from '../lib/socialAuth';
import { registerPasskey, beginDesktopPasskeyBridge, PASSKEY_BRIDGE_NAV_KEY, isPasskeyUserCancellation, isPasskeyAlreadyRegistered } from '../lib/passkey';
import LegalDocument, { type LegalDocumentKind } from './LegalDocument';
import { version as appVersion } from '../../package.json';

const languageOptions: Array<{ value: Language; label: string }> = [
  { value: 'English', label: 'English' },
  { value: '简体中文', label: '简体中文' },
  { value: '繁體中文', label: '繁體中文' },
  { value: 'Latin', label: 'Latin' },
  { value: '한국어', label: '한국어' },
];

const CONTACT_EMAIL = 'support@ngaasiu.studio';

// 站内导航：个人中心及其子页面在设置页内部切换（类似微信），不弹窗
type SettingsView = 'main' | 'profile' | 'nickname' | 'email' | 'password' | 'passkey' | 'danger' | 'social' | 'help' | 'about' | 'recycle';

const VIEW_PARENT: Record<Exclude<SettingsView, 'main'>, SettingsView> = {
  profile: 'main',
  nickname: 'profile',
  email: 'profile',
  password: 'profile',
  passkey: 'profile',
  danger: 'profile',
  social: 'profile',
  help: 'main',
  about: 'main',
  recycle: 'main',
};

export default function Settings() {
  const [view, setView] = useState<SettingsView>('main');
  const [showNotifications, setShowNotifications] = useState(false);
  // 关于页里的用户协议/隐私政策：应用内整页查看（与登录页共用 LegalDocument）
  const [legalKind, setLegalKind] = useState<LegalDocumentKind | null>(null);
  // V1.4.0：回收站（软删除订阅，30 天后自动永久清除）
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [deletedSubs, setDeletedSubs] = useState<Subscription[]>([]);
  const [selectedDeleted, setSelectedDeleted] = useState<string[]>([]);
  const [recycleLoading, setRecycleLoading] = useState(false);
  const [recycleBusy, setRecycleBusy] = useState(false);

  const loadDeletedSubs = async () => {
    try {
      setRecycleLoading(true);
      setDeletedSubs(await api.getDeletedSubscriptions());
      setSelectedDeleted([]);
    } catch {
      setDeletedSubs([]);
    } finally {
      setRecycleLoading(false);
    }
  };

  const handleRestoreDeleted = async (id: string) => {
    try {
      setRecycleBusy(true);
      await api.restoreSubscription(id);
      await loadDeletedSubs();
    } finally {
      setRecycleBusy(false);
    }
  };

  const handlePurgeSelected = async () => {
    if (selectedDeleted.length === 0 || !window.confirm(t('recycle.purgeConfirm'))) return;
    try {
      setRecycleBusy(true);
      await Promise.all(selectedDeleted.map((id) => api.purgeSubscription(id)));
      await loadDeletedSubs();
    } finally {
      setRecycleBusy(false);
    }
  };
  const [showLanguageSelect, setShowLanguageSelect] = useState(false);
  const [showThemeSelect, setShowThemeSelect] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [profile, setProfile] = useState<{ name: string; avatar: string | null }>({ name: '', avatar: null });
  const [helpArticles, setHelpArticles] = useState<HelpArticle[]>([]);
  const [expandedArticleId, setExpandedArticleId] = useState<string | null>(null);
  const [auxLoading, setAuxLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState('');
  const [actionError, setActionError] = useState('');

  // 安全与隐私
  const [securityOverview, setSecurityOverview] = useState<SecurityOverview | null>(null);
  const [securityLoading, setSecurityLoading] = useState(false);
  // 换绑邮箱：新邮箱 + 验证码
  const [newEmailInput, setNewEmailInput] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [sendingEmailCode, setSendingEmailCode] = useState(false);
  const [emailCodeCountdown, setEmailCodeCountdown] = useState(0);
  const [savingEmail, setSavingEmail] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [addingPasskey, setAddingPasskey] = useState(false);
  // V1.3.6 通行密钥列表管理
  const [passkeys, setPasskeys] = useState<PasskeyItem[] | null>(null);
  const [passkeysLoading, setPasskeysLoading] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [savingProfileName, setSavingProfileName] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const { language, setLanguage, t } = useI18n();
  const { theme, setTheme } = useTheme();
  const { user, login, logout, updateUser, token } = useAuth();

  const goBack = () => setView(VIEW_PARENT[view]);
  useBackHandler(goBack, view !== 'main');
  useBackHandler(() => setShowLanguageSelect(false), showLanguageSelect);
  useBackHandler(() => setShowThemeSelect(false), showThemeSelect);

  const pickLocalized = (text: LocalizedText): string =>
    language === '简体中文' || language === '繁體中文' ? text.zh || text.en : text.en || text.zh;

  const loadSettings = async () => {
    try {
      setSettingsLoading(true);
      setSettingsError(null);
      const [data, profileData] = await Promise.all([
        api.getUserSettings(),
        api.getProfile().catch(() => null),
      ]);
      setUserSettings(data);
      setLanguage(data.language);
      setTheme(data.theme);
      if (profileData) {
        setProfile({ name: profileData.name, avatar: profileData.avatar });
        updateUser({ name: profileData.name, avatar: profileData.avatar });
      }
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setSettingsLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
    // 绑定第三方后 App 会写导航标记并切到设置页：直接进入第三方登录视图展示结果
    if (sessionStorage.getItem(SOCIAL_BIND_NAV_KEY) === 'social') {
      sessionStorage.removeItem(SOCIAL_BIND_NAV_KEY);
      setActionNotice('');
      setActionError('');
      setView('social');
    }
    // 桌面端通行密钥桥接完成回到应用：直接打开通行密钥列表并提示
    if (sessionStorage.getItem(PASSKEY_BRIDGE_NAV_KEY) === '1') {
      sessionStorage.removeItem(PASSKEY_BRIDGE_NAV_KEY);
      setActionNotice(t('settings.passkeyAdded'));
      setView('passkey');
      void refreshPasskeys();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 进入个人中心相关页面时加载安全概览
  useEffect(() => {
    if (view === 'main' || securityOverview || securityLoading) return;
    let active = true;
    (async () => {
      setSecurityLoading(true);
      try {
        const data = await api.getSecurityOverview();
        if (!active) return;
        setSecurityOverview(data);
      } catch (err) {
        if (active) setActionError(err instanceof Error ? err.message : 'Failed to load security info');
      } finally {
        if (active) setSecurityLoading(false);
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // V1.3.6：进入通行密钥页时加载凭据列表
  useEffect(() => {
    if (view !== 'passkey') return;
    void refreshPasskeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const saveSettings = async (partial: Partial<UserSettings>) => {
    try {
      const updated = await api.updateUserSettings(partial);
      setUserSettings(updated);
      return updated;
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to save settings');
      return null;
    }
  };

  const handleThemeChange = async (next: Theme) => {
    setTheme(next);
    setShowThemeSelect(false);
    await saveSettings({ theme: next });
  };

  const handleLanguageChange = async (nextLanguage: Language) => {
    setLanguage(nextLanguage);
    setShowLanguageSelect(false);
    await saveSettings({ language: nextLanguage });
  };

  const handleCloudSync = async () => {
    try {
      setSyncing(true);
      setSettingsError(null);
      const updated = await api.triggerCloudSync();
      setUserSettings(updated);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to sync settings');
    } finally {
      setSyncing(false);
    }
  };

  const formatLastSync = () => {
    if (!userSettings?.lastSyncedAt) return t('settings.lastSync');
    const date = new Date(userSettings.lastSyncedAt);
    if (Number.isNaN(date.getTime())) return t('settings.lastSync');
    return t('settings.lastSyncAt').replace('{time}', date.toLocaleString());
  };

  const handleOpenHelp = async () => {
    setActionNotice('');
    setActionError('');
    setExpandedArticleId(null);
    setView('help');
    try {
      setAuxLoading(true);
      const articles = await api.getHelpArticles();
      setHelpArticles(articles);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to load help center');
    } finally {
      setAuxLoading(false);
    }
  };

  const applySession = (session: { token: string; user: { id: number; email: string; name: string; avatar?: string | null } }, avatarFallback?: string | null) => {
    login(session.token, {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      avatar: session.user.avatar ?? avatarFallback ?? null,
    });
    setProfile({ name: session.user.name, avatar: session.user.avatar ?? avatarFallback ?? null });
  };

  const saveProfile = async (partial: { name?: string; avatar?: string | null }): Promise<boolean> => {
    setActionNotice('');
    setActionError('');
    try {
      const session = await api.updateProfile(partial);
      applySession(session);
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save profile');
      return false;
    }
  };

  const handleAvatarFile = async (file: File | undefined) => {
    if (!file) return;
    setActionNotice('');
    setActionError('');
    try {
      const url = await api.uploadAvatar(file);
      setProfile((prev) => ({ ...prev, avatar: url }));
      await saveProfile({ avatar: url });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to upload avatar');
    } finally {
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  };

  const handleSaveNickname = async () => {
    const nextName = profile.name.trim();
    if (!nextName) return;
    setSavingProfileName(true);
    const ok = await saveProfile({ name: nextName });
    setSavingProfileName(false);
    if (ok) {
      setActionNotice(t('settings.profileSaved'));
      goBack();
    }
  };

  const handleAddPasskey = async () => {
    setActionError('');
    setActionNotice('');
    // 桌面端（Electron）：app:// origin 通不过 WebAuthn 的 rpID 校验。
    // V1.3.8 改为主窗口导航到线上桥接页 passkey-bridge.html，在真实 https origin
    // 下调起系统 WebAuthn（Touch ID / Windows Hello），完成后自动回到应用并
    // 跳转通行密钥列表；此前的「子窗口 + postMessage」方案系统弹窗调不出来。
    const isDesktopApp = /Electron/i.test(navigator.userAgent);
    if (isDesktopApp) {
      beginDesktopPasskeyBridge('register');
      return;
    }
    try {
      setAddingPasskey(true);
      const result = await registerPasskey();
      setSecurityOverview((prev) => (prev ? { ...prev, passkeyCount: result.passkeyCount } : prev));
      setActionNotice(t('settings.passkeyAdded'));
      await refreshPasskeys();
    } catch (err) {
      if (isPasskeyUserCancellation(err)) {
        // 用户取消或超时，静默处理
      } else if (isPasskeyAlreadyRegistered(err)) {
        setActionNotice(t('settings.passkeyAlready'));
      } else {
        setActionError(err instanceof Error ? err.message : 'Failed to add passkey');
      }
    } finally {
      setAddingPasskey(false);
    }
  };

  const refreshPasskeys = async () => {
    try {
      setPasskeysLoading(true);
      setPasskeys(await api.listPasskeys());
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to load passkeys');
    } finally {
      setPasskeysLoading(false);
    }
  };

  const handleRenamePasskey = async (id: number) => {
    const label = renameValue.trim();
    if (!label) return;
    try {
      setPasskeysLoading(true);
      setPasskeys(await api.renamePasskey(id, label));
      setRenamingId(null);
      setActionNotice(t('settings.passkeyRenamed'));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to rename passkey');
    } finally {
      setPasskeysLoading(false);
    }
  };

  const handleDeletePasskey = async (id: number) => {
    try {
      setPasskeysLoading(true);
      const next = await api.deletePasskey(id);
      setPasskeys(next);
      setSecurityOverview((prev) => (prev ? { ...prev, passkeyCount: next.length } : prev));
      setDeletingId(null);
      setActionNotice(t('settings.passkeyDeleted'));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete passkey');
    } finally {
      setPasskeysLoading(false);
    }
  };

  // 换绑邮箱验证码倒计时
  useEffect(() => {
    if (emailCodeCountdown <= 0) return;
    const timer = setTimeout(() => setEmailCodeCountdown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [emailCodeCountdown]);

  const handleSendEmailCode = async () => {
    const email = newEmailInput.trim();
    setActionError('');
    setActionNotice('');
    if (!email || !email.includes('@')) {
      setActionError(t('settings.invalidEmail'));
      return;
    }
    try {
      setSendingEmailCode(true);
      const data = await api.requestEmailCode(email, 'change_email');
      if (data.devCode) {
        setEmailCode(data.devCode);
        setActionNotice(`Dev code: ${data.devCode}`);
      } else {
        setActionNotice(t('settings.codeSent'));
      }
      setEmailCodeCountdown(60);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to send code');
    } finally {
      setSendingEmailCode(false);
    }
  };

  const handleChangeEmail = async () => {
    const email = newEmailInput.trim();
    if (!email || !email.includes('@')) return;
    if (!emailCode.trim()) {
      setActionError(t('settings.emailCodeRequired'));
      return;
    }
    try {
      setSavingEmail(true);
      setActionError('');
      const session = await api.updateSecurityEmail(email, emailCode.trim());
      applySession(session, profile.avatar);
      setSecurityOverview((prev) => (prev ? { ...prev, email: session.user.email } : prev));
      setActionNotice(t('settings.emailUpdated'));
      goBack();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update email');
    } finally {
      setSavingEmail(false);
    }
  };

  const handleSetPassword = async () => {
    setActionError('');
    if (newPasswordInput.length < 6) {
      setActionError(t('settings.passwordTooShort'));
      return;
    }
    if (securityOverview?.hasPassword && !currentPasswordInput) {
      setActionError(t('settings.currentPasswordRequired'));
      return;
    }
    try {
      setSavingPassword(true);
      const updated = await api.setSecurityPassword(newPasswordInput, currentPasswordInput || undefined);
      setSecurityOverview(updated);
      setCurrentPasswordInput('');
      setNewPasswordInput('');
      setActionNotice(t('settings.profileSaved'));
      goBack();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm(t('settings.confirmDeleteAccount'))) return;
    try {
      setDeleting(true);
      await api.deleteAccount();
      logout();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete account');
      setDeleting(false);
    }
  };

  const displayName = profile.name || user?.name || '';

  const renderView = () => {
    switch (view) {
      case 'profile':
        return (
          <div>
            <SubPageHeader title={t('settings.profile')} onBack={goBack} />
            {(actionNotice || actionError) && (
              <p className={cn('text-xs px-2 pb-2', actionError ? 'text-red-500' : 'text-primary')}>{actionError || actionNotice}</p>
            )}
            <div>
              {/* 头像行：点击直接换头像 */}
              <button
                onClick={() => avatarInputRef.current?.click()}
                className="w-full flex items-center justify-between py-3 px-2 border-b border-outline-variant/5 active:bg-surface-container-low/60 transition-colors group"
              >
                <span className="text-sm font-semibold text-on-surface">{t('settings.changeAvatar')}</span>
                <span className="flex items-center gap-2">
                  {profile.avatar ? (
                    <img src={resolveAssetUrl(profile.avatar)} alt="avatar" className="w-11 h-11 rounded-full object-cover border border-white shadow-sm bg-surface-container-low" />
                  ) : (
                    <span className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                      {(displayName || 'U').charAt(0).toUpperCase()}
                    </span>
                  )}
                  <ChevronRight className="text-outline-variant/40 group-hover:text-primary transition-colors" size={16} />
                </span>
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => void handleAvatarFile(e.target.files?.[0])}
              />
              {/* 昵称 */}
              <ListRow label={t('settings.nickname')} value={profile.name} onClick={() => setView('nickname')} />
              {/* 安全相关子项直接放出 */}
              {securityLoading || !securityOverview ? (
                <div className="py-6 flex justify-center text-on-surface-variant"><Loader2 size={18} className="animate-spin" /></div>
              ) : (
                <>
                  <ListRow
                    label={t('settings.securityEmail')}
                    value={securityOverview.email}
                    onClick={() => { setNewEmailInput(''); setEmailCode(''); setView('email'); }}
                  />
                  <ListRow
                    label={t('settings.securityPassword')}
                    value={securityOverview.hasPassword ? t('settings.securitySet') : t('settings.securityNotSet')}
                    onClick={() => setView('password')}
                  />
                  <ListRow
                    label={t('settings.passkey')}
                    value={String(securityOverview.passkeyCount)}
                    onClick={() => setView('passkey')}
                  />
                  <ListRow
                    label={t('settings.socialLogin')}
                    value={t('settings.socialLoginDesc')}
                    onClick={() => setView('social')}
                  />
                </>
              )}
              {/* 注销账号 */}
              <ListRow label={t('settings.deleteAccount')} danger onClick={() => setView('danger')} />
            </div>
            <p className="text-xs text-on-surface-variant/70 px-2 pt-4 leading-relaxed">{t('settings.deleteAccountDesc')}</p>
          </div>
        );

      case 'nickname':
        return (
          <div>
            <SubPageHeader title={t('settings.nickname')} onBack={goBack} />
            <div className="space-y-3 pt-2">
              <input
                type="text"
                value={profile.name}
                onChange={(e) => setProfile((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={t('settings.nicknamePlaceholder')}
                className="w-full bg-surface-container-low border border-outline-variant/10 rounded-xl px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
              {actionError && <p className="text-xs text-red-500">{actionError}</p>}
              <button
                onClick={() => void handleSaveNickname()}
                disabled={savingProfileName || !profile.name.trim()}
                className="w-full bg-primary text-white px-3 py-3 rounded-xl text-sm font-bold disabled:opacity-70 active:scale-[0.98] transition-transform"
              >
                {savingProfileName ? t('settings.processing') : t('settings.saveProfile')}
              </button>
            </div>
          </div>
        );

      case 'email':
        return (
          <div>
            <SubPageHeader title={t('settings.changeEmail')} onBack={goBack} />
            <div className="space-y-3 pt-2">
              <p className="text-xs text-on-surface-variant px-1">
                {t('settings.currentEmail')}：{securityOverview?.email || user?.email || '—'}
              </p>
              <input
                type="email"
                value={newEmailInput}
                onChange={(e) => setNewEmailInput(e.target.value)}
                placeholder={t('settings.newEmailPlaceholder')}
                className="w-full bg-surface-container-low border border-outline-variant/10 rounded-xl px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={emailCode}
                  onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ''))}
                  placeholder={t('settings.emailCodePlaceholder')}
                  className="flex-1 min-w-0 bg-surface-container-low border border-outline-variant/10 rounded-xl px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
                <button
                  onClick={() => void handleSendEmailCode()}
                  disabled={sendingEmailCode || emailCodeCountdown > 0}
                  className="shrink-0 px-3 py-3 rounded-xl border border-outline-variant/30 text-xs font-bold text-primary active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100"
                >
                  {sendingEmailCode
                    ? t('settings.processing')
                    : emailCodeCountdown > 0
                      ? t('settings.resendIn').replace('{s}', String(emailCodeCountdown))
                      : t('settings.sendCode')}
                </button>
              </div>
              {actionNotice && <p className="text-xs text-primary px-1">{actionNotice}</p>}
              {actionError && <p className="text-xs text-red-500 px-1">{actionError}</p>}
              <button
                onClick={() => void handleChangeEmail()}
                disabled={savingEmail}
                className="w-full bg-primary text-white px-3 py-3 rounded-xl text-sm font-bold disabled:opacity-70 active:scale-[0.98] transition-transform"
              >
                {savingEmail ? t('settings.processing') : t('settings.changeEmail')}
              </button>
              <p className="text-xs text-on-surface-variant/70 px-1 leading-relaxed">{t('settings.changeEmailDesc')}</p>
            </div>
          </div>
        );

      case 'password':
        return (
          <div>
            <SubPageHeader title={securityOverview?.hasPassword ? t('settings.changePassword') : t('settings.setPassword')} onBack={goBack} />
            <div className="space-y-3 pt-2">
              {securityOverview?.hasPassword && (
                <input
                  type="password"
                  value={currentPasswordInput}
                  onChange={(e) => setCurrentPasswordInput(e.target.value)}
                  placeholder={t('settings.currentPasswordPlaceholder')}
                  className="w-full bg-surface-container-low border border-outline-variant/10 rounded-xl px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                />
              )}
              <input
                type="password"
                value={newPasswordInput}
                onChange={(e) => setNewPasswordInput(e.target.value)}
                placeholder={t('settings.newPasswordPlaceholder')}
                className="w-full bg-surface-container-low border border-outline-variant/10 rounded-xl px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
              {actionError && <p className="text-xs text-red-500">{actionError}</p>}
              <button
                onClick={() => void handleSetPassword()}
                disabled={savingPassword}
                className="w-full bg-primary text-white px-3 py-3 rounded-xl text-sm font-bold disabled:opacity-70 active:scale-[0.98] transition-transform"
              >
                {savingPassword ? t('settings.processing') : (securityOverview?.hasPassword ? t('settings.changePassword') : t('settings.setPassword'))}
              </button>
            </div>
          </div>
        );

      case 'passkey':
        return (
          <div>
            <SubPageHeader title={t('settings.passkey')} onBack={goBack} />
            <div className="space-y-4 pt-2">
              {/* 已添加的通行密钥列表：自定义命名、编辑、删除 */}
              <div className="space-y-2">
                {passkeysLoading && (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 size={20} className="animate-spin text-primary" />
                  </div>
                )}
                {!passkeysLoading && passkeys && passkeys.map((item) => (
                  <div
                    key={item.id}
                    className="bg-surface-container-low rounded-xl px-3 py-3 flex items-center gap-3"
                  >
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Fingerprint size={18} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {renamingId === item.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleRenamePasskey(item.id);
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            maxLength={64}
                            className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-surface-container-lowest outline-none text-sm font-semibold focus:ring-2 focus:ring-primary/30"
                          />
                          <button
                            onClick={() => void handleRenamePasskey(item.id)}
                            className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center active:scale-90 transition-transform"
                            aria-label={t('settings.renamePasskey')}
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={() => setRenamingId(null)}
                            className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center active:scale-90 transition-transform"
                            aria-label="cancel"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm font-bold text-on-surface truncate">{item.label}</p>
                          <p className="text-[11px] text-on-surface-variant mt-0.5 truncate">
                            {t('settings.passkeyAddedOn')} {new Date(item.createdAt).toLocaleDateString()}
                            {item.lastUsedAt ? ` · ${t('settings.passkeyLastUsed')} ${new Date(item.lastUsedAt).toLocaleDateString()}` : ''}
                          </p>
                        </>
                      )}
                    </div>
                    {renamingId !== item.id && deletingId !== item.id && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => { setRenamingId(item.id); setRenameValue(item.label); }}
                          className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high active:scale-90 transition-all"
                          aria-label={t('settings.renamePasskey')}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => setDeletingId(item.id)}
                          className="w-9 h-9 rounded-full flex items-center justify-center text-red-500 hover:bg-red-500/10 active:scale-90 transition-all"
                          aria-label={t('settings.deletePasskey')}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                    {deletingId === item.id && (
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] font-semibold text-red-500">{t('settings.deletePasskeyConfirm')}</span>
                        <button
                          onClick={() => void handleDeletePasskey(item.id)}
                          className="px-3 h-8 rounded-full bg-red-500 text-white text-xs font-bold active:scale-95 transition-transform"
                        >
                          {t('settings.deletePasskeyYes')}
                        </button>
                        <button
                          onClick={() => setDeletingId(null)}
                          className="px-3 h-8 rounded-full bg-surface-container-high text-xs font-bold active:scale-95 transition-transform"
                        >
                          {t('settings.deletePasskeyNo')}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {!passkeysLoading && passkeys && passkeys.length === 0 && (
                  <div className="text-center py-8 space-y-2">
                    <ShieldCheck size={28} className="mx-auto text-on-surface-variant/40" />
                    <p className="text-xs text-on-surface-variant">{t('settings.passkeyEmpty')}</p>
                  </div>
                )}
              </div>

              <button
                onClick={() => void handleAddPasskey()}
                disabled={addingPasskey}
                className="w-full bg-primary text-white px-3 py-3 rounded-xl text-sm font-bold disabled:opacity-70 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                {addingPasskey ? <Loader2 size={16} className="animate-spin" /> : <Fingerprint size={16} />}
                {t('settings.addPasskey')}
              </button>
              {(actionNotice || actionError) && (
                <p className={cn('text-xs px-2', actionError ? 'text-red-500' : 'text-primary')}>{actionError || actionNotice}</p>
              )}
            </div>
          </div>
        );

      case 'danger':
        return (
          <div>
            <SubPageHeader title={t('settings.dangerZone')} onBack={goBack} />
            <div className="space-y-4 pt-2">
              <p className="text-xs text-on-surface-variant px-2 leading-relaxed">{t('settings.deleteAccountDesc')}</p>
              {actionError && <p className="text-xs text-red-500 px-2">{actionError}</p>}
              <button
                onClick={() => void handleDeleteAccount()}
                disabled={deleting}
                className="w-full bg-red-600 text-white px-3 py-3 rounded-xl text-sm font-bold disabled:opacity-70 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                {t('settings.deleteAccount')}
              </button>
            </div>
          </div>
        );

      case 'social':
        return <SocialLoginPage onBack={goBack} />;

      case 'recycle':
        return (
          <div>
            <SubPageHeader title={t('settings.recycleBin')} onBack={goBack} />
            <div className="pt-6 space-y-4">
              <p className="text-xs text-on-surface-variant px-1">{t('recycle.autoHint')}</p>
              {recycleLoading ? (
                <div className="py-10 flex justify-center text-on-surface-variant"><Loader2 size={20} className="animate-spin" /></div>
              ) : deletedSubs.length === 0 ? (
                <p className="text-center text-sm text-on-surface-variant py-12">{t('recycle.empty')}</p>
              ) : (
                <>
                  <label className="flex items-center gap-3 px-1 text-sm text-on-surface-variant cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedDeleted.length === deletedSubs.length && deletedSubs.length > 0}
                      onChange={(e) => setSelectedDeleted(e.target.checked ? deletedSubs.map((s) => s.id) : [])}
                      className="w-4 h-4 accent-[#0054cd]"
                    />
                    {t('recycle.selectAll')}
                  </label>
                  <div className="space-y-2">
                    {deletedSubs.map((sub) => (
                      <div key={sub.id} className="flex items-center gap-3 bg-surface-container-low rounded-xl p-3">
                        <input
                          type="checkbox"
                          checked={selectedDeleted.includes(sub.id)}
                          onChange={(e) => setSelectedDeleted((prev) => e.target.checked ? [...prev, sub.id] : prev.filter((x) => x !== sub.id))}
                          className="w-4 h-4 accent-[#0054cd] shrink-0"
                        />
                        <div className="w-8 h-8 rounded-lg overflow-hidden bg-surface-container-lowest shrink-0 flex items-center justify-center">
                          {sub.icon ? (
                            <img src={resolveAssetUrl(sub.icon)} alt={sub.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <span className="text-xs font-bold text-primary uppercase">{sub.name ? sub.name.charAt(0) : '?'}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-bold text-on-surface truncate">{sub.name}</h3>
                          <p className="text-[10px] text-on-surface-variant">{sub.nextBillingDate || '—'}</p>
                        </div>
                        <button
                          onClick={() => void handleRestoreDeleted(sub.id)}
                          disabled={recycleBusy}
                          className="text-primary text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-surface-container-high transition-colors disabled:opacity-40 shrink-0"
                        >
                          {t('recycle.restore')}
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={handlePurgeSelected}
                    disabled={selectedDeleted.length === 0 || recycleBusy}
                    className="w-full py-3 rounded-xl bg-red-500 text-white font-bold text-sm active:scale-[0.98] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    <Trash2 size={16} />
                    {t('recycle.purgeNow')} ({selectedDeleted.length})
                  </button>
                </>
              )}
            </div>
          </div>
        );

      case 'help':
        return (
          <div>
            <SubPageHeader title={t('settings.helpCenter')} onBack={goBack} />
            {auxLoading ? (
              <div className="py-12 flex justify-center text-on-surface-variant"><Loader2 size={20} className="animate-spin" /></div>
            ) : (
              <div className="space-y-3 pt-2">
                {helpArticles.map((article) => {
                  const expanded = expandedArticleId === article.id;
                  return (
                    <div key={article.id} className="bg-surface-container-low rounded-xl overflow-hidden">
                      <button
                        onClick={() => setExpandedArticleId(expanded ? null : article.id)}
                        className="w-full text-left p-3 flex items-start justify-between gap-2 hover:bg-surface-container transition-colors"
                      >
                        <div>
                          <p className="text-sm font-semibold text-on-surface">{pickLocalized(article.title)}</p>
                          <p className="text-xs text-on-surface-variant mt-1">{pickLocalized(article.summary)}</p>
                        </div>
                        <ChevronDown size={16} className={cn('mt-1 shrink-0 text-on-surface-variant transition-transform', expanded && 'rotate-180')} />
                      </button>
                      {expanded && (
                        <div className="px-3 pb-3 space-y-2">
                          {(language === '简体中文' || language === '繁體中文' ? article.content.zh : article.content.en).map((paragraph, index) => (
                            <p key={index} className="text-xs text-on-surface-variant leading-relaxed">· {paragraph}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {helpArticles.length === 0 && (
                  <p className="text-sm text-on-surface-variant px-1">{t('settings.noHelpContent')}</p>
                )}
              </div>
            )}
          </div>
        );

      case 'about':
        return (
          <div>
            <SubPageHeader title={t('settings.about')} onBack={goBack} />
            <div className="pt-6 space-y-6">
              {/* 用真实应用图标，与桌面/安装图标保持一致 */}
              <div className="flex flex-col items-center gap-2 py-2">
                <img src="icon.png" alt="DingYue" className="w-20 h-20 rounded-[22%] shadow-md bg-surface-container-low" />
                <p className="text-lg font-black tracking-tight text-on-surface">DingYue</p>
                <p className="text-xs text-on-surface-variant font-medium">v{appVersion}</p>
                <p className="text-xs text-on-surface-variant text-center max-w-xs">{t('settings.aboutDesc')}</p>
              </div>
              {/* V1.4.0：协议在上、联络我们在下，三行同框无分隔线 */}
              <div className="bg-surface-container-low rounded-xl overflow-hidden">
                <button
                  onClick={() => setLegalKind('agreement')}
                  className="w-full flex items-center justify-between p-3 hover:bg-surface-container transition-colors"
                >
                  <span className="flex items-center gap-3 text-sm font-semibold text-on-surface">
                    <FileText size={16} className="text-on-surface-variant" />
                    {t('legal.agreement')}
                  </span>
                  <ChevronRight size={16} className="text-outline-variant" />
                </button>
                <button
                  onClick={() => setLegalKind('privacy')}
                  className="w-full flex items-center justify-between p-3 hover:bg-surface-container transition-colors"
                >
                  <span className="flex items-center gap-3 text-sm font-semibold text-on-surface">
                    <ShieldCheck size={16} className="text-on-surface-variant" />
                    {t('legal.privacy')}
                  </span>
                  <ChevronRight size={16} className="text-outline-variant" />
                </button>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className="w-full flex items-center justify-between p-3 hover:bg-surface-container transition-colors"
                >
                  <span className="flex items-center gap-3 text-sm font-semibold text-on-surface">
                    <Mail size={16} className="text-on-surface-variant" />
                    {t('settings.contactUs')}
                  </span>
                  <span className="text-xs text-primary font-medium">{CONTACT_EMAIL}</span>
                </a>
              </div>
            </div>
          </div>
        );

      default:
        return (
          <>
            {/* Profile Section — 扁平行式，点击进入个人中心 */}
            <section
              onClick={() => { setActionNotice(''); setActionError(''); setView('profile'); }}
              className="flex items-center gap-4 py-5 cursor-pointer group"
            >
              {profile.avatar ? (
                <img src={resolveAssetUrl(profile.avatar)} alt="avatar" className="w-16 h-16 rounded-full object-cover border-2 border-white shadow-sm bg-surface-container-low" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary border-2 border-white shadow-sm">
                  {displayName ? (
                    <span className="text-xl font-bold">{displayName.trim().charAt(0).toUpperCase()}</span>
                  ) : (
                    <User size={32} fill="currentColor" className="text-primary/20" />
                  )}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold text-on-surface truncate">{displayName || '—'}</h2>
                <p className="text-sm text-on-surface-variant truncate">{user?.email}</p>
              </div>
              <ChevronRight className="text-outline-variant group-hover:text-primary transition-colors" size={20} />
            </section>

            {/* Settings Groups */}
            <div className="space-y-6">
              <SettingsGroup title={t('settings.account')}>
                <SettingsItem
                  icon={<Bell size={18} />}
                  label={t('settings.messageCenter')}
                  onClick={() => setShowNotifications(true)}
                />
                <SettingsItem
                  icon={<RefreshCw size={18} />}
                  label={t('settings.cloudSync')}
                  value={syncing ? t('settings.syncing') : formatLastSync()}
                  onClick={() => void handleCloudSync()}
                />
                <SettingsItem
                  icon={<Trash2 size={18} />}
                  label={t('settings.recycleBin')}
                  onClick={() => { setView('recycle'); void loadDeletedSubs(); }}
                />
              </SettingsGroup>

              <SettingsGroup title={t('settings.general')}>
                <SettingsItem
                  icon={<Palette size={18} />}
                  label={t('settings.theme')}
                  value={theme === 'Light' ? t('settings.light') || 'Light' : theme === 'Dark' ? t('settings.dark') || 'Dark' : t('settings.forest') || 'Forest'}
                  onClick={() => setShowThemeSelect(true)}
                />
                <SettingsItem
                  icon={<Languages size={18} />}
                  label={t('settings.language')}
                  value={language}
                  onClick={() => setShowLanguageSelect(true)}
                />
              </SettingsGroup>

              <SettingsGroup title={t('settings.support')}>
                <SettingsItem icon={<HelpCircle size={18} />} label={t('settings.helpCenter')} onClick={() => void handleOpenHelp()} />
                <SettingsItem icon={<Info size={18} />} label={t('settings.about')} onClick={() => setView('about')} />
              </SettingsGroup>
            </div>

            {/* Sign Out — 红色底框 + 二次确认（V1.4.0） */}
            <button onClick={() => setShowLogoutConfirm(true)} className="w-full py-4 flex items-center justify-center gap-2 bg-red-500/10 text-red-600 font-bold rounded-2xl transition-colors active:scale-[0.99] hover:bg-red-500/15">
              <LogOut size={20} />
              {t('settings.signOut')}
            </button>
            <AnimatePresence>
              {showLogoutConfirm && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center px-8"
                  onClick={() => setShowLogoutConfirm(false)}
                >
                  <motion.div
                    initial={{ scale: 0.92, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-surface rounded-2xl p-6 w-full max-w-xs text-center shadow-2xl"
                  >
                    <div className="w-12 h-12 mx-auto rounded-full bg-red-500/10 flex items-center justify-center text-red-600">
                      <LogOut size={22} />
                    </div>
                    <h3 className="text-base font-bold text-on-surface mt-3">{t('settings.logoutConfirmTitle')}</h3>
                    <p className="text-sm text-on-surface-variant mt-1">{user?.email}</p>
                    <div className="flex gap-3 mt-5">
                      <button
                        onClick={() => setShowLogoutConfirm(false)}
                        className="flex-1 py-2.5 rounded-xl border border-outline-variant/30 text-on-surface-variant font-bold text-sm active:scale-95 transition-all"
                      >
                        {t('settings.cancelLogout')}
                      </button>
                      <button
                        onClick={() => { setShowLogoutConfirm(false); logout(); }}
                        className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-bold text-sm active:scale-95 transition-all"
                      >
                        {t('settings.continueLogout')}
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 版本号跟随 package.json 的 version 字段 */}
            <p className="text-center text-[10px] text-on-surface-variant font-medium opacity-40">
              DingYue v{appVersion}
            </p>
          </>
        );
    }
  };

  if (legalKind) {
    return <LegalDocument kind={legalKind} onBack={() => setLegalKind(null)} />;
  }

  return (
    <div className="px-6 max-w-2xl mx-auto pb-10">
      {settingsLoading && view === 'main' && (
        <div className="bg-surface-container-lowest rounded-xl p-4 flex items-center justify-center text-on-surface-variant">
          <Loader2 size={18} className="animate-spin" />
        </div>
      )}

      {settingsError && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-600 mt-4">
          {settingsError}
        </div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={view}
          initial={{ x: 32, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -32, opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          {renderView()}
        </motion.div>
      </AnimatePresence>

      {/* Notification Center Modal */}
      {showNotifications && (
        <NotificationCenter onClose={() => setShowNotifications(false)} />
      )}

      {/* Language Selection Modal */}
      {showLanguageSelect && (
        <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface w-full max-w-sm rounded-3xl p-6 space-y-4 animate-in slide-in-from-bottom-8 duration-300">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-bold text-lg text-on-surface">{t('settings.selectLanguage')}</h3>
              <button onClick={() => setShowLanguageSelect(false)} className="p-2 hover:bg-surface-container-high rounded-full transition-colors">
                <X size={20} className="text-on-surface-variant" />
              </button>
            </div>
            <div className="space-y-2">
              {languageOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => { void handleLanguageChange(option.value); }}
                  className={cn(
                    "w-full flex justify-between items-center p-4 rounded-2xl transition-colors active:scale-[0.98]",
                    language === option.value
                      ? "bg-primary/10 border border-primary/20"
                      : "bg-surface-container-lowest border border-outline-variant/10 hover:bg-surface-container-low"
                  )}
                >
                  <span className={cn("font-medium", language === option.value ? "text-primary font-bold" : "text-on-surface")}>{option.label}</span>
                  {language === option.value && <Check size={18} className="text-primary"/>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 主题选择：浅色 / 深色 / 森林绿（自选，默认浅色） */}
      {showThemeSelect && (
        <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface w-full max-w-sm rounded-3xl p-6 space-y-4 animate-in slide-in-from-bottom-8 duration-300">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-bold text-lg text-on-surface">{t('settings.selectTheme')}</h3>
              <button onClick={() => setShowThemeSelect(false)} className="p-2 hover:bg-surface-container-high rounded-full transition-colors">
                <X size={20} className="text-on-surface-variant" />
              </button>
            </div>
            <div className="space-y-2">
              {([
                { value: 'Light' as Theme, label: t('settings.light') || 'Light', swatch: 'bg-surface-container-lowest', ring: true },
                { value: 'Dark' as Theme, label: t('settings.dark') || 'Dark', swatch: 'bg-[#111318]' },
                { value: 'Forest' as Theme, label: t('settings.forest') || 'Forest', swatch: 'bg-[#2f7d52]' },
              ]).map((option) => (
                <button
                  key={option.value}
                  onClick={() => { void handleThemeChange(option.value); }}
                  className={cn(
                    "w-full flex justify-between items-center p-4 rounded-2xl transition-colors active:scale-[0.98]",
                    theme === option.value
                      ? "bg-primary/10 border border-primary/20"
                      : "bg-surface-container-lowest border border-outline-variant/10 hover:bg-surface-container-low"
                  )}
                >
                  <span className={cn("font-medium flex items-center gap-3", theme === option.value ? "text-primary font-bold" : "text-on-surface")}>
                    <span className={cn("w-6 h-6 rounded-full shrink-0", option.swatch, option.ring && "ring-1 ring-outline-variant")} />
                    {option.label}
                  </span>
                  {theme === option.value && <Check size={18} className="text-primary"/>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SubPageHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1 py-4 -mx-2">
      <button
        onClick={onBack}
        aria-label={t('settings.back')}
        className="p-2 rounded-full hover:bg-surface-container-low active:scale-90 transition-all"
      >
        <ArrowLeft size={22} className="text-on-surface" />
      </button>
      <h2 className="text-lg font-bold text-on-surface">{title}</h2>
    </div>
  );
}

function ListRow({ label, value, onClick, danger }: { label: string; value?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between py-4 px-2 border-b border-outline-variant/5 active:bg-surface-container-low/60 transition-colors group"
    >
      <span className={cn('text-sm font-semibold', danger ? 'text-red-600' : 'text-on-surface')}>{label}</span>
      <span className="flex items-center gap-2 max-w-[60%]">
        {value && <span className="text-xs text-on-surface-variant font-medium truncate">{value}</span>}
        <ChevronRight className="text-outline-variant/40 group-hover:text-primary transition-colors shrink-0" size={16} />
      </span>
    </button>
  );
}

function SettingsGroup({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div>
      <h3 className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant/60">{title}</h3>
      {children}
    </div>
  );
}

function SettingsItem({ icon, label, value, onClick }: { icon: React.ReactNode, label: string, value?: string, onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between py-4 hover:bg-surface-container-low/60 rounded-xl px-2 transition-colors group border-b border-outline-variant/5 last:border-0"
    >
      <div className="flex items-center gap-3">
        <div className="text-on-surface-variant group-hover:text-primary transition-colors">
          {icon}
        </div>
        <span className="text-sm font-semibold text-on-surface">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {value && <span className="text-xs text-on-surface-variant font-medium">{value}</span>}
        <ChevronRight className="text-outline-variant/40 group-hover:text-primary transition-colors" size={16} />
      </div>
    </button>
  );
}
