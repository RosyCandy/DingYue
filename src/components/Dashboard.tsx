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

// 时间线里的分类显示翻译（存库值英文/自定义名；V1.3.6 修复恒等函数未翻译的问题）
const translateCategoryName = (name: string, t: (k: string) => string): string => {
  const key = CATEGORY_I18N[name];
  return key ? t(key) : name;
};

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

  const expiringSoon = subscriptions.filter(s => s.status === 'urgent' || s.status === 'soon');

  // V1.3.9 时间线：中轴线 + 双侧事件。左侧绿点 = 订阅开始（startDate），
  // 右侧红点 = 账单日/到期日（提醒），两侧卡片都写订阅名。
  // 周期由「订阅时间 → 下一个账单日」的间隔推导（与统计口径一致），
  // 往回展开 3 年内的历史账单日，往前展示最近两个未来账单日作提醒。
  const timeline = React.useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const origin = new Date(today);
    origin.setFullYear(origin.getFullYear() - 3);

    type TimelineEvent =
      | { date: Date; kind: 'today' }
      | { date: Date; kind: 'quarter' }
      | { date: Date; kind: 'start' | 'billing'; sub: (typeof subscriptions)[number] };
    const events: TimelineEvent[] = [];
    const dated: Array<{ date: Date; kind: 'start' | 'billing'; sub: (typeof subscriptions)[number] }> = [];

    const addDays = (d: Date, days: number): Date => {
      const x = new Date(d);
      x.setDate(x.getDate() + days);
      x.setHours(0, 0, 0, 0);
      return x;
    };
    const cycleDaysOf = (sub: (typeof subscriptions)[number]): number => {
      if (sub.startDate && sub.nextBillingDate) {
        const s = new Date(sub.startDate);
        const n = new Date(sub.nextBillingDate);
        if (!isNaN(s.getTime()) && !isNaN(n.getTime())) {
          const days = Math.round((n.getTime() - s.getTime()) / 86400000);
          if (days >= 7) return days;
        }
      }
      return sub.billingCycle === 'annually' ? 365 : 30;
    };

    for (const sub of subscriptions) {
      // 左侧绿点：订阅开始时间
      if (sub.startDate) {
        const start = new Date(sub.startDate);
        start.setHours(0, 0, 0, 0);
        if (!isNaN(start.getTime()) && start >= origin && start <= today) {
          dated.push({ date: start, kind: 'start', sub });
        }
      }
      // 右侧红点：账单日（周期展开）
      if (sub.nextBillingDate) {
        const nextRaw = new Date(sub.nextBillingDate);
        if (isNaN(nextRaw.getTime())) continue;
        const next = new Date(nextRaw);
        next.setHours(0, 0, 0, 0);
        const cycle = cycleDaysOf(sub);
        // 未来账单日（提醒）：最多展示两个
        let futureCount = 0;
        let f = new Date(next);
        while (f.getTime() >= origin.getTime() && futureCount < 2) {
          if (f.getTime() > today.getTime()) {
            dated.push({ date: new Date(f), kind: 'billing', sub });
            futureCount += 1;
          }
          f = addDays(f, cycle);
        }
        // 历史账单日
        let guard = 0;
        let p = new Date(next);
        while (p.getTime() >= origin.getTime() && guard < 60) {
          if (p.getTime() <= today.getTime()) {
            dated.push({ date: new Date(p), kind: 'billing', sub });
          }
          p = addDays(p, -cycle);
          guard += 1;
        }
      }
    }

    // 季度刻度：仅补位没有任何事件的季度
    let q = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
    while (q >= origin) {
      const quarterEnd = new Date(q.getFullYear(), q.getMonth() + 3, 1);
      const hasEvent = dated.some((e) => e.date >= q && e.date < quarterEnd);
      if (!hasEvent) events.push({ date: new Date(q), kind: 'quarter' });
      q = new Date(q.getFullYear(), q.getMonth() - 3, 1);
    }

    // 今天节点（居中置顶）
    events.push({ date: new Date(today), kind: 'today' });
    events.push(...dated);
    events.sort((a, b) => b.date.getTime() - a.date.getTime());
    return events;
  }, [subscriptions]);

  // 懒加载：初始渲染最近 30 个节点，滚动接近底部时追加更早的历史
  const [visibleCount, setVisibleCount] = React.useState(30);
  const visibleTimeline = timeline.slice(0, visibleCount);
  React.useEffect(() => {
    const onScroll = () => {
      const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 600;
      if (nearBottom) setVisibleCount((c) => Math.min(c + 30, timeline.length));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [timeline.length]);

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

      {/* Timeline — V1.3.9：中轴时间线，左绿点=订阅开始，右红点=账单日提醒，两侧写订阅名 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xl font-bold tracking-tight">{t('dashboard.timeline')}</h2>
          <div className="flex items-center gap-3 text-[11px] text-on-surface-variant font-medium">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              {t('dashboard.legendStart')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
              {t('dashboard.legendRenew')}
            </span>
          </div>
        </div>

        <div className="relative py-2">
          {/* 中轴 */}
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-outline-variant/25 -translate-x-1/2" />
          {visibleTimeline.map((event, index) => {
            const date = event.date;
            const dayLabel = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

            // 今天节点：居中
            if (event.kind === 'today') {
              return (
                <div key={`today-${index}`} className="relative flex items-center justify-center py-1.5">
                  <div className="absolute left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-primary border-2 border-surface shadow-sm z-10" />
                  <span className="bg-primary/10 text-primary text-xs font-bold px-3 py-1 rounded-full">{t('dashboard.today')}</span>
                </div>
              );
            }

            // 季度刻度：居中小灰点 + 年月
            if (event.kind === 'quarter') {
              return (
                <div key={`q-${date.getTime()}-${index}`} className="relative flex items-center justify-center py-1">
                  <div className="absolute left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-surface-container-high border-2 border-surface z-10" />
                  <span className="text-[11px] text-on-surface-variant/80 font-medium bg-surface px-2 rounded-full">
                    {date.getFullYear()}{t('dashboard.year')} {date.getMonth() + 1}{t('dashboard.month')}
                  </span>
                </div>
              );
            }

            const sub = event.sub;
            const isStart = event.kind === 'start';
            return (
              <div key={`${sub.id}-${event.kind}-${date.getTime()}-${index}`} className="relative flex items-center py-1.5">
                {/* 中轴上的圆点：绿=订阅开始，红=账单日提醒 */}
                <div
                  className={cn(
                    'absolute left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 border-surface shadow-sm z-10',
                    isStart ? 'bg-emerald-500' : 'bg-red-500'
                  )}
                />
                <div className={cn('w-[calc(50%-1.5rem)]', isStart ? 'mr-auto' : 'ml-auto')}>
                  <div className={cn(
                    'bg-surface-container-lowest border border-outline-variant/10 rounded-xl px-3 py-2 shadow-sm flex items-center gap-2',
                    isStart ? 'flex-row' : 'flex-row-reverse'
                  )}>
                    <div className="w-7 h-7 rounded-lg overflow-hidden bg-surface-container-low shrink-0 flex items-center justify-center">
                      {sub.icon ? (
                        <img src={resolveAssetUrl(sub.icon)} alt={sub.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="text-[10px] font-bold text-primary uppercase">{sub.name ? sub.name.charAt(0) : '?'}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-on-surface truncate">{sub.name}</h3>
                      <p className="text-[10px] text-on-surface-variant">
                        {dayLabel} · {isStart ? t('dashboard.legendStart') : t('dashboard.legendRenew')}
                      </p>
                    </div>
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
