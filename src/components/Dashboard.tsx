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

  // V1.3.11 时间线：超长跨度（2016-01 → 2036-12）+ 只亮关键点。
  // 每个订阅只画两处：绿点 = 订阅开始（startDate），红点 = 下一个账单日及其
  // 未来周期投影（提醒用）。历史账单日不再逐年点亮（V1.3.11 用户反馈：
  // 25 年创建的订阅没必要把之前每年 9/28 都点亮）。
  // 同一天既是某订阅的开始又是另一订阅的账单日 → 点对半双色（左绿右红）。
  // 容器内滚动：默认把「今天」滚到头顶，往上滑看到 2036，往下滑回到 2016。
  const TIMELINE_START = React.useMemo(() => new Date(2016, 0, 1), []);
  const TIMELINE_END = React.useMemo(() => new Date(2036, 11, 31), []);

  const timeline = React.useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dayKey = (d: Date): string =>
      `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

    // 1) 收集事件并按日期分组
    const groups = new Map<string, { date: Date; starts: Subscription[]; billings: Subscription[] }>();
    const add = (date: Date, kind: 'start' | 'billing', sub: Subscription) => {
      if (date < TIMELINE_START || date > TIMELINE_END) return;
      const key = dayKey(date);
      const group = groups.get(key) || { date: new Date(date), starts: [], billings: [] };
      (kind === 'start' ? group.starts : group.billings).push(sub);
      groups.set(key, group);
    };

    for (const sub of subscriptions) {
      if (sub.startDate) {
        const start = new Date(sub.startDate);
        start.setHours(0, 0, 0, 0);
        if (!isNaN(start.getTime())) add(start, 'start', sub);
      }
      if (sub.nextBillingDate) {
        const next = new Date(sub.nextBillingDate);
        next.setHours(0, 0, 0, 0);
        if (isNaN(next.getTime())) continue;
        // V1.3.12：只画用户真实录入的下一个账单日——
        // ① 过期（账单日已过）订阅不画续订点；② 不做未来周期投影，
        // 否则会凭空捏造出 2036 年的「续订」（V1.3.11 用户反馈的幽灵订阅）
        if (next.getTime() < today.getTime()) continue;
        add(next, 'billing', sub);
      }
    }

    // 2) 季度刻度：只补位完全没有任何事件的季度
    const rows: Array<
      | { kind: 'quarter'; date: Date }
      | { kind: 'today'; date: Date }
      | { kind: 'events'; date: Date; starts: Subscription[]; billings: Subscription[] }
    > = [];
    let q = new Date(TIMELINE_END.getFullYear(), Math.floor(TIMELINE_END.getMonth() / 3) * 3, 1);
    while (q >= TIMELINE_START) {
      const quarterEnd = new Date(q.getFullYear(), q.getMonth() + 3, 1);
      const hasEvent = Array.from(groups.values()).some((g) => g.date >= q && g.date < quarterEnd);
      if (!hasEvent) rows.push({ kind: 'quarter', date: new Date(q) });
      q = new Date(q.getFullYear(), q.getMonth() - 3, 1);
    }
    // 3) 今天 + 事件行，整体倒序（新在上）
    rows.push({ kind: 'today', date: new Date(today) });
    Array.from(groups.values())
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .forEach((g) => rows.push({ kind: 'events', date: g.date, starts: g.starts, billings: g.billings }));
    rows.sort((a, b) => b.date.getTime() - a.date.getTime());
    return rows;
  }, [subscriptions, TIMELINE_START, TIMELINE_END]);

  // 容器内滚动定位：挂载/数据变化后把「今天」滚到容器顶部
  // （todayRow 的 offsetParent 就是滚动容器本身，offsetTop 已是容器内坐标）
  const timelineScrollRef = React.useRef<HTMLDivElement>(null);
  const todayRowRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const container = timelineScrollRef.current;
    const today = todayRowRef.current;
    if (!container || !today) return;
    container.scrollTop = Math.max(0, today.offsetTop - 8);
  }, [timeline]);

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

      {/* Timeline — V1.3.11：2016→2036 超长跨度，容器内滚动，默认「今天」在头顶。
          绿点=订阅开始，红点=账单日提醒（含未来周期投影），同一天既是开始又是
          账单日→左绿右红对半双色点；两侧卡片写订阅名，日期为纯数字。 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1 flex-wrap gap-y-1">
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
            <span className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{ background: 'linear-gradient(90deg, #10b981 50%, #ef4444 50%)' }}
              />
              {t('dashboard.legendBoth')}
            </span>
          </div>
        </div>

        <div
          ref={timelineScrollRef}
          className="relative max-h-[32rem] overflow-y-auto no-scrollbar rounded-2xl border border-outline-variant/10 bg-surface-container-lowest/60 p-3"
        >
          {/* 中轴 */}
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-outline-variant/25 -translate-x-1/2" />
          {timeline.map((event, index) => {
            const date = event.date;
            // 纯数字日期（M/D，跨年带年份）——任何语言都无歧义
            const dayLabel = date.getFullYear() === new Date().getFullYear()
              ? `${date.getMonth() + 1}/${date.getDate()}`
              : `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;

            // 今天节点：只有气泡本身骑在中轴上
            if (event.kind === 'today') {
              return (
                <div key={`today-${index}`} ref={todayRowRef} className="relative flex items-center justify-center py-2">
                  <span className="relative z-10 bg-primary/10 border border-primary/25 text-primary text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                    {t('dashboard.today')}
                  </span>
                </div>
              );
            }

            // 季度刻度：无订阅事件的占位点，灰点 + 日期在点的右边
            if (event.kind === 'quarter') {
              return (
                <div key={`q-${date.getTime()}-${index}`} className="relative flex items-center py-3">
                  <div className="absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-outline-variant/80 border-2 border-surface z-10" />
                  <span className="ml-[calc(50%+1.25rem)] text-[11px] text-on-surface-variant/80 font-medium whitespace-nowrap">
                    {date.getFullYear()}{t('dashboard.year')} {date.getMonth() + 1}{t('dashboard.month')}
                  </span>
                </div>
              );
            }

            const { starts, billings } = event;
            const dotColor = starts.length && billings.length
              ? 'linear-gradient(90deg, #10b981 50%, #ef4444 50%)'
              : starts.length ? '#10b981' : '#ef4444';

            const renderCard = (sub: Subscription, kind: 'start' | 'billing') => (
              <div
                key={`${sub.id}-${kind}`}
                className={cn(
                  'bg-surface border border-outline-variant/10 rounded-xl px-3 py-2 shadow-sm flex items-center gap-2',
                  kind === 'start' ? 'flex-row' : 'flex-row-reverse'
                )}
              >
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
                    {dayLabel} · {kind === 'start' ? t('dashboard.legendStart') : t('dashboard.legendRenew')}
                  </p>
                </div>
              </div>
            );

            return (
              <div key={`e-${dayLabel}-${date.getFullYear()}-${index}`} className="relative flex items-center py-1.5">
                {/* 中轴圆点：绿=开始，红=账单日，双色=两者同日 */}
                <div
                  className="absolute left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 border-surface shadow-sm z-10"
                  style={{ background: dotColor }}
                />
                <div className="w-[calc(50%-1.5rem)] mr-auto space-y-2">
                  {starts.map((sub) => renderCard(sub, 'start'))}
                </div>
                <div className="w-[calc(50%-1.5rem)] ml-auto space-y-2">
                  {billings.map((sub) => renderCard(sub, 'billing'))}
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
