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
import nodemailer from 'nodemailer';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { Agent, ProxyAgent, setGlobalDispatcher, fetch as undiciFetch } from 'undici';

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

// 上面的全局代理是给 Google 校验用的；微信 / QQ 是国内服务、Apple 也通常可直连，
// 走境外代理反而可能失败，所以这些出站请求绕过全局代理直连。
const directDispatcher = new Agent();
const directFetch = (url: string, init?: Parameters<typeof undiciFetch>[1]) =>
  undiciFetch(url, { ...init, dispatcher: directDispatcher });

const app = express();
const port = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
if (process.env.NODE_ENV === 'production' && !GOOGLE_CLIENT_ID) {
  throw new Error('GOOGLE_CLIENT_ID must be set in production');
}
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Apple Sign In：id_token 的 aud 会随平台不同（Web 是 Services ID，iOS 原生是 Bundle ID），
// 所以用逗号分隔的列表配置所有允许的 audience。未配置时仅校验签名与签发方。
const APPLE_ALLOWED_AUDIENCES = String(process.env.APPLE_ALLOWED_AUDIENCES || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const WECHAT_APP_ID = process.env.WECHAT_APP_ID || '';
const WECHAT_APP_SECRET = process.env.WECHAT_APP_SECRET || '';
const QQ_APP_ID = process.env.QQ_APP_ID || '';
const QQ_APP_SECRET = process.env.QQ_APP_SECRET || '';

// 邮件发送：未配置 SMTP 时退化为“开发模式”，验证码只打印到服务端日志，
// 且仅在非生产环境随响应返回 devCode，方便本地调试。
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const SMTP_SECURE = SMTP_PORT === 465;
const smtpConfigured = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
const mailer = smtpConfigured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    })
  : null;
if (!smtpConfigured) {
  console.log('SMTP 未配置，邮箱验证码将以开发模式输出到日志。');
}

// 通行密钥（Passkey / WebAuthn）：rpID 必须与访问域名一致（本地开发是 localhost），
// 生产环境请在 .env 设置 PASSKEY_RP_ID=ngaasiu.studio 和 PASSKEY_EXPECTED_ORIGINS。
const PASSKEY_RP_ID = process.env.PASSKEY_RP_ID || 'localhost';
const PASSKEY_RP_NAME = process.env.PASSKEY_RP_NAME || 'DuoDuo';
const PASSKEY_EXPECTED_ORIGINS = [
  ...(process.env.PASSKEY_EXPECTED_ORIGINS || `http://localhost:3000,https://${PASSKEY_RP_ID}`)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  ...(process.env.PASSKEY_ANDROID_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
];

// WebAuthn challenge 只需要存活几分钟，单进程部署直接放内存即可
const passkeyChallenges = new Map<string, { challenge: string; expiresAt: number }>();
const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;

const storePasskeyChallenge = (key: string, challenge: string) => {
  const now = Date.now();
  for (const [k, v] of passkeyChallenges) {
    if (v.expiresAt < now) passkeyChallenges.delete(k);
  }
  passkeyChallenges.set(key, { challenge, expiresAt: now + PASSKEY_CHALLENGE_TTL_MS });
};

const consumePasskeyChallenge = (key: string, challenge: string): boolean => {
  const record = passkeyChallenges.get(key);
  if (!record || record.challenge !== challenge || record.expiresAt < Date.now()) {
    return false;
  }
  passkeyChallenges.delete(key);
  return true;
};

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

// 月份统一用阿拉伯数字显示，与界面语言无关
const MONTH_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const CATEGORY_COLORS = ['#0054cd', '#4c4aca', '#894d00', '#2e7d32', '#ec4899', '#0ea5e9', '#6366f1', '#16a34a'];
const UPLOAD_ROOT = path.join(process.cwd(), 'server', 'uploads');
const ICON_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'icons');

fs.mkdirSync(ICON_UPLOAD_DIR, { recursive: true });

// 1. 中间件最先注册
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use('/api/uploads', express.static(UPLOAD_ROOT));
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'duoduo-api' });
});

// 2. 连接池在所有路由之前定义
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'DingYue',
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

const buildAuthResponse = (user: { id: number; email: string; name?: string | null; avatar?: string | null }) => {
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
      name: user.name || '',
      avatar: user.avatar || null
    }
  };
};

