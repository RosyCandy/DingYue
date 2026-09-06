import { Subscription } from '../constants';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/browser';

const normalizeApiBaseUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return '/api';
  }
  return trimmed.replace(/\/+$/, '');
};

const API_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL || '/api');

export const buildApiUrl = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_URL}${normalizedPath}`;
};

export type MembershipPlan = 'trial' | 'monthly' | 'annual' | 'lifetime';

export interface Membership {
  id: number;
  plan: MembershipPlan;
  status: 'trial' | 'active' | 'expired' | 'canceled';
  amount: number;
  currency: string;
  paymentMethod: string;
  payerEmail: string;
  autoRenew: boolean;
  startsAt: string;
  expiresAt: string | null;
}

export interface ActivateMembershipPayload {
  plan: MembershipPlan;
  paymentMethod: string;
  payerEmail: string;
  autoRenew: boolean;
}

export interface NotificationItem {
  id: number;
  type: 'billing_due' | 'trial_ending' | 'membership' | 'system';
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  isRead: boolean;
  relatedSubscriptionId: string | null;
  actionText: string | null;
  actionTarget: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface AccountSummaryItem {
  name: string;
  monthlyTotal: number;
  subscriptionCount: number;
  nextPaymentDate: string | null;
}

export interface AccountSummaryResponse {
  accounts: AccountSummaryItem[];
  subscriptions: Subscription[];
}

export interface CategorySummaryItem {
  name: string;
  count: number;
  monthlyTotal: number;
  color: string;
  isCustom?: boolean;
  customCategoryId?: number | null;
}

export interface CustomCategory {
  id: number;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface StatsTrendItem {
  name: string;
  value: number;
  active: boolean;
  forecast: boolean;
}

export interface StatsCategoryItem {
  name: string;
  amount: number;
  value: number;
  color: string;
}

export interface StatsAccountItem {
  label: string;
  amount: number;
  percentage: number;
  initial: string;
}

export interface StatsOverview {
  totalYearlyForecast: number;
  monthlyForecast: number;
  monthlyBurnRate: number;
  activeSubscriptions: number;
  trendData: StatsTrendItem[];
  categoryBreakdown: StatsCategoryItem[];
  accountComparison: StatsAccountItem[];
  optimization: {
    category: string | null;
    potentialSavings: number;
  };
}

export interface PaymentMethod {
  id: number;
  label: string;
  methodType: 'apple_pay' | 'credit_card' | 'paypal' | 'bank_transfer' | 'other';
  accountRef: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentMethodInput {
  label: string;
  methodType: PaymentMethod['methodType'];
  accountRef?: string;
  isDefault?: boolean;
}

export interface UserSettings {
  theme: 'Light' | 'Dark';
  language: 'English' | '简体中文' | '繁體中文' | 'Latin' | '한국어';
  appLockEnabled: boolean;
  cloudSyncEnabled: boolean;
  lastSyncedAt: string | null;
  updatedAt: string;
}

export interface SecurityOverview {
  email: string;
  hasPassword: boolean;
  googleLinked: boolean;
  passkeyCount: number;
  accountCreatedAt: string;
  recommendations: string[];
}

export interface AuthUserPayload {
  id: number;
  email: string;
  name: string;
  avatar: string | null;
}

export interface AuthSessionPayload {
  token: string;
  user: AuthUserPayload;
}

export interface LocalizedText {
  en: string;
  zh: string;
}

export interface HelpArticle {
  id: string;
  title: LocalizedText;
  summary: LocalizedText;
  content: { en: string[]; zh: string[] };
}

const getAuthHeaders = (includeJsonContentType = false): Headers => {
  const headers = new Headers();
  const token = localStorage.getItem('auth_token');
  if (includeJsonContentType) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
};

const parseApiError = async (response: Response): Promise<string> => {
  try {
    const data = await response.json();
    return data?.error || data?.message || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
};

const toBillingCycle = (value: unknown): 'monthly' | 'annually' => {
  const normalized = String(value ?? '').toLowerCase();
  return normalized === 'annually' || normalized === 'annual' || normalized === 'yearly'
    ? 'annually'
    : 'monthly';
};

const calculateDaysLeft = (dateText?: string | null): number | undefined => {
  if (!dateText) return undefined;
  const today = new Date();
  const nextDate = new Date(dateText);
  if (Number.isNaN(nextDate.getTime())) return undefined;
  const diff = Math.ceil((nextDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return diff;
};

const normalizeSubscription = (item: any): Subscription => {
  const nextBillingDate = item.nextBillingDate ?? item.next_billing_date ?? '';
  return {
    id: String(item.id),
    name: item.name || '',
    icon: item.icon || '',
    price: Number(item.price) || 0,
    currency: item.currency || 'USD',
    billingCycle: toBillingCycle(item.billingCycle ?? item.billing_cycle),
    nextBillingDate: nextBillingDate ? String(nextBillingDate).slice(0, 10) : '',
    category: item.category || '',
    account: item.account || '',
    region: item.region || '',
    status: (item.status || 'normal') as Subscription['status'],
    daysLeft: calculateDaysLeft(nextBillingDate),
  };
};

const buildCreatePayload = (sub: Omit<Subscription, 'id'> | Record<string, any>) => {
  const input = sub as Record<string, any>;
  const nextBillingDate = input.nextBillingDate ?? input.next_billing_date;
  return {
    name: input.name,
    icon: input.icon || null,
    price: Number(input.price) || 0,
    currency: input.currency || 'USD',
    billing_cycle: toBillingCycle(input.billingCycle ?? input.billing_cycle ?? 'monthly'),
    next_billing_date: nextBillingDate || null,
    category: input.category || null,
    account: input.account || null,
    region: input.region || null,
    status: input.status || 'normal',
  };
};

const buildUpdatePayload = (sub: Partial<Subscription> | Record<string, any>) => {
  const input = sub as Record<string, any>;
  const payload: Record<string, unknown> = {};

  if (input.name !== undefined) payload.name = input.name;
  if (input.icon !== undefined) payload.icon = input.icon || null;
  if (input.price !== undefined) payload.price = Number(input.price) || 0;
  if (input.currency !== undefined) payload.currency = input.currency;
  if (input.billingCycle !== undefined || input.billing_cycle !== undefined) {
    payload.billing_cycle = toBillingCycle(input.billingCycle ?? input.billing_cycle);
  }
  if (input.nextBillingDate !== undefined || input.next_billing_date !== undefined) {
    payload.next_billing_date = (input.nextBillingDate ?? input.next_billing_date) || null;
  }
  if (input.category !== undefined) payload.category = input.category || null;
  if (input.account !== undefined) payload.account = input.account || null;
  if (input.region !== undefined) payload.region = input.region || null;
  if (input.status !== undefined) payload.status = input.status;

  return payload;
};

const normalizeMembership = (item: any): Membership => ({
  id: Number(item.id),
  plan: item.plan as MembershipPlan,
  status: item.status as Membership['status'],
  amount: Number(item.amount) || 0,
  currency: item.currency || 'CNY',
  paymentMethod: item.paymentMethod ?? item.payment_method ?? '',
  payerEmail: item.payerEmail ?? item.payer_email ?? '',
  autoRenew: Boolean(item.autoRenew ?? item.auto_renew),
  startsAt: item.startsAt ?? item.starts_at,
  expiresAt: item.expiresAt ?? item.expires_at ?? null,
});

const normalizeNotification = (item: any): NotificationItem => ({
  id: Number(item.id),
  type: (item.type || 'system') as NotificationItem['type'],
  title: item.title || '',
  message: item.message || '',
  severity: (item.severity || 'info') as NotificationItem['severity'],
  isRead: Boolean(item.isRead ?? item.is_read),
  relatedSubscriptionId: item.relatedSubscriptionId ?? item.related_subscription_id ?? null,
  actionText: item.actionText ?? item.action_text ?? null,
  actionTarget: item.actionTarget ?? item.action_target ?? null,
  createdAt: item.createdAt ?? item.created_at,
  readAt: item.readAt ?? item.read_at ?? null,
});

const normalizePaymentMethod = (item: any): PaymentMethod => ({
  id: Number(item.id),
  label: item.label || '',
  methodType: (item.methodType ?? item.method_type ?? 'other') as PaymentMethod['methodType'],
  accountRef: item.accountRef ?? item.account_ref ?? null,
  isDefault: Boolean(item.isDefault ?? item.is_default),
  createdAt: item.createdAt ?? item.created_at,
  updatedAt: item.updatedAt ?? item.updated_at,
});

const normalizeCustomCategory = (item: any): CustomCategory => ({
  id: Number(item.id),
  name: String(item.name || ''),
  color: String(item.color || '#0054cd'),
  createdAt: item.createdAt ?? item.created_at,
  updatedAt: item.updatedAt ?? item.updated_at,
});

const normalizeLanguage = (language: unknown): UserSettings['language'] => {
  const value = String(language || '').trim();
  if (value === '简体中文' || value === '繁體中文' || value === 'Latin' || value === '한국어') {
    return value;
  }
  return 'English';
};

const normalizeUserSettings = (item: any): UserSettings => ({
  theme: (item.theme === 'Dark' ? 'Dark' : 'Light') as UserSettings['theme'],
  language: normalizeLanguage(item.language),
  appLockEnabled: Boolean(item.appLockEnabled ?? item.app_lock_enabled),
  cloudSyncEnabled: Boolean(item.cloudSyncEnabled ?? item.cloud_sync_enabled),
  lastSyncedAt: item.lastSyncedAt ?? item.last_synced_at ?? null,
  updatedAt: item.updatedAt ?? item.updated_at,
});

export const api = {
  async getSubscriptions(): Promise<Subscription[]> {
    const response = await fetch(`${API_URL}/subscriptions`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return Array.isArray(data) ? data.map(normalizeSubscription) : [];
  },

  async createSubscription(sub: Omit<Subscription, 'id'>): Promise<Subscription> {
    const response = await fetch(`${API_URL}/subscriptions`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify(buildCreatePayload(sub)),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return normalizeSubscription(data);
  },

  async updateSubscription(id: string, sub: Partial<Subscription>): Promise<Subscription> {
    const response = await fetch(`${API_URL}/subscriptions/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(true),
      body: JSON.stringify(buildUpdatePayload(sub)),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return normalizeSubscription(data);
  },

  async deleteSubscription(id: string): Promise<void> {
    const response = await fetch(`${API_URL}/subscriptions/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
  },

  async getCurrentMembership(): Promise<Membership | null> {
    const response = await fetch(`${API_URL}/membership/current`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return data ? normalizeMembership(data) : null;
  },

  async activateMembership(payload: ActivateMembershipPayload): Promise<Membership> {
    const response = await fetch(`${API_URL}/membership/activate`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify({
        plan: payload.plan,
        payment_method: payload.paymentMethod,
        payer_email: payload.payerEmail,
        auto_renew: payload.autoRenew,
      }),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return normalizeMembership(data);
  },

  async getMembershipHistory(): Promise<Membership[]> {
    const response = await fetch(`${API_URL}/membership/history`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return Array.isArray(data) ? data.map(normalizeMembership) : [];
  },

  async cancelMembershipAutoRenew(): Promise<Membership> {
    const response = await fetch(`${API_URL}/membership/cancel-auto-renew`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return normalizeMembership(data);
  },

  async restoreMembershipPurchase(): Promise<Membership> {
    const response = await fetch(`${API_URL}/membership/restore`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return normalizeMembership(data);
  },

  async getNotifications(): Promise<NotificationItem[]> {
    const response = await fetch(`${API_URL}/notifications`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return Array.isArray(data) ? data.map(normalizeNotification) : [];
  },

  async markNotificationRead(id: number): Promise<NotificationItem> {
    const response = await fetch(`${API_URL}/notifications/${id}/read`, {
      method: 'PATCH',
      headers: getAuthHeaders(true),
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return normalizeNotification(data);
  },

  async markAllNotificationsRead(): Promise<void> {
    const response = await fetch(`${API_URL}/notifications/read-all`, {
      method: 'PATCH',
      headers: getAuthHeaders(true),
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
  },

  async getStatsOverview(): Promise<StatsOverview> {
    const response = await fetch(`${API_URL}/stats/overview`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    return response.json();
  },

  async getAccountSummary(): Promise<AccountSummaryResponse> {
    const response = await fetch(`${API_URL}/accounts/summary`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return {
      accounts: Array.isArray(data?.accounts)
        ? data.accounts.map((item: any) => ({
            name: item.name,
            monthlyTotal: Number(item.monthlyTotal ?? item.monthly_total ?? 0),
            subscriptionCount: Number(item.subscriptionCount ?? item.subscription_count ?? 0),
            nextPaymentDate: item.nextPaymentDate ?? item.next_payment_date ?? null,
          }))
        : [],
      subscriptions: Array.isArray(data?.subscriptions)
        ? data.subscriptions.map(normalizeSubscription)
        : [],
    };
  },

  async getCategorySummary(): Promise<CategorySummaryItem[]> {
    const response = await fetch(`${API_URL}/categories/summary`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    if (!Array.isArray(data?.categories)) return [];
    return data.categories.map((item: any) => ({
      name: item.name,
      count: Number(item.count || 0),
      monthlyTotal: Number(item.monthlyTotal ?? item.monthly_total ?? 0),
      color: item.color || '#0054cd',
      isCustom: Boolean(item.isCustom ?? item.is_custom),
      customCategoryId: item.customCategoryId ?? item.custom_category_id ?? null,
    }));
  },

  async getCustomCategories(): Promise<CustomCategory[]> {
    const response = await fetch(`${API_URL}/custom-categories`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return Array.isArray(data) ? data.map(normalizeCustomCategory) : [];
  },

  async createCustomCategory(payload: { name: string; color?: string }): Promise<CustomCategory> {
    const response = await fetch(`${API_URL}/custom-categories`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify({
        name: payload.name,
        color: payload.color,
      }),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return normalizeCustomCategory(data);
  },

  async updateCustomCategory(id: number, payload: { name?: string; color?: string }): Promise<CustomCategory> {
    const response = await fetch(`${API_URL}/custom-categories/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(true),
      body: JSON.stringify({
        name: payload.name,
        color: payload.color,
      }),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return normalizeCustomCategory(data);
  },

  async deleteCustomCategory(id: number): Promise<{ success: boolean; reassignedSubscriptions: number }> {
    const response = await fetch(`${API_URL}/custom-categories/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    return response.json();
  },

  async updateSubscriptionCategory(id: string, category: string): Promise<Subscription> {
    const response = await fetch(`${API_URL}/subscriptions/${id}/category`, {
      method: 'PATCH',
      headers: getAuthHeaders(true),
      body: JSON.stringify({ category }),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return normalizeSubscription(data);
  },

  async uploadSubscriptionIcon(file: File): Promise<string> {
    const formData = new FormData();
    formData.append('icon', file);

    const response = await fetch(`${API_URL}/uploads/icon`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: formData,
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return String(data?.url || '');
  },

  async uploadAvatar(file: File): Promise<string> {
    const formData = new FormData();
    formData.append('avatar', file);

    const response = await fetch(`${API_URL}/uploads/avatar`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: formData,
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return String(data?.url || '');
  },

  async getPaymentMethods(): Promise<PaymentMethod[]> {
    const response = await fetch(`${API_URL}/payment-methods`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return Array.isArray(data) ? data.map(normalizePaymentMethod) : [];
  },

  async createPaymentMethod(payload: PaymentMethodInput): Promise<PaymentMethod> {
    const response = await fetch(`${API_URL}/payment-methods`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify({
        label: payload.label,
        method_type: payload.methodType,
        account_ref: payload.accountRef,
        is_default: payload.isDefault,
      }),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return normalizePaymentMethod(data);
  },

  async updatePaymentMethod(id: number, payload: Partial<PaymentMethodInput>): Promise<PaymentMethod> {
    const response = await fetch(`${API_URL}/payment-methods/${id}`, {
      method: 'PUT',
      headers: getAuthHeaders(true),
      body: JSON.stringify({
        label: payload.label,
        method_type: payload.methodType,
        account_ref: payload.accountRef,
        is_default: payload.isDefault,
      }),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return normalizePaymentMethod(data);
  },

  async deletePaymentMethod(id: number): Promise<void> {
    const response = await fetch(`${API_URL}/payment-methods/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
  },

  async getUserSettings(): Promise<UserSettings> {
    const response = await fetch(`${API_URL}/settings`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return normalizeUserSettings(data);
  },

  async updateUserSettings(payload: Partial<UserSettings>): Promise<UserSettings> {
    const response = await fetch(`${API_URL}/settings`, {
      method: 'PUT',
      headers: getAuthHeaders(true),
      body: JSON.stringify({
        theme: payload.theme,
        language: payload.language,
        app_lock_enabled: payload.appLockEnabled,
        cloud_sync_enabled: payload.cloudSyncEnabled,
      }),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return normalizeUserSettings(data);
  },

  async triggerCloudSync(): Promise<UserSettings> {
    const response = await fetch(`${API_URL}/settings/cloud-sync`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return normalizeUserSettings(data);
  },

  async getSecurityOverview(): Promise<SecurityOverview> {
    const response = await fetch(`${API_URL}/security/overview`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    return response.json();
  },

  async updateSecurityEmail(email: string): Promise<AuthSessionPayload> {
    const response = await fetch(`${API_URL}/security/email`, {
      method: 'PATCH',
      headers: getAuthHeaders(true),
      body: JSON.stringify({ email }),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    return response.json();
  },

  async setSecurityPassword(newPassword: string, currentPassword?: string): Promise<SecurityOverview> {
    const response = await fetch(`${API_URL}/security/password`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify({ newPassword, currentPassword }),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    return response.json();
  },

  async unlinkGoogleAccount(): Promise<SecurityOverview> {
    const response = await fetch(`${API_URL}/security/unlink-google`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    return response.json();
  },

  async getHelpArticles(): Promise<HelpArticle[]> {
    const response = await fetch(`${API_URL}/help/articles`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    const data = await response.json();
    return Array.isArray(data)
      ? data.map((item) => ({
          id: String(item.id || ''),
          title: { en: String(item.title?.en || ''), zh: String(item.title?.zh || '') },
          summary: { en: String(item.summary?.en || ''), zh: String(item.summary?.zh || '') },
          content: {
            en: Array.isArray(item.content?.en) ? item.content.en.map(String) : [],
            zh: Array.isArray(item.content?.zh) ? item.content.zh.map(String) : [],
          },
        }))
      : [];
  },

  async getProfile(): Promise<{ id: number; email: string; name: string; avatar: string | null }> {
    const response = await fetch(`${API_URL}/users/profile`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    return response.json();
  },

  async updateProfile(payload: { name?: string; avatar?: string | null }): Promise<AuthSessionPayload & { avatar: string | null }> {
    const response = await fetch(`${API_URL}/users/profile`, {
      method: 'PATCH',
      headers: getAuthHeaders(true),
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    return response.json();
  },

  async deleteAccount(): Promise<void> {
    const response = await fetch(`${API_URL}/users/account`, {
      method: 'DELETE',
      headers: getAuthHeaders(true),
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
  },

  async getFxRates(): Promise<{ base: string; rates: Record<string, number>; fetchedAt: number; stale?: boolean }> {
    const response = await fetch(`${API_URL}/fx/rates`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    return response.json();
  },

  async beginPasskeyRegistration(): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const response = await fetch(`${API_URL}/webauthn/register/options`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    return response.json();
  },

  async finishPasskeyRegistration(credential: RegistrationResponseJSON): Promise<{ verified: boolean; passkeyCount: number }> {
    const response = await fetch(`${API_URL}/webauthn/register/verify`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify({ credential }),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    return response.json();
  },

  async beginPasskeyAuthentication(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const response = await fetch(`${API_URL}/webauthn/auth/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    return response.json();
  },

  async finishPasskeyAuthentication(credential: AuthenticationResponseJSON): Promise<AuthSessionPayload> {
    const response = await fetch(`${API_URL}/webauthn/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    });
    if (!response.ok) throw new Error(await parseApiError(response));
    return response.json();
  },
};
