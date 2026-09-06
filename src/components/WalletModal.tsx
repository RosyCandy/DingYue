import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, CreditCard, Plus, Smartphone, Trash2, CheckCircle2, Loader2 } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { api, PaymentMethod, PaymentMethodInput } from '../lib/api';

import { useBackHandler } from '../lib/backButton';

export default function WalletModal({ onClose }: { onClose: () => void }) {
  useBackHandler(onClose);
  const { t } = useI18n();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState('');
  const [methodType, setMethodType] = useState<PaymentMethod['methodType']>('credit_card');
  const [accountRef, setAccountRef] = useState('');

  const loadMethods = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getPaymentMethods();
      setMethods(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payment methods');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMethods();
  }, []);

  const createMethod = async () => {
    try {
      if (!label.trim()) {
        setError('Please enter a payment method name.');
        return;
      }
      const payload: PaymentMethodInput = {
        label: label.trim(),
        methodType,
        accountRef: accountRef.trim() || undefined,
        isDefault: methods.length === 0,
      };
      await api.createPaymentMethod(payload);
      setLabel('');
      setAccountRef('');
      setMethodType('credit_card');
      setShowForm(false);
      await loadMethods();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create method');
    }
  };

  const makeDefault = async (method: PaymentMethod) => {
    try {
      await api.updatePaymentMethod(method.id, { isDefault: true });
      await loadMethods();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update method');
    }
  };

  const removeMethod = async (method: PaymentMethod) => {
    try {
      await api.deletePaymentMethod(method.id);
      await loadMethods();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete method');
    }
  };

  const iconForMethod = (method: PaymentMethod) => {
    if (method.methodType === 'apple_pay') return <Smartphone size={20} />;
    return <CreditCard size={20} />;
  };

  const colorForMethod = (method: PaymentMethod) => {
    if (method.methodType === 'apple_pay') return 'bg-black text-white';
    if (method.methodType === 'paypal') return 'bg-sky-600 text-white';
    return 'bg-blue-600 text-white';
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <motion.div 
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="bg-surface w-full max-w-md rounded-t-[32px] sm:rounded-[32px] p-6 pb-12 sm:pb-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-on-surface">{t('wallet.title')}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-bold text-on-surface-variant uppercase tracking-wider">{t('wallet.connected')}</h3>

          {loading ? (
            <div className="h-36 flex items-center justify-center text-on-surface-variant">
              <Loader2 className="animate-spin" size={24} />
            </div>
          ) : (
            <>
              {error && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-xs text-red-600">{error}</div>
              )}

              {methods.map((method) => (
                <div key={method.id} className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-4 flex items-center gap-4 shadow-sm">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${colorForMethod(method)}`}>
                    {iconForMethod(method)}
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-on-surface">{method.label}</h4>
                    <p className="text-xs text-on-surface-variant">{method.accountRef || method.methodType}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {method.isDefault ? (
                      <div className="text-xs font-bold text-primary bg-primary/10 px-2 py-1 rounded-md">Default</div>
                    ) : (
                      <button
                        onClick={() => void makeDefault(method)}
                        className="text-xs text-primary font-semibold"
                      >
                        Set Default
                      </button>
                    )}
                    <button
                      onClick={() => void removeMethod(method)}
                      className="text-red-500 hover:text-red-600"
                      aria-label="Delete method"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}

              {methods.length === 0 && (
                <div className="text-sm text-on-surface-variant bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant/10">
                  No payment methods yet.
                </div>
              )}

              {showForm && (
                <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-4 space-y-3">
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="w-full bg-surface border border-outline-variant/20 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="Method name (e.g. Visa 4242)"
                  />
                  <select
                    value={methodType}
                    onChange={(e) => setMethodType(e.target.value as PaymentMethod['methodType'])}
                    className="w-full bg-surface border border-outline-variant/20 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="credit_card">Credit Card</option>
                    <option value="apple_pay">Apple Pay</option>
                    <option value="paypal">PayPal</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="other">Other</option>
                  </select>
                  <input
                    value={accountRef}
                    onChange={(e) => setAccountRef(e.target.value)}
                    className="w-full bg-surface border border-outline-variant/20 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="Account ref (optional)"
                  />
                  <button
                    onClick={() => void createMethod()}
                    className="w-full py-2 rounded-xl bg-primary text-white text-sm font-bold"
                  >
                    <CheckCircle2 size={16} className="inline-block mr-1" />
                    Save Method
                  </button>
                </div>
              )}
            </>
          )}

          <button
            onClick={() => setShowForm((prev) => !prev)}
            className="w-full mt-4 py-4 rounded-2xl border-2 border-dashed border-outline-variant/30 text-on-surface-variant font-bold flex items-center justify-center gap-2 hover:bg-surface-container-lowest hover:border-primary/30 hover:text-primary transition-all active:scale-[0.98]"
          >
            <Plus size={20} />
            {showForm ? 'Cancel' : t('wallet.add')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