const buildSecurityOverview = async (user: {
  id?: number;
  email: string;
  password_hash: string | null;
  google_id: string | null;
  created_at: string;
}) => {
  let passkeyCount = 0;
  if (user.id) {
    const [rows]: any = await pool.query(
      'SELECT COUNT(*) AS count FROM webauthn_credentials WHERE user_id = ?',
      [user.id]
    );
    passkeyCount = Number(rows?.[0]?.count || 0);
  }
  return {
    email: user.email,
    hasPassword: Boolean(user.password_hash),
    googleLinked: Boolean(user.google_id),
    passkeyCount,
    accountCreatedAt: user.created_at,
    recommendations: [
      'Use a strong password and rotate it periodically.',
      'Enable app lock if your device is shared.',
      'Review active subscriptions every month.'
    ]
  };
};

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
      apple_id VARCHAR(255) UNIQUE,
      wechat_id VARCHAR(255) UNIQUE,
      qq_id VARCHAR(255) UNIQUE,
      avatar VARCHAR(500) NULL,
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

  // Social login provider columns (Apple / WeChat / QQ) and profile avatar.
  const [userColumns]: any = await pool.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
  );
  const userColumnNames = new Set(
    Array.isArray(userColumns)
      ? userColumns.map((row: { COLUMN_NAME: string }) => row.COLUMN_NAME)
      : []
  );
  for (const column of ['apple_id', 'wechat_id', 'qq_id', 'avatar']) {
    if (!userColumnNames.has(column)) {
      await pool.execute(`ALTER TABLE users ADD COLUMN ${column} VARCHAR(255) NULL`);
    }
  }
  for (const indexName of ['uniq_users_apple_id', 'uniq_users_wechat_id', 'uniq_users_qq_id']) {
    const [existingIndexes]: any = await pool.query(
      `SHOW INDEX FROM users WHERE Key_name = '${indexName}'`
    );
    if (!Array.isArray(existingIndexes) || existingIndexes.length === 0) {
      await pool.execute(`CREATE UNIQUE INDEX ${indexName} ON users (${indexName.replace('uniq_users_', '')})`);
    }
  }

  // Email verification codes for registration and password reset.
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      purpose ENUM('register', 'reset_password') NOT NULL,
      code_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      attempts INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_verification_codes_email_purpose (email, purpose)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Passkey (WebAuthn) credentials.
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      credential_id VARCHAR(512) NOT NULL,
      credential_public_key TEXT NOT NULL,
      counter BIGINT NOT NULL DEFAULT 0,
      transports VARCHAR(255) NULL,
      device_type VARCHAR(64) NULL,
      backed_up BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_webauthn_credential_id (credential_id),
      INDEX idx_webauthn_user_id (user_id),
      CONSTRAINT fk_webauthn_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
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
// Email Verification Codes
// ─────────────────────────────────────────────

const CODE_PURPOSES = ['register', 'reset_password'] as const;
type CodePurpose = typeof CODE_PURPOSES[number];
const CODE_TTL_MINUTES = 10;
const CODE_MAX_ATTEMPTS = 5;
const CODE_SEND_COOLDOWN_MS = 60 * 1000;
const CODE_HOURLY_LIMIT = 5;

