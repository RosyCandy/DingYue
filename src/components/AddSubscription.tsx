import React, { useState, useEffect } from 'react';
import { X, PlusCircle, CloudUpload, ChevronRight, Calendar, Clock, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import IconSelection from './IconSelection';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/utils';
import { useBackHandler } from '../lib/backButton';
import { api } from '../lib/api';
import { Trash2 } from 'lucide-react';
import { ACTIVE_CURRENCIES, getCurrencySymbol } from '../lib/currencies';
import { Subscription } from '../constants';

interface AddSubscriptionProps {
  onClose: () => void;
  onSuccess?: () => void;
  initialData?: any;
}

export default function AddSubscription({ onClose, onSuccess, initialData }: AddSubscriptionProps) {
  const [step, setStep] = useState(1);
  useBackHandler(() => { if (step > 1) setStep(step - 1); else onClose(); });
  const [loading, setLoading] = useState(false);
  const { t } = useI18n();

  // Form State
  const [name, setName] = useState(initialData?.name || '');
  const [category, setCategory] = useState(initialData?.category || 'Entertainment');
  const [region, setRegion] = useState(initialData?.region || '');
  const [source, setSource] = useState(initialData?.source || 'Apple App Store');
  const [account, setAccount] = useState(initialData?.account || '');
  const [price, setPrice] = useState(initialData?.price || '');
  // 默认货币跟随首页的展示货币选择；编辑时用订阅原货币
  const [currency, setCurrency] = useState(
    initialData?.currency || localStorage.getItem('display_currency') || 'USD'
  );
  // V1.4.0：账单周期显式下拉（月付/季度付/年付/免费试用），替代原「免费订阅」开关
  const [cycle, setCycle] = useState<'monthly' | 'quarterly' | 'annually' | 'trial'>(
    initialData?.billingCycle || 'monthly'
  );
  const [customCategories, setCustomCategories] = useState<Array<{ id: number; name: string }>>([]);
  // V1.3.9：频率下拉改为「订阅时间」——周期 = 订阅时间 → 下一个账单日的间隔，
  // 月付/季付/年付乃至任意周期都自然支持
  const [startDate, setStartDate] = useState(
    // 编辑旧数据（无订阅时间）时留空，保存后沿用旧 billing_cycle 口径；新建默认今天
    initialData
      ? (initialData?.startDate || initialData?.start_date || '')
      : new Date().toISOString().split('T')[0]
  );
  const [nextBillingDate, setNextBillingDate] = useState(
    initialData?.nextBillingDate || initialData?.next_billing_date
      ? new Date(initialData.nextBillingDate || initialData.next_billing_date).toISOString().split('T')[0]
      : ''
  );
  const [selectedIcon, setSelectedIcon] = useState<string | null>(initialData?.icon || null);
  // V1.4.0：删除订阅（软删除进回收站，二次确认）
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!initialData?.id) return;
    try {
      setDeleting(true);
      await api.deleteSubscription(initialData.id);
      setConfirmingDelete(false);
      onSuccess?.();
      onClose();
    } catch (error) {
      console.error('Failed to delete subscription:', error);
      alert(t('subs.deleteFailed') || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    void api.getCustomCategories()
      .then((list) => setCustomCategories(list.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    try {
      if (!name.trim()) {
        alert('Please enter a subscription name');
        return;
      }

      setLoading(true);
      const normalizedPrice = cycle === 'trial' ? 0 : Number(price);
      const subData: Omit<Subscription, 'id'> = {
        name,
        category,
        region,
        account,
        price: Number.isFinite(normalizedPrice) ? normalizedPrice : 0,
        currency,
        billingCycle: cycle,
        nextBillingDate: nextBillingDate || '',
        startDate,
        icon: selectedIcon || '',
        status: cycle === 'trial' ? 'trial' : 'normal'
      };
      if (initialData?.id) {
        await api.updateSubscription(initialData.id, subData);
      } else {
        await api.createSubscription(subData);
      }
      
      onSuccess?.();
      onClose();
    } catch (error) {
      console.error('Failed to save subscription:', error);
      alert('Failed to save subscription');
    } finally {
      setLoading(false);
    }
  };

  const handleIconSelect = (icon: string) => {
    setSelectedIcon(icon);
    setStep(1);
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-surface flex flex-col"
    >
      {/* Top Header */}
      <header className="safe-area-header fixed top-0 w-full z-50 glass-effect transition-opacity">
        <div className="flex justify-between items-center px-6 h-16 w-full max-w-2xl mx-auto">
          <button onClick={step === 1 ? onClose : () => setStep(1)} className="text-primary font-medium hover:opacity-70 transition-opacity active:scale-95">
            {step === 1 ? t('add.cancel') : <ArrowLeft size={24} />}
          </button>
          <h1 className="text-lg font-bold text-on-surface">
            {step === 1 ? (initialData ? t('add.editSubscription') : t('add.addSubscription')) : t('add.selectIcon')}
          </h1>
          <button 
            onClick={handleSave} 
            disabled={loading}
            className="text-primary font-bold hover:opacity-70 transition-opacity active:scale-95 disabled:opacity-50"
          >
            {loading ? '...' : t('add.save')}
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 pt-24 pb-32 space-y-8 overflow-y-auto no-scrollbar flex-1 w-full">
        <AnimatePresence mode="wait">
          {step === 1 ? (
            <motion.div
              key="form"
              initial={{ x: -20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 20, opacity: 0 }}
              className="space-y-8"
            >
              {/* V1.3.7：单卡片表单（此前四个卡片割裂感强），图标+名称同行等高，
                  分类/地区、来源/邮箱、金额/货币、频率/账单日两两同行（手机端同样生效） */}
              <section className="bg-surface-container-low p-5 rounded-2xl space-y-5">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setStep(2)}
                    aria-label={t('add.selectIcon')}
                    className="w-14 h-14 shrink-0 bg-primary-container/10 rounded-xl flex items-center justify-center text-primary overflow-hidden border-2 border-dashed border-primary/20 hover:border-primary/40 transition-colors"
                  >
                    {selectedIcon ? (
                      <img src={selectedIcon} alt="Selected" className="w-9 h-9 object-contain" referrerPolicy="no-referrer" />
                    ) : (
                      <PlusCircle size={26} />
                    )}
                  </button>
                  <input
                    className="flex-1 min-w-0 h-14 bg-surface-container-lowest border-none rounded-lg px-4 focus:ring-2 focus:ring-primary/20 placeholder:text-outline-variant transition-all shadow-sm"
                    placeholder={t('add.subNamePlaceholder')}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold tracking-widest text-on-surface-variant uppercase ml-1">{t('add.category')}</label>
                    <div className="relative">
                      <select
                        className="w-full bg-surface-container-lowest border-none rounded-lg p-4 pr-10 appearance-none focus:ring-2 focus:ring-primary/20 shadow-sm truncate"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      >
                        {/* 存库值保持英文/自定义名，显示按语言翻译 */}
                        <option value="Entertainment">{t('cat.entertainment')}</option>
                        <option value="Video">{t('cat.video')}</option>
                        <option value="AI">{t('cat.ai')}</option>
                        <option value="Development">{t('cat.development')}</option>
                        <option value="Electronics">{t('cat.electronics')}</option>
                        <option value="Productivity">{t('cat.productivity')}</option>
                        <option value="Software">{t('cat.software')}</option>
                        <option value="Lifestyle">{t('cat.lifestyle')}</option>
                        <option value="Finance">{t('cat.finance')}</option>
                        {customCategories.length > 0 && (
                          <optgroup label={t('subs.customCategories')}>
                            {customCategories.map((c) => (
                              <option key={c.id} value={c.name}>{c.name}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 text-outline-variant pointer-events-none rotate-90" size={18} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold tracking-widest text-on-surface-variant uppercase ml-1">{t('add.region')}</label>
                    <input
                      className="w-full bg-surface-container-lowest border-none rounded-lg p-4 focus:ring-2 focus:ring-primary/20 placeholder:text-outline-variant transition-all shadow-sm"
                      placeholder={t('add.regionPlaceholder')}
                      type="text"
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold tracking-widest text-on-surface-variant uppercase ml-1">{t('add.source')}</label>
                    <div className="relative">
                      <select
                        className="w-full bg-surface-container-lowest border-none rounded-lg p-4 pr-10 appearance-none focus:ring-2 focus:ring-primary/20 shadow-sm truncate"
                        value={source}
                        onChange={(e) => setSource(e.target.value)}
                      >
                        <option value="Apple App Store">{t('add.sourceApple')}</option>
                        <option value="Google Play Store">{t('add.sourceGoogle')}</option>
                        <option value="Direct Billing">{t('add.sourceDirect')}</option>
                      </select>
                      <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 text-outline-variant pointer-events-none rotate-90" size={18} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold tracking-widest text-on-surface-variant uppercase ml-1">{t('add.accountEmail')}</label>
                    <input
                      className="w-full bg-surface-container-lowest border-none rounded-lg p-4 focus:ring-2 focus:ring-primary/20 placeholder:text-outline-variant transition-all shadow-sm"
                      placeholder="example@icloud.com"
                      type="email"
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                    />
                  </div>
                </div>

                {/* V1.4.0：账单周期下拉（月付/季度付/年付/免费试用），替代原「免费订阅」开关 */}
                <div className="space-y-2">
                  <label className="text-[11px] font-bold tracking-widest text-on-surface-variant uppercase ml-1">{t('add.billingCycle')}</label>
                  <div className="relative">
                    <select
                      className="w-full bg-surface-container-lowest border-none rounded-lg p-4 pr-10 appearance-none focus:ring-2 focus:ring-primary/20 shadow-sm"
                      value={cycle}
                      onChange={(e) => {
                        const next = e.target.value as typeof cycle;
                        setCycle(next);
                        if (next === 'trial') setPrice('0');
                      }}
                    >
                      <option value="monthly">{t('add.cycleMonthly')}</option>
                      <option value="quarterly">{t('add.cycleQuarterly')}</option>
                      <option value="annually">{t('add.cycleAnnually')}</option>
                      <option value="trial">{t('add.cycleTrial')}</option>
                    </select>
                    <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 text-outline-variant pointer-events-none rotate-90" size={18} />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-2">
                    <label className="text-[11px] font-bold tracking-widest text-on-surface-variant uppercase ml-1">{t('add.amount')}</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-primary font-bold">{getCurrencySymbol(currency)}</span>
                      <input
                        className="w-full h-14 bg-surface-container-lowest border-none rounded-lg px-4 pl-10 focus:ring-2 focus:ring-primary/20 shadow-sm text-xl font-bold disabled:opacity-50"
                        placeholder="0.00"
                        step="0.01"
                        type="number"
                        disabled={cycle === 'trial'}
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold tracking-widest text-on-surface-variant uppercase ml-1">{t('add.currency')}</label>
                    <div className="relative">
                      <select
                        className="w-full h-14 bg-surface-container-lowest border-none rounded-lg px-4 pr-8 appearance-none focus:ring-2 focus:ring-primary/20 shadow-sm text-sm font-semibold truncate disabled:opacity-50"
                        value={currency}
                        disabled={cycle === 'trial'}
                        onChange={(e) => setCurrency(e.target.value)}
                      >
                        {ACTIVE_CURRENCIES.map((c) => (
                          <option key={c.code} value={c.code}>{c.code} {c.symbol}</option>
                        ))}
                      </select>
                      <ChevronRight className="absolute right-2 top-1/2 -translate-y-1/2 text-outline-variant pointer-events-none rotate-90" size={16} />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold tracking-widest text-on-surface-variant uppercase ml-1">{t('add.startDate')}</label>
                    <input
                      className="w-full bg-surface-container-lowest border-none rounded-lg p-4 focus:ring-2 focus:ring-primary/20 shadow-sm"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold tracking-widest text-on-surface-variant uppercase ml-1">{t('add.nextBilling')}</label>
                    <input
                      className="w-full bg-surface-container-lowest border-none rounded-lg p-4 focus:ring-2 focus:ring-primary/20 shadow-sm"
                      type="date"
                      value={nextBillingDate}
                      onChange={(e) => setNextBillingDate(e.target.value)}
                    />
                  </div>
                </div>
              </section>

              {/* Action Button */}
              <section className="pt-6 space-y-3">
                <button
                  onClick={handleSave}
                  disabled={loading}
                  className="w-full py-4 bg-gradient-to-br from-primary to-primary-container text-white font-bold rounded-xl shadow-xl hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  {loading ? '...' : (initialData ? t('add.saveChanges') : t('add.addSubscription'))}
                </button>
                {initialData?.id && (
                  <button
                    onClick={() => setConfirmingDelete(true)}
                    className="w-full py-3.5 rounded-xl border border-red-200 bg-red-50/60 text-red-600 font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
                  >
                    <Trash2 size={16} />
                    {t('subs.delete')}
                  </button>
                )}
              </section>

              {/* 删除二次确认 */}
              <AnimatePresence>
                {confirmingDelete && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center px-8"
                    onClick={() => !deleting && setConfirmingDelete(false)}
                  >
                    <motion.div
                      initial={{ scale: 0.92, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.95, opacity: 0 }}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-surface rounded-2xl p-6 w-full max-w-xs text-center shadow-2xl"
                    >
                      <h3 className="text-base font-bold text-on-surface">{t('subs.delete')}</h3>
                      <p className="text-sm text-on-surface-variant mt-2 leading-relaxed">{t('subs.deleteConfirm')}</p>
                      <div className="flex gap-3 mt-5">
                        <button
                          onClick={() => setConfirmingDelete(false)}
                          disabled={deleting}
                          className="flex-1 py-2.5 rounded-xl border border-outline-variant/30 text-on-surface-variant font-bold text-sm active:scale-95 transition-all"
                        >
                          {t('settings.cancelLogout')}
                        </button>
                        <button
                          onClick={() => void handleDelete()}
                          disabled={deleting}
                          className="flex-1 py-2.5 rounded-xl bg-red-500 text-white font-bold text-sm active:scale-95 transition-all disabled:opacity-60"
                        >
                          {deleting ? '...' : t('subs.delete')}
                        </button>
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div
              key="icons"
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -20, opacity: 0 }}
            >
              <IconSelection onSelect={handleIconSelect} onBack={() => setStep(1)} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </motion.div>
  );
}

