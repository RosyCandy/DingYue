import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import multer from 'multer';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

dotenv.config();

// 如果本机需要通过代理才能访问 Google（例如部分网络环境下 accounts.google.com /
// www.googleapis.com 无法直连），可以在 .env 中设置 HTTPS_PROXY（或 HTTP_PROXY），
// 例如 HTTPS_PROXY=http://127.0.0.1:7890。设置后，Node 后端对 Google 的所有
// fetch 请求（包括校验 Google 登录凭证）都会经过该代理转发。
// 注意：浏览器通常会遵循系统代理设置，但 Node.js 默认不会，所以即使浏览器里能弹出
// Google 登录框、选完账号，后端校验 credential 时依然可能因为连不上 Google 而失败。
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`Using proxy for outbound requests (e.g. Google API calls): ${proxyUrl}`);
}

const app = express();
const port = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

type AuthTokenPayload = {
  userId: number;
  email: string;
  name: string;
};

type AuthenticatedRequest = Request & {
  user?: AuthTokenPayload;
};

type MembershipPlan = 'trial' | 'monthly' | 'annual' | 'lifetime';
type MembershipStatus = 'trial' | 'active' | 'expired' | 'canceled';
type UserTheme = 'Light' | 'Dark';
type UserLanguage = 'English' | '简体中文' | '繁體中文' | 'Latin' | '한국어';
type NotificationType = 'billing_due' | 'trial_ending' | 'membership' | 'system';
type NotificationSeverity = 'info' | 'warning' | 'critical';

type SubscriptionRow = {
  id: string;
  user_id: number;
  name: string;
  icon: string | null;
  price: number;
  currency: string;
  billing_cycle: 'monthly' | 'annually';
  next_billing_date: string | null;
  category: string | null;
  account: string | null;
  region: string | null;
  status: 'normal' | 'urgent' | 'trial' | 'expired';
  created_at: string;
  updated_at: string;
};

type CustomCategoryRow = {
  id: number;
  user_id: number;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
};

const MONTH_LABELS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const CATEGORY_COLORS = ['#0054cd', '#4c4aca', '#894d00', '#2e7d32', '#ec4899', '#0ea5e9', '#6366f1', '#16a34a'];
const UPLOAD_ROOT = path.join(process.cwd(), 'server', 'uploads');
const ICON_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'icons');

fs.mkdirSync(ICON_UPLOAD_DIR, { recursive: true });

// 1. 中间件最先注册
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use('/api/uploads', express.static(UPLOAD_ROOT));

// 2. 连接池在所有路由之前定义
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'duoduo_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const parsePrice = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeBillingCycle = (value: unknown): 'monthly' | 'annually' => {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized === 'annually' || normalized === 'annual' || normalized === 'yearly') {
    return 'annually';
  }
  return 'monthly';
};

const parseBoolean = (value: unknown, defaultValue = false): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return defaultValue;
};

const toMonthlyAmount = (subscription: Pick<SubscriptionRow, 'price' | 'billing_cycle'>): number => {
  return subscription.billing_cycle === 'annually'
    ? parsePrice(subscription.price) / 12
    : parsePrice(subscription.price);
};

const sanitizeCategoryName = (value: string | null | undefined): string => {
  const name = String(value || '').trim();
  return name || 'Unassigned';
};

const normalizeCategoryColor = (value: unknown): string => {
  const color = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#0054cd';
};

const sanitizeAccountName = (value: string | null | undefined): string => {
  const name = String(value || '').trim();
  return name || 'Unassigned Account';
};

const computeDaysUntil = (dateText: string | null | undefined): number | null => {
  if (!dateText) return null;
  const target = new Date(dateText);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
};

const toPercentage = (part: number, total: number): number => {
  if (total <= 0) return 0;
  return Number(((part / total) * 100).toFixed(1));
};

const authRequired = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录或登录已过期' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload & Partial<AuthTokenPayload>;
    if (!payload.userId || !payload.email) {
      return res.status(401).json({ error: '无效登录凭证' });
    }

    req.user = {
      userId: payload.userId,
      email: payload.email,
      name: payload.name || ''
    };
    next();
  } catch {
    return res.status(401).json({ error: '无效登录凭证' });
  }
};

const buildAuthResponse = (user: { id: number; email: string; name?: string | null }) => {
  const token = jwt.sign(
    { userId: user.id, email: user.email, name: user.name || '' },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name || ''
    }
  };
};

const buildSecurityOverview = (user: {
  email: string;
  password_hash: string | null;
  google_id: string | null;
  created_at: string;
}) => ({
  email: user.email,
  hasPassword: Boolean(user.password_hash),
  googleLinked: Boolean(user.google_id),
  accountCreatedAt: user.created_at,
  recommendations: [
    'Use a strong password and rotate it periodically.',
    'Enable app lock if your device is shared.',
    'Review active subscriptions every month.'
  ]
});

const iconStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, ICON_UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)
      ? ext
      : '.png';
    cb(null, `${Date.now()}-${crypto.randomUUID()}${safeExt}`);
  }
});

const uploadIconMiddleware = multer({
  storage: iconStorage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const allowedMime = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (allowedMime.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Only image files are allowed'));
  }
});

