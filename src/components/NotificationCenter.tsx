import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bell, AlertCircle, ChevronRight, CheckCheck, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useI18n } from '../lib/i18n';
import { Subscription } from '../constants';
import { cn } from '../lib/utils';
import AddSubscription from './AddSubscription';
import { api, NotificationItem } from '../lib/api';

import { useBackHandler } from '../lib/backButton';

export default function NotificationCenter({ onClose }: { onClose: () => void }) {
  useBackHandler(onClose);
  const { t } = useI18n();
  const [editingSub, setEditingSub] = useState<any | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [subscriptionsById, setSubscriptionsById] = useState<Record<string, Subscription>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.isRead).length,
    [notifications]
  );

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [notificationData, subscriptions] = await Promise.all([
        api.getNotifications(),
        api.getSubscriptions(),
      ]);

      const map: Record<string, Subscription> = {};
      subscriptions.forEach((sub) => {
        map[sub.id] = sub;
      });

      setSubscriptionsById(map);
      setNotifications(notificationData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleOpenNotification = async (item: NotificationItem) => {
    if (!item.isRead) {
      try {
        const updated = await api.markNotificationRead(item.id);
        setNotifications((prev) => prev.map((n) => (n.id === item.id ? updated : n)));
      } catch {
        // keep UX responsive even if read marking fails
      }
    }

    const relatedSubscription = item.relatedSubscriptionId
      ? subscriptionsById[item.relatedSubscriptionId]
      : null;

    if (relatedSubscription) {
      setEditingSub(relatedSubscription);
    }
  };

  const markAllRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update notifications');
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-surface flex flex-col"
    >
      {/* Header */}
      <header className="safe-area-header fixed top-0 w-full z-50 glass-effect transition-opacity">
        <div className="flex items-center px-6 h-16 w-full max-w-2xl mx-auto relative">
          <button onClick={onClose} className="absolute left-6 text-primary font-medium hover:opacity-70 transition-opacity active:scale-95">
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-lg font-bold text-on-surface w-full text-center">{t('notifications.title')}</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 pt-28 pb-32 space-y-5 overflow-y-auto no-scrollbar flex-1 w-full">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-on-surface-variant">
            {unreadCount > 0 ? t('notifications.unread').replace('{count}', String(unreadCount)) : t('notifications.allCaughtUp')}
          </p>
          <button
            onClick={markAllRead}
            disabled={unreadCount === 0 || loading}
            className="text-xs font-bold text-primary disabled:opacity-40 flex items-center gap-1"
          >
            <CheckCheck size={14} /> {t('notifications.markAllRead')}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48 text-on-surface-variant">
            <Loader2 size={28} className="animate-spin" />
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-600">
            {error}
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-on-surface-variant opacity-60">
            <Bell size={48} className="mb-4" />
            <p className="font-medium">{t('notifications.empty')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {notifications.map((item) => {
              const isUrgent = item.severity === 'critical';
              const isWarning = item.severity === 'warning';
              
              return (
                <div 
                  key={item.id}
                  onClick={() => void handleOpenNotification(item)}
                  className={cn(
                    "bg-surface-container-lowest rounded-2xl border overflow-hidden shadow-sm hover:shadow-md transition-all cursor-pointer p-4",
                    isUrgent
                      ? "border-red-500/30"
                      : isWarning
                        ? "border-orange-500/20"
                        : "border-outline-variant/10",
                    !item.isRead ? "ring-1 ring-primary/10" : "opacity-90"
                  )}
                >
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full overflow-hidden bg-surface-container-low shrink-0 flex items-center justify-center">
                      {item.relatedSubscriptionId && subscriptionsById[item.relatedSubscriptionId]?.icon ? (
                          <img
                            src={subscriptionsById[item.relatedSubscriptionId].icon}
                            alt={item.title}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                      ) : (
                          <Bell size={14} className="text-primary" />
                      )}
                    </div>
                    
                    <div className="flex-1 space-y-1">
                      <div className="flex justify-between items-start">
                        <h3 className="font-bold text-on-surface">{item.title}</h3>
                        <span className={cn(
                          "text-[10px] px-2 py-0.5 font-bold rounded-md uppercase",
                          isUrgent
                            ? "bg-red-50 text-red-600"
                            : isWarning
                              ? "bg-orange-50 text-orange-600"
                              : "bg-blue-50 text-blue-600"
                        )}>
                          {t(`notifications.severity.${item.severity}`)}
                        </span>
                      </div>

                      <p className="text-xs text-on-surface-variant leading-relaxed">{item.message}</p>

                      {item.type === 'trial_ending' && (
                        <div className="flex items-start gap-1.5 text-red-600 mt-2 bg-red-50 p-2 rounded-lg">
                          <AlertCircle size={14} className="shrink-0 mt-0.5" />
                          <p className="text-xs font-medium leading-tight">
                            {t('notifications.trialEnding')}
                          </p>
                        </div>
                      )}
                      
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-outline-variant/10">
                        <span className="text-xs font-bold text-primary">{item.actionText || t('notifications.renewOrCancel')}</span>
                        <ChevronRight size={16} className="text-primary" />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Edit Modal */}
      <AnimatePresence>
        {editingSub && (
          <AddSubscription 
            onClose={() => setEditingSub(null)} 
            initialData={editingSub} 
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
