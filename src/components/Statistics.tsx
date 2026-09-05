import React from 'react';
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import { TrendingUp, Lightbulb, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { api, StatsOverview } from '../lib/api';

export default function Statistics() {
  const [timeRange, setTimeRange] = React.useState<'monthly' | 'annual'>('annual');
  const [stats, setStats] = React.useState<StatsOverview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const { t } = useI18n();

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

  const trendData = React.useMemo(() => {
    if (!stats) return [];
    if (timeRange === 'annual') return stats.trendData;
    const currentIndex = stats.trendData.findIndex((item) => item.active);
    if (currentIndex < 0) return stats.trendData.slice(-6);
    const start = Math.max(0, currentIndex - 5);
    return stats.trendData.slice(start, currentIndex + 1);
  }, [stats, timeRange]);

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

  return (
    <div className="px-6 max-w-7xl mx-auto space-y-8 pb-10">
      {/* Header Section */}
      <section className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <p className="text-on-surface-variant font-medium tracking-wide text-sm uppercase">{t('stats.financialInsights')}</p>
          <h1 className="text-4xl font-extrabold tracking-tight mt-1">{t('stats.title')}</h1>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setTimeRange('monthly')}
            className={cn(
              "px-4 py-2 font-semibold rounded-xl text-sm transition-all",
              timeRange === 'monthly' ? "bg-primary text-white shadow-lg shadow-primary/20" : "bg-surface-container-high text-on-surface hover:opacity-80"
            )}
          >
            {t('stats.monthly')}
          </button>
          <button 
            onClick={() => setTimeRange('annual')}
            className={cn(
              "px-4 py-2 font-semibold rounded-xl text-sm transition-all",
              timeRange === 'annual' ? "bg-primary text-white shadow-lg shadow-primary/20" : "bg-surface-container-high text-on-surface hover:opacity-80"
            )}
          >
            {t('stats.annual')}
          </button>
        </div>
      </section>

      {/* Main Analytics Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Expenditure Trend */}
        <div className="md:col-span-8 bg-surface-container-lowest rounded-xl p-6 shadow-sm flex flex-col gap-6">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-lg font-bold text-on-surface">{t('stats.expenditureTrend')}</h3>
              <p className="text-sm text-on-surface-variant">{t('stats.yearlyProjection')}</p>
            </div>
            <div className="text-right">
              <span className="text-2xl font-bold text-primary">${stats.totalYearlyForecast.toFixed(2)}</span>
              <p className="text-xs text-on-surface-variant">{t('stats.totalYearlyForecast')}</p>
            </div>
          </div>
          
          <div className="h-64 w-full mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trendData}>
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fill: '#414755' }}
                  dy={10}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {trendData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={entry.active ? '#0054cd' : entry.forecast ? '#e8e8ed' : '#ededf2'} 
                      stroke={entry.forecast ? '#c1c6d7' : 'none'}
                      strokeDasharray={entry.forecast ? "4 4" : "0"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
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
                .replace('{amount}', stats.monthlyForecast.toFixed(2))
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
                    <span className="text-sm font-medium text-on-surface-variant">{item.name}</span>
                  </div>
                  <span className="text-sm font-bold">{item.value.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Account Comparison */}
        <div className="md:col-span-6 bg-surface-container-lowest rounded-xl p-6 shadow-sm">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-on-surface">{t('stats.accountComparison')}</h3>
            <span className="text-xs text-on-surface-variant font-medium">{t('stats.perAppleId')}</span>
          </div>
          <div className="space-y-6">
            {stats.accountComparison.map((item, index) => (
              <div key={item.label}>
                <AccountProgress
                  label={item.label}
                  amount={item.amount}
                  percentage={Math.max(5, item.percentage)}
                  color={['bg-indigo-500', 'bg-teal-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500'][index % 5]}
                  initial={item.initial}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Optimization Tip */}
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
                <span className="font-semibold">{stats.optimization.category || t('stats.stackedPlans')}</span>
                :
                {' '}
                <span className="text-primary font-bold">${stats.optimization.potentialSavings.toFixed(2)} {t('stats.perMonth')}</span>
              </p>
            </div>
            <button className="text-primary font-bold text-sm px-4 py-2 hover:bg-white rounded-lg transition-colors whitespace-nowrap">{t('stats.reviewDetails')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountProgress({ label, amount, percentage, color, initial }: { label: string, amount: number, percentage: number, color: string, initial: string }) {
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
        <span className="text-sm font-bold text-on-surface">${amount}{t('account.perMonth')}</span>
      </div>
      <div className="w-full bg-surface-container-low h-3 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${percentage}%` }}></div>
      </div>
    </div>
  );
}
