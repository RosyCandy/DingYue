import React, { useState, useEffect } from 'react';
import { X, PlusCircle, CloudUpload, ChevronRight, Share2, Calendar, Clock, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import IconSelection from './IconSelection';
import { useI18n } from '../lib/i18n';
import { api } from '../lib/api';
import { Subscription } from '../constants';

interface AddSubscriptionProps {
  onClose: () => void;
  onSuccess?: () => void;
  initialData?: any;
}

export default function AddSubscription({ onClose, onSuccess, initialData }: AddSubscriptionProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const { t } = useI18n();

  // Form State
  const [name, setName] = useState(initialData?.name || '');
  const [category, setCategory] = useState(initialData?.category || 'Entertainment');
  const [region, setRegion] = useState(initialData?.region || '');
  const [source, setSource] = useState(initialData?.source || 'Apple App Store');
  const [account, setAccount] = useState(initialData?.account || '');
  const [price, setPrice] = useState(initialData?.price || '');
  const [currency, setCurrency] = useState(initialData?.currency || 'USD');
  const [cycle, setCycle] = useState<'monthly' | 'annually'>(
    initialData?.billingCycle === 'annually' || initialData?.billing_cycle === 'annually' ? 'annually' : 'monthly'
  );
  const [nextBillingDate, setNextBillingDate] = useState(
    initialData?.nextBillingDate || initialData?.next_billing_date
      ? new Date(initialData.nextBillingDate || initialData.next_billing_date).toISOString().split('T')[0]
      : ''
  );
  const [selectedIcon, setSelectedIcon] = useState<string | null>(initialData?.icon || null);

  const handleSave = async () => {
    try {
      if (!name.trim()) {
        alert('Please enter a subscription name');
        return;
      }

      setLoading(true);
      const normalizedPrice = Number(price);
      const subData: Omit<Subscription, 'id'> = {
        name,
        category,
        region,
        account,
        price: Number.isFinite(normalizedPrice) ? normalizedPrice : 0,
        currency,
        billingCycle: cycle,
        nextBillingDate: nextBillingDate || '',
        icon: selectedIcon || '',
        status: 'normal'
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
              {/* Subscription Details Header */}
              <section className="flex flex-col items-center text-center space-y-4 mb-10">
                <button 
                  onClick={() => setStep(2)}
                  className="w-20 h-20 bg-primary-container/10 rounded-2xl flex items-center justify-center text-primary overflow-hidden border-2 border-dashed border-primary/20 hover:border-primary/40 transition-colors"
                >
                  {selectedIcon ? (
                    <img src={selectedIcon} alt="Selected" className="w-12 h-12 object-contain" referrerPolicy="no-referrer" />
                  ) : (
                    <PlusCircle size={40} />
                  )}
                </button>
                <div className="space-y-1">
                  <h2 className="text-3xl font-extrabold tracking-tight text-on-surface">
                    {initialData ? initialData.name : t('add.newCommitment')}
                  </h2>
                  <p className="text-on-surface-variant text-sm">{t('add.organize')}</p>
                </div>
              </section>

              {/* Subscription Identity */}
              <section className="space-y-4">
                <div className="bg-surface-container-low p-6 rounded-xl space-y-6">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold tracking-widest text-on-surface-variant uppercase ml-1">{t('add.subName')}</label>
                    <input 
                      className="w-full bg-surface-container-lowest border-none rounded-lg p-4 focus:ring-2 focus:ring-primary/20 placeholder:text-outline-variant transition-all shadow-sm" 
                      placeholder="e.g. Netflix, Adobe Creative Cloud" 
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold tracking-widest text-on-surface-variant uppercase ml-1">{t('add.category')}</label>
                      <div className="relative">
                        <select 
                          className="w-full bg-surface-container-lowest border-none rounded-lg p-4 appearance-none focus:ring-2 focus:ring-primary/20 shadow-sm"
                          value={category}
                          onChange={(e) => setCategory(e.target.value)}
                        >
                          <option>Entertainment</option>
                          <option>Productivity</option>
                          <option>Software</option>
                          <option>Lifestyle</option>
                          <option>Finance</option>
                        </select>
                        <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 text-outline-variant pointer-events-none rotate-90" size={20} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold tracking-widest text-on-surface-variant uppercase ml-1">{t('add.region')}</label>
                      <input 
                        className="w-full bg-surface-container-lowest border-none rounded-lg p-4 focus:ring-2 focus:ring-primary/20 placeholder:text-outline-variant transition-all shadow-sm" 
                        placeholder="e.g. US, EU, UK" 
                        type="text"
                        value={region}
                        onChange={(e) => setRegion(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </section>

              {/* Subscription Source */}
              <section className="space-y-4">
                <div className="bg-surface-container-low p-6 rounded-xl space-y-6">
                  <div className="flex items-center gap-3 mb-2">
                    <Share2 className="text-primary-container" size={20} />
                    <h3 className="text-sm font-bold text-on-surface">{t('add.sourceAccount')}</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold tracking-widest text-on-surface-variant uppercase ml-1">{t('add.source')}</label>
                      <div className="relative">
                        <select 
                          className="w-full bg-surface-container-lowest border-none rounded-lg p-4 appearance-none focus:ring-2 focus:ring-primary/20 shadow-sm"
                          value={source}
                          onChange={(e) => setSource(e.target.value)}
                        >
                          <option>Apple App Store</option>
                          <option>Google Play Store</option>
                          <option>Direct Billing</option>
                        </select>
                        <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 text-outline-variant pointer-events-none rotate-90" size={20} />
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
                </div>
              </section>

              {/* Financials */}
              <section className="space-y-4">
                <div className="bg-surface-container-low p-6 rounded-xl">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-2 space-y-2">
                      <label className="text-[11px] font-bold tracking-widest text-on-surface-variant uppercase ml-1">{t('add.amount')}</label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-primary font-bold">$</span>
                        <input 
                          className="w-full bg-surface-container-lowest border-none rounded-lg py-4 pl-10 pr-4 focus:ring-2 focus:ring-primary/20 shadow-sm text-xl font-bold" 
                          placeholder="0.00" 
                          step="0.01" 
                          type="number"
                          value={price}
                          onChange={(e) => setPrice(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold tracking-widest text-on-surface-variant uppercase ml-1">{t('add.currency')}</label>
                      <div className="relative">
                        <select 
                          className="w-full bg-surface-container-lowest border-none rounded-lg p-4 appearance-none focus:ring-2 focus:ring-primary/20 shadow-sm font-semibold"
                          value={currency}
                          onChange={(e) => setCurrency(e.target.value)}
                        >
                          <option>USD</option>
                          <option>EUR</option>
                          <option>GBP</option>
                          <option>JPY</option>
                        </select>
                        <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 text-outline-variant pointer-events-none rotate-90" size={20} />
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Billing Cycle */}
              <section className="space-y-4">
                <div className="bg-surface-container-low p-6 rounded-xl space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold tracking-widest text-on-surface-variant uppercase ml-1">{t('add.billingFreq')}</label>
                      <div className="relative">
                        <select 
                          className="w-full bg-surface-container-lowest border-none rounded-lg p-4 appearance-none focus:ring-2 focus:ring-primary/20 shadow-sm"
                          value={cycle}
                          onChange={(e) => setCycle(e.target.value as 'monthly' | 'annually')}
                        >
                          <option value="monthly">Monthly</option>
                          <option value="annually">Annually</option>
                        </select>
                        <Clock className="absolute right-4 top-1/2 -translate-y-1/2 text-outline-variant pointer-events-none" size={20} />
                      </div>
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
                </div>
              </section>

              {/* Action Button */}
              <section className="pt-6">
                <button 
                  onClick={handleSave}
                  disabled={loading}
                  className="w-full py-4 bg-gradient-to-br from-primary to-primary-container text-white font-bold rounded-xl shadow-xl hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  {loading ? '...' : (initialData ? t('add.saveChanges') : t('add.addSubscription'))}
                </button>
              </section>
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

