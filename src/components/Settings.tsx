import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  User, Bell, Lock, HelpCircle, LogOut, ChevronRight, ChevronDown, Star, RefreshCw, Palette, Languages,
  X, Check, Loader2, Info, Mail, ArrowLeft, Fingerprint, Trash2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import Premium from './Premium';
import { Language, useI18n } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import NotificationCenter from './NotificationCenter';
import { useBackHandler } from '../lib/backButton';
import { useAuth } from '../lib/auth';
import { api, HelpArticle, LocalizedText, Membership, SecurityOverview, UserSettings } from '../lib/api';
import { registerPasskey, isPasskeyUserCancellation, isPasskeyAlreadyRegistered } from '../lib/passkey';
import { version as appVersion } from '../../package.json';

const languageOptions: Array<{ value: Language; label: string }> = [
  { value: 'English', label: 'English' },
  { value: '简体中文', label: '简体中文' },
  { value: '繁體中文', label: '繁體中文' },
  { value: 'Latin', label: 'Latin' },
  { value: '한국어', label: '한국어' },
];

const CONTACT_EMAIL = 'rosyhazes@126.com';

// 站内导航：个人中心及其子页面在设置页内部切换（类似微信），不弹窗
type SettingsView = 'main' | 'profile' | 'nickname' | 'email' | 'password' | 'passkey' | 'danger';

const VIEW_PARENT: Record<Exclude<SettingsView, 'main'>, SettingsView> = {
  profile: 'main',
  nickname: 'profile',
  email: 'profile',
  password: 'profile',
  passkey: 'profile',
  danger: 'profile',
};

