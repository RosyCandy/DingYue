import React, { useEffect, useState } from 'react';
import { LayoutGrid, ReceiptText, BarChart3, Settings as SettingsIcon, Wallet, Plus } from 'lucide-react';
import { cn } from './lib/utils';
import Dashboard from './components/Dashboard';
import Subscriptions from './components/Subscriptions';
import Statistics from './components/Statistics';
import Settings from './components/Settings';
import AddSubscription from './components/AddSubscription';
import WalletModal from './components/WalletModal';
import { motion, AnimatePresence } from 'motion/react';
import { useI18n } from './lib/i18n';
import { useAuth } from './lib/auth';
import LoginPage from './components/LoginPage';
import { api, buildApiUrl } from './lib/api';
import { useTheme } from './lib/theme';
import { consumeSocialOAuthCallback, SOCIAL_LOGIN_ERROR_KEY } from './lib/socialAuth';
import { useAndroidBackButton } from './lib/backButton';

type Tab = 'dashboard' | 'subscriptions' | 'statistics' | 'settings';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const { t, setLanguage } = useI18n();
  const { setTheme } = useTheme();

  const { user, login, updateUser } = useAuth();

  // Android 物理返回键：弹窗已通过 useBackHandler 自行处理，
  // 这里兜底“返回仪表盘”，仪表盘再按一次才退出应用
  const activeTabRef = React.useRef(activeTab);
  activeTabRef.current = activeTab;
  useAndroidBackButton(
    () => activeTabRef.current,
    () => setActiveTab('dashboard')
  );

  useEffect(() => {
    // 微信 / QQ 网页版扫码登录会跳转离开应用再带 code 回来，在这里完成换 token
    const callback = consumeSocialOAuthCallback();
    if (!callback) return;
    void (async () => {
      try {
        const res = await fetch(buildApiUrl(`/auth/${callback.provider}`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: callback.code, redirectUri: `${window.location.origin}/` })
        });
        const data = await res.json();
        if (res.ok) {
          login(data.token, data.user);
        } else {
          sessionStorage.setItem(SOCIAL_LOGIN_ERROR_KEY, data.error || '第三方登录失败');
        }
      } catch {
        sessionStorage.setItem(SOCIAL_LOGIN_ERROR_KEY, '网络异常，第三方登录失败');
      } finally {
        window.history.replaceState({}, '', window.location.pathname);
      }
    })();
    // 仅在应用挂载时处理一次 OAuth 回调
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const loadSettings = async () => {
      try {
        const settings = await api.getUserSettings();
        if (!active) return;
        setTheme(settings.theme);
        setLanguage(settings.language);
      } catch {
        // ignore startup settings fetch failures
      }
      try {
        // 启动时同步一次最新资料，保证顶栏头像/昵称与服务器一致
        const profile = await api.getProfile();
        if (!active) return;
        updateUser({ name: profile.name, avatar: profile.avatar });
      } catch {
        // ignore profile fetch failures
      }
    };
    void loadSettings();
    return () => {
      active = false;
    };
  }, [setLanguage, setTheme, user?.id]);

  if (!user) return <LoginPage />;

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard onNavigate={setActiveTab} />;
      case 'subscriptions':
        return <Subscriptions />;
      case 'statistics':
        return <Statistics />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="min-h-screen bg-surface pb-32">
      {/* Top Header */}
      <header className="app-header fixed top-0 left-0 w-full z-50 h-16 bg-surface flex items-center justify-between px-6 border-b border-outline-variant/10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveTab('settings')}
            className="w-10 h-10 rounded-full overflow-hidden bg-primary-container/20 flex items-center justify-center shrink-0 text-primary font-bold"
            aria-label="Open profile settings"
          >
            {user.avatar ? (
              <img src={user.avatar} alt="" className="w-full h-full object-cover" />
            ) : (
              (user.name || user.email).trim().charAt(0).toUpperCase()
            )}
          </button>
          <div className="flex flex-col justify-center">
            <h1 className="text-lg font-bold tracking-tight text-on-surface leading-tight">
              {t(`header.${activeTab}.title`)}
            </h1>
            <p className="text-[10px] text-on-surface-variant font-medium leading-tight mt-0.5">
              {t(`header.${activeTab}.subtitle`)}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowWalletModal(true)}
          className="w-10 h-10 rounded-full bg-surface-container-low text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition-colors flex items-center justify-center"
          aria-label="Open wallet"
        >
          <Wallet size={18} />
        </button>
      </header>

      {/* Main Content */}
      <main className="app-main">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {renderContent()}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* FAB */}
      <button 
        onClick={() => setShowAddModal(true)}
        className="fixed bottom-28 right-6 w-14 h-14 rounded-full bg-gradient-to-br from-primary to-primary-container text-white shadow-2xl flex items-center justify-center hover:opacity-90 active:scale-90 transition-all z-40"
      >
        <Plus size={28} />
      </button>

      {/* Bottom Navigation */}
      <nav className="app-bottom-nav fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-4 pt-2 pb-8 bg-surface border-t border-outline-variant/10">
        <NavButton 
          active={activeTab === 'dashboard'} 
          onClick={() => setActiveTab('dashboard')}
          icon={<LayoutGrid size={24} />}
          label={t('nav.dashboard')}
        />
        <NavButton 
          active={activeTab === 'subscriptions'} 
          onClick={() => setActiveTab('subscriptions')}
          icon={<ReceiptText size={24} />}
          label={t('nav.subscriptions')}
        />
        <NavButton 
          active={activeTab === 'statistics'} 
          onClick={() => setActiveTab('statistics')}
          icon={<BarChart3 size={24} />}
          label={t('nav.statistics')}
        />
        <NavButton 
          active={activeTab === 'settings'} 
          onClick={() => setActiveTab('settings')}
          icon={<SettingsIcon size={24} />}
          label={t('nav.settings')}
        />
      </nav>

      {/* Add Subscription Modal */}
      <AnimatePresence>
        {showAddModal && (
          <AddSubscription onClose={() => setShowAddModal(false)} />
        )}
      </AnimatePresence>

      {/* Wallet Modal */}
      <AnimatePresence>
        {showWalletModal && (
          <WalletModal onClose={() => setShowWalletModal(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center px-4 py-1.5 transition-all active:scale-90",
        active ? "text-primary bg-primary/5 rounded-2xl" : "text-on-surface-variant opacity-60"
      )}
    >
      {icon}
      <span className="text-[10px] font-semibold tracking-wide uppercase mt-1">{label}</span>
    </button>
  );
}
