import React from 'react';
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell, PieChart, Pie, CartesianGrid } from 'recharts';
import { TrendingUp, Lightbulb, Loader2, ChevronLeft, ChevronRight, ChevronDown, CalendarDays } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { api, StatsOverview, StatsTrendResponse } from '../lib/api';
import { getCurrencySymbol, FALLBACK_RATES } from '../lib/currencies';
import { useAuth } from '../lib/auth';

// 统计接口返回的分类值为存库英文/自定义名，展示时翻译默认分类
const translateCategory = (name: string, t: (k: string) => string): string => {
  const map: Record<string, string> = {
    Entertainment: 'cat.entertainment', Video: 'cat.video', AI: 'cat.ai',
    Development: 'cat.development', Electronics: 'cat.electronics',
    Productivity: 'cat.productivity', Software: 'cat.software',
    Lifestyle: 'cat.lifestyle', Finance: 'cat.finance'
  };
  const key = map[name];
  return key ? t(key) : name;
};

export default function Statistics() {
  const [timeRange, setTimeRange] = React.useState<'monthly' | 'annual'>('annual');
  const [stats, setStats] = React.useState<StatsOverview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const { t } = useI18n();
  const { user } = useAuth();
  const [rates, setRates] = React.useState<Record<string, number>>(FALLBACK_RATES);
  const displayCurrency = localStorage.getItem('display_currency') || 'USD';
  const currencySymbol = getCurrencySymbol(displayCurrency);
  // 优先用后端实时汇率（USD 基准，6 小时缓存），失败时保留静态兜底表
  React.useEffect(() => {
    api.getFxRates()
      .then((data) => setRates({ ...FALLBACK_RATES, ...data.rates }))
      .catch(() => {});
  }, []);
  // 统计接口的金额以 USD 为基准，展示时按首页选定的货币换算
  const convertFromUsd = (usd: number): number => {
    const rate = rates[displayCurrency] || 1;
    return usd * rate;
  };

  // ── V1.3.6 真实账单趋势：年 / 月 / 日自由选择 ─────────────────────────
  // 旧版只有"未来 12 个月预测"，月视图还截断成 6 个月（1-12 月只显示 4-9 月
  // 的由来）。现在由 /api/stats/trend 返回所选年份 12 个月、或所选月份每日的
  // 真实账单合计，支持左右滑动在相邻月 / 年之间平滑切换。
  const now = new Date();
  const [trendYear, setTrendYear] = React.useState(now.getFullYear());
  const [trendMonth, setTrendMonth] = React.useState(now.getMonth() + 1);
  const [trend, setTrend] = React.useState<StatsTrendResponse | null>(null);
  const [trendLoading, setTrendLoading] = React.useState(false);
  const [trendDirection, setTrendDirection] = React.useState(1); // 滑动方向，控制过渡动画
  const [yearPickerOpen, setYearPickerOpen] = React.useState(false);
  const [optimizationOpen, setOptimizationOpen] = React.useState(false);

  const loadTrend = React.useCallback(async (year: number, month: number | null) => {
    try {
      setTrendLoading(true);
      setTrend(await api.getStatsTrend(year, month ?? undefined));
    } catch {
      // 趋势加载失败不阻塞整页
    } finally {
      setTrendLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadTrend(trendYear, timeRange === 'monthly' ? trendMonth : null);
  }, [trendYear, trendMonth, timeRange, loadTrend]);

  // 切换到相邻月（保持年份进位）
  const gotoAdjacentMonth = (delta: number) => {
    setTrendDirection(delta);
    const next = new Date(trendYear, trendMonth - 1 + delta, 1);
    setTrendYear(next.getFullYear());
    setTrendMonth(next.getMonth() + 1);
  };
  const gotoAdjacentYear = (delta: number) => {
    setTrendDirection(delta);
    setTrendYear((y) => y + delta);
  };

  const loadStats = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getStatsOverview();
      setStats(data);
    } catch {
      setError(t('stats.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    void loadStats();
  }, []);

  // 图表数据：月视图 = 所选月每日账单；年视图 = 所选年 12 个月账单
  const chartData = React.useMemo(() => {
    if (!trend) return [];
    return timeRange === 'monthly' ? trend.days : trend.months;
  }, [trend, timeRange]);

  const rangeTotal = React.useMemo(
    () => chartData.reduce((acc, item) => acc + item.value, 0),
    [chartData]
  );

  // 触屏 / 鼠标左右滑动切换上/下一个（月或年）
  const swipeState = React.useRef<{ x: number; y: number } | null>(null);
  const onSwipeStart = (e: React.PointerEvent) => {
    swipeState.current = { x: e.clientX, y: e.clientY };
  };
  const onSwipeEnd = (e: React.PointerEvent) => {
    const start = swipeState.current;
    swipeState.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dy) > Math.abs(dx)) return; // 距离不够或竖向滚动，忽略
    const delta = dx < 0 ? 1 : -1; // 左滑 = 下一个
    if (timeRange === 'monthly') gotoAdjacentMonth(delta);
    else gotoAdjacentYear(delta);
  };

  const hasStatsData = Boolean(
    stats && (stats.trendData.length > 0 || stats.categoryBreakdown.length > 0 || stats.accountComparison.length > 0)
  );

  if (loading) {
    return (
      <div className="px-6 max-w-7xl mx-auto pb-10 h-72 flex items-center justify-center text-on-surface-variant">
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="px-6 max-w-4xl mx-auto pb-10">
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-600">
          {error || t('stats.noData')}
        </div>
      </div>
    );
  }

  if (!hasStatsData) {
    return (
      <div className="relative overflow-hidden px-6 max-w-4xl mx-auto pb-10">
        <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(to_right,rgba(0,84,205,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,84,205,0.08)_1px,transparent_1px)] [background-size:24px_24px]" />
        <div className="relative min-h-[32rem] rounded-2xl border border-outline-variant/20 bg-surface/75 px-6 py-20 text-center backdrop-blur-sm">
          <TrendingUp className="mx-auto text-primary/50" size={48} />
          <h2 className="mt-5 text-2xl font-bold">{t('stats.emptyTitle')}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-on-surface-variant">{t('stats.emptyDescription')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 max-w-7xl mx-auto space-y-8 pb-10">
      {/* Header Section */}
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-on-surface-variant font-medium tracking-wide text-sm uppercase">{t('stats.financialInsights')}</p>
          <h1 className="text-4xl font-extrabold tracking-tight mt-1">{t('stats.title')}</h1>
        </div>
      </section>

      {/* Main Analytics Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Expenditure Trend — V1.3.6：年/月/日自由选择 + 平滑滑动 */}
        <div className="md:col-span-8 bg-surface-container-lowest rounded-xl p-6 shadow-sm flex flex-col gap-4">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-lg font-bold text-on-surface">{t('stats.expenditureTrend')}</h3>
              <p className="text-sm text-on-surface-variant">{t('stats.trendSwipeHint')}</p>
            </div>
            <div className="text-right">
              <span className="text-2xl font-bold text-primary">
                {trendLoading ? '…' : `${currencySymbol}${convertFromUsd(rangeTotal).toFixed(2)}`}
              </span>
              <p className="text-xs text-on-surface-variant">
                {timeRange === 'monthly'
                  ? `${trendYear}${t('stats.yearUnit')} ${trendMonth}${t('stats.monthUnit')} · ${t('stats.rangeTotal')}`
                  : `${trendYear}${t('stats.yearUnit')} · ${t('stats.rangeTotal')}`}
              </p>
            </div>
          </div>

          {/* 年份导航 + 月/年模式切换 */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1 relative">
              <button
                onClick={() => gotoAdjacentYear(-1)}
                className="w-8 h-8 rounded-full bg-surface-container-low hover:bg-surface-container-high flex items-center justify-center active:scale-90 transition-all"
                aria-label="previous year"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setYearPickerOpen((v) => !v)}
                className="h-8 px-3 rounded-full bg-surface-container-low hover:bg-surface-container-high flex items-center gap-1.5 text-sm font-bold text-on-surface active:scale-95 transition-all"
              >
                <CalendarDays size={14} className="text-primary" />
                {trendYear}{t('stats.yearUnit')}
                <ChevronDown size={12} className={cn('transition-transform', yearPickerOpen && 'rotate-180')} />
              </button>
              <button
                onClick={() => gotoAdjacentYear(1)}
                className="w-8 h-8 rounded-full bg-surface-container-low hover:bg-surface-container-high flex items-center justify-center active:scale-90 transition-all"
                aria-label="next year"
              >
                <ChevronRight size={16} />
              </button>
              {yearPickerOpen && (
                <div className="absolute top-9 left-0 z-20 w-28 max-h-56 overflow-y-auto bg-surface-container-lowest rounded-xl shadow-xl border border-outline-variant/10 py-1">
                  {Array.from({ length: 12 }, (_, i) => now.getFullYear() + 1 - i).map((y) => (
                    <button
                      key={y}
                      onClick={() => { setTrendYear(y); setYearPickerOpen(false); }}
                      className={cn(
                        'w-full text-left px-3 py-2 text-sm font-semibold hover:bg-surface-container-low transition-colors',
                        y === trendYear ? 'text-primary' : 'text-on-surface'
                      )}
                    >
                      {y}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-1 bg-surface-container-low rounded-full p-1">
              <button
                onClick={() => setTimeRange('annual')}
                className={cn(
                  'px-4 py-1.5 rounded-full text-xs font-bold transition-all',
                  timeRange === 'annual' ? 'bg-primary text-white shadow-md shadow-primary/30' : 'text-on-surface-variant'
                )}
              >
                {t('stats.byYear')}
              </button>
              <button
                onClick={() => setTimeRange('monthly')}
                className={cn(
                  'px-4 py-1.5 rounded-full text-xs font-bold transition-all',
                  timeRange === 'monthly' ? 'bg-primary text-white shadow-md shadow-primary/30' : 'text-on-surface-variant'
                )}
              >
                {t('stats.byMonth')}
              </button>
            </div>
          </div>

          {/* 月份横滑选择条（月视图） */}
          {timeRange === 'monthly' && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar py-0.5 -mx-1 px-1">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                const isCurrent = m === trendMonth;
                const isNowMonth = trendYear === now.getFullYear() && m === now.getMonth() + 1;
                return (
                  <button
                    key={m}
                    onClick={() => { setTrendDirection(m > trendMonth ? 1 : -1); setTrendMonth(m); }}
                    className={cn(
                      'shrink-0 w-10 h-8 rounded-full text-xs font-bold transition-all active:scale-90',
                      isCurrent
                        ? 'bg-primary text-white shadow-md shadow-primary/30'
                        : isNowMonth
                          ? 'bg-primary/10 text-primary border border-primary/30'
                          : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'
                    )}
                  >
                    {m}{t('stats.monthUnit')}
                  </button>
                );
              })}
            </div>
          )}

          {/* 图表：左右滑动切换上/下一个月或年 */}
          <div
            className="h-64 w-full touch-pan-y select-none relative"
            onPointerDown={onSwipeStart}
            onPointerUp={onSwipeEnd}
            onPointerCancel={() => { swipeState.current = null; }}
          >
            {trendLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/40 backdrop-blur-[1px] rounded-lg">
                <Loader2 size={20} className="animate-spin text-primary" />
              </div>
            )}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${timeRange}-${trendYear}-${trendMonth}`}
                initial={{ x: trendDirection * 40, opacity: 0.4 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: trendDirection * -40, opacity: 0 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="h-full"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e3e6ef" />
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fill: '#414755' }}
                      dy={10}
                      interval={timeRange === 'monthly' && chartData.length > 20 ? 2 : 0}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {chartData.map((entry, index) => {
                        const isNow =
                          timeRange === 'monthly'
                            ? trendYear === now.getFullYear() && trendMonth === now.getMonth() + 1 && entry.label === String(now.getDate())
                            : trendYear === now.getFullYear() && entry.label === String(now.getMonth() + 1);
                        return (
                          <Cell
                            key={`cell-${index}`}
                            fill={isNow ? '#0054cd' : entry.forecast ? '#e8e8ed' : entry.value > 0 ? '#7ba7e8' : '#ededf2'}
                            stroke={entry.forecast ? '#c1c6d7' : 'none'}
                            strokeDasharray={entry.forecast ? '4 4' : '0'}
                          />
                        );
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Forecast Summary */}
        <div className="md:col-span-4 bg-primary rounded-xl p-6 text-white flex flex-col justify-between shadow-xl shadow-primary/20 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-3xl"></div>
          <div className="z-10">
            <TrendingUp size={32} className="mb-4" />
            <h3 className="text-xl font-bold leading-tight">{t('stats.futureForecast')}</h3>
            <p className="text-sm opacity-80 mt-2">
              {t('stats.nextCycleForecast')
                .replace('{amount}', `${currencySymbol}${convertFromUsd(stats.monthlyForecast).toFixed(2)}`)
                .replace('{count}', String(stats.activeSubscriptions))}
            </p>
          </div>
          <div className="z-10 mt-8 pt-6 border-t border-white/10">
            <div className="flex justify-between items-center mb-1">
              <span className="text-sm font-medium">{t('stats.monthlyBurnRate')}</span>
              <span className="font-bold">{stats.monthlyBurnRate > 0 ? '+' : ''}{stats.monthlyBurnRate}%</span>
            </div>
            <div className="w-full bg-white/20 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-white h-full"
                style={{ width: `${Math.min(100, Math.max(8, Math.abs(stats.monthlyBurnRate) * 5))}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="md:col-span-6 bg-surface-container-lowest rounded-xl p-6 shadow-sm">
          <h3 className="text-lg font-bold text-on-surface mb-6">{t('stats.categoryBreakdown')}</h3>
          {stats.categoryBreakdown.length === 0 ? (
            <div className="space-y-3">
              {/* 空态基准条：有基准线避免整块空白 */}
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-surface-container-high shrink-0"></div>
                <div className="flex-1 bg-surface-container-low h-3 rounded-full overflow-hidden">
                  <div className="h-full w-[4%] bg-surface-container-high rounded-full"></div>
                </div>
                <span className="text-xs text-on-surface-variant font-medium shrink-0">0%</span>
              </div>
              <p className="text-xs text-on-surface-variant pt-2">{t('stats.categoryEmptyHint')}</p>
            </div>
          ) : (
          <div className="flex items-center gap-8">
            <div className="relative w-40 h-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.categoryBreakdown}
                    innerRadius={50}
                    outerRadius={70}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {stats.categoryBreakdown.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex items-center justify-center flex-col">
                <span className="text-[10px] text-on-surface-variant block uppercase font-bold tracking-tighter">{t('stats.total')}</span>
                <span className="text-lg font-bold text-on-surface leading-none">{stats.categoryBreakdown.length}</span>
              </div>
            </div>
            <div className="flex-1 space-y-3">
              {stats.categoryBreakdown.map((item) => (
                <div key={item.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }}></div>
                    <span className="text-sm font-medium text-on-surface-variant">{translateCategory(item.name, t)}</span>
                  </div>
                  {/* V1.3.8：占比按订阅数量计算（服务端下发），并展示折算后的月均金额 */}
                  <span className="text-sm font-bold">
                    <span className="text-on-surface-variant font-medium">{currencySymbol}{convertFromUsd(item.amount || 0).toFixed(2)}</span>
                    <span className="ml-2">{item.value.toFixed(1)}%</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          )}
        </div>

        {/* Account Comparison */}
        <div className="md:col-span-6 bg-surface-container-lowest rounded-xl p-6 shadow-sm">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-on-surface">{t('stats.accountComparison')}</h3>
            <span className="text-xs text-on-surface-variant font-medium">{t('stats.perAccount')}</span>
          </div>
          <div className="space-y-6">
            {stats.accountComparison.length === 0 && (
              /* 空态基准条：显示当前登录账户 */
              <AccountProgress
                label={user?.name || user?.email || t('stats.currentAccount')}
                amount={0}
                percentage={4}
                color="bg-surface-container-high"
                initial={(user?.name || user?.email || 'U').charAt(0).toUpperCase()}
              />
            )}
            {stats.accountComparison.map((item, index) => (
              <div key={item.label}>
                <AccountProgress
                  label={item.label}
                  amount={convertFromUsd(item.amount)}
                  percentage={Math.max(5, item.percentage)}
                  color={['bg-indigo-500', 'bg-teal-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500'][index % 5]}
                  initial={item.initial}
                  symbol={currencySymbol}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Optimization Tip — V1.3.8：无可省金额时整卡隐藏；分类名翻译；查看详情页内展开 */}
        {(stats.optimization.category && stats.optimization.potentialSavings > 0 && (stats.optimization.items?.length ?? 0) > 0) && (
        <div className="md:col-span-12 bg-surface-container-low rounded-xl p-6 border border-outline-variant/10">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-white shadow-sm flex items-center justify-center text-primary shrink-0">
              <Lightbulb size={24} fill="currentColor" className="text-primary/20" />
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-on-surface">{t('stats.optimizationTip')}</h4>
              <p className="text-sm text-on-surface-variant mt-1 leading-relaxed">
                {t('stats.suggestedSavingsFor')}
                {' '}
                <span className="font-semibold">{translateCategory(stats.optimization.category, t)}</span>
                :
                {' '}
                <span className="text-primary font-bold">{currencySymbol}{convertFromUsd(stats.optimization.potentialSavings).toFixed(2)} {t('stats.perMonth')}</span>
              </p>
              {optimizationOpen && (
                <div className="mt-4 space-y-2 border-t border-outline-variant/15 pt-3">
                  {stats.optimization.items!.map((item) => (
                    <div key={item.name} className="flex justify-between text-sm">
                      <span className="text-on-surface-variant">{item.name}</span>
                      <span className="font-bold text-on-surface">{currencySymbol}{convertFromUsd(item.amount).toFixed(2)}{t('stats.perMonth')}</span>
                    </div>
                  ))}
                  <p className="text-xs text-on-surface-variant pt-1">{t('stats.optimizationDetailHint')}</p>
                </div>
              )}
            </div>
            <button onClick={() => setOptimizationOpen((v) => !v)}
                    className="text-primary font-bold text-sm px-4 py-2 hover:bg-white rounded-lg transition-colors whitespace-nowrap">
              {optimizationOpen ? t('stats.hideDetails') : t('stats.reviewDetails')}
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

function AccountProgress({ label, amount, percentage, color, initial, symbol = '$' }: { label: string, amount: number, percentage: number, color: string, initial: string, symbol?: string }) {
  const { t } = useI18n();

  return (
    <div>
      <div className="flex justify-between items-end mb-2">
        <div className="flex items-center gap-2">
          <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[10px] text-white font-bold", color)}>
            {initial}
          </div>
          <span className="text-sm font-semibold">{label}</span>
        </div>
        <span className="text-sm font-bold text-on-surface">{symbol}{amount}{t('account.perMonth')}</span>
      </div>
      <div className="w-full bg-surface-container-low h-3 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${percentage}%` }}></div>
      </div>
    </div>
  );
}
