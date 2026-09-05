import React, { useState } from 'react';
import { Search, BarChart2, AlertCircle, Clock, XCircle, Filter, RefreshCw, ChevronRight, FileText, User, LayoutGrid, Calendar } from 'lucide-react';
import { api } from '../lib/api';
import { Subscription } from '../constants';
import { cn } from '../lib/utils';
import AccountView from './AccountView';
import CategoryView from './CategoryView';
import { useI18n } from '../lib/i18n';
import AddSubscription from './AddSubscription';

type SubView = 'list' | 'account' | 'category';
type StatusFilter = 'all' | 'active' | 'urgent' | 'soon' | 'expired';

export default function Subscriptions() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState<SubView>('list');
  const [showCycleDropdown, setShowCycleDropdown] = useState(false);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [editingSub, setEditingSub] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const { t } = useI18n();

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
    return matchesSearch && matchesStatus;
  });

  if (view === 'account') return <AccountView onBack={() => setView('list')} />;
  if (view === 'category') return <CategoryView onBack={() => setView('list')} />;

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

          <button 
            onClick={() => setView('account')}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-surface-container-lowest border border-outline-variant/20 rounded-2xl text-xs font-semibold text-on-surface whitespace-nowrap"
          >
            <User size={14} /> {t('subs.accounts')}
          </button>

          <button 
            onClick={() => setView('category')}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-surface-container-lowest border border-outline-variant/20 rounded-2xl text-xs font-semibold text-on-surface whitespace-nowrap"
          >
            <LayoutGrid size={14} /> {t('subs.byCategory')}
          </button>

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

