import React, { useState, useEffect } from 'react';
import { TrendingUp, Tv, Edit3, Brush, CheckCircle2, Timer, ArrowRight, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { Subscription } from '../constants';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

export default function Dashboard({ onNavigate }: { onNavigate?: (tab: 'dashboard' | 'subscriptions' | 'statistics' | 'settings') => void }) {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useI18n();

  useEffect(() => {
    const fetchSubs = async () => {
      try {
        const data = await api.getSubscriptions();
        setSubscriptions(data);
      } catch (error) {
        console.error('Failed to fetch subscriptions', error);
      } finally {
        setLoading(false);
      }
    };
    fetchSubs();
  }, []);

  const expiringSoon = subscriptions.filter(s => s.status === 'urgent');

  // Calculate total monthly expenditure
  const totalMonthly = subscriptions.reduce((acc, sub: any) => {
    const price = Number(sub.price) || 0; // 强制转为数字
    const cycle = sub.billingCycle || sub.billing_cycle;
    return acc + (cycle === 'monthly' ? price : price / 12);
  }, 0);

  // Sort subscriptions by next billing date for the timeline
  const timelineSubscriptions = [...subscriptions].sort((a, b) => 
    new Date(a.nextBillingDate).getTime() - new Date(b.nextBillingDate).getTime()
  );

  const activeCount = subscriptions.length;
  const trialCount = subscriptions.filter(s => s.status === 'trial').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-primary" size={40} />
      </div>
    );
  }

  return (
    <div className="px-6 max-w-5xl mx-auto space-y-8 pb-10">
      {/* Expenditure Card */}
      <section>
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-primary to-primary-container p-8 text-white shadow-xl">
          <div className="flex flex-col gap-1">
            <span className="text-white/70 text-sm font-medium tracking-wide uppercase">{t('dashboard.totalBurn')}</span>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-extrabold tracking-tight">${totalMonthly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span className="text-lg text-white/80 font-medium">USD/{t('dashboard.month')}</span>
            </div>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-4 border-t border-white/10 pt-6">
            <div>
              <p className="text-white/60 text-[10px] uppercase tracking-widest font-bold">{t('dashboard.inLocalCurrency')}</p>
              <p className="text-lg font-bold">€{(totalMonthly * 0.92).toFixed(2)} / HK${(totalMonthly * 7.8).toFixed(2)}</p>
            </div>
            <div className="text-right">
              <p className="text-white/60 text-[10px] uppercase tracking-widest font-bold">{t('dashboard.annualCumulative')}</p>
              <p className="text-lg font-bold flex items-center justify-end gap-1">
                <TrendingUp size={16} />
                {t('dashboard.allTime')}
              </p>
            </div>
          </div>
          {/* Decorative Glass Element */}
          <div className="absolute -right-12 -top-12 w-48 h-48 bg-white/10 rounded-full blur-3xl"></div>
        </div>
      </section>

      {/* Expiring Soon */}
      <section className="space-y-4">
        <div className="flex justify-between items-end">
          <h2 className="text-xl font-bold tracking-tight px-1">{t('dashboard.expiringSoon')}</h2>
          <button 
            onClick={() => onNavigate?.('subscriptions')}
            className="text-primary text-sm font-bold flex items-center gap-1 hover:opacity-80 active:scale-95 transition-all"
          >
            {t('dashboard.seeAll')} <ArrowRight size={14} />
          </button>
        </div>
        <div className="flex overflow-x-auto no-scrollbar gap-4 -mx-6 px-6">
          {expiringSoon.map((sub) => (
            <div key={sub.id} className="flex-shrink-0 w-64 bg-surface-container-lowest p-5 rounded-xl shadow-sm border border-outline-variant/10">
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-lg bg-surface-container-low flex items-center justify-center">
                  <img src={sub.icon} alt={sub.name} className="w-6 h-6 object-contain" referrerPolicy="no-referrer" />
                </div>
                <span className="px-2.5 py-1 rounded-full bg-red-100 text-red-600 text-[10px] font-bold uppercase tracking-wider">
                  {t('dashboard.in')} {sub.daysLeft} {t('dashboard.days')}
                </span>
              </div>
              <h3 className="font-bold text-lg leading-tight">{sub.name}</h3>
              <p className="text-on-surface-variant text-sm mt-1">${sub.price} / {sub.billingCycle === 'monthly' ? t('dashboard.month') : t('dashboard.year')}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Summary Statistics Bento */}
      <section className="grid grid-cols-2 gap-4">
        <div className="bg-surface-container-low p-6 rounded-xl flex flex-col justify-between aspect-square">
          <div>
            <div className="w-10 h-10 bg-surface-container-lowest rounded-full flex items-center justify-center mb-4 text-primary">
              <CheckCircle2 size={24} fill="currentColor" className="text-primary/20" />
            </div>
            <h3 className="text-on-surface-variant text-sm font-semibold uppercase tracking-wider">{t('dashboard.activePaid')}</h3>
          </div>
          <div>
            <p className="text-3xl font-extrabold">{activeCount}</p>
            <p className="text-on-surface-variant text-xs mt-1">{t('dashboard.maintainedCommit')}</p>
          </div>
        </div>
        <div className="bg-surface-container-low p-6 rounded-xl flex flex-col justify-between aspect-square">
          <div>
            <div className="w-10 h-10 bg-surface-container-lowest rounded-full flex items-center justify-center mb-4 text-secondary">
              <Timer size={24} />
            </div>
            <h3 className="text-on-surface-variant text-sm font-semibold uppercase tracking-wider">{t('dashboard.freeTrials')}</h3>
          </div>
          <div>
            <p className="text-3xl font-extrabold text-secondary">{trialCount.toString().padStart(2, '0')}</p>
            <p className="text-on-surface-variant text-xs mt-1">{t('dashboard.dueForReview')}</p>
          </div>
        </div>
      </section>

      {/* Timeline View */}
      <section className="space-y-4">
        <div className="flex justify-between items-end">
          <h2 className="text-xl font-bold tracking-tight px-1">{t('dashboard.timeline')}</h2>
        </div>
        
        <div className="relative border-l-2 border-outline-variant/20 ml-2 space-y-4 py-2">
          {timelineSubscriptions.map((sub) => {
            const date = sub.nextBillingDate ? new Date(sub.nextBillingDate) : new Date();
            const month = date.toLocaleString('default', { month: 'short' });
            const day = date.getDate();
            
            return (
              <div key={sub.id} className="relative pl-4">
                {/* Timeline Dot */}
                <div className="absolute -left-[9px] top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary border-4 border-surface shadow-sm"></div>
                
                <div className="bg-surface-container-lowest rounded-2xl p-3 border border-outline-variant/10 shadow-sm flex items-center gap-3">
                  <div className="flex flex-col items-center justify-center w-10 shrink-0 bg-primary/5 rounded-xl py-1.5 text-primary">
                    <span className="text-[10px] font-bold uppercase">{month}</span>
                    <span className="text-base font-black leading-none">{day}</span>
                  </div>

                  <div className="w-8 h-8 rounded-full overflow-hidden bg-surface-container-low shrink-0 flex items-center justify-center">
                    {sub.icon ? (
                        <img src={sub.icon} alt={sub.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                        <span className="text-xs font-bold text-primary uppercase">
                          {sub.name ? sub.name.charAt(0) : '?'}
                        </span>
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-on-surface text-sm truncate">{sub.name}</h3>
                    <p className="text-[10px] text-on-surface-variant truncate">{sub.category}</p>
                  </div>
                  
                  <div className="text-right shrink-0">
                    <p className="font-bold text-on-surface text-sm">
                      {sub.currency === 'USD' ? '$' : '¥'}{(Number(sub.price) || 0).toFixed(2)}
                    </p>
                    <p className="text-[8px] text-on-surface-variant uppercase tracking-wider mt-0.5">
                      {sub.billingCycle === 'monthly' ? t('dashboard.month') : t('dashboard.year')}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