async function ensureDatabaseSchema() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255),
      google_id VARCHAR(255),
      name VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id VARCHAR(36) PRIMARY KEY,
      user_id INT,
      name VARCHAR(255) NOT NULL,
      icon VARCHAR(255),
      price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
      currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      billing_cycle ENUM('monthly', 'annually') NOT NULL DEFAULT 'monthly',
      next_billing_date DATE,
      category VARCHAR(50),
      account VARCHAR(50),
      region VARCHAR(50),
      status ENUM('normal', 'urgent', 'trial', 'expired') NOT NULL DEFAULT 'normal',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [subscriptionColumns]: any = await pool.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriptions'`
  );
  const subscriptionColumnNames = new Set(
    Array.isArray(subscriptionColumns)
      ? subscriptionColumns.map((row: { COLUMN_NAME: string }) => row.COLUMN_NAME)
      : []
  );

  if (!subscriptionColumnNames.has('user_id')) {
    await pool.execute('ALTER TABLE subscriptions ADD COLUMN user_id INT NULL AFTER id');
  }

  const [subscriptionIndexes]: any = await pool.query(
    `SHOW INDEX FROM subscriptions WHERE Key_name = 'idx_subscriptions_user_id'`
  );
  if (!Array.isArray(subscriptionIndexes) || subscriptionIndexes.length === 0) {
    await pool.execute('CREATE INDEX idx_subscriptions_user_id ON subscriptions (user_id)');
  }

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS memberships (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      plan ENUM('trial', 'monthly', 'annual', 'lifetime') NOT NULL,
      status ENUM('trial', 'active', 'expired', 'canceled') NOT NULL DEFAULT 'active',
      amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
      currency VARCHAR(10) NOT NULL DEFAULT 'CNY',
      payment_method VARCHAR(50) NOT NULL,
      payer_email VARCHAR(255) NOT NULL,
      auto_renew BOOLEAN NOT NULL DEFAULT TRUE,
      starts_at DATETIME NOT NULL,
      expires_at DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_memberships_user_id (user_id),
      CONSTRAINT fk_memberships_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS payment_methods (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      label VARCHAR(120) NOT NULL,
      method_type ENUM('apple_pay', 'credit_card', 'paypal', 'bank_transfer', 'other') NOT NULL,
      account_ref VARCHAR(120),
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_payment_methods_user_id (user_id),
      CONSTRAINT fk_payment_methods_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      notification_key VARCHAR(191) NOT NULL,
      type ENUM('billing_due', 'trial_ending', 'membership', 'system') NOT NULL DEFAULT 'system',
      title VARCHAR(255) NOT NULL,
      message VARCHAR(500) NOT NULL,
      severity ENUM('info', 'warning', 'critical') NOT NULL DEFAULT 'info',
      related_subscription_id VARCHAR(36),
      action_text VARCHAR(80),
      action_target VARCHAR(255),
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      read_at DATETIME,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_notification_key (user_id, notification_key),
      INDEX idx_notifications_user_id (user_id),
      INDEX idx_notifications_read (user_id, is_read),
      CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INT PRIMARY KEY,
      theme ENUM('Light', 'Dark') NOT NULL DEFAULT 'Light',
      language ENUM('English', '简体中文', '繁體中文', 'Latin', '한국어') NOT NULL DEFAULT 'English',
      app_lock_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      cloud_sync_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      last_synced_at DATETIME,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS custom_categories (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      name VARCHAR(80) NOT NULL,
      color VARCHAR(7) NOT NULL DEFAULT '#0054cd',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_custom_categories_user_name (user_id, name),
      INDEX idx_custom_categories_user_id (user_id),
      CONSTRAINT fk_custom_categories_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Keep enum in sync for existing databases created with older schema.
  await pool.execute(`
    ALTER TABLE user_settings
    MODIFY language ENUM('English', '简体中文', '繁體中文', 'Latin', '한국어') NOT NULL DEFAULT 'English'
  `);

  // Legacy-data safeguard: if the project has only one user, bind old subscriptions with NULL user_id to that user.
  const [userRows]: any = await pool.query('SELECT id FROM users ORDER BY id ASC');
  if (Array.isArray(userRows) && userRows.length === 1) {
    const onlyUserId = userRows[0].id;
    await pool.execute(
      'UPDATE subscriptions SET user_id = ? WHERE user_id IS NULL',
      [onlyUserId]
    );
  }
}

const fetchUserSubscriptions = async (userId: number): Promise<SubscriptionRow[]> => {
  const [rows]: any = await pool.query(
    'SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  );
  return (Array.isArray(rows) ? rows : []) as SubscriptionRow[];
};

const fetchUserCustomCategories = async (userId: number): Promise<CustomCategoryRow[]> => {
  const [rows]: any = await pool.query(
    'SELECT * FROM custom_categories WHERE user_id = ? ORDER BY created_at DESC',
    [userId]
  );
  return (Array.isArray(rows) ? rows : []) as CustomCategoryRow[];
};

const ensureUserSettingsRow = async (userId: number) => {
  await pool.execute(
    'INSERT INTO user_settings (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id = user_id',
    [userId]
  );
};

const buildAccountSummary = (subscriptions: SubscriptionRow[]) => {
  const map = new Map<string, { name: string; monthlyTotal: number; subscriptionCount: number; nextPaymentDate: string | null }>();

  subscriptions.forEach((sub) => {
    const name = sanitizeAccountName(sub.account);
    const current = map.get(name) || {
      name,
      monthlyTotal: 0,
      subscriptionCount: 0,
      nextPaymentDate: null
    };

    current.monthlyTotal += toMonthlyAmount(sub);
    current.subscriptionCount += 1;

    if (sub.next_billing_date) {
      if (!current.nextPaymentDate || new Date(sub.next_billing_date).getTime() < new Date(current.nextPaymentDate).getTime()) {
        current.nextPaymentDate = sub.next_billing_date;
      }
    }
    map.set(name, current);
  });

  return Array.from(map.values())
    .map((item) => ({
      ...item,
      monthlyTotal: Number(item.monthlyTotal.toFixed(2))
    }))
    .sort((a, b) => b.monthlyTotal - a.monthlyTotal);
};

const buildCategorySummary = (
  subscriptions: SubscriptionRow[],
  customCategories: Array<{ id: number; name: string; color: string }> = []
) => {
  const map = new Map<string, {
    name: string;
    count: number;
    monthlyTotal: number;
    color?: string;
    isCustom: boolean;
    customCategoryId: number | null;
  }>();

  customCategories.forEach((category) => {
    const name = String(category.name || '').trim();
    if (!name) return;
    map.set(name, {
      name,
      count: 0,
      monthlyTotal: 0,
      color: normalizeCategoryColor(category.color),
      isCustom: true,
      customCategoryId: Number(category.id) || null,
    });
  });

  subscriptions.forEach((sub) => {
    const name = sanitizeCategoryName(sub.category);
    const current = map.get(name) || {
      name,
      count: 0,
      monthlyTotal: 0,
      color: undefined,
      isCustom: false,
      customCategoryId: null,
    };
    current.count += 1;
    current.monthlyTotal += toMonthlyAmount(sub);
    map.set(name, current);
  });

  return Array.from(map.values())
    .sort((a, b) => {
      if (b.monthlyTotal !== a.monthlyTotal) return b.monthlyTotal - a.monthlyTotal;
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    })
    .map((item, index) => ({
      ...item,
      monthlyTotal: Number(item.monthlyTotal.toFixed(2)),
      color: item.color || CATEGORY_COLORS[index % CATEGORY_COLORS.length]
    }));
};

const buildStatsOverview = (subscriptions: SubscriptionRow[]) => {
  const monthlyForecast = subscriptions.reduce((acc, sub) => acc + toMonthlyAmount(sub), 0);
  const totalYearlyForecast = monthlyForecast * 12;
  const now = new Date();
  const currentMonthIndex = now.getMonth();

  const trend = MONTH_LABELS.map((name, index) => ({
    name,
    value: 0,
    active: index === currentMonthIndex,
    forecast: index > currentMonthIndex
  }));

  subscriptions.forEach((sub) => {
    if (sub.billing_cycle === 'monthly') {
      trend.forEach((month) => {
        month.value += parsePrice(sub.price);
      });
      return;
    }

    const billingMonth = sub.next_billing_date && !Number.isNaN(new Date(sub.next_billing_date).getTime())
      ? new Date(sub.next_billing_date).getMonth()
      : currentMonthIndex;
    trend[billingMonth].value += parsePrice(sub.price);
  });

  const trendData = trend.map((item) => ({
    ...item,
    value: Number(item.value.toFixed(2))
  }));

  const currentMonthValue = trendData[currentMonthIndex]?.value || 0;
  const previousMonthValue = trendData[(currentMonthIndex + 11) % 12]?.value || 0;
  const monthlyBurnRate = previousMonthValue > 0
    ? Number((((currentMonthValue - previousMonthValue) / previousMonthValue) * 100).toFixed(1))
    : 0;

  const categoryTotals = buildCategorySummary(subscriptions);
  const categoryBreakdown = categoryTotals.map((item) => ({
    name: item.name,
    amount: item.monthlyTotal,
    value: toPercentage(item.monthlyTotal, monthlyForecast),
    color: item.color
  }));

  const accountTotals = buildAccountSummary(subscriptions);
  const maxAccountTotal = accountTotals.reduce((max, item) => Math.max(max, item.monthlyTotal), 0);
  const accountComparison = accountTotals.map((item) => ({
    label: item.name,
    amount: item.monthlyTotal,
    percentage: maxAccountTotal > 0 ? toPercentage(item.monthlyTotal, maxAccountTotal) : 0,
    initial: item.name.charAt(0).toUpperCase()
  }));

  const optimizationCandidate = categoryTotals.find((item) => item.count >= 2);
  const potentialSavings = optimizationCandidate
    ? Number((optimizationCandidate.monthlyTotal * 0.15).toFixed(2))
    : 0;

  return {
    totalYearlyForecast: Number(totalYearlyForecast.toFixed(2)),
    monthlyForecast: Number(monthlyForecast.toFixed(2)),
    monthlyBurnRate,
    activeSubscriptions: subscriptions.length,
    trendData,
    categoryBreakdown,
    accountComparison,
    optimization: {
      category: optimizationCandidate?.name || null,
      potentialSavings
    }
  };
};

const upsertNotification = async ({
  userId,
  notificationKey,
  type,
  title,
  message,
  severity,
  relatedSubscriptionId,
  actionText,
  actionTarget
}: {
  userId: number;
  notificationKey: string;
  type: NotificationType;
  title: string;
  message: string;
  severity: NotificationSeverity;
  relatedSubscriptionId?: string;
  actionText?: string;
  actionTarget?: string;
}) => {
  await pool.execute(
    `INSERT INTO notifications
      (user_id, notification_key, type, title, message, severity, related_subscription_id, action_text, action_target, is_read)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)
     ON DUPLICATE KEY UPDATE
      title = VALUES(title),
      message = VALUES(message),
      severity = VALUES(severity),
      related_subscription_id = VALUES(related_subscription_id),
      action_text = VALUES(action_text),
      action_target = VALUES(action_target),
      updated_at = CURRENT_TIMESTAMP`,
    [
      userId,
      notificationKey,
      type,
      title,
      message,
      severity,
      relatedSubscriptionId || null,
      actionText || null,
      actionTarget || null
    ]
  );
};

const syncSubscriptionNotifications = async (userId: number) => {
  const subscriptions = await fetchUserSubscriptions(userId);

  for (const sub of subscriptions) {
    const daysLeft = computeDaysUntil(sub.next_billing_date);
    if (daysLeft === null || daysLeft > 7) continue;

    const severity: NotificationSeverity = daysLeft <= 1 ? 'critical' : daysLeft <= 3 ? 'warning' : 'info';
    const billingKey = `billing:${sub.id}:${sub.next_billing_date || 'na'}`;
    const billingTitle = `${sub.name} billing reminder`;
    const billingMessage = daysLeft <= 0
      ? `${sub.name} is due today. Please review your payment method.`
      : `${sub.name} renews in ${daysLeft} day(s).`;

    await upsertNotification({
      userId,
      notificationKey: billingKey,
      type: 'billing_due',
      title: billingTitle,
      message: billingMessage,
      severity,
      relatedSubscriptionId: sub.id,
      actionText: 'Renew or Cancel',
      actionTarget: `/subscriptions/${sub.id}`
    });

    if (sub.status === 'trial' && daysLeft <= 3) {
      await upsertNotification({
        userId,
        notificationKey: `trial:${sub.id}:${sub.next_billing_date || 'na'}`,
        type: 'trial_ending',
        title: `${sub.name} trial ending`,
        message: 'Free trial ending soon. Cancel to avoid charges.',
        severity: 'warning',
        relatedSubscriptionId: sub.id,
        actionText: 'Renew or Cancel',
        actionTarget: `/subscriptions/${sub.id}`
      });
    }
  }
};

// ─────────────────────────────────────────────
// Auth Routes
// ─────────────────────────────────────────────

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: '请填写所有必填字段' });
  }
  try {
    const hashed = await bcrypt.hash(password, 10);
    await pool.execute(
        'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
        [email, hashed, name]
    );
    res.json({ success: true });
  } catch (e: any) {
    console.error('Register error:', e); // ← 打印完整错误
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: '邮箱已注册' });
    }
    if (e.code === 'ER_NO_SUCH_TABLE') {
      return res.status(500).json({ error: 'users 表不存在，请先初始化数据库' });
    }
    if (e.code === 'ECONNREFUSED' || e.code === 'ER_ACCESS_DENIED_ERROR') {
      return res.status(500).json({ error: '数据库连接失败: ' + e.message });
    }
    res.status(400).json({ error: '注册失败: ' + e.message });
  }
});


// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: '请填写邮箱和密码' });
  }
  try {
    const [rows]: any = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
    const user = rows[0];
    if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: '邮箱或密码错误' });
    }
    res.json(buildAuthResponse(user));
  } catch (e: any) {
    res.status(500).json({ error: '登录失败: ' + e.message });
  }
});

// POST /api/auth/google
app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ error: '缺少 Google 凭证' });
  }
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    if (!payload?.email) {
      return res.status(400).json({ error: 'Google 账户未返回邮箱信息' });
    }
    const email = payload.email;
    const name = payload.name || payload.email;
    const googleId = payload.sub;

    const [rows]: any = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
    let user = rows[0];
    if (!user) {
      await pool.execute(
          'INSERT INTO users (email, name, google_id) VALUES (?, ?, ?)',
          [email, name, googleId]
      );
      const [newRows]: any = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
      user = newRows[0];
    } else if (!user.google_id) {
      // 已存在的邮箱/密码账户首次使用 Google 登录时，补充关联 google_id
      await pool.execute('UPDATE users SET google_id = ? WHERE id = ?', [googleId, user.id]);
      user.google_id = googleId;
    }
    res.json(buildAuthResponse(user));
  } catch (e: any) {
    res.status(400).json({ error: 'Google 登录失败: ' + e.message });
  }
});