// 微信 / QQ / Apple 匿名用户没有真实邮箱，用占位邮箱满足 users.email 的唯一约束。
// 占位邮箱不能用于收验证码，找回密码接口会显式拒绝。
const EMAIL_PLACEHOLDER_DOMAINS = ['@wechat.placeholder', '@qq.placeholder', '@apple.placeholder'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeEmail = (value: unknown): string => String(value || '').trim().toLowerCase();

const isPlaceholderEmail = (email: string): boolean =>
  EMAIL_PLACEHOLDER_DOMAINS.some((domain) => email.endsWith(domain));

const isDeliverableEmail = (email: string): boolean =>
  EMAIL_PATTERN.test(email) && !isPlaceholderEmail(email);

const createPlaceholderEmail = (prefix: string, providerId: string, domain: string): string => {
  const digest = crypto.createHash('sha256').update(providerId).digest('hex').slice(0, 20);
  return `${prefix}_${digest}${domain}`;
};

const sendVerificationCodeEmail = async (email: string, code: string, purpose: CodePurpose) => {
  const purposeText = purpose === 'register' ? '注册' : '密码重置';
  const subject = `【DuoDuo】${purposeText}验证码`;
  const text = `你的 DuoDuo ${purposeText}验证码是：${code}\n\n验证码 ${CODE_TTL_MINUTES} 分钟内有效。如果不是你本人操作，请忽略这封邮件。`;

  if (!mailer) {
    console.log(`[dev] ${purposeText}验证码 ${email}: ${code}`);
    return;
  }
  await mailer.sendMail({ from: SMTP_FROM, to: email, subject, text });
};

const sendVerificationCode = async (email: string, purpose: CodePurpose): Promise<{ devCode?: string }> => {
  const [recentRows]: any = await pool.query(
    `SELECT created_at FROM email_verification_codes
     WHERE email = ? AND purpose = ? AND created_at > DATE_SUB(NOW(), INTERVAL ? SECOND)
     ORDER BY created_at DESC LIMIT 1`,
    [email, purpose, CODE_SEND_COOLDOWN_MS / 1000]
  );
  if (Array.isArray(recentRows) && recentRows.length > 0) {
    throw Object.assign(new Error('发送太频繁，请稍后再试'), { status: 429 });
  }

  const [hourRows]: any = await pool.query(
    `SELECT COUNT(*) AS count FROM email_verification_codes
     WHERE email = ? AND purpose = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
    [email, purpose]
  );
  const hourlyCount = Number(hourRows?.[0]?.count || 0);
  if (hourlyCount >= CODE_HOURLY_LIMIT) {
    throw Object.assign(new Error('验证码发送次数已达上限，请一小时后再试'), { status: 429 });
  }

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const codeHash = await bcrypt.hash(code, 10);
  await pool.execute(
    `INSERT INTO email_verification_codes (email, purpose, code_hash, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [email, purpose, codeHash, CODE_TTL_MINUTES]
  );

  await sendVerificationCodeEmail(email, code, purpose);
  if (!mailer && process.env.NODE_ENV !== 'production') {
    return { devCode: code };
  }
  return {};
};

const consumeVerificationCode = async (email: string, purpose: CodePurpose, code: string) => {
  if (!/^\d{6}$/.test(code)) {
    throw Object.assign(new Error('请输入 6 位数字验证码'), { status: 400 });
  }

  const [rows]: any = await pool.query(
    `SELECT id, code_hash, expires_at, attempts FROM email_verification_codes
     WHERE email = ? AND purpose = ? AND used_at IS NULL AND expires_at > NOW()
     ORDER BY id DESC LIMIT 1`,
    [email, purpose]
  );
  const record = Array.isArray(rows) ? rows[0] : null;
  if (!record) {
    throw Object.assign(new Error('验证码已过期，请重新获取'), { status: 400 });
  }
  if (Number(record.attempts) >= CODE_MAX_ATTEMPTS) {
    throw Object.assign(new Error('验证码错误次数过多，请重新获取'), { status: 400 });
  }

  const matches = await bcrypt.compare(code, record.code_hash);
  if (!matches) {
    await pool.execute('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?', [record.id]);
    throw Object.assign(new Error('验证码不正确'), { status: 400 });
  }

  await pool.execute('UPDATE email_verification_codes SET used_at = NOW() WHERE id = ?', [record.id]);
};

// ─────────────────────────────────────────────
// Social Login Helpers (Apple / WeChat / QQ)
// ─────────────────────────────────────────────

const SOCIAL_PROVIDER_COLUMNS = ['apple_id', 'wechat_id', 'qq_id'] as const;
type SocialProviderColumn = typeof SOCIAL_PROVIDER_COLUMNS[number];

const findOrCreateSocialUser = async ({
  providerColumn,
  providerId,
  email,
  name,
  placeholderPrefix,
  placeholderDomain
}: {
  providerColumn: SocialProviderColumn;
  providerId: string;
  email: string | null;
  name: string;
  placeholderPrefix: string;
  placeholderDomain: string;
}) => {
  const [byProvider]: any = await pool.execute(
    `SELECT * FROM users WHERE ${providerColumn} = ? LIMIT 1`,
    [providerId]
  );
  if (byProvider?.[0]) return byProvider[0];

  if (email) {
    // 已有同邮箱账户（例如邮箱注册用户）时直接关联该第三方账号
    const [byEmail]: any = await pool.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
    if (byEmail?.[0]) {
      await pool.execute(`UPDATE users SET ${providerColumn} = ? WHERE id = ?`, [providerId, byEmail[0].id]);
      return { ...byEmail[0], [providerColumn]: providerId };
    }
  }

  const placeholderEmail = createPlaceholderEmail(placeholderPrefix, providerId, placeholderDomain);
  const displayName = name || '用户';
  try {
    await pool.execute(
      `INSERT INTO users (email, name, ${providerColumn}) VALUES (?, ?, ?)`,
      [placeholderEmail, displayName, providerId]
    );
  } catch (e: any) {
    // 并发登录时可能撞唯一索引，重查一次
    if (e?.code !== 'ER_DUP_ENTRY') throw e;
  }
  const [created]: any = await pool.execute(
    `SELECT * FROM users WHERE ${providerColumn} = ? LIMIT 1`,
    [providerId]
  );
  return created[0];
};

type AppleJwk = { kid: string; kty: string; n: string; e: string };
let appleJwksCache: { keys: Map<string, crypto.KeyObject>; fetchedAt: number } | null = null;

const getAppleSigningKeys = async (): Promise<Map<string, crypto.KeyObject>> => {
  if (appleJwksCache && Date.now() - appleJwksCache.fetchedAt < 24 * 60 * 60 * 1000) {
    return appleJwksCache.keys;
  }
  const res = await directFetch('https://appleid.apple.com/auth/keys');
  if (!res.ok) throw new Error(`获取 Apple 公钥失败: ${res.status}`);
  const data: any = await res.json();
  const keys = new Map<string, crypto.KeyObject>();
  for (const jwk of (data.keys || []) as AppleJwk[]) {
    keys.set(jwk.kid, crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' }));
  }
  if (keys.size === 0) throw new Error('Apple 公钥列表为空');
  appleJwksCache = { keys, fetchedAt: Date.now() };
  return keys;
};

const verifyAppleIdentityToken = async (identityToken: string): Promise<{ sub: string; email: string | null }> => {
  const decoded = jwt.decode(identityToken, { complete: true });
  if (!decoded || typeof decoded !== 'object' || !('header' in decoded)) {
    throw new Error('无效的 Apple 凭证');
  }
  const kid = (decoded as any).header?.kid;
  const keys = await getAppleSigningKeys();
  const key = kid ? keys.get(kid) : undefined;
  if (!key) throw new Error('找不到匹配的 Apple 公钥');

  const verifyOptions: jwt.VerifyOptions = {
    algorithms: ['RS256'],
    issuer: 'https://appleid.apple.com'
  };
  if (APPLE_ALLOWED_AUDIENCES.length > 0) {
    // @types/jsonwebtoken 把多 audience 定义成了 tuple，这里列表长度运行时才确定
    verifyOptions.audience = APPLE_ALLOWED_AUDIENCES as [string, ...string[]];
  }
  const payload = jwt.verify(identityToken, key, verifyOptions) as jwt.JwtPayload;
  if (!payload?.sub) throw new Error('Apple 凭证缺少用户标识');
  return { sub: payload.sub, email: (payload.email as string) || null };
};

// ─────────────────────────────────────────────
// Auth Routes
// ─────────────────────────────────────────────

// POST /api/auth/send-code — 注册 / 找回密码的邮箱验证码
app.post('/api/auth/send-code', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const purpose = String(req.body?.purpose || '') as CodePurpose;
  if (!CODE_PURPOSES.includes(purpose)) {
    return res.status(400).json({ error: '无效的验证码用途' });
  }
  if (!isDeliverableEmail(email)) {
    return res.status(400).json({ error: '请输入有效的邮箱地址' });
  }
  try {
    if (purpose === 'register') {
      const [rows]: any = await pool.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
      if (Array.isArray(rows) && rows.length > 0) {
        return res.status(400).json({ error: '该邮箱已注册，请直接登录' });
      }
    } else {
      const [rows]: any = await pool.execute('SELECT id, password_hash, google_id, apple_id, wechat_id, qq_id FROM users WHERE email = ? LIMIT 1', [email]);
      const user = rows?.[0];
      if (!user) {
        return res.status(400).json({ error: '该邮箱未注册' });
      }
      if (isPlaceholderEmail(email)) {
        return res.status(400).json({ error: '第三方登录账户没有真实邮箱，请使用对应方式登录，或先在设置中绑定邮箱' });
      }
    }

    const { devCode } = await sendVerificationCode(email, purpose);
    res.json({ success: true, ...(devCode ? { devCode } : {}) });
  } catch (e: any) {
    const status = typeof e?.status === 'number' ? e.status : 500;
    if (status === 500) console.error('Send code error:', e);
    res.status(status).json({ error: e.message || '验证码发送失败' });
  }
});

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const { password, name, code } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: '请填写所有必填字段' });
  }
  if (!isDeliverableEmail(email)) {
    return res.status(400).json({ error: '请输入有效的邮箱地址' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: '密码至少需要 6 位' });
  }
  if (!code) {
    return res.status(400).json({ error: '请输入邮箱验证码' });
  }
  try {
    await consumeVerificationCode(email, 'register', String(code));
    const hashed = await bcrypt.hash(password, 10);
    await pool.execute(
        'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
        [email, hashed, name]
    );
    const [rows]: any = await pool.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
    // 注册即登录：邮箱已通过验证码验证
    res.json(buildAuthResponse(rows[0]));
  } catch (e: any) {
    if (typeof e?.status === 'number') {
      return res.status(e.status).json({ error: e.message });
    }
    console.error('Register error:', e);
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
  const email = normalizeEmail(req.body?.email);
  const { password } = req.body;
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

// POST /api/auth/reset-password — 忘记密码时通过邮箱验证码重置
app.post('/api/auth/reset-password', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const { code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: '请填写所有必填字段' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    return res.status(400).json({ error: '新密码至少需要 6 位' });
  }
  if (isPlaceholderEmail(email)) {
    return res.status(400).json({ error: '第三方登录账户不支持邮箱找回，请使用对应方式登录' });
  }
  try {
    await consumeVerificationCode(email, 'reset_password', String(code));
    const [rows]: any = await pool.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    const user = rows?.[0];
    if (!user) {
      return res.status(400).json({ error: '该邮箱未注册' });
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [hashed, user.id]);
    res.json({ success: true });
  } catch (e: any) {
    if (typeof e?.status === 'number') {
      return res.status(e.status).json({ error: e.message });
    }
    console.error('Reset password error:', e);
    res.status(500).json({ error: '密码重置失败: ' + e.message });
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

// POST /api/auth/apple — 前端（iOS 原生 SDK / Web JS SDK）拿到 identityToken 后提交
app.post('/api/auth/apple', async (req, res) => {
  const { identityToken, name } = req.body;
  if (!identityToken) {
    return res.status(400).json({ error: '缺少 Apple 凭证' });
  }
  try {
    const { sub, email } = await verifyAppleIdentityToken(identityToken);
    const displayName = typeof name === 'string' && name.trim() ? name.trim() : '';
    const user = await findOrCreateSocialUser({
      providerColumn: 'apple_id',
      providerId: sub,
      email,
      name: displayName,
      placeholderPrefix: 'apple',
      placeholderDomain: '@apple.placeholder'
    });
    if (!user) {
      return res.status(400).json({ error: 'Apple 登录失败: 无法创建或匹配用户' });
    }
    res.json(buildAuthResponse(user));
  } catch (e: any) {
    if (process.env.NODE_ENV !== 'production') console.error('Apple login error:', e);
    res.status(400).json({ error: 'Apple 登录失败: ' + e.message });
  }
});

// POST /api/auth/wechat — 网站应用扫码登录后回传 code
app.post('/api/auth/wechat', async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: '缺少微信登录 code' });
  }
  if (!WECHAT_APP_ID || !WECHAT_APP_SECRET) {
    return res.status(501).json({ error: '微信登录暂未配置，请联系管理员' });
  }
  try {
    const tokenRes = await directFetch(
      `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${encodeURIComponent(WECHAT_APP_ID)}&secret=${encodeURIComponent(WECHAT_APP_SECRET)}&code=${encodeURIComponent(String(code))}&grant_type=authorization_code`
    );
    const tokenData: any = await tokenRes.json();
    if (!tokenData.openid) {
      return res.status(400).json({ error: '微信登录失败: ' + (tokenData.errmsg || '无效 code') });
    }

    // 优先使用 unionid（同一开放平台主体下稳定），否则退回 openid
    const providerId = String(tokenData.unionid || tokenData.openid);
    let nickname = '';
    try {
      const userRes = await directFetch(
        `https://api.weixin.qq.com/sns/userinfo?access_token=${encodeURIComponent(tokenData.access_token)}&openid=${encodeURIComponent(String(tokenData.openid))}`
      );
      const userData: any = await userRes.json();
      if (typeof userData?.nickname === 'string') nickname = userData.nickname;
    } catch {
      // 拿不到昵称不影响登录
    }

    const user = await findOrCreateSocialUser({
      providerColumn: 'wechat_id',
      providerId,
      email: null,
      name: nickname || '微信用户',
      placeholderPrefix: 'wx',
      placeholderDomain: '@wechat.placeholder'
    });
    if (!user) {
      return res.status(400).json({ error: '微信登录失败: 无法创建或匹配用户' });
    }
    res.json(buildAuthResponse(user));
  } catch (e: any) {
    if (process.env.NODE_ENV !== 'production') console.error('WeChat login error:', e);
    res.status(400).json({ error: '微信登录失败: ' + e.message });
  }
});