export default function Settings() {
  const [view, setView] = useState<SettingsView>('main');
  const [showPremium, setShowPremium] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showLanguageSelect, setShowLanguageSelect] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [currentMembership, setCurrentMembership] = useState<Membership | null>(null);
  const [profile, setProfile] = useState<{ name: string; avatar: string | null }>({ name: '', avatar: null });
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [helpArticles, setHelpArticles] = useState<HelpArticle[]>([]);
  const [expandedArticleId, setExpandedArticleId] = useState<string | null>(null);
  const [auxLoading, setAuxLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState('');
  const [actionError, setActionError] = useState('');

  // 安全与隐私
  const [securityOverview, setSecurityOverview] = useState<SecurityOverview | null>(null);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [unlinkingGoogle, setUnlinkingGoogle] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [addingPasskey, setAddingPasskey] = useState(false);
  const [savingProfileName, setSavingProfileName] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const { language, setLanguage, t } = useI18n();
  const { theme, setTheme } = useTheme();
  const { user, login, logout, updateUser } = useAuth();

  const goBack = () => setView(VIEW_PARENT[view]);
  useBackHandler(goBack, view !== 'main');
  useBackHandler(() => setShowHelpModal(false), showHelpModal);
  useBackHandler(() => setShowAboutModal(false), showAboutModal);
  useBackHandler(() => setShowLanguageSelect(false), showLanguageSelect);

  const pickLocalized = (text: LocalizedText): string =>
    language === '简体中文' || language === '繁體中文' ? text.zh || text.en : text.en || text.zh;

  const loadMembership = async () => {
    try {
      const membership = await api.getCurrentMembership();
      setCurrentMembership(membership);
    } catch {
      setCurrentMembership(null);
    }
  };

  const loadSettings = async () => {
    try {
      setSettingsLoading(true);
      setSettingsError(null);
      const [data, membership, profileData] = await Promise.all([
        api.getUserSettings(),
        api.getCurrentMembership(),
        api.getProfile().catch(() => null),
      ]);
      setUserSettings(data);
      setCurrentMembership(membership);
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
        setEmailInput(data.email);
      } catch (err) {
        if (active) setActionError(err instanceof Error ? err.message : 'Failed to load security info');
      } finally {
        if (active) setSecurityLoading(false);
      }
    })();
    return () => { active = false; };
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

  const handleThemeToggle = async () => {
    const nextTheme = theme === 'Light' ? 'Dark' : 'Light';
    setTheme(nextTheme);
    await saveSettings({ theme: nextTheme });
  };

  const handleLanguageChange = async (nextLanguage: Language) => {
    setLanguage(nextLanguage);
    setShowLanguageSelect(false);
    await saveSettings({ language: nextLanguage });
  };

  const handleAppLockToggle = async () => {
    const nextValue = !(userSettings?.appLockEnabled || false);
    const updated = await saveSettings({ appLockEnabled: nextValue });
    if (updated) {
      setUserSettings(updated);
    }
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

  const getPlanLabel = (plan: Membership['plan']) => {
    if (plan === 'trial') return t('premium.freeTrial');
    if (plan === 'monthly') return t('premium.monthly');
    if (plan === 'annual') return t('premium.annual');
    return t('premium.lifetime');
  };

  const formatMembershipExpiry = (membership: Membership) => {
    if (!membership.expiresAt) return t('settings.memberLifetime');
    const date = new Date(membership.expiresAt);
    if (Number.isNaN(date.getTime())) return t('settings.memberLifetime');
    return date.toLocaleDateString();
  };

  const isPremiumMember = Boolean(
    currentMembership &&
      currentMembership.status !== 'expired' &&
      currentMembership.status !== 'canceled' &&
      (!currentMembership.expiresAt || new Date(currentMembership.expiresAt).getTime() > Date.now())
  );

  const handleOpenHelp = async () => {
    try {
      setShowHelpModal(true);
      setExpandedArticleId(null);
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
      const url = await api.uploadSubscriptionIcon(file);
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
    try {
      setAddingPasskey(true);
      const result = await registerPasskey();
      setSecurityOverview((prev) => (prev ? { ...prev, passkeyCount: result.passkeyCount } : prev));
      setActionNotice(t('settings.passkeyAdded'));
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

  const handleSaveEmail = async () => {
    const email = emailInput.trim();
    if (!email || !email.includes('@')) return;
    try {
      setSavingEmail(true);
      setActionError('');
      const session = await api.updateSecurityEmail(email);
      applySession(session, profile.avatar);
      setSecurityOverview((prev) => (prev ? { ...prev, email: session.user.email } : prev));
      setActionNotice(t('settings.profileSaved'));
      goBack();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update email');
    } finally {
      setSavingEmail(false);
    }
  };

  const handleUnlinkGoogle = async () => {
    if (!securityOverview?.googleLinked) return;
    if (!securityOverview.hasPassword) return;
    if (!window.confirm(t('settings.confirmUnlinkGoogle'))) return;
    try {
      setUnlinkingGoogle(true);
      setActionError('');
      const updated = await api.unlinkGoogleAccount();
      setSecurityOverview(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to unlink Google account');
    } finally {
      setUnlinkingGoogle(false);
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

  const handleClosePremium = async () => {
    setShowPremium(false);
    await loadMembership();
  };

  if (showPremium) return <Premium onClose={() => void handleClosePremium()} />;

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
                    <img src={profile.avatar} alt="avatar" className="w-11 h-11 rounded-full object-cover border border-white shadow-sm" />
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
                    onClick={() => { setEmailInput(securityOverview.email); setView('email'); }}
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
                    label={t('settings.securityGoogle')}
                    value={securityOverview.googleLinked ? t('settings.securityLinked') : t('settings.securityNotLinked')}
                    onClick={() => void handleUnlinkGoogle()}
                  />
                  {securityOverview.googleLinked && !securityOverview.hasPassword && (
                    <p className="text-xs text-amber-600 px-2 pt-2">{t('settings.needPasswordBeforeUnlink')}</p>
                  )}
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
                {savingProfileName ? t('premium.processing') : t('settings.saveProfile')}
              </button>
            </div>
          </div>
        );

      case 'email':
        return (
          <div>
            <SubPageHeader title={t('settings.securityEmail')} onBack={goBack} />
            <div className="space-y-3 pt-2">
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder={t('settings.securityEmailPlaceholder')}
                className="w-full bg-surface-container-low border border-outline-variant/10 rounded-xl px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
              {actionError && <p className="text-xs text-red-500">{actionError}</p>}
              <button
                onClick={() => void handleSaveEmail()}
                disabled={savingEmail}
                className="w-full bg-primary text-white px-3 py-3 rounded-xl text-sm font-bold disabled:opacity-70 active:scale-[0.98] transition-transform"
              >
                {savingEmail ? t('premium.processing') : t('settings.saveEmail')}
              </button>
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
                {savingPassword ? t('premium.processing') : (securityOverview?.hasPassword ? t('settings.changePassword') : t('settings.setPassword'))}
              </button>
            </div>
          </div>
        );

      case 'passkey':
        return (
          <div>
            <SubPageHeader title={t('settings.passkey')} onBack={goBack} />
            <div className="space-y-4 pt-2">
              <p className="text-sm text-on-surface-variant px-2">
                {securityOverview ? String(securityOverview.passkeyCount) : '0'}
              </p>
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

      default:
        return (
          <>
            {/* Profile Section — 扁平行式，点击进入个人中心 */}
            <section
              onClick={() => { setActionNotice(''); setActionError(''); setView('profile'); }}
              className="flex items-center gap-4 py-5 cursor-pointer group"
            >
              {profile.avatar ? (
                <img src={profile.avatar} alt="avatar" className="w-16 h-16 rounded-full object-cover border-2 border-white shadow-sm" />
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

            {/* Pro Banner */}
            {isPremiumMember && currentMembership ? (
              <section
                onClick={() => setShowPremium(true)}
                className="relative overflow-hidden bg-gradient-to-br from-emerald-600 to-primary p-6 rounded-2xl text-white shadow-lg cursor-pointer active:scale-[0.98] transition-transform"
              >
                <div className="absolute -top-6 -right-6 w-24 h-24 bg-white/10 rounded-full blur-2xl"></div>
                <div className="relative z-10 flex justify-between items-start gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Star size={16} fill="currentColor" className="text-amber-300" />
                      <span className="text-[10px] font-bold tracking-widest uppercase opacity-85">DuoDuo Pro</span>
                    </div>
                    <h3 className="text-lg font-bold">{t('settings.memberThanksTitle')}</h3>
                    <p className="text-xs opacity-80">{t('settings.memberThanksDesc')}</p>
                    <p className="text-xs opacity-90 pt-1">
                      {t('settings.memberPlan')}: {getPlanLabel(currentMembership.plan)}
                    </p>
                    <p className="text-xs opacity-90">
                      {t('settings.memberValidUntil')}: {formatMembershipExpiry(currentMembership)}
                    </p>
                  </div>
                  <button className="bg-white text-emerald-700 px-4 py-2 rounded-xl text-xs font-bold shadow-sm whitespace-nowrap">
                    {t('settings.manageMembership')}
                  </button>
                </div>
              </section>
            ) : (
              <section
                onClick={() => setShowPremium(true)}
                className="relative overflow-hidden bg-gradient-to-br from-indigo-600 to-primary p-6 rounded-2xl text-white shadow-lg cursor-pointer active:scale-[0.98] transition-transform"
              >
                <div className="absolute -top-6 -right-6 w-24 h-24 bg-white/10 rounded-full blur-2xl"></div>
                <div className="relative z-10 flex justify-between items-center">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Star size={16} fill="currentColor" className="text-amber-400" />
                      <span className="text-[10px] font-bold tracking-widest uppercase opacity-80">DuoDuo Pro</span>
                    </div>
                    <h3 className="text-lg font-bold">{t('settings.upgradeTitle')}</h3>
                    <p className="text-xs opacity-70">{t('settings.upgradeDesc')}</p>
                  </div>
                  <button className="bg-white text-primary px-4 py-2 rounded-xl text-xs font-bold shadow-sm">
                    {t('settings.upgradeBtn')}
                  </button>
                </div>
              </section>
            )}

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
              </SettingsGroup>

              <SettingsGroup title={t('settings.general')}>
                <SettingsItem
                  icon={<Palette size={18} />}
                  label={t('settings.theme')}
                  value={theme === 'Light' ? t('settings.light') || 'Light' : t('settings.dark') || 'Dark'}
                  onClick={() => void handleThemeToggle()}
                />
                <SettingsItem
                  icon={<Languages size={18} />}
                  label={t('settings.language')}
                  value={language}
                  onClick={() => setShowLanguageSelect(true)}
                />
                <SettingsItem
                  icon={<Lock size={18} />}
                  label={t('settings.appLock')}
                  value={userSettings?.appLockEnabled ? t('settings.on') : t('settings.off')}
                  onClick={() => void handleAppLockToggle()}
                />
              </SettingsGroup>

              <SettingsGroup title={t('settings.support')}>
                <SettingsItem icon={<HelpCircle size={18} />} label={t('settings.helpCenter')} onClick={() => void handleOpenHelp()} />
                <SettingsItem icon={<Info size={18} />} label={t('settings.about')} onClick={() => setShowAboutModal(true)} />
              </SettingsGroup>
            </div>

            {/* Sign Out — 扁平文字按钮 */}
            <button onClick={logout} className="w-full py-4 flex items-center justify-center gap-2 text-red-600 font-bold hover:bg-red-50 rounded-2xl transition-colors active:scale-[0.99]">
              <LogOut size={20} />
              {t('settings.signOut')}
            </button>

            {/* 版本号跟随 package.json 的 version 字段 */}
            <p className="text-center text-[10px] text-on-surface-variant font-medium opacity-40">
              DuoDuo v{appVersion}
            </p>
          </>
        );
    }
  };

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

      {/* Help Center Modal — 点击展开正文 */}
      {showHelpModal && (
        <div className="fixed inset-0 z-[85] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface w-full max-w-md rounded-3xl p-6 space-y-4 max-h-[88vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg text-on-surface">{t('settings.helpCenter')}</h3>
              <button onClick={() => setShowHelpModal(false)} className="p-2 hover:bg-surface-container-high rounded-full transition-colors">
                <X size={20} className="text-on-surface-variant" />
              </button>
            </div>
            {auxLoading ? (
              <div className="py-8 flex justify-center text-on-surface-variant"><Loader2 size={20} className="animate-spin" /></div>
            ) : (
              <div className="space-y-3">
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
                  <p className="text-sm text-on-surface-variant">{t('settings.noHelpContent')}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* About Modal */}
      {showAboutModal && (
        <div className="fixed inset-0 z-[85] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface w-full max-w-sm rounded-3xl p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg text-on-surface">{t('settings.about')}</h3>
              <button onClick={() => setShowAboutModal(false)} className="p-2 hover:bg-surface-container-high rounded-full transition-colors">
                <X size={20} className="text-on-surface-variant" />
              </button>
            </div>
            <div className="flex flex-col items-center gap-2 py-3">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary text-2xl font-black">D</div>
              <p className="text-lg font-black tracking-tight text-on-surface">DuoDuo</p>
              <p className="text-xs text-on-surface-variant font-medium">v{appVersion}</p>
              <p className="text-xs text-on-surface-variant text-center">{t('settings.aboutDesc')}</p>
            </div>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="flex items-center justify-between bg-surface-container-low rounded-xl p-3 hover:bg-surface-container transition-colors"
            >
              <span className="flex items-center gap-3 text-sm font-semibold text-on-surface">
                <Mail size={16} className="text-on-surface-variant" />
                {t('settings.contactUs')}
              </span>
              <span className="text-xs text-primary font-medium">{CONTACT_EMAIL}</span>
            </a>
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
