import React, { useState } from 'react';
import { Search, BarChart2, AlertCircle, Clock, XCircle, Filter, RefreshCw, ChevronRight, FileText, User, LayoutGrid, Calendar, Plus, Trash2, Users } from 'lucide-react';
import { api } from '../lib/api';
import { Subscription } from '../constants';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { useBackHandler } from '../lib/backButton';
import { useAuth } from '../lib/auth';
import AddSubscription from './AddSubscription';

type StatusFilter = 'all' | 'active' | 'urgent' | 'soon' | 'expired';

const CUSTOM_ACCOUNTS_KEY = 'custom_accounts';

export default function Subscriptions() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCycleDropdown, setShowCycleDropdown] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [editingSub, setEditingSub] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  // 账户筛选：默认登录邮箱，可添加其他账户
  const { user } = useAuth();
  const defaultAccount = user?.email || '';
  const [customAccounts, setCustomAccounts] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(CUSTOM_ACCOUNTS_KEY) || '[]'); } catch { return []; }
  });
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [newAccountName, setNewAccountName] = useState('');
  // 分类管理
  const [categories, setCategories] = useState<Array<{ id: number; name: string; color: string }>>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryBusy, setCategoryBusy] = useState(false);
  const { t } = useI18n();

  const account = selectedAccount || defaultAccount;

  // Android 返回键：编辑弹窗 > 各下拉 > 关闭
  useBackHandler(() => {
    if (editingSub) {
      setEditingSub(null);
      return;
    }
    if (showAccountDropdown) { setShowAccountDropdown(false); return; }
    if (showCategoryDropdown) { setShowCategoryDropdown(false); return; }
    if (showCycleDropdown || showStatusDropdown) {
      setShowCycleDropdown(false);
      setShowStatusDropdown(false);
    }
  });

  const fetchSubscriptions = async () => {
    try {
      setLoading(true);
      const data = await api.getSubscriptions();
      setSubscriptions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchSubscriptions();
  }, []);

  // 打开分类管理时加载自定义分类
  React.useEffect(() => {
    if (!showCategoryDropdown) return;
    let active = true;
    api.getCustomCategories().then((data) => {
      if (active) setCategories(data.map((c) => ({ id: c.id, name: c.name, color: c.color })));
    }).catch(() => {});
    return () => { active = false; };
  }, [showCategoryDropdown]);

  const handleAddAccount = () => {
    const name = newAccountName.trim();
    if (!name) return;
    const next = Array.from(new Set([...customAccounts, name]));
    setCustomAccounts(next);
    localStorage.setItem(CUSTOM_ACCOUNTS_KEY, JSON.stringify(next));
    setSelectedAccount(name);
    setNewAccountName('');
  };

  const handleAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!name || categoryBusy) return;
    setCategoryBusy(true);
    try {
      const created = await api.createCustomCategory({ name });
      setCategories((prev) => [{ id: created.id, name: created.name, color: created.color }, ...prev]);
      setNewCategoryName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create category');
    } finally {
      setCategoryBusy(false);
    }
  };

  const handleDeleteCategory = async (id: number) => {
    if (categoryBusy) return;
    setCategoryBusy(true);
    try {
      await api.deleteCustomCategory(id);
      setCategories((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete category');
    } finally {
      setCategoryBusy(false);
    }
  };

  const statusCounts = {
    all: subscriptions.length,
    active: subscriptions.filter((sub) => sub.status === 'normal' || sub.status === 'trial').length,
    urgent: subscriptions.filter((sub) => sub.status === 'urgent').length,
    soon: subscriptions.filter((sub) => sub.daysLeft !== undefined && sub.daysLeft > 7 && sub.daysLeft <= 30).length,
    expired: subscriptions.filter((sub) => sub.status === 'expired').length,
  };

  const filteredSubs = subscriptions.filter((sub) => {
    const matchesSearch = sub.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && (sub.status === 'normal' || sub.status === 'trial')) ||
      (statusFilter === 'urgent' && sub.status === 'urgent') ||
      (statusFilter === 'soon' && sub.daysLeft !== undefined && sub.daysLeft > 7 && sub.daysLeft <= 30) ||
      (statusFilter === 'expired' && sub.status === 'expired');
    // 未填写账户的订阅归入登录邮箱账户
    const subAccount = sub.account || defaultAccount;
    const matchesAccount = account === '__all__' || subAccount === account;
    return matchesSearch && matchesStatus && matchesAccount;
  });

  const accountOptions = Array.from(new Set([
    defaultAccount,
    ...customAccounts,
    ...subscriptions.map((sub) => sub.account).filter(Boolean),
  ])).filter(Boolean);

  return (
    <div className="px-4 max-w-2xl mx-auto space-y-6 pb-10">
      {/* Search and Global Actions */}
      <section className="space-y-4">
        <div className="relative flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" size={20} />
            <input 
              type="text"
              placeholder={t('subs.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-11 pr-4 py-3 bg-surface-container-low border-none rounded-2xl text-on-surface placeholder:text-on-surface-variant focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/20 transition-all outline-none text-sm"
            />
          </div>
          <button className="bg-primary text-white px-5 py-3 rounded-2xl text-sm font-bold shadow-sm hover:opacity-90 active:scale-95 transition-all">
            {t('subs.search')}
          </button>
        </div>

        {/* Stats Summary Cards */}
        <div className="grid grid-cols-4 gap-2">
          <StatCard active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} icon={<BarChart2 size={18} />} count={statusCounts.all} label={t('subs.total')} color="text-primary" bgColor="bg-primary/10" />
          <StatCard active={statusFilter === 'urgent'} onClick={() => setStatusFilter('urgent')} icon={<AlertCircle size={18} />} count={statusCounts.urgent} label={t('subs.urgent')} color="text-red-600" bgColor="bg-red-100" />
          <StatCard active={statusFilter === 'soon'} onClick={() => setStatusFilter('soon')} icon={<Clock size={18} />} count={statusCounts.soon} label={t('subs.soon')} color="text-orange-600" bgColor="bg-orange-100" />
          <StatCard active={statusFilter === 'expired'} onClick={() => setStatusFilter('expired')} icon={<XCircle size={18} />} count={statusCounts.expired} label={t('subs.expired')} color="text-gray-500" bgColor="bg-gray-100" />
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-2 relative">
          <div className="relative">
            <FilterButton 
              icon={<Filter size={14} />} 
              label={t('subs.allStatus')} 
              onClick={() => setShowStatusDropdown(!showStatusDropdown)}
            />
            {showStatusDropdown && (
              <div className="absolute top-full left-0 mt-2 w-40 bg-surface-container-lowest border border-outline-variant/10 rounded-xl shadow-xl z-50 p-2">
                <button className="w-full text-left px-3 py-2 hover:bg-surface-container-low rounded-lg text-sm">{t('subs.statusActive')}</button>
                <button className="w-full text-left px-3 py-2 hover:bg-surface-container-low rounded-lg text-sm">{t('subs.statusExpired')}</button>
                <button className="w-full text-left px-3 py-2 hover:bg-surface-container-low rounded-lg text-sm">{t('subs.statusTrial')}</button>
              </div>
            )}
          </div>

          {/* 账户下拉筛选：默认登录邮箱，可添加账户 */}
          <div className="relative">
            <FilterButton
              icon={<Users size={14} />}
              label={account === '__all__' ? t('subs.allAccounts') : account}
              onClick={() => { setShowAccountDropdown((v) => !v); setShowCategoryDropdown(false); }}
            />
            {showAccountDropdown && (
              <div className="absolute top-full left-0 mt-2 w-56 bg-surface-container-lowest border border-outline-variant/10 rounded-xl shadow-xl z-50 p-2">
                <button
                  onClick={() => { setSelectedAccount('__all__'); setShowAccountDropdown(false); }}
                  className="w-full text-left px-3 py-2 hover:bg-surface-container-low rounded-lg text-sm"
                >
                  {t('subs.allAccounts')}
                </button>
                {accountOptions.map((option) => (
                  <button
                    key={option}
                    onClick={() => { setSelectedAccount(option); setShowAccountDropdown(false); }}
                    className={cn(
                      "w-full text-left px-3 py-2 hover:bg-surface-container-low rounded-lg text-sm truncate",
                      option === account && "text-primary font-bold"
                    )}
                  >
                    {option}
                  </button>
                ))}
                <div className="border-t border-outline-variant/10 mt-1 pt-2 flex items-center gap-1 px-1">
                  <input
                    type="text"
                    value={newAccountName}
                    onChange={(e) => setNewAccountName(e.target.value)}
                    placeholder={t('subs.addAccount')}
                    className="flex-1 min-w-0 bg-surface-container-low rounded-lg px-2 py-1.5 text-xs outline-none"
                  />
                  <button
                    onClick={handleAddAccount}
                    disabled={!newAccountName.trim()}
                    className="p-1.5 text-primary disabled:opacity-40 active:scale-90 transition-transform"
                    aria-label={t('subs.addAccount')}
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 分类管理：下拉内新增 / 删除分类 */}
          <div className="relative">
            <FilterButton
              icon={<LayoutGrid size={14} />}
              label={t('subs.manageCategories')}
              onClick={() => { setShowCategoryDropdown((v) => !v); setShowAccountDropdown(false); }}
            />
            {showCategoryDropdown && (
              <div className="absolute top-full left-0 mt-2 w-56 bg-surface-container-lowest border border-outline-variant/10 rounded-xl shadow-xl z-50 p-2">
                <div className="max-h-48 overflow-y-auto">
                  {categories.map((category) => (
                    <div key={category.id} className="flex items-center justify-between px-3 py-2 hover:bg-surface-container-low rounded-lg text-sm">
                      <span className="flex items-center gap-2 truncate">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: category.color }} />
                        <span className="truncate">{category.name}</span>
                      </span>
                      <button
                        onClick={() => void handleDeleteCategory(category.id)}
                        disabled={categoryBusy}
                        className="text-on-surface-variant hover:text-red-500 disabled:opacity-40 shrink-0"
                        aria-label={`${t('settings.deleteAccount')}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  {categories.length === 0 && (
                    <p className="px-3 py-2 text-xs text-on-surface-variant">{t('settings.noData')}</p>
                  )}
                </div>
                <div className="border-t border-outline-variant/10 mt-1 pt-2 flex items-center gap-1 px-1">
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder={t('subs.categoryName')}
                    className="flex-1 min-w-0 bg-surface-container-low rounded-lg px-2 py-1.5 text-xs outline-none"
                  />
                  <button
                    onClick={() => void handleAddCategory()}
                    disabled={!newCategoryName.trim() || categoryBusy}
                    className="p-1.5 text-primary disabled:opacity-40 active:scale-90 transition-transform"
                    aria-label={t('subs.addCategory')}
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <FilterButton 
              icon={<Calendar size={14} />} 
              label={t('subs.billingCycle')} 
              onClick={() => setShowCycleDropdown(!showCycleDropdown)}
            />
            {showCycleDropdown && (
              <div className="absolute top-full left-0 mt-2 w-40 bg-surface-container-lowest border border-outline-variant/10 rounded-xl shadow-xl z-50 p-2">
                <button className="w-full text-left px-3 py-2 hover:bg-surface-container-low rounded-lg text-sm">{t('subs.monthly')}</button>
                <button className="w-full text-left px-3 py-2 hover:bg-surface-container-low rounded-lg text-sm">{t('subs.annual')}</button>
                <button className="w-full text-left px-3 py-2 hover:bg-surface-container-low rounded-lg text-sm">{t('subs.lifetime')}</button>
              </div>
            )}
          </div>

          <button onClick={() => { setStatusFilter('all'); setSearchQuery(''); }} className="flex items-center gap-1.5 px-4 py-2.5 ml-auto text-primary text-xs font-bold whitespace-nowrap">
            <RefreshCw size={14} />
            {t('subs.reset')}
          </button>
        </div>
      </section>

      {/* Subscription List */}
      <section className="space-y-4">
        {filteredSubs.map((sub) => (
          <div 
            key={sub.id} 
            onClick={() => setEditingSub(sub)}
            className="bg-surface-container-lowest rounded-2xl border border-outline-variant/10 overflow-hidden shadow-sm hover:shadow-md transition-all cursor-pointer"
          >
            <div className="p-4 space-y-3">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-surface-container-low shrink-0 flex items-center justify-center">
                    {sub.icon ? (
                        <img src={sub.icon} alt={sub.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                        <span className="text-xs font-bold text-primary uppercase">
                          {sub.name ? sub.name.charAt(0) : '?'}
                        </span>
                    )}
                  </div>
                  <div>
                    <h3 className="font-bold text-on-surface">{sub.name}</h3>
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className={cn(
                        "text-[10px] px-2 py-0.5 font-bold rounded-md uppercase",
                        sub.status === 'urgent' ? "bg-red-50 text-red-600" : 
                        sub.status === 'trial' ? "bg-blue-50 text-blue-600" : "bg-green-50 text-green-600"
                      )}>
                        {sub.status === 'urgent' ? t('subs.urgent') : sub.status === 'trial' ? t('subs.statusTrial') : t('subs.statusActive')}
                      </span>
                    </div>
                  </div>
                </div>
                <ChevronRight className="text-outline-variant" size={20} />
              </div>
              
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center gap-2 text-on-surface-variant">
                  <FileText size={16} />
                  <span className="text-xs font-medium">{sub.category} {t('subs.plan')}</span>
                </div>
                <div className="flex items-center gap-2 text-on-surface-variant">
                  <User size={16} />
                  <span className="text-xs font-medium">{sub.account} • {sub.region}</span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-lg mt-2 text-on-surface-variant">
                  <Clock size={16} />
                  <span className="text-xs font-medium">
                    {sub.nextBillingDate}
                    {sub.daysLeft && (
                      <span className={cn(
                        "ml-2 font-bold px-2 py-0.5 rounded-md",
                        sub.daysLeft <= 7 ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"
                      )}>
                        {t('subs.endsIn')} {sub.daysLeft} {t('subs.daysLower')}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>
            <div className="bg-surface-container-low/50 px-4 py-3 flex justify-between items-center border-t border-outline-variant/10">
              <span className="text-primary font-extrabold text-lg">${sub.price}</span>
              <span className="text-[10px] font-bold text-on-surface-variant/40 bg-surface-container-high w-5 h-5 flex items-center justify-center rounded">-</span>
            </div>
          </div>
        ))}
      </section>

      {editingSub && (
        <AddSubscription 
          onClose={() => setEditingSub(null)} 
          onSuccess={fetchSubscriptions}
          initialData={editingSub} 
        />
      )}
    </div>
  );
}

function StatCard({ icon, count, label, color, bgColor, active, onClick }: { icon: React.ReactNode, count: number, label: string, color: string, bgColor: string, active: boolean, onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn("bg-surface-container-lowest p-3 rounded-2xl border flex flex-col items-center justify-center text-center transition-all active:scale-95", active ? "border-primary/40 ring-2 ring-primary/10" : "border-outline-variant/10")}>
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center mb-1", bgColor, color)}>
        {icon}
      </div>
      <span className={cn("text-lg font-bold", color)}>{count}</span>
      <span className="text-[10px] text-on-surface-variant font-medium uppercase">{label}</span>
    </button>
  );
}

function FilterButton({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="flex items-center gap-1.5 px-4 py-2.5 bg-surface-container-lowest border border-outline-variant/20 rounded-2xl text-xs font-semibold text-on-surface whitespace-nowrap"
    >
      {icon}
      {label}
      <ChevronRight size={14} className="rotate-90 opacity-50" />
    </button>
  );
}

