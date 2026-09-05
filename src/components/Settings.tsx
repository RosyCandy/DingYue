import React, { useEffect, useState } from 'react';
import { User, Shield, Bell, Lock, HelpCircle, LogOut, ChevronRight, Star, RefreshCw, Palette, Languages, X, Check, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import Premium from './Premium';
import { Language, useI18n } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import NotificationCenter from './NotificationCenter';
import { useAuth } from '../lib/auth';
import { api, HelpArticle, Membership, SecurityOverview, UserSettings } from '../lib/api';

const languageOptions: Array<{ value: Language; label: string }> = [
  { value: 'English', label: 'English' },
  { value: '简体中文', label: '简体中文' },
  { value: '繁體中文', label: '繁體中文' },
  { value: 'Latin', label: 'Latin' },
  { value: '한국어', label: '한국어' },
];

export default function Settings() {
  const [showPremium, setShowPremium] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showLanguageSelect, setShowLanguageSelect] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [currentMembership, setCurrentMembership] = useState<Membership | null>(null);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [securityOverview, setSecurityOverview] = useState<SecurityOverview | null>(null);
  const [securityEmailInput, setSecurityEmailInput] = useState('');
  const [savingSecurityEmail, setSavingSecurityEmail] = useState(false);
  const [unlinkingGoogle, setUnlinkingGoogle] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [helpArticles, setHelpArticles] = useState<HelpArticle[]>([]);
  const [auxLoading, setAuxLoading] = useState(false);
  const { language, setLanguage, t } = useI18n();
  const { theme, setTheme } = useTheme();
  const { user, login, logout } = useAuth();

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
      const [data, membership] = await Promise.all([
        api.getUserSettings(),
        api.getCurrentMembership(),
      ]);
      setUserSettings(data);
      setCurrentMembership(membership);
      setLanguage(data.language);
      setTheme(data.theme);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setSettingsLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

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

  const handleOpenSecurity = async () => {
    try {
      setShowSecurityModal(true);
      setAuxLoading(true);
      const data = await api.getSecurityOverview();
      setSecurityOverview(data);
      setSecurityEmailInput(data.email);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to load security info');
    } finally {
      setAuxLoading(false);
    }
  };

  const handleUpdateSecurityEmail = async () => {
    const email = securityEmailInput.trim();
    if (!email || !email.includes('@')) {
      setSettingsError(t('premium.invalidEmail'));
      return;
    }

    try {
      setSavingSecurityEmail(true);
      setSettingsError(null);
      const session = await api.updateSecurityEmail(email);
      login(session.token, session.user);
      setSecurityOverview((prev) => (prev ? { ...prev, email: session.user.email } : prev));
      setSecurityEmailInput(session.user.email);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to update email');
    } finally {
      setSavingSecurityEmail(false);
    }
  };

  const handleUnlinkGoogle = async () => {
    if (!securityOverview?.googleLinked) return;
    if (!securityOverview.hasPassword) {
      setSettingsError(t('settings.needPasswordBeforeUnlink'));
      return;
    }
    if (!window.confirm(t('settings.confirmUnlinkGoogle'))) return;

    try {
      setUnlinkingGoogle(true);
      setSettingsError(null);
      const updated = await api.unlinkGoogleAccount();
      setSecurityOverview(updated);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to unlink Google account');
    } finally {
      setUnlinkingGoogle(false);
    }
  };

  const handleSetPassword = async () => {
    setSettingsError(null);
    if (newPasswordInput.length < 6) {
      setSettingsError(t('settings.passwordTooShort'));
      return;
    }
    if (securityOverview?.hasPassword && !currentPasswordInput) {
      setSettingsError(t('settings.currentPasswordRequired'));
      return;
    }

    try {
      setSavingPassword(true);
      const updated = await api.setSecurityPassword(newPasswordInput, currentPasswordInput || undefined);
      setSecurityOverview(updated);
      setCurrentPasswordInput('');
      setNewPasswordInput('');
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleClosePremium = async () => {
    setShowPremium(false);
    await loadMembership();
  };

  const handleOpenHelp = async () => {
    try {
      setShowHelpModal(true);
      setAuxLoading(true);
      const articles = await api.getHelpArticles();
      setHelpArticles(articles);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to load help center');
    } finally {
      setAuxLoading(false);
    }
  };

  if (showPremium) return <Premium onClose={() => void handleClosePremium()} />;

  return (
    <div className="px-6 max-w-2xl mx-auto space-y-8 pb-10">
      {settingsLoading && (
        <div className="bg-surface-container-lowest rounded-xl p-4 flex items-center justify-center text-on-surface-variant">
          <Loader2 size={18} className="animate-spin" />
        </div>
      )}

      {settingsError && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-sm text-red-600">
          {settingsError}
        </div>
      )}

      {/* Profile Section */}
      <section className="flex items-center gap-4 bg-surface-container-low p-6 rounded-2xl border border-outline-variant/10">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary border-2 border-white shadow-sm">
          <User size={32} fill="currentColor" className="text-primary/20" />
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-on-surface">{user?.name}</h2>
          <p className="text-sm text-on-surface-variant">{user?.email}</p>
        </div>
        <button className="p-2 hover:bg-surface-container-high rounded-full transition-colors">
          <ChevronRight className="text-outline-variant" size={20} />
        </button>
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
          <SettingsItem icon={<Shield size={18} />} label={t('settings.security')} onClick={() => void handleOpenSecurity()} />
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
        </SettingsGroup>
      </div>

      {/* Sign Out */}
      <button onClick={logout} className="w-full py-4 flex items-center justify-center gap-2 text-red-600 font-bold bg-red-50 rounded-2xl hover:bg-red-100 transition-colors active:scale-95">
        <LogOut size={20} />
        {t('settings.signOut')}
      </button>

      <p className="text-center text-[10px] text-on-surface-variant font-medium opacity-40">
        DuoDuo Version 2.4.0 (Build 102)
      </p>

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

      {showSecurityModal && (
        <div className="fixed inset-0 z-[85] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface w-full max-w-md rounded-3xl p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg text-on-surface">{t('settings.security')}</h3>
              <button onClick={() => setShowSecurityModal(false)} className="p-2 hover:bg-surface-container-high rounded-full transition-colors">
                <X size={20} className="text-on-surface-variant" />
              </button>
            </div>
            {auxLoading ? (
              <div className="py-8 flex justify-center text-on-surface-variant"><Loader2 size={20} className="animate-spin" /></div>
            ) : securityOverview ? (
              <div className="space-y-4 text-sm">
                <div className="space-y-2">
                  <p><span className="font-semibold">{t('settings.securityEmail')}:</span> {securityOverview.email}</p>
                  <p><span className="font-semibold">{t('settings.securityPassword')}:</span> {securityOverview.hasPassword ? t('settings.securitySet') : t('settings.securityNotSet')}</p>
                  <p><span className="font-semibold">{t('settings.securityGoogle')}:</span> {securityOverview.googleLinked ? t('settings.securityLinked') : t('settings.securityNotLinked')}</p>
                  <p><span className="font-semibold">{t('settings.securityCreated')}:</span> {new Date(securityOverview.accountCreatedAt).toLocaleDateString()}</p>
                </div>

                <div className="bg-surface-container-low rounded-xl p-3 space-y-3">
                  <label className="text-xs font-semibold text-on-surface-variant">{t('settings.securityEmail')}</label>
                  <input
                    type="email"
                    value={securityEmailInput}
                    onChange={(e) => setSecurityEmailInput(e.target.value)}
                    placeholder={t('settings.securityEmailPlaceholder')}
                    className="w-full bg-surface border border-outline-variant/20 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    onClick={() => void handleUpdateSecurityEmail()}
                    disabled={savingSecurityEmail}
                    className="w-full bg-primary text-white px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-70"
                  >
                    {savingSecurityEmail ? t('premium.processing') : t('settings.saveEmail')}
                  </button>

                  {securityOverview.googleLinked ? (
                    <>
                      <button
                        onClick={() => void handleUnlinkGoogle()}
                        disabled={unlinkingGoogle || !securityOverview.hasPassword}
                        className="w-full bg-red-50 text-red-600 px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-70"
                      >
                        {unlinkingGoogle ? t('premium.processing') : t('settings.unlinkGoogle')}
                      </button>
                      {!securityOverview.hasPassword && (
                        <p className="text-xs text-amber-600">{t('settings.needPasswordBeforeUnlink')}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-on-surface-variant">{t('settings.googleAlreadyUnlinked')}</p>
                  )}
                </div>

                <div className="bg-surface-container-low rounded-xl p-3 space-y-3">
                  <label className="text-xs font-semibold text-on-surface-variant">
                    {securityOverview.hasPassword ? t('settings.changePassword') : t('settings.setPassword')}
                  </label>
                  {securityOverview.hasPassword && (
                    <input
                      type="password"
                      value={currentPasswordInput}
                      onChange={(e) => setCurrentPasswordInput(e.target.value)}
                      placeholder={t('settings.currentPasswordPlaceholder')}
                      className="w-full bg-surface border border-outline-variant/20 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  )}
                  <input
                    type="password"
                    value={newPasswordInput}
                    onChange={(e) => setNewPasswordInput(e.target.value)}
                    placeholder={t('settings.newPasswordPlaceholder')}
                    className="w-full bg-surface border border-outline-variant/20 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    onClick={() => void handleSetPassword()}
                    disabled={savingPassword}
                    className="w-full bg-primary text-white px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-70"
                  >
                    {savingPassword ? t('premium.processing') : (securityOverview.hasPassword ? t('settings.changePassword') : t('settings.setPassword'))}
                  </button>
                </div>

                <div className="bg-surface-container-low rounded-xl p-3 space-y-1">
                  {securityOverview.recommendations.map((item) => (
                    <p key={item} className="text-xs text-on-surface-variant">• {item}</p>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-on-surface-variant">{t('settings.noData')}</p>
            )}
          </div>
        </div>
      )}

      {showHelpModal && (
        <div className="fixed inset-0 z-[85] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface w-full max-w-md rounded-3xl p-6 space-y-4">
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
                {helpArticles.map((article) => (
                  <div key={article.id} className="bg-surface-container-low rounded-xl p-3">
                    <p className="text-sm font-semibold text-on-surface">{article.title}</p>
                    <p className="text-xs text-on-surface-variant mt-1">{article.summary}</p>
                  </div>
                ))}
                {helpArticles.length === 0 && (
                  <p className="text-sm text-on-surface-variant">{t('settings.noHelpContent')}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="px-2 text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant/60">{title}</h3>
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/10 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function SettingsItem({ icon, label, value, onClick }: { icon: React.ReactNode, label: string, value?: string, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="w-full flex items-center justify-between p-4 hover:bg-surface-container-low transition-colors border-b border-outline-variant/5 last:border-0 group"
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