// POST /api/auth/qq — QQ 互联 OAuth 登录后回传 code
app.post('/api/auth/qq', async (req, res) => {
  const { code, redirectUri } = req.body;
  if (!code) {
    return res.status(400).json({ error: '缺少 QQ 登录 code' });
  }
  if (!QQ_APP_ID || !QQ_APP_SECRET) {
    return res.status(501).json({ error: 'QQ 登录暂未配置，请联系管理员' });
  }
  try {
    const tokenRes = await directFetch(
      `https://graph.qq.com/oauth2.0/token?grant_type=authorization_code&client_id=${encodeURIComponent(QQ_APP_ID)}&client_secret=${encodeURIComponent(QQ_APP_SECRET)}&code=${encodeURIComponent(String(code))}&redirect_uri=${encodeURIComponent(String(redirectUri || ''))}&fmt=json`
    );
    const tokenData: any = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.status(400).json({ error: 'QQ 登录失败: ' + (tokenData.error_description || tokenData.msg || '无效 code') });
    }

    let openid = tokenData.openid;
    if (!openid) {
      const meRes = await directFetch(
        `https://graph.qq.com/oauth2.0/me?access_token=${encodeURIComponent(tokenData.access_token)}&fmt=json`
      );
      const meText = await meRes.text();
      const meData = JSON.parse(meText.replace(/^callback\(|\);$/g, '').trim());
      if (!meData?.openid) {
        return res.status(400).json({ error: 'QQ 登录失败: 获取 openid 失败' });
      }
      openid = meData.openid;
    }

    let nickname = '';
    try {
      const userRes = await directFetch(
        `https://graph.qq.com/user/get_user_info?access_token=${encodeURIComponent(tokenData.access_token)}&oauth_consumer_key=${encodeURIComponent(QQ_APP_ID)}&openid=${encodeURIComponent(String(openid))}`
      );
      const userData: any = await userRes.json();
      if (typeof userData?.nickname === 'string') nickname = userData.nickname;
    } catch {
      // 拿不到昵称不影响登录
    }

    const user = await findOrCreateSocialUser({
      providerColumn: 'qq_id',
      providerId: String(openid),
      email: null,
      name: nickname || 'QQ用户',
      placeholderPrefix: 'qq',
      placeholderDomain: '@qq.placeholder'
    });
    if (!user) {
      return res.status(400).json({ error: 'QQ 登录失败: 无法创建或匹配用户' });
    }
    res.json(buildAuthResponse(user));
  } catch (e: any) {
    if (process.env.NODE_ENV !== 'production') console.error('QQ login error:', e);
    res.status(400).json({ error: 'QQ 登录失败: ' + e.message });
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

app.post('/api/uploads/avatar', authRequired, (req: AuthenticatedRequest, res) => {
  uploadIconMiddleware.single('avatar')(req as Request, res, (error: any) => {
    if (error) {
      const message = error?.message || 'Upload failed';
      if (error?.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Image file is too large (max 5MB)' });
      }
      return res.status(400).json({ error: message });
    }

    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      return res.status(400).json({ error: 'No avatar image uploaded' });
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

    res.json(await buildSecurityOverview(user));
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
      'SELECT id, email, name, avatar FROM users WHERE id = ? LIMIT 1',
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
    res.json(await buildSecurityOverview(updatedRows[0]));
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
      return res.json(await buildSecurityOverview(user));
    }

    if (!user.password_hash) {
      return res.status(400).json({ error: '请先设置登录密码，再取消关联 Google 账号，否则将无法登录' });
    }

    await pool.execute('UPDATE users SET google_id = NULL WHERE id = ?', [userId]);

    const [updatedRows]: any = await pool.query(
      'SELECT id, email, password_hash, google_id, created_at FROM users WHERE id = ? LIMIT 1',
      [userId]
    );

    res.json(await buildSecurityOverview(updatedRows[0]));
  } catch (error: any) {
    console.error('Error unlinking google account:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/users/profile — 当前用户资料
app.get('/api/users/profile', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const [rows]: any = await pool.query('SELECT id, email, name, avatar FROM users WHERE id = ? LIMIT 1', [userId]);
    const user = rows?.[0];
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ id: user.id, email: user.email, name: user.name || '', avatar: user.avatar || null });
  } catch (error: any) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/users/profile — 更新昵称 / 头像
app.patch('/api/users/profile', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;

    const [rows]: any = await pool.query('SELECT id, email, name, avatar FROM users WHERE id = ? LIMIT 1', [userId]);
    const user = rows?.[0];
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updates: string[] = [];
    const values: any[] = [];

    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) {
        return res.status(400).json({ error: '昵称不能为空' });
      }
      if (name.length > 100) {
        return res.status(400).json({ error: '昵称过长（最多 100 字）' });
      }
      updates.push('name = ?');
      values.push(name);
    }

    if (req.body?.avatar !== undefined) {
      const avatar = req.body.avatar === null ? null : String(req.body.avatar).trim();
      if (avatar && !/^(\/api\/uploads\/|https?:\/\/)/.test(avatar)) {
        return res.status(400).json({ error: '无效的头像地址' });
      }
      updates.push('avatar = ?');
      values.push(avatar || null);
    }

    if (updates.length > 0) {
      values.push(userId);
      await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
    }

    const [updatedRows]: any = await pool.query('SELECT id, email, name, avatar FROM users WHERE id = ? LIMIT 1', [userId]);
    const updated = updatedRows[0];
    // 名称会写进 JWT payload，重新签发保持一致
    res.json({ ...buildAuthResponse(updated), avatar: updated.avatar || null });
  } catch (error: any) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/users/account — 注销账号（订阅、会员、设置等数据级联删除）
app.delete('/api/users/account', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const [result]: any = await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
    if (!result.affectedRows) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting account:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
// Passkey (WebAuthn) Routes
// ─────────────────────────────────────────────

// POST /api/webauthn/register/options — 登录状态下开始注册通行密钥
app.post('/api/webauthn/register/options', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const [rows]: any = await pool.query(
      'SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = ?',
      [userId]
    );
    const options = await generateRegistrationOptions({
      rpName: PASSKEY_RP_NAME,
      rpID: PASSKEY_RP_ID,
      userName: req.user!.email,
      userDisplayName: req.user!.name || req.user!.email,
      excludeCredentials: rows.map((row: any) => ({
        id: row.credential_id,
        transports: row.transports ? String(row.transports).split(',') : undefined
      }))
    });
    storePasskeyChallenge(`reg:${userId}`, options.challenge);
    res.json(options);
  } catch (error: any) {
    console.error('WebAuthn register options error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/webauthn/register/verify — 校验并保存新通行密钥
app.post('/api/webauthn/register/verify', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const verification = await verifyRegistrationResponse({
      response: req.body?.credential,
      expectedChallenge: (challenge) => consumePasskeyChallenge(`reg:${userId}`, challenge),
      expectedOrigin: PASSKEY_EXPECTED_ORIGINS,
      expectedRPID: PASSKEY_RP_ID
    });
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: '通行密钥验证失败' });
    }
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    await pool.execute(
      `INSERT INTO webauthn_credentials
         (user_id, credential_id, credential_public_key, counter, transports, device_type, backed_up)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE counter = VALUES(counter), user_id = VALUES(user_id)`,
      [
        userId,
        credential.id,
        Buffer.from(credential.publicKey).toString('base64url'),
        credential.counter,
        (credential.transports || []).join(','),
        credentialDeviceType,
        credentialBackedUp
      ]
    );
    const [countRows]: any = await pool.query(
      'SELECT COUNT(*) AS count FROM webauthn_credentials WHERE user_id = ?',
      [userId]
    );
    res.json({ verified: true, passkeyCount: Number(countRows?.[0]?.count || 0) });
  } catch (error: any) {
    console.error('WebAuthn register verify error:', error);
    res.status(400).json({ error: '通行密钥注册失败: ' + error.message });
  }
});

