import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Wallet, ArrowUpDown, User, ChevronDown, Search, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { api, AccountSummaryItem } from '../lib/api';
import { Subscription } from '../constants';

interface AccountViewProps {
  onBack: () => void;
}

export default function AccountView({ onBack }: AccountViewProps) {
  const [accounts, setAccounts] = useState<AccountSummaryItem[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getAccountSummary();
      setAccounts(data.accounts);
      setSubscriptions(data.subscriptions);
      if (data.accounts.length > 0) {
        setSelectedAccount(data.accounts[0].name);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load account summary');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const selectedAccountData = useMemo(
    () => accounts.find((item) => item.name === selectedAccount) || accounts[0],
    [accounts, selectedAccount]
  );

  const formatBillingDate = (value?: string | null) => {
    const text = String(value || '').trim();
    if (!text) return '--';
    if (text.includes('T')) return text.split('T')[0];
    if (text.length > 10) return text.slice(0, 10);
    return text;
  };

  const visibleSubscriptions = useMemo(() => {
    return subscriptions.filter((sub) => {
      if (selectedAccountData && (sub.account || 'Unassigned Account') !== selectedAccountData.name) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.trim().toLowerCase();
      return sub.name.toLowerCase().includes(q) || (sub.category || '').toLowerCase().includes(q);
    });
  }, [subscriptions, selectedAccountData, searchQuery]);

  return (
    <div className="fixed inset-0 z-50 bg-surface flex flex-col">
      <header className="safe-area-header fixed top-0 w-full z-50 glass-effect flex justify-between items-center px-6 py-4 border-b border-outline-variant/10">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-primary mr-1">
            <ArrowLeft size={24} />
          </button>
          <Wallet className="text-primary" size={24} />
          <h1 className="text-xl font-bold tracking-tight text-on-surface">All Subscriptions</h1>
        </div>
        <button className="hover:bg-surface-container-low p-2 rounded-full transition-colors active:scale-95">
          <ArrowUpDown className="text-on-surface-variant" size={24} />
        </button>
      </header>

      <main className="pt-24 px-6 w-full max-w-2xl mx-auto overflow-y-auto no-scrollbar pb-32 flex-1">
        {loading ? (
          <div className="h-60 flex items-center justify-center text-on-surface-variant">
            <Loader2 className="animate-spin" size={30} />
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-600 mb-6">{error}</div>
        ) : (
          <>
        <section className="mb-8">
          <label className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface-variant mb-3 block">Viewing Account</label>
          <div className="bg-surface-container-lowest rounded-xl p-4 flex items-center justify-between shadow-sm hover:bg-surface-container-low transition-colors group border border-outline-variant/10">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <User size={24} fill="currentColor" className="text-primary/20" />
              </div>
              <div className="min-w-0">
                <h2 className="font-bold text-on-surface leading-tight truncate">{selectedAccountData?.name || 'Unassigned Account'}</h2>
                <p className="text-sm text-on-surface-variant">{selectedAccountData?.subscriptionCount || 0} subscriptions</p>
              </div>
            </div>
            <div className="flex items-center gap-2 max-w-[45%]">
              <select
                value={selectedAccountData?.name || ''}
                onChange={(e) => setSelectedAccount(e.target.value)}
                className="bg-transparent text-sm font-medium text-on-surface outline-none max-w-[180px] truncate"
              >
                {accounts.map((account) => (
                  <option key={account.name} value={account.name}>
                    {account.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="text-outline-variant group-hover:text-primary transition-colors" size={20} />
            </div>
          </div>
        </section>

        <section className="mb-10">
          <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-primary to-primary-container p-8 text-white shadow-xl">
            <div className="absolute -top-12 -right-12 w-48 h-48 bg-white/10 rounded-full blur-3xl"></div>
            <div className="relative z-10">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <p className="text-white/70 text-xs font-semibold tracking-widest uppercase mb-1">Monthly Total</p>
                  <h3 className="text-4xl font-extrabold tracking-tight font-manrope">${(selectedAccountData?.monthlyTotal || 0).toFixed(2)}</h3>
                </div>
                <div
                  className="bg-white/15 backdrop-blur-md px-3 py-1 rounded-full text-[11px] font-bold max-w-[58%] truncate"
                  title={selectedAccountData?.nextPaymentDate || 'NO UPCOMING BILLING'}
                >
                  {selectedAccountData?.nextPaymentDate ? `NEXT: ${formatBillingDate(selectedAccountData.nextPaymentDate)}` : 'NO UPCOMING BILLING'}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-6 border-t border-white/10">
                <div>
                  <p className="text-white/60 text-[10px] font-bold uppercase tracking-wider mb-1">Subscriptions</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-bold">{selectedAccountData?.subscriptionCount || 0}</span>
                    <span className="bg-white/20 px-2 py-0.5 rounded text-[10px]">ACTIVE</span>
                  </div>
                </div>
                <div>
                  <p className="text-white/60 text-[10px] font-bold uppercase tracking-wider mb-1">Next Payment</p>
                  <p className="text-xl font-bold truncate">{formatBillingDate(selectedAccountData?.nextPaymentDate)}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mb-8">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant" size={20} />
            <input 
              className="w-full bg-surface-container-low border-none rounded-full py-4 pl-12 pr-6 text-sm focus:ring-2 focus:ring-primary/20 focus:bg-surface-container-lowest transition-all placeholder:text-on-surface-variant/60" 
              placeholder="Search apps in this account..." 
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex justify-between items-center px-2 mb-4">
            <h3 className="font-bold text-lg font-manrope">Subscription List</h3>
            <span className="text-xs text-on-surface-variant font-medium">{visibleSubscriptions.length} items</span>
          </div>

          {visibleSubscriptions.map((sub) => (
            <div key={sub.id} className="bg-surface-container-lowest rounded-xl p-5 flex items-center justify-between group hover:shadow-md transition-all border border-outline-variant/10">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-surface-container-low flex items-center justify-center overflow-hidden">
                  <img src={sub.icon} alt={sub.name} className="w-8 h-8 object-contain" referrerPolicy="no-referrer" />
                </div>
                <div>
                  <h4 className="font-bold text-on-surface">{sub.name}</h4>
                  <p className="text-xs text-on-surface-variant">{sub.billingCycle === 'monthly' ? 'Monthly' : 'Annual'} Plan</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-bold text-on-surface">${sub.price}</p>
                <span className={cn(
                  "inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold",
                  sub.status === 'urgent' ? "bg-red-50 text-red-600" : "bg-surface-container-low text-on-surface-variant"
                )}>
                  {sub.status === 'urgent' ? `Ends in ${sub.daysLeft} days` : `Renews ${sub.nextBillingDate}`}
                </span>
              </div>
            </div>
          ))}

          {visibleSubscriptions.length === 0 && (
            <div className="text-center text-sm text-on-surface-variant py-10">No subscriptions in this account.</div>
          )}
        </section>
          </>
        )}
      </main>
    </div>
  );
}
