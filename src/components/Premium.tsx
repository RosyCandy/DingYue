import React, { useEffect, useState } from 'react';
import { Wallet, X, RefreshCw, ShieldCheck, Zap, Headset, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { ActivateMembershipPayload, api, Membership, MembershipPlan } from '../lib/api';
import { useAuth } from '../lib/auth';

interface PremiumProps {
  onClose: () => void;
}

import { useBackHandler } from '../lib/backButton';

export default function Premium({ onClose }: PremiumProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [page, setPage] = useState<'benefits' | 'plans'>('benefits');
  const [selectedPlan, setSelectedPlan] = useState<MembershipPlan>('trial');
  const [checkoutStep, setCheckoutStep] = useState<'select' | 'confirm' | 'done'>('select');
  const [payerEmail, setPayerEmail] = useState(user?.email || '');
  const [paymentMethod, setPaymentMethod] = useState('apple_pay');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [currentMembership, setCurrentMembership] = useState<Membership | null>(null);
  const [history, setHistory] = useState<Membership[]>([]);

  const activeMembership = Boolean(
    currentMembership &&
    currentMembership.status !== 'expired' &&
    currentMembership.status !== 'canceled' &&
    (!currentMembership.expiresAt || new Date(currentMembership.expiresAt).getTime() > Date.now())
  );
  const currentPlan = activeMembership && currentMembership ? currentMembership.plan : null;

  // 已是会员时直接进入套餐管理页，跳过优势页
  useEffect(() => {
    if (activeMembership) setPage('plans');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMembership]);

  useBackHandler(() => {
    if (page === 'plans' && !activeMembership) setPage('benefits');
    else onClose();
  });

  useEffect(() => {
    if (user?.email) {
      setPayerEmail(user.email);
    }
  }, [user?.email]);

  useEffect(() => {
    const loadMembership = async () => {
      try {
        const [membership, historyData] = await Promise.all([
          api.getCurrentMembership(),
          api.getMembershipHistory(),
        ]);
        setCurrentMembership(membership);
        setHistory(historyData);
      } catch (error) {
        console.error('Failed to load membership:', error);
      }
    };
    loadMembership();
  }, []);

  const getPlanLabel = (plan: MembershipPlan) => {
    if (plan === 'trial') return t('premium.freeTrial');
    if (plan === 'monthly') return t('premium.monthly');
    if (plan === 'annual') return t('premium.annual');
    return t('premium.lifetime');
  };

  const getPaymentMethodLabel = (method: string) => {
    if (method === 'apple_pay') return t('premium.methodApplePay');
    if (method === 'wechat_pay') return t('premium.methodWechatPay');
    if (method === 'alipay') return t('premium.methodAlipay');
    if (method === 'google_pay') return t('premium.methodGooglePay');
    if (method === 'credit_card') return t('premium.methodCard');
    if (method === 'paypal') return t('premium.methodPaypal');
    return method;
  };

  const formatDate = (dateText: string | null) => {
    if (!dateText) return t('premium.noExpiry');
    const date = new Date(dateText);
    if (Number.isNaN(date.getTime())) return dateText;
    return date.toLocaleDateString();
  };

  const getPlanPriceLabel = (plan: MembershipPlan) => {
    if (plan === 'trial') return t('premium.free');
    if (plan === 'monthly') return `¥3${t('premium.periodMonthly')}`;
    if (plan === 'annual') return `¥36${t('premium.periodAnnual')}`;
    return `¥48 ${t('premium.periodOnce')}`;
  };

  const validateCheckout = () => {
    if (!payerEmail || !payerEmail.includes('@')) {
      setErrorMessage(t('premium.invalidEmail'));
      return false;
    }

    if (!agreeTerms) {
      setErrorMessage(t('premium.agreeRequired'));
      return false;
    }
    return true;
  };

  const handleProceedToConfirm = () => {
    setErrorMessage('');
    setSuccessMessage('');
    if (!validateCheckout()) return;
    setCheckoutStep('confirm');
  };

  const handleActivate = async () => {
    setErrorMessage('');
    setSuccessMessage('');

    if (!validateCheckout()) return;

    try {
      setLoading(true);
      const payload: ActivateMembershipPayload = {
        plan: selectedPlan,
        paymentMethod,
        payerEmail,
        autoRenew: selectedPlan !== 'lifetime',
      };
      const membership = await api.activateMembership(payload);
      setCurrentMembership(membership);
      const historyData = await api.getMembershipHistory();
      setHistory(historyData);
      setSuccessMessage(t('premium.successActivated'));
      setCheckoutStep('done');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('premium.activateFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleRestorePurchase = async () => {
    try {
      setActionLoading(true);
      setErrorMessage('');
      const membership = await api.restoreMembershipPurchase();
      setCurrentMembership(membership);
      const historyData = await api.getMembershipHistory();
      setHistory(historyData);
      setSuccessMessage(t('premium.purchaseRestored'));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('premium.restoreFailed'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelAutoRenew = async () => {
    try {
      setActionLoading(true);
      setErrorMessage('');
      const membership = await api.cancelMembershipAutoRenew();
      setCurrentMembership(membership);
      const historyData = await api.getMembershipHistory();
      setHistory(historyData);
      setSuccessMessage(t('premium.autoRenewCanceled'));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('premium.cancelAutoRenewFailed'));
    } finally {
      setActionLoading(false);
    }
  };

  const benefits = [
    { icon: <ShieldCheck size={20} />, title: t('premium.unlimitedAccounts'), desc: t('premium.unlimitedAccountsDesc'), color: 'text-amber-600', bgColor: 'bg-amber-50' },
    { icon: <Zap size={20} />, title: t('premium.advancedAnalytics'), desc: t('premium.advancedAnalyticsDesc'), color: 'text-indigo-600', bgColor: 'bg-indigo-50' },
    { icon: <RefreshCw size={20} />, title: t('premium.cloudSync'), desc: t('premium.cloudSyncDesc'), color: 'text-primary', bgColor: 'bg-primary/10' },
    { icon: <Headset size={20} />, title: t('premium.prioritySupport'), desc: t('premium.prioritySupportDesc'), color: 'text-red-600', bgColor: 'bg-red-50' },
  ];

  return (
    <div className="fixed inset-0 z-[70] bg-surface flex flex-col overflow-y-auto no-scrollbar">
      <header className="safe-area-header bg-surface text-primary w-full top-0 left-0 flex items-center justify-between px-6 py-3 z-10 sticky border-b border-outline-variant/10">
        <div className="flex items-center gap-2">
          {page === 'plans' && !activeMembership ? (
            <button
              onClick={() => setPage('benefits')}
              aria-label={t('settings.back')}
              className="p-1 -ml-1 rounded-full hover:bg-surface-container-low active:scale-90 transition-all text-on-surface"
            >
              <ArrowLeft size={22} />
            </button>
          ) : (
            <Wallet size={24} fill="currentColor" className="text-primary/20" />
          )}
          <span className="font-manrope font-bold tracking-tight text-lg text-on-surface">DuoDuo</span>
        </div>
        <button onClick={onClose} className="hover:opacity-70 transition-opacity scale-90 active:scale-75 text-on-surface-variant">
          <X size={24} />
        </button>
      </header>

      {page === 'benefits' ? (
        /* ── 优势页：微信式列表，无卡片 ── */
        <main className="max-w-2xl mx-auto px-6 pt-6 pb-40 flex-1 w-full">
          <section className="text-center mb-8">
            <div className="inline-flex items-start gap-2">
              <h1 className="font-manrope text-2xl md:text-3xl font-extrabold text-on-surface tracking-tight leading-tight">
                {t('premium.title')}
              </h1>
              <span className="font-serif italic text-primary text-xl md:text-2xl font-semibold leading-none mt-0.5">{t('premium.subtitle')}</span>
            </div>
            <p className="text-on-surface-variant text-sm max-w-md mx-auto leading-relaxed mt-2">
              {t('premium.desc')}
            </p>
          </section>

          <div className="divide-y divide-outline-variant/10">
            {benefits.map((benefit) => (
              <div key={benefit.title} className="flex items-start gap-4 py-5 px-1">
                <div className={cn('w-11 h-11 rounded-full flex items-center justify-center shrink-0', benefit.bgColor, benefit.color)}>
                  {benefit.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-manrope font-bold text-on-surface text-base">{benefit.title}</h3>
                  <p className="text-on-surface-variant text-sm mt-0.5 leading-relaxed">{benefit.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* 底部立即订阅 */}
          <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-surface via-surface to-transparent">
            <div className="max-w-2xl mx-auto">
              <button
                onClick={() => setPage('plans')}
                className="w-full bg-primary text-white font-manrope font-bold py-4 rounded-xl shadow-md shadow-primary/10 active:scale-95 transition-all hover:bg-primary/90"
              >
                {t('premium.subscribeNow')}
              </button>
            </div>
          </div>
        </main>
      ) : (
        /* ── 套餐与支付页 ── */
        <main className="max-w-4xl mx-auto px-6 pt-4 pb-16 flex-1 w-full">
          <section className="space-y-4">
            <button
              onClick={() => {
                setSelectedPlan('trial');
                setCheckoutStep('select');
              }}
              className={cn(
                "w-full text-left p-[2px] rounded-2xl shadow-lg active:scale-[0.98] transition-all",
                currentPlan === 'trial'
                  ? "bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-emerald-200"
                  : selectedPlan === 'trial'
                    ? "bg-gradient-to-br from-primary to-primary-container shadow-primary/20"
                    : "bg-outline-variant/20 hover:bg-outline-variant/40"
              )}
            >
              <div className={cn(
                "p-4 rounded-[0.95rem] flex items-center justify-between transition-colors",
                currentPlan === 'trial'
                  ? "bg-emerald-50"
                  : selectedPlan === 'trial'
                    ? "bg-surface-container-lowest"
                    : "bg-surface"
              )}>
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center transition-colors",
                    currentPlan === 'trial'
                      ? "bg-emerald-100 text-emerald-700"
                      : selectedPlan === 'trial'
                        ? "bg-primary/10 text-primary"
                        : "bg-outline-variant/20 text-on-surface-variant"
                  )}>
                    <ShieldCheck size={20} />
                  </div>
                  <div>
                    <span className={cn(
                      "text-[10px] font-bold tracking-wider uppercase block transition-colors",
                      currentPlan === 'trial'
                        ? "text-emerald-700"
                        : selectedPlan === 'trial'
                          ? "text-primary"
                          : "text-on-surface-variant"
                    )}>{currentPlan === 'trial' ? t('premium.currentPlanTag') : t('premium.recommended')}</span>
                    <h3 className="font-manrope text-lg font-bold text-on-surface leading-tight">{t('premium.freeTrial')}</h3>
                    <p className="text-on-surface-variant text-[10px]">{t('premium.freeTrialDesc')}</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xl font-bold text-on-surface">{t('premium.free')}</span>
                </div>
              </div>
            </button>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <PricingCard
                title={t('premium.monthly')}
                price="¥3"
                period={t('premium.periodMonthly')}
                selected={selectedPlan === 'monthly'}
                isCurrent={currentPlan === 'monthly'}
                currentTagText={t('premium.currentPlanTag')}
                onClick={() => {
                  setSelectedPlan('monthly');
                  setCheckoutStep('select');
                }}
              />
              <PricingCard
                title={t('premium.annual')}
                price="¥36"
                period={t('premium.periodAnnual')}
                bestValue
                bestValueText={t('premium.bestValue')}
                selected={selectedPlan === 'annual'}
                isCurrent={currentPlan === 'annual'}
                currentTagText={t('premium.currentPlanTag')}
                onClick={() => {
                  setSelectedPlan('annual');
                  setCheckoutStep('select');
                }}
              />
              <PricingCard
                title={t('premium.lifetime')}
                price="¥48"
                period={t('premium.periodOnce')}
                selected={selectedPlan === 'lifetime'}
                isCurrent={currentPlan === 'lifetime'}
                currentTagText={t('premium.currentPlanTag')}
                onClick={() => {
                  setSelectedPlan('lifetime');
                  setCheckoutStep('select');
                }}
              />
            </div>
          </section>

          <section className="mt-6 bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-5 space-y-4">
            <h3 className="font-manrope font-bold text-sm text-on-surface">{t('premium.billingDetails')}</h3>

            <div className="space-y-2">
              <label className="text-[11px] font-bold tracking-widest text-on-surface-variant uppercase">{t('premium.payerEmail')}</label>
              <input
                type="email"
                value={payerEmail}
                onChange={(e) => setPayerEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-surface border border-outline-variant/20 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-bold tracking-widest text-on-surface-variant uppercase">{t('premium.paymentMethod')}</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full bg-surface border border-outline-variant/20 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="wechat_pay">{t('premium.methodWechatPay')}</option>
                <option value="alipay">{t('premium.methodAlipay')}</option>
                <option value="apple_pay">{t('premium.methodApplePay')}</option>
                <option value="google_pay">{t('premium.methodGooglePay')}</option>
                <option value="credit_card">{t('premium.methodCard')}</option>
                <option value="paypal">{t('premium.methodPaypal')}</option>
              </select>
            </div>

            <label className="flex items-center gap-2 text-xs text-on-surface-variant font-medium">
              <input
                type="checkbox"
                checked={selectedPlan !== 'lifetime'}
                readOnly
                className="accent-primary"
              />
              {selectedPlan === 'lifetime' ? t('premium.oneTime') : t('premium.autoRenew')}
            </label>

            <label className="flex items-start gap-2 text-xs text-on-surface-variant font-medium leading-relaxed">
              <input
                type="checkbox"
                checked={agreeTerms}
                onChange={(e) => {
                  setAgreeTerms(e.target.checked);
                  setCheckoutStep('select');
                }}
                className="accent-primary mt-0.5"
              />
              {t('premium.agreeTerms')}
            </label>

            {checkoutStep === 'confirm' && (
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 text-xs text-on-surface space-y-1">
                <p className="font-semibold text-primary">{t('premium.confirmOrderTitle')}</p>
                <p className="text-on-surface-variant">{t('premium.confirmOrderDesc')}</p>
                <p><span className="font-semibold">{t('premium.currentPlan')}:</span> {getPlanLabel(selectedPlan)}</p>
                <p><span className="font-semibold">{t('premium.paymentMethod')}:</span> {getPaymentMethodLabel(paymentMethod)}</p>
                <p><span className="font-semibold">{t('premium.payerEmail')}:</span> {payerEmail}</p>
                <p><span className="font-semibold">{t('stats.total')}:</span> {getPlanPriceLabel(selectedPlan)}</p>
              </div>
            )}

            {errorMessage && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg flex items-center gap-2">
                <AlertCircle size={14} />
                <span>{errorMessage}</span>
              </div>
            )}

            {successMessage && (
              <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 px-3 py-2 rounded-lg flex items-center gap-2">
                <CheckCircle2 size={14} />
                <span>{successMessage}</span>
              </div>
            )}

            {currentMembership && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-on-surface space-y-2">
                <span className="inline-flex items-center rounded-full bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5">
                  {t('premium.currentPlanTag')}
                </span>
                <p><span className="font-semibold">{t('premium.currentPlan')}:</span> {getPlanLabel(currentMembership.plan)}</p>
                <p><span className="font-semibold">{t('premium.validUntil')}:</span> {formatDate(currentMembership.expiresAt)}</p>
                <p><span className="font-semibold">{t('premium.autoRenewLabel')}:</span> {currentMembership.autoRenew ? t('settings.on') : t('settings.off')}</p>
                {currentMembership.autoRenew && currentMembership.plan !== 'lifetime' && (
                  <button
                    onClick={() => void handleCancelAutoRenew()}
                    disabled={actionLoading}
                    className="mt-1 text-xs font-bold text-red-600 hover:underline"
                  >
                    {t('premium.cancelAutoRenew')}
                  </button>
                )}
              </div>
            )}

            {history.length > 0 && (
              <div className="bg-surface border border-outline-variant/20 rounded-xl p-3 space-y-2">
                <p className="text-xs font-semibold text-on-surface">{t('premium.recentPurchases')}</p>
                {history.slice(0, 3).map((item) => (
                  <div key={item.id} className="flex justify-between text-xs text-on-surface-variant">
                    <span>{getPlanLabel(item.plan)} ({item.status})</span>
                    <span>{formatDate(item.expiresAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="mt-8 flex flex-col items-center">
            {checkoutStep === 'confirm' && (
              <button
                onClick={() => setCheckoutStep('select')}
                className="mb-3 text-xs font-semibold text-on-surface-variant hover:text-primary"
              >
                {t('premium.backToPlanSelection')}
              </button>
            )}
            <button
              onClick={
                checkoutStep === 'done'
                  ? onClose
                  : checkoutStep === 'confirm'
                    ? handleActivate
                    : handleProceedToConfirm
              }
              disabled={loading}
              className="w-full max-w-sm bg-primary text-white font-manrope font-bold py-4 rounded-xl shadow-md shadow-primary/10 active:scale-95 transition-all hover:bg-primary/90 disabled:opacity-80 flex items-center justify-center gap-2"
            >
              {loading
                ? t('premium.processing')
                : checkoutStep === 'done'
                  ? t('premium.goToSettings')
                  : checkoutStep === 'confirm'
                    ? (selectedPlan === 'trial' ? t('premium.startFreeTrial') : t('premium.confirmAndSubscribe'))
                    : t('premium.nextStep')}
            </button>
            {checkoutStep === 'done' && (
              <p className="mt-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 px-3 py-2 rounded-lg">
                {t('premium.nextStepHint')}
              </p>
            )}
            <p className="mt-4 text-[10px] text-on-surface-variant text-center max-w-[240px]">
              {t('premium.disclaimer')}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[11px] font-medium text-on-surface-variant opacity-80">
              <button onClick={() => void handleRestorePurchase()} disabled={actionLoading} className="hover:underline disabled:opacity-50">
                {actionLoading ? t('premium.processing') : t('premium.restorePurchase')}
              </button>
              <a href="https://example.com/terms" target="_blank" rel="noreferrer" className="hover:underline">{t('premium.terms')}</a>
              <a href="https://example.com/privacy" target="_blank" rel="noreferrer" className="hover:underline">{t('premium.privacy')}</a>
            </div>
          </section>
        </main>
      )}

      <div className="fixed top-0 left-0 w-full h-full pointer-events-none -z-10 overflow-hidden">
        <div className="absolute top-0 right-0 w-[50%] h-[30%] bg-primary/5 rounded-full blur-[80px]"></div>
        <div className="absolute bottom-0 left-0 w-[40%] h-[20%] bg-secondary/5 rounded-full blur-[60px]"></div>
      </div>
    </div>
  );
}

function PricingCard({
  title,
  price,
  period,
  bestValue,
  bestValueText,
  selected,
  isCurrent,
  currentTagText,
  onClick
}: {
  title: string;
  price: string;
  period: string;
  bestValue?: boolean;
  bestValueText?: string;
  selected?: boolean;
  isCurrent?: boolean;
  currentTagText?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "bg-surface-container-lowest p-4 rounded-xl border-2 text-left active:scale-[0.98] transition-all relative overflow-hidden",
        isCurrent
          ? "border-emerald-500 bg-emerald-50 shadow-md shadow-emerald-100"
          : selected
            ? "border-primary shadow-md shadow-primary/10"
            : (bestValue ? "border-primary/30" : "border-transparent ring-1 ring-outline-variant/10 hover:ring-outline-variant/30")
      )}
    >
      {isCurrent ? (
        <div className="absolute top-0 right-0 px-2 py-0.5 rounded-bl-lg bg-emerald-600">
          <span className="text-[8px] font-bold text-white uppercase">{currentTagText || 'Current'}</span>
        </div>
      ) : bestValue && (
        <div className={cn(
          "absolute top-0 right-0 px-2 py-0.5 rounded-bl-lg transition-colors",
          selected ? "bg-primary" : "bg-primary/80"
        )}>
          <span className="text-[8px] font-bold text-white uppercase">{bestValueText || 'Best Value'}</span>
        </div>
      )}
      <h3 className="font-manrope font-bold text-on-surface text-sm">{title}</h3>
      <div className="flex items-baseline gap-1 mt-1">
        <span className="text-lg font-bold text-on-surface">{price}</span>
        <span className="text-on-surface-variant text-[10px]">{period}</span>
      </div>
    </button>
  );
}
