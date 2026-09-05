export interface Subscription {
  id: string;
  name: string;
  icon: string;
  price: number;
  currency: string;
  billingCycle: 'monthly' | 'annually';
  nextBillingDate: string;
  category: string;
  account: string;
  region: string;
  status: 'normal' | 'urgent' | 'trial' | 'expired';
  daysLeft?: number;
}

export const MOCK_SUBSCRIPTIONS: Subscription[] = [
  {
    id: '1',
    name: 'Netflix',
    icon: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD0ipLfXKbyebTNRBO_BYEojYsNKGUhY5Pha3Lkt_mtlHus6sl6hRVoSo0-8YFWICZ7haphydCQUyDFQcOaLrvY2RXcHI6TxOFesSLa7X2NPB3zapNMPNAsAxQh2R0Qb4ObgFsfdRSDUPjcmkgKDvJj2169KTDRTakph5WK8_viUr3MMdwYJSfEsqApqjGbWraWsvYRiDmmDaDNXQ2CsKaT1er40VMHgKxmO_1zDmC9DwQbfx2LPtiaer-KiM5DalHxDKLH9fuWKs4o',
    price: 15.99,
    currency: 'USD',
    billingCycle: 'monthly',
    nextBillingDate: '2026-06-24',
    category: 'Entertainment',
    account: 'Personal Apple ID',
    region: 'US Region',
    status: 'urgent',
    daysLeft: 2,
  },
  {
    id: '2',
    name: 'Adobe Creative Cloud',
    icon: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAmf54bDrPc32nVXB2UI6E3xEy1YlrV4N1uNAIu3GlT_YDhrA3VgeqvMumO6jXhbF3xBDgrwliIvpABrWxkQH2AOO7uER7D77GIzQYSGTstiENrDBFLCtqAcoS06PtTY4XLG7N0Fval8_Lz2AbRJpMAuc81lPRCy3JKVtsNMipOgHHv1ZrZxwQ7kPA4lvtV5d4wOQuj8SD3mwM9oA4FDeUQmfZjHa08MHfK6GlghKDJZIPPnYvXurkAG0n2VJI---23yxY9vq9FlT6m',
    price: 52.99,
    currency: 'USD',
    billingCycle: 'monthly',
    nextBillingDate: '2026-04-02',
    category: 'Software',
    account: 'Personal Apple ID',
    region: 'Global',
    status: 'trial',
    daysLeft: 1,
  },
  {
    id: '3',
    name: 'Slack Pro',
    icon: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCIkW0FutGyi2Dnoa4B7sUL1E8MWQ5wG5vc5U5EILfP94BhW3mjMXnrsOJyhmofC8G7WL9PRdDTjNYCm1NUE6mnfYI1osR_UooiZp8IcSDfIheZ5E9VB2YjWVh1ziW_w0RmunmKYOvb1HS0jmoxK9a9r9xpuV4kJ76A0AtMvnZ8z4SYUId5mktSxZsOXAq6Rub5ueni6fIaTNr6Mw4O4cby2D9G6mfI9pp-lyY-H-CQhiGLeTgaXlF74X3iUIfr5h6ph3xeNlNwyQfe',
    price: 8.75,
    currency: 'USD',
    billingCycle: 'monthly',
    nextBillingDate: '2026-06-22',
    category: 'Productivity',
    account: 'Work Apple ID',
    region: 'San Francisco',
    status: 'urgent',
    daysLeft: 2,
  },
  {
    id: '4',
    name: 'Apple TV+',
    icon: 'https://picsum.photos/seed/appletv/100/100',
    price: 9.99,
    currency: 'USD',
    billingCycle: 'monthly',
    nextBillingDate: '2026-04-03',
    category: 'Entertainment',
    account: 'Personal Apple ID',
    region: 'US Region',
    status: 'urgent',
    daysLeft: 2,
  },
  {
    id: '5',
    name: 'Notion Pro',
    icon: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAWFcNl6zS_1nVALoHukTsV4IW9ABoEAn-Q_NrVZ6O3OLKrFYfHmz60hOfVBJDmIlcz8aDsDvdZp7Ic4WEPS_1CecXKITI2SUB7rhN0LjH0FNhfgDTZ7DlyGh6kBgxqn0t33LP3R6g_YPDzpS195ZoWCyc_M4f_7Rlj8rGJiQgELgGYJYlnvKEDiX6SQBrtzpyiSlBJUIEMEiRJbrSrworV1NcYcqp-uQiSqzUcmcbLMUdqjNVAD-PFUf9RvPrzLurjb0gncZuDGKf9',
    price: 10.00,
    currency: 'USD',
    billingCycle: 'monthly',
    nextBillingDate: '2026-04-05',
    category: 'Productivity',
    account: 'Personal Apple ID',
    region: 'Global',
    status: 'normal',
    daysLeft: 4,
  },
  {
    id: '6',
    name: 'Spotify Premium',
    icon: 'https://picsum.photos/seed/spotify/100/100',
    price: 9.99,
    currency: 'USD',
    billingCycle: 'monthly',
    nextBillingDate: '2026-04-01',
    category: 'Entertainment',
    account: 'Personal Apple ID',
    region: 'US Region',
    status: 'urgent',
    daysLeft: 0,
  }
];

export const CATEGORIES = [
  { name: 'Entertainment', count: 12, icon: 'Movie', color: '#6664e4' },
  { name: 'Finance', count: 4, icon: 'Wallet', color: '#10b981' },
  { name: 'Productivity', count: 8, icon: 'Zap', color: '#316ee9' },
  { name: 'Health & Fitness', count: 3, icon: 'Dumbbell', color: '#ef4444' },
  { name: 'Education', count: 2, icon: 'GraduationCap', color: '#f59e0b' },
  { name: 'Utilities', count: 15, icon: 'Settings', color: '#6366f1' },
  { name: 'Food & Drink', count: 5, icon: 'Utensils', color: '#ec4899' },
  { name: 'Travel', count: 1, icon: 'Plane', color: '#06b6d4' },
  { name: 'News', count: 6, icon: 'Newspaper', color: '#64748b' },
];