// POST /api/webauthn/auth/options — 无需登录，生成登录挑战（可发现凭据，无需输入邮箱）
app.post('/api/webauthn/auth/options', async (_req, res) => {
  try {
    const options = await generateAuthenticationOptions({
      rpID: PASSKEY_RP_ID,
      userVerification: 'preferred'
    });
    storePasskeyChallenge(`auth:${options.challenge}`, options.challenge);
    res.json(options);
  } catch (error: any) {
    console.error('WebAuthn auth options error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/webauthn/auth/verify — 校验通行密钥并签发登录 token
app.post('/api/webauthn/auth/verify', async (req, res) => {
  try {
    const credential = req.body?.credential;
    if (!credential?.id) {
      return res.status(400).json({ error: '缺少通行密钥凭证' });
    }
    const [rows]: any = await pool.query(
      `SELECT wc.*, u.email AS user_email, u.name AS user_name
       FROM webauthn_credentials wc JOIN users u ON u.id = wc.user_id
       WHERE wc.credential_id = ? LIMIT 1`,
      [String(credential.id)]
    );
    const stored = rows?.[0];
    if (!stored) {
      return res.status(400).json({ error: '该通行密钥未绑定本站账户' });
    }
    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: (challenge) => consumePasskeyChallenge(`auth:${challenge}`, challenge),
      expectedOrigin: PASSKEY_EXPECTED_ORIGINS,
      expectedRPID: PASSKEY_RP_ID,
      credential: {
        id: stored.credential_id,
        publicKey: new Uint8Array(Buffer.from(stored.credential_public_key, 'base64url')),
        counter: Number(stored.counter),
        transports: stored.transports ? String(stored.transports).split(',') : undefined
      }
    });
    if (!verification.verified) {
      return res.status(400).json({ error: '通行密钥验证失败' });
    }
    await pool.execute(
      'UPDATE webauthn_credentials SET counter = ? WHERE id = ?',
      [verification.authenticationInfo.newCounter, stored.id]
    );
    const [userRows]: any = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [stored.user_id]);
    res.json(buildAuthResponse(userRows[0]));
  } catch (error: any) {
    console.error('WebAuthn auth verify error:', error);
    res.status(400).json({ error: '通行密钥登录失败: ' + error.message });
  }
});

// GET /api/fx/rates — 以 USD 为基准的实时汇率（缓存 6 小时，失败时回退到最近一次缓存）
let fxRatesCache: { rates: Record<string, number>; fetchedAt: number } | null = null;

app.get('/api/fx/rates', authRequired, async (_req: AuthenticatedRequest, res) => {
  if (fxRatesCache && Date.now() - fxRatesCache.fetchedAt < 6 * 60 * 60 * 1000) {
    return res.json({ base: 'USD', rates: fxRatesCache.rates, fetchedAt: fxRatesCache.fetchedAt });
  }
  try {
    const upstream = await directFetch('https://open.er-api.com/v6/latest/USD');
    const data: any = await upstream.json();
    if (data?.result !== 'success' || !data?.rates || typeof data.rates !== 'object') {
      throw new Error('invalid fx response');
    }
    fxRatesCache = { rates: data.rates, fetchedAt: Date.now() };
    res.json({ base: 'USD', rates: fxRatesCache.rates, fetchedAt: fxRatesCache.fetchedAt });
  } catch (error: any) {
    if (fxRatesCache) {
      // 上游临时失败时返回略旧的缓存，好过中断界面
      return res.json({ base: 'USD', rates: fxRatesCache.rates, fetchedAt: fxRatesCache.fetchedAt, stale: true });
    }
    if (process.env.NODE_ENV !== 'production') console.error('FX rates error:', error);
    res.status(502).json({ error: '获取实时汇率失败，请稍后重试' });
  }
});

app.get('/api/help/articles', authRequired, async (_req: AuthenticatedRequest, res) => {
  // 正文同时提供中英文，前端按用户语言选择显示
  res.json([
    {
      id: 'billing-reminders',
      title: { en: 'How billing reminders work', zh: '账单提醒是如何工作的' },
      summary: { en: 'Learn how upcoming renewals are detected and notified.', zh: '了解系统如何检测即将到来的续费并发送通知。' },
      content: {
        en: [
          'DuoDuo checks the next billing date of every subscription every day.',
          'When a renewal is within 3 days, a billing_due notification appears in the Message Center and the subscription is marked as "urgent" on the dashboard.',
          'Free trials generate a trial_ending notification 3 days before the trial finishes, so you can cancel before being charged.',
          'Tip: keep the next billing date accurate when adding or editing a subscription — reminders are calculated from it.'
        ],
        zh: [
          'DuoDuo 每天都会检查每个订阅的下次扣费日期。',
          '当距离续费不足 3 天时，消息中心会出现账单提醒，仪表盘上该订阅会被标记为“即将到期”。',
          '免费试用会在结束前 3 天生成“试用即将结束”提醒，方便你在扣费前取消。',
          '小贴士：添加或编辑订阅时请保持下次扣费日期准确，所有提醒都基于这个日期计算。'
        ]
      }
    },
    {
      id: 'manage-membership',
      title: { en: 'Manage membership and restore purchases', zh: '管理会员与恢复购买' },
      summary: { en: 'Steps to cancel auto-renew or restore previous purchases.', zh: '如何取消自动续费或恢复已购买的会员。' },
      content: {
        en: [
          'Open Settings → the membership banner → Manage to view your current plan and expiry date.',
          'Cancel auto-renew: tap "Cancel auto-renew" in the membership page. Your benefits remain valid until the expiry date.',
          'Restore purchases: if you reinstalled the app or switched devices, tap "Restore purchases" on the membership page while logged in with the same account.',
          'Upgrading plans takes effect immediately; the unused value of the old plan is not refunded pro-rated.'
        ],
        zh: [
          '打开「设置」→ 顶部会员卡片 →「管理会员」，可以查看当前套餐和到期时间。',
          '取消自动续费：在会员页面点击「取消自动续费」，会员权益会保留到当前到期日。',
          '恢复购买：重新安装应用或更换设备后，登录同一账户，在会员页面点击「恢复购买」即可找回会员状态。',
          '升级套餐立即生效；旧套餐未使用部分不支持按比例退款。'
        ]
      }
    },
    {
      id: 'payment-methods',
      title: { en: 'Manage payment methods', zh: '管理支付方式' },
      summary: { en: 'Add, remove, and set a default payment method in Wallet.', zh: '在钱包中添加、删除支付方式或设置默认支付方式。' },
      content: {
        en: [
          'Tap the wallet icon in the top-right corner of the home screen to open Wallet.',
          'Add a payment method: choose a label (e.g. "Visa ending 4242") and a type such as Apple Pay or credit card.',
          'Long-press or tap the ⋯ menu on a card to edit, set as default, or delete it. The default method is suggested first when activating a membership.',
          'Payment methods are for bookkeeping only — DuoDuo never stores card numbers or charges them.'
        ],
        zh: [
          '在首页右上角点击钱包图标，打开「支付方式」管理。',
          '添加支付方式：填写名称（例如“尾号 4242 的 Visa”）并选择类型（Apple Pay、信用卡等）。',
          '点击卡片上的菜单可以编辑、设为默认或删除；开通会员时会优先推荐默认支付方式。',
          '支付方式仅用于记账备注——DuoDuo 不会存储卡号，也不会产生任何扣款。'
        ]
      }
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