app.post('/api/uploads/icon', authRequired, (req: AuthenticatedRequest, res) => {
  uploadIconMiddleware.single('icon')(req as Request, res, (error: any) => {
    if (error) {
      const message = error?.message || 'Upload failed';
      if (error?.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Image file is too large (max 5MB)' });
      }
      return res.status(400).json({ error: message });
    }

    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    return res.status(201).json({
      url: `/api/uploads/icons/${file.filename}`
    });
  });
});

// ─────────────────────────────────────────────
// Subscription Routes
// ─────────────────────────────────────────────

// 1. GET /api/subscriptions — 获取当前用户订阅
app.get('/api/subscriptions', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const [rows] = await pool.query(
      'SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    res.json(rows);
  } catch (error: any) {
    console.error('Error fetching subscriptions:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. POST /api/subscriptions — 新增订阅
app.post('/api/subscriptions', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const newId = crypto.randomUUID();
    const sub = req.body;

    const status = sub.status || 'normal';
    const price = parsePrice(sub.price);
    const currency = sub.currency || 'USD';
    const next_billing_date = sub.next_billing_date || null;
    const billing_cycle = normalizeBillingCycle(sub.billing_cycle);

    const query = `
      INSERT INTO subscriptions 
      (id, user_id, name, icon, price, currency, billing_cycle, next_billing_date, category, account, region, status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [
      newId,
      userId,
      sub.name,
      sub.icon || null,
      price,
      currency,
      billing_cycle,
      next_billing_date,
      sub.category || null,
      sub.account || null,
      sub.region || null,
      status
    ];

    await pool.execute(query, values);
    const [rows]: any = await pool.query('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?', [newId, userId]);
    res.status(201).json(rows[0]);
  } catch (error: any) {
    console.error('Error creating subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. PUT /api/subscriptions/:id — 更新订阅
app.put('/api/subscriptions/:id', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const sub = req.body;

    const [ownedRows]: any = await pool.query(
      'SELECT id FROM subscriptions WHERE id = ? AND user_id = ? LIMIT 1',
      [id, userId]
    );
    if (!Array.isArray(ownedRows) || ownedRows.length === 0) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    const updates: string[] = [];
    const values: any[] = [];

    const updatableFields = [
      'name', 'icon', 'price', 'currency', 'billing_cycle',
      'next_billing_date', 'category', 'account', 'region', 'status'
    ];

    updatableFields.forEach(field => {
      if (sub[field] !== undefined) {
        let val = sub[field];
        if (field === 'price') {
          val = parsePrice(val);
        }
        if (field === 'billing_cycle') {
          val = normalizeBillingCycle(val);
        }
        if (field === 'next_billing_date' && (!val || val === '')) {
          val = null;
        }
        updates.push(`${field} = ?`);
        values.push(val);
      }
    });

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id, userId);
    const query = `UPDATE subscriptions SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`;
    await pool.execute(query, values);

    const [rows]: any = await pool.query('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?', [id, userId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    res.json(rows[0]);
  } catch (error: any) {
    console.error('Error updating subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. DELETE /api/subscriptions/:id — 删除订阅
app.delete('/api/subscriptions/:id', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const [result]: any = await pool.execute('DELETE FROM subscriptions WHERE id = ? AND user_id = ?', [id, userId]);
    if (!result?.affectedRows) {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
// Accounts, Categories, Stats Routes
// ─────────────────────────────────────────────

app.get('/api/accounts/summary', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const subscriptions = await fetchUserSubscriptions(userId);
    const accounts = buildAccountSummary(subscriptions);
    res.json({ accounts, subscriptions });
  } catch (error: any) {
    console.error('Error fetching account summary:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/categories/summary', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const subscriptions = await fetchUserSubscriptions(userId);
    const customCategories = await fetchUserCustomCategories(userId);
    const categories = buildCategorySummary(
      subscriptions,
      customCategories.map((item) => ({ id: item.id, name: item.name, color: item.color }))
    );
    res.json({ categories });
  } catch (error: any) {
    console.error('Error fetching category summary:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/custom-categories', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const categories = await fetchUserCustomCategories(userId);
    res.json(categories);
  } catch (error: any) {
    console.error('Error fetching custom categories:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/custom-categories', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const name = String(req.body?.name || '').trim();
    const color = normalizeCategoryColor(req.body?.color);

    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    if (name.length > 50) {
      return res.status(400).json({ error: 'Category name must be 50 characters or fewer' });
    }

    await pool.execute(
      `INSERT INTO custom_categories (user_id, name, color)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE color = VALUES(color), updated_at = CURRENT_TIMESTAMP`,
      [userId, name, color]
    );

    const [rows]: any = await pool.query(
      'SELECT * FROM custom_categories WHERE user_id = ? AND name = ? LIMIT 1',
      [userId, name]
    );

    res.status(201).json(rows?.[0]);
  } catch (error: any) {
    console.error('Error creating custom category:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/custom-categories/:id', authRequired, async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.userId;
  const id = Number(req.params.id);

  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid category id' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows]: any = await conn.query(
      'SELECT * FROM custom_categories WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE',
      [id, userId]
    );
    const existing = rows?.[0];
    if (!existing) {
      await conn.rollback();
      return res.status(404).json({ error: 'Custom category not found' });
    }

    const nextName = req.body?.name !== undefined
      ? String(req.body.name || '').trim()
      : String(existing.name || '');
    const nextColor = req.body?.color !== undefined
      ? normalizeCategoryColor(req.body.color)
      : normalizeCategoryColor(existing.color);

    if (!nextName) {
      await conn.rollback();
      return res.status(400).json({ error: 'Category name is required' });
    }
    if (nextName.length > 50) {
      await conn.rollback();
      return res.status(400).json({ error: 'Category name must be 50 characters or fewer' });
    }

    await conn.execute(
      'UPDATE custom_categories SET name = ?, color = ? WHERE id = ? AND user_id = ?',
      [nextName, nextColor, id, userId]
    );

    if (nextName !== existing.name) {
      await conn.execute(
        'UPDATE subscriptions SET category = ? WHERE user_id = ? AND category = ?',
        [nextName, userId, existing.name]
      );
    }

    const [updatedRows]: any = await conn.query(
      'SELECT * FROM custom_categories WHERE id = ? AND user_id = ? LIMIT 1',
      [id, userId]
    );

    await conn.commit();
    return res.json(updatedRows?.[0]);
  } catch (error: any) {
    await conn.rollback();
    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Category name already exists' });
    }
    console.error('Error updating custom category:', error);
    return res.status(500).json({ error: error.message });
  } finally {
    conn.release();
  }
});

app.delete('/api/custom-categories/:id', authRequired, async (req: AuthenticatedRequest, res) => {
  const userId = req.user!.userId;
  const id = Number(req.params.id);

  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid category id' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows]: any = await conn.query(
      'SELECT * FROM custom_categories WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE',
      [id, userId]
    );
    const existing = rows?.[0];
    if (!existing) {
      await conn.rollback();
      return res.status(404).json({ error: 'Custom category not found' });
    }

    const [subResult]: any = await conn.execute(
      'UPDATE subscriptions SET category = NULL WHERE user_id = ? AND category = ?',
      [userId, existing.name]
    );

    await conn.execute('DELETE FROM custom_categories WHERE id = ? AND user_id = ?', [id, userId]);
    await conn.commit();

    return res.json({
      success: true,
      reassignedSubscriptions: Number(subResult?.affectedRows || 0),
    });
  } catch (error: any) {
    await conn.rollback();
    console.error('Error deleting custom category:', error);
    return res.status(500).json({ error: error.message });
  } finally {
    conn.release();
  }
});

app.patch('/api/subscriptions/:id/category', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const category = String(req.body?.category || '').trim();
    if (!category) {
      return res.status(400).json({ error: '分类不能为空' });
    }

    const [result]: any = await pool.execute(
      'UPDATE subscriptions SET category = ? WHERE id = ? AND user_id = ?',
      [category, id, userId]
    );
    if (!result?.affectedRows) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    const [rows]: any = await pool.query('SELECT * FROM subscriptions WHERE id = ? AND user_id = ? LIMIT 1', [id, userId]);
    res.json(rows[0]);
  } catch (error: any) {
    console.error('Error updating category:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats/overview', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const subscriptions = await fetchUserSubscriptions(userId);
    const overview = buildStatsOverview(subscriptions);
    res.json(overview);
  } catch (error: any) {
    console.error('Error fetching stats overview:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
// Notification Routes
// ─────────────────────────────────────────────

app.get('/api/notifications', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    await syncSubscriptionNotifications(userId);

    const [rows]: any = await pool.query(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY is_read ASC, created_at DESC LIMIT 120',
      [userId]
    );
    res.json(rows);
  } catch (error: any) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/notifications/read-all', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    await pool.execute(
      'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE user_id = ? AND is_read = FALSE',
      [userId]
    );
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error reading all notifications:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/notifications/:id/read', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const [result]: any = await pool.execute(
      'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    if (!result?.affectedRows) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const [rows]: any = await pool.query('SELECT * FROM notifications WHERE id = ? AND user_id = ? LIMIT 1', [id, userId]);
    res.json(rows[0]);
  } catch (error: any) {
    console.error('Error reading notification:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
// Payment Method Routes
// ─────────────────────────────────────────────

app.get('/api/payment-methods', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const [rows]: any = await pool.query(
      'SELECT * FROM payment_methods WHERE user_id = ? ORDER BY is_default DESC, created_at DESC',
      [userId]
    );
    res.json(rows);
  } catch (error: any) {
    console.error('Error fetching payment methods:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/payment-methods', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const methodType = String(req.body?.method_type || '').trim() || 'other';
    const label = String(req.body?.label || '').trim();
    const accountRef = String(req.body?.account_ref || '').trim() || null;
    let isDefault = parseBoolean(req.body?.is_default, false);

    if (!label) {
      return res.status(400).json({ error: '支付方式名称不能为空' });
    }

    const [existingRows]: any = await pool.query(
      'SELECT COUNT(*) AS total FROM payment_methods WHERE user_id = ?',
      [userId]
    );
    const total = Number(existingRows?.[0]?.total || 0);
    if (total === 0) {
      isDefault = true;
    }

    if (isDefault) {
      await pool.execute('UPDATE payment_methods SET is_default = FALSE WHERE user_id = ?', [userId]);
    }

    const [result]: any = await pool.execute(
      'INSERT INTO payment_methods (user_id, label, method_type, account_ref, is_default) VALUES (?, ?, ?, ?, ?)',
      [userId, label, methodType, accountRef, isDefault]
    );

    const [rows]: any = await pool.query('SELECT * FROM payment_methods WHERE id = ? AND user_id = ? LIMIT 1', [result.insertId, userId]);
    res.status(201).json(rows[0]);
  } catch (error: any) {
    console.error('Error creating payment method:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/payment-methods/:id', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const [ownedRows]: any = await pool.query(
      'SELECT * FROM payment_methods WHERE id = ? AND user_id = ? LIMIT 1',
      [id, userId]
    );
    if (!Array.isArray(ownedRows) || ownedRows.length === 0) {
      return res.status(404).json({ error: 'Payment method not found' });
    }

    const updates: string[] = [];
    const values: any[] = [];
    if (req.body?.label !== undefined) {
      updates.push('label = ?');
      values.push(String(req.body.label).trim());
    }
    if (req.body?.method_type !== undefined) {
      updates.push('method_type = ?');
      values.push(String(req.body.method_type).trim() || 'other');
    }
    if (req.body?.account_ref !== undefined) {
      updates.push('account_ref = ?');
      values.push(String(req.body.account_ref).trim() || null);
    }

    const isDefaultRequested = req.body?.is_default !== undefined
      ? parseBoolean(req.body.is_default, false)
      : null;

    if (isDefaultRequested !== null) {
      updates.push('is_default = ?');
      values.push(isDefaultRequested);
      if (isDefaultRequested) {
        await pool.execute(
          'UPDATE payment_methods SET is_default = FALSE WHERE user_id = ? AND id <> ?',
          [userId, id]
        );
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id, userId);
    await pool.execute(
      `UPDATE payment_methods SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
      values
    );

    const [rows]: any = await pool.query('SELECT * FROM payment_methods WHERE id = ? AND user_id = ? LIMIT 1', [id, userId]);
    res.json(rows[0]);
  } catch (error: any) {
    console.error('Error updating payment method:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/payment-methods/:id', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;

    const [rows]: any = await pool.query(
      'SELECT * FROM payment_methods WHERE id = ? AND user_id = ? LIMIT 1',
      [id, userId]
    );
    const existing = rows?.[0];
    if (!existing) {
      return res.status(404).json({ error: 'Payment method not found' });
    }

    await pool.execute('DELETE FROM payment_methods WHERE id = ? AND user_id = ?', [id, userId]);

    if (existing.is_default) {
      const [remaining]: any = await pool.query(
        'SELECT id FROM payment_methods WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
      if (remaining?.[0]?.id) {
        await pool.execute('UPDATE payment_methods SET is_default = TRUE WHERE id = ? AND user_id = ?', [remaining[0].id, userId]);
      }
    }

    res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting payment method:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
// User Settings Routes
// ─────────────────────────────────────────────

app.get('/api/settings', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    await ensureUserSettingsRow(userId);
    const [rows]: any = await pool.query('SELECT * FROM user_settings WHERE user_id = ? LIMIT 1', [userId]);
    res.json(rows[0]);
  } catch (error: any) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/settings', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    await ensureUserSettingsRow(userId);

    const updates: string[] = [];
    const values: any[] = [];

    if (req.body?.theme !== undefined) {
      const theme = req.body.theme === 'Dark' ? 'Dark' : 'Light';
      updates.push('theme = ?');
      values.push(theme as UserTheme);
    }

    if (req.body?.language !== undefined) {
      const languageCandidates: UserLanguage[] = ['English', '简体中文', '繁體中文', 'Latin', '한국어'];
      const languageInput = String(req.body.language || '').trim() as UserLanguage;
      const language = languageCandidates.includes(languageInput) ? languageInput : 'English';
      updates.push('language = ?');
      values.push(language as UserLanguage);
    }

    if (req.body?.app_lock_enabled !== undefined) {
      updates.push('app_lock_enabled = ?');
      values.push(parseBoolean(req.body.app_lock_enabled, false));
    }

    if (req.body?.cloud_sync_enabled !== undefined) {
      updates.push('cloud_sync_enabled = ?');
      values.push(parseBoolean(req.body.cloud_sync_enabled, true));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(userId);
    await pool.execute(
      `UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = ?`,
      values
    );

    const [rows]: any = await pool.query('SELECT * FROM user_settings WHERE user_id = ? LIMIT 1', [userId]);
    res.json(rows[0]);
  } catch (error: any) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings/cloud-sync', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    await ensureUserSettingsRow(userId);
    await pool.execute(
      'UPDATE user_settings SET last_synced_at = NOW(), cloud_sync_enabled = TRUE WHERE user_id = ?',
      [userId]
    );
    const [rows]: any = await pool.query('SELECT * FROM user_settings WHERE user_id = ? LIMIT 1', [userId]);
    res.json(rows[0]);
  } catch (error: any) {
    console.error('Error syncing settings:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/security/overview', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const [rows]: any = await pool.query(
      'SELECT id, email, password_hash, google_id, created_at FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    const user = rows?.[0];
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(buildSecurityOverview(user));
  } catch (error: any) {
    console.error('Error fetching security overview:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/security/email', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const nextEmail = String(req.body?.email || '').trim().toLowerCase();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!nextEmail || !emailPattern.test(nextEmail)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const [dupRows]: any = await pool.query(
      'SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1',
      [nextEmail, userId]
    );
    if (Array.isArray(dupRows) && dupRows.length > 0) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    await pool.execute('UPDATE users SET email = ? WHERE id = ?', [nextEmail, userId]);

    const [rows]: any = await pool.query(
      'SELECT id, email, name FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    const user = rows?.[0];
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(buildAuthResponse(user));
  } catch (error: any) {
    console.error('Error updating security email:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/security/password', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: '新密码至少需要 6 位' });
    }

    const [rows]: any = await pool.query(
      'SELECT id, password_hash FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    const user = rows?.[0];
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.password_hash) {
      // 已经设置过密码：修改密码时必须校验当前密码
      if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password_hash))) {
        return res.status(401).json({ error: '当前密码不正确' });
      }
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hashed, userId]);

    const [updatedRows]: any = await pool.query(
      'SELECT id, email, password_hash, google_id, created_at FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    res.json(buildSecurityOverview(updatedRows[0]));
  } catch (error: any) {
    console.error('Error setting password:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/security/unlink-google', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;

    const [rows]: any = await pool.query(
      'SELECT id, email, password_hash, google_id, created_at FROM users WHERE id = ? LIMIT 1',
      [userId]
    );
    const user = rows?.[0];
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.google_id) {
      return res.json(buildSecurityOverview(user));
    }

    if (!user.password_hash) {
      return res.status(400).json({ error: '请先设置登录密码，再取消关联 Google 账号，否则将无法登录' });
    }

    await pool.execute('UPDATE users SET google_id = NULL WHERE id = ?', [userId]);

    const [updatedRows]: any = await pool.query(
      'SELECT id, email, password_hash, google_id, created_at FROM users WHERE id = ? LIMIT 1',
      [userId]
    );

    res.json(buildSecurityOverview(updatedRows[0]));
  } catch (error: any) {
    console.error('Error unlinking google account:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/help/articles', authRequired, async (_req: AuthenticatedRequest, res) => {
  res.json([
    {
      id: 'billing-reminders',
      title: 'How billing reminders work',
      summary: 'Learn how upcoming renewals are detected and notified.'
    },
    {
      id: 'manage-membership',
      title: 'Manage membership and restore purchases',
      summary: 'Steps to cancel auto-renew or restore previous purchases.'
    },
    {
      id: 'payment-methods',
      title: 'Manage payment methods',
      summary: 'Add, remove, and set a default payment method in Wallet.'
    }
  ]);
});

// ─────────────────────────────────────────────
// Membership Routes
// ─────────────────────────────────────────────

const getMembershipAmount = (plan: MembershipPlan): number => {
  switch (plan) {
    case 'trial':
      return 0;
    case 'monthly':
      return 3;
    case 'annual':
      return 36;
    case 'lifetime':
      return 48;
    default:
      return 0;
  }
};

const getMembershipWindow = (plan: MembershipPlan): { startsAt: Date; expiresAt: Date | null; status: 'trial' | 'active' } => {
  const startsAt = new Date();
  if (plan === 'trial') {
    const expiresAt = new Date(startsAt);
    expiresAt.setDate(expiresAt.getDate() + 14);
    return { startsAt, expiresAt, status: 'trial' };
  }
  if (plan === 'monthly') {
    const expiresAt = new Date(startsAt);
    expiresAt.setMonth(expiresAt.getMonth() + 1);
    return { startsAt, expiresAt, status: 'active' };
  }
  if (plan === 'annual') {
    const expiresAt = new Date(startsAt);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    return { startsAt, expiresAt, status: 'active' };
  }
  return { startsAt, expiresAt: null, status: 'active' };
};

const createMembershipRecord = async ({
  userId,
  plan,
  paymentMethod,
  payerEmail,
  autoRenew
}: {
  userId: number;
  plan: MembershipPlan;
  paymentMethod: string;
  payerEmail: string;
  autoRenew: boolean;
}) => {
  const { startsAt, expiresAt, status } = getMembershipWindow(plan);
  const amount = getMembershipAmount(plan);
  const finalAutoRenew = plan === 'lifetime' ? false : autoRenew;

  const [result]: any = await pool.execute(
    `INSERT INTO memberships
     (user_id, plan, status, amount, currency, payment_method, payer_email, auto_renew, starts_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      plan,
      status,
      amount,
      'CNY',
      paymentMethod,
      payerEmail,
      finalAutoRenew,
      startsAt,
      expiresAt
    ]
  );

  const [rows]: any = await pool.query('SELECT * FROM memberships WHERE id = ? LIMIT 1', [result.insertId]);
  return rows[0];
};

app.get('/api/membership/current', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const [rows]: any = await pool.query(
      'SELECT * FROM memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    res.json(rows[0] || null);
  } catch (error: any) {
    console.error('Error fetching membership:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/membership/history', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const [rows]: any = await pool.query(
      'SELECT * FROM memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [userId]
    );
    res.json(rows);
  } catch (error: any) {
    console.error('Error fetching membership history:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/membership/activate', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { plan, payment_method, payer_email, auto_renew } = req.body as {
      plan?: MembershipPlan;
      payment_method?: string;
      payer_email?: string;
      auto_renew?: boolean;
    };

    const validPlans: MembershipPlan[] = ['trial', 'monthly', 'annual', 'lifetime'];
    if (!plan || !validPlans.includes(plan)) {
      return res.status(400).json({ error: '无效的会员计划' });
    }
    if (!payment_method || !payer_email) {
      return res.status(400).json({ error: '请填写完整的支付信息' });
    }

    await pool.execute(
      `UPDATE memberships
       SET status = 'canceled', updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND status IN ('active', 'trial')`,
      [userId]
    );

    const membership = await createMembershipRecord({
      userId,
      plan,
      paymentMethod: payment_method,
      payerEmail: payer_email,
      autoRenew: Boolean(auto_renew ?? true)
    });
    res.status(201).json(membership);
  } catch (error: any) {
    console.error('Error activating membership:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/membership/cancel-auto-renew', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const [rows]: any = await pool.query(
      `SELECT * FROM memberships
       WHERE user_id = ? AND status IN ('active', 'trial')
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    const current = rows?.[0];
    if (!current) {
      return res.status(404).json({ error: 'No active membership found' });
    }

    await pool.execute(
      'UPDATE memberships SET auto_renew = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
      [current.id, userId]
    );

    const [updatedRows]: any = await pool.query('SELECT * FROM memberships WHERE id = ? AND user_id = ? LIMIT 1', [current.id, userId]);
    res.json(updatedRows[0]);
  } catch (error: any) {
    console.error('Error canceling auto renew:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/membership/restore', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const [rows]: any = await pool.query(
      'SELECT * FROM memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    const latest = rows?.[0];
    if (!latest) {
      return res.status(404).json({ error: 'No previous purchase found' });
    }

    const [activeRows]: any = await pool.query(
      `SELECT * FROM memberships
       WHERE user_id = ? AND status IN ('active', 'trial')
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    if (activeRows?.[0]) {
      return res.json(activeRows[0]);
    }

    const plan = (latest.plan || 'monthly') as MembershipPlan;
    const restoredMembership = await createMembershipRecord({
      userId,
      plan,
      paymentMethod: latest.payment_method || 'apple_pay',
      payerEmail: latest.payer_email || req.user!.email,
      autoRenew: plan === 'lifetime' ? false : true
    });

    await upsertNotification({
      userId,
      notificationKey: `membership:restore:${restoredMembership.id}`,
      type: 'membership',
      title: 'Purchase restored',
      message: `Your ${plan} membership has been restored successfully.`,
      severity: 'info',
      actionText: 'View membership',
      actionTarget: '/settings'
    });

    res.status(201).json(restoredMembership);
  } catch (error: any) {
    console.error('Error restoring purchase:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────
const startServer = async () => {
  try {
    await ensureDatabaseSchema();
    app.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
      console.log('Using MySQL database backend.');
    });
  } catch (error) {
    console.error('Failed to initialize database schema:', error);
    process.exit(1);
  }
};

void startServer();