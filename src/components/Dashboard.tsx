import React, { useState, useEffect, useRef } from 'react';
import { TrendingUp, CheckCircle2, Timer, ArrowRight, Loader2, ChevronDown, Search } from 'lucide-react';
import { api, resolveAssetUrl } from '../lib/api';
import { Subscription } from '../constants';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

// 统计/时间线里的分类显示翻译（存库值英文/自定义名）
const CATEGORY_I18N: Record<string, string> = {
  Entertainment: 'cat.entertainment', Video: 'cat.video', AI: 'cat.ai',
  Development: 'cat.development', Electronics: 'cat.electronics',
  Productivity: 'cat.productivity', Software: 'cat.software',
  Lifestyle: 'cat.lifestyle', Finance: 'cat.finance'
};
import { ACTIVE_CURRENCIES, getCurrencySymbol, FALLBACK_RATES, DEFAULT_CURRENCY } from '../lib/currencies';

const translateCategoryName = (name: string): string => name;

const CURRENCY_STORAGE_KEY = 'display_currency';

export default function Dashboard({ onNavigate }: { onNavigate?: (tab: 'dashboard' | 'subscriptions' | 'statistics' | 'settings') => void }) {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [rates, setRates] = useState<Record<string, number>>(FALLBACK_RATES);
  const [ratesLive, setRatesLive] = useState(false);
  const [displayCurrency, setDisplayCurrency] = useState<string>(() => localStorage.getItem(CURRENCY_STORAGE_KEY) || DEFAULT_CURRENCY);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');
  const { t } = useI18n();
  const translateCategoryName = (name: string): string => {
    const key = CATEGORY_I18N[name];
    return key ? t(key) : name;
  };
  const pickerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const fetchRates = async () => {
      try {
        const data = await api.getFxRates();
        if (data?.rates) {
          setRates({ ...FALLBACK_RATES, ...data.rates });
          setRatesLive(!data.stale);
        }
      } catch {
        // 实时汇率不可用时使用内置兜底汇率
      }
    };
    fetchRates();
  }, []);

  // 点击选择器外部时关闭
  useEffect(() => {
    if (!showCurrencyPicker) return;
    const handleClick = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setShowCurrencyPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showCurrencyPicker]);

  const selectCurrency = (code: string) => {
    setDisplayCurrency(code);
    localStorage.setItem(CURRENCY_STORAGE_KEY, code);
    setShowCurrencyPicker(false);
    setCurrencySearch('');
  };

  // 任意币种金额换算到目标币种（汇率均为对 USD 的比值）
  const convert = (price: number, fromCurrency: string, toCurrency: string): number => {
    const fromRate = rates[fromCurrency] || 1;
    const toRate = rates[toCurrency] || 1;
    return (price / fromRate) * toRate;
  };

  const totalMonthlyUsd = subscriptions.reduce((acc, sub: any) => {
    const price = Number(sub.price) || 0;
    const cycle = sub.billingCycle || sub.billing_cycle;
    const monthly = cycle === 'monthly' ? price : price / 12;
    return acc + convert(monthly, sub.currency || 'USD', 'USD');
  }, 0);
  const totalMonthlyDisplay = convert(totalMonthlyUsd, 'USD', displayCurrency);
  const currencySymbol = getCurrencySymbol(displayCurrency);

  const expiringSoon = subscriptions.filter(s => s.status === 'urgent');

  // 时间线：始终从今天延伸 3 年。订阅按周期展开成未来账单日（精确到日），
  // 没有订阅账单的季度以季度刻度补位（精确到月），保证时间轴连续不空白。
  const timeline = React.useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setFullYear(horizon.getFullYear() + 3);

    type TimelineEvent = { date: Date; sub?: (typeof subscriptions)[number]; quarter?: boolean };
    const events: TimelineEvent[] = [];

    // 1) 订阅账单日按周期展开
    const subEvents: Array<{ date: Date; sub: (typeof subscriptions)[number] }> = [];
    for (const sub of subscriptions) {
      if (sub.status === 'expired') continue;
      if (!sub.nextBillingDate) continue;
      let d = new Date(sub.nextBillingDate);
      if (isNaN(d.getTime())) continue;
      d.setHours(0, 0, 0, 0);
      let guard = 0;
      while (d <= horizon && guard < 60) {
        if (d >= today) subEvents.push({ date: new Date(d), sub });
        d = new Date(d);
        if ((sub.billingCycle || 'monthly') === 'annually') d.setFullYear(d.getFullYear() + 1);
        else d.setMonth(d.getMonth() + 1);
        guard += 1;
      }
    }

    // 2) 季度刻度：仅补位没有订阅事件的季度
    const quarterStarts: Date[] = [];
    let q = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3 + 3, 1);
    while (q <= horizon) {
      quarterStarts.push(new Date(q));
      q = new Date(q.getFullYear(), q.getMonth() + 3, 1);
    }
    for (const qs of quarterStarts) {
      const quarterEnd = new Date(qs.getFullYear(), qs.getMonth() + 3, 1);
      const hasSubEvent = subEvents.some((e) => e.date >= qs && e.date < quarterEnd);
      if (!hasSubEvent) events.push({ date: qs, quarter: true });
    }

    // 3) 今天节点（始终最上）
    events.push({ date: new Date(today), quarter: false, sub: undefined });

    // 4) 订阅事件加入并整体排序；同一天的多个订阅按添加顺序（数组原序）
    events.push(...subEvents.map((e) => ({ date: e.date, sub: e.sub })));
    events.sort((a, b) => a.date.getTime() - b.date.getTime());
    return events;
  }, [subscriptions]);

  const activePaidSubs = subscriptions.filter(s => s.status !== 'trial');
  const trialSubs = subscriptions.filter(s => s.status === 'trial');

  const filteredCurrencies = ACTIVE_CURRENCIES.filter((c) => {
    const query = currencySearch.trim().toLowerCase();
    if (!query) return true;
    return c.code.toLowerCase().includes(query) || c.name.toLowerCase().includes(query);
  });

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
          <div className="flex items-start justify-between gap-3">
            <span className="text-white/70 text-sm font-medium tracking-wide uppercase">{t('dashboard.totalBurn')}</span>
            {/* 货币切换器 */}
            <div className="relative" ref={pickerRef}>
              <button
                onClick={() => setShowCurrencyPicker((v) => !v)}
                className="flex items-center gap-1 bg-white/15 hover:bg-white/25 rounded-full px-3 py-1.5 text-xs font-bold active:scale-95 transition-all"
              >
                {displayCurrency}
                <ChevronDown size={12} />
              </button>
              {showCurrencyPicker && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-surface text-on-surface rounded-2xl shadow-2xl border border-outline-variant/10 overflow-hidden z-50">
                  <div className="p-2 border-b border-outline-variant/10">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" size={14} />
                      <input
                        autoFocus
                        type="text"
                        value={currencySearch}
                        onChange={(e) => setCurrencySearch(e.target.value)}
                        placeholder={t('dashboard.searchCurrency')}
                        className="w-full pl-8 pr-3 py-2 bg-surface-container-low rounded-lg text-xs outline-none"
                      />
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {filteredCurrencies.map((currency) => (
                      <button
                        key={currency.code}
                        onClick={() => selectCurrency(currency.code)}
                        className={cn(
                          'w-full flex items-center justify-between px-3 py-2 text-left text-xs hover:bg-surface-container-low transition-colors',
                          currency.code === displayCurrency && 'text-primary font-bold'
                        )}
                      >
                        <span className="font-bold">{currency.code}</span>
                        <span className="text-on-surface-variant truncate ml-2 flex-1 text-right">{currency.name}</span>
                      </button>
                    ))}
                    {filteredCurrencies.length === 0 && (
                      <p className="px-3 py-4 text-xs text-on-surface-variant text-center">{t('dashboard.noCurrency')}</p>
                    )}
                  </div>
                  <p className="px-3 py-2 text-[10px] text-on-surface-variant border-t border-outline-variant/10">
                    {ratesLive ? t('dashboard.liveRates') : t('dashboard.fallbackRates')}
                  </p>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1 mt-1">
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-extrabold tracking-tight">
                {currencySymbol}{totalMonthlyDisplay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-lg text-white/80 font-medium">{displayCurrency}/{t('dashboard.month')}</span>
            </div>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-4 border-t border-white/10 pt-6">
            <div>
              <p className="text-white/60 text-[10px] uppercase tracking-widest font-bold">{t('dashboard.usdTotal')}</p>
              <p className="text-lg font-bold">${totalMonthlyUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="text-right">
              <p className="text-white/60 text-[10px] uppercase tracking-widest font-bold">{t('dashboard.annualCumulative')}</p>
              <p className="text-lg font-bold flex items-center justify-end gap-1">
                <TrendingUp size={16} />
                {currencySymbol}{(totalMonthlyDisplay * 12).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </p>
            </div>
          </div>
          {/* Decorative Glass Element */}
          <div className="absolute -right-12 -top-12 w-48 h-48 bg-white/10 rounded-full blur-3xl pointer-events-none"></div>
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
                  <img src={resolveAssetUrl(sub.icon)} alt={sub.name} className="w-6 h-6 object-contain" referrerPolicy="no-referrer" />
                </div>
                <span className="px-2.5 py-1 rounded-full bg-red-100 text-red-600 text-[10px] font-bold uppercase tracking-wider">
                  {t('dashboard.in')} {sub.daysLeft} {t('dashboard.days')}
                </span>
              </div>
              <h3 className="font-bold text-lg leading-tight">{sub.name}</h3>
              <p className="text-on-surface-variant text-sm mt-1">{getCurrencySymbol(sub.currency)}{sub.price} / {sub.billingCycle === 'monthly' ? t('dashboard.month') : t('dashboard.year')}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Summary — 高度随内容自适应 */}
      <section className="grid grid-cols-2 gap-4">
        <SummaryCard
          icon={<CheckCircle2 size={24} fill="currentColor" className="text-primary/20" />}
          iconColor="text-primary"
          title={t('dashboard.activePaid')}
          count={activePaidSubs.length}
          countColor="text-on-surface"
          footerText={t('dashboard.maintainedCommit')}
          items={activePaidSubs}
        />
        <SummaryCard
          icon={<Timer size={24} />}
          iconColor="text-secondary"
          title={t('dashboard.freeTrials')}
          count={trialSubs.length}
          countColor="text-secondary"
          footerText={t('dashboard.dueForReview')}
          items={trialSubs}
        />
      </section>

      {/* Timeline View */}
      <section className="space-y-4">
        <div className="flex justify-between items-end">
          <h2 className="text-xl font-bold tracking-tight px-1">{t('dashboard.timeline')}</h2>
        </div>

        <div className="relative border-l-2 border-outline-variant/20 ml-2 space-y-4 py-2">
          {timeline.map((event, index) => {
            const date = event.date;
            const month = date.toLocaleString('default', { month: 'short' });
            const day = date.getDate();
            const yearLabel = date.getFullYear();
            const isToday = index === 0;

            // 季度刻度节点：小灰点 + 月份标签
            if (event.quarter) {
              return (
                <div key={`q-${date.getTime()}-${index}`} className="relative pl-4">
                  <div className="absolute -left-[7px] top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-surface-container-high border-2 border-surface"></div>
                  <div className="py-1.5 text-sm text-on-surface-variant font-medium">
                    {yearLabel}{t('dashboard.year')} {date.getMonth() + 1}{t('dashboard.month')}
                  </div>
                </div>
              );
            }

            // 订阅事件节点：账单卡（同一天多个订阅按添加顺序依次排列）
            if (event.sub) {
              const sub = event.sub;
              return (
                <div key={`${sub.id}-${date.getTime()}-${index}`} className="relative pl-4">
                  <div className="absolute -left-[9px] top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary border-4 border-surface shadow-sm"></div>

                  <div className="bg-surface-container-lowest rounded-2xl p-3 border border-outline-variant/10 shadow-sm flex items-center gap-3">
                    <div className="flex flex-col items-center justify-center w-10 shrink-0 bg-primary/5 rounded-xl py-1.5 text-primary">
                      <span className="text-[10px] font-bold uppercase">{month}</span>
                      <span className="text-base font-black leading-none">{day}</span>
                    </div>

                    <div className="w-8 h-8 rounded-full overflow-hidden bg-surface-container-low shrink-0 flex items-center justify-center">
                      {sub.icon ? (
                          <img src={resolveAssetUrl(sub.icon)} alt={sub.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                          <span className="text-xs font-bold text-primary uppercase">
                            {sub.name ? sub.name.charAt(0) : '?'}
                          </span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-on-surface text-sm truncate">{sub.name}</h3>
                      <p className="text-[10px] text-on-surface-variant truncate">
                        {translateCategoryName(sub.category)} · {isToday ? t('dashboard.today') : yearLabel}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="font-bold text-on-surface text-sm">
                        {(Number(sub.price) || 0) > 0
                          ? `${getCurrencySymbol(sub.currency)}${(Number(sub.price) || 0).toFixed(2)}`
                          : t('dashboard.free')}
                      </p>
                      <p className="text-[8px] text-on-surface-variant uppercase tracking-wider mt-0.5">
                        {sub.billingCycle === 'monthly' ? t('dashboard.month') : t('dashboard.year')}
                      </p>
                    </div>
                  </div>
                </div>
              );
            }

            // 今天节点
            return (
              <div key={`today-${index}`} className="relative pl-4">
                <div className="absolute -left-[9px] top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary border-4 border-surface shadow-sm"></div>
                <div className="bg-primary/5 rounded-2xl p-3 flex items-center gap-3">
                  <div className="flex flex-col items-center justify-center w-10 shrink-0 bg-primary/10 rounded-xl py-1.5 text-primary">
                    <span className="text-[10px] font-bold uppercase">{month}</span>
                    <span className="text-base font-black leading-none">{day}</span>
                  </div>
                  <span className="text-sm font-bold text-primary">{t('dashboard.today')}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  icon, iconColor, title, count, countColor, footerText, items,
}: {
  icon: React.ReactNode;
  iconColor: string;
  title: string;
  count: number;
  countColor: string;
  footerText: string;
  items: Subscription[];
}) {
  const { t } = useI18n();
  return (
    <div className="bg-surface-container-low p-5 rounded-xl self-start w-full">
      <div className="flex items-center gap-2.5 mb-1">
        <div className={cn('w-9 h-9 rounded-full flex items-center justify-center shrink-0', iconColor)}>
          {icon}
        </div>
        <h3 className="text-on-surface-variant text-xs font-semibold uppercase tracking-wider flex-1">{title}</h3>
      </div>
      <p className={cn('text-3xl font-extrabold', countColor)}>{count}</p>
      <p className="text-on-surface-variant text-[11px] mt-0.5">{footerText}</p>
      {items.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-outline-variant/10 pt-3">
          {items.map((sub) => (
            <li key={sub.id} className="flex items-center justify-between text-xs gap-2">
              <span className="text-on-surface font-medium truncate">{sub.name}</span>
              <span className="text-on-surface-variant shrink-0">
                {getCurrencySymbol(sub.currency)}{(Number(sub.price) || 0).toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
