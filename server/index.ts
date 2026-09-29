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

// CZL Connect（connect.czl.net）OAuth2.0 中继登录：个人开发者绕过微信/QQ 企业认证的折衷方案。
// 上游用户实际授权给 CZL，本服务端用授权码换 CZL 的用户信息后按 czl_id 建户/匹配。
const CZL_CLIENT_ID = process.env.CZL_CLIENT_ID || '';
const CZL_CLIENT_SECRET = process.env.CZL_CLIENT_SECRET || '';
const CZL_BASE_URL = (process.env.CZL_BASE_URL || 'https://connect.czl.net').replace(/\/+$/, '');

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

// 常用货币符号（服务端提醒邮件用，未收录时回退货币代码）
const CURRENCY_SYMBOLS_SERVER: Record<string, string> = {
  USD: '$', CNY: '¥', EUR: '€', GBP: '£', JPY: '¥', HKD: 'HK$', TWD: 'NT$', KRW: '₩',
  SGD: 'S$', AUD: 'A$', NZD: 'NZ$', CAD: 'C$', CHF: 'CHF', INR: '₹', RUB: '₽',
  TRY: '₺', BRL: 'R$', MXN: 'Mex$', THB: '฿', MYR: 'RM', PHP: '₱', VND: '₫', SEK: 'kr'
};
const currencySymbolServer = (code: string): string => CURRENCY_SYMBOLS_SERVER[code] || `${code} `;

// 到期提醒专用发件账号（alert@），未配置时回退主发件账号
const ALERT_FROM = process.env.SMTP_ALERT_FROM || 'DingYue <alert@ngaasiu.studio>';
const ALERT_USER = process.env.SMTP_ALERT_USER || '';
const ALERT_PASS = process.env.SMTP_ALERT_PASS || '';
const alertMailer = ALERT_USER && ALERT_PASS
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: ALERT_USER, pass: ALERT_PASS }
    })
  : mailer;

// 通行密钥（Passkey / WebAuthn）：rpID 必须与访问域名一致（本地开发是 localhost），
// 生产环境请在 .env 设置 PASSKEY_RP_ID=ngaasiu.studio 和 PASSKEY_EXPECTED_ORIGINS。
const PASSKEY_RP_ID = process.env.PASSKEY_RP_ID || 'localhost';
const PASSKEY_RP_NAME = process.env.PASSKEY_RP_NAME || 'DingYue';
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
  start_date?: string | null;
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
  queueLimit: 0,
  // DATE/DATETIME 以字符串返回：mysql2 默认转 JS Date，reminder 扫描里
  // String(next_billing_date).slice(0,10) 会拿到 "Tue Oct 14" 这种垃圾值，
  // 导致防重键全部变成 0000-00-00、同档提醒重复发送（V1.3.9 实测踩坑）
  dateStrings: true
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

// V1.3.9：周期改为「订阅时间 → 下一个账单日」的间隔推导（天数），
// 支持月付/季付/年付乃至任意周期；两个日期缺失或间隔不足一周时
// 回退到旧的 billing_cycle 口径（兼容存量数据）
const subscriptionCycleDays = (sub: Pick<SubscriptionRow, 'start_date' | 'next_billing_date' | 'billing_cycle'>): number | null => {
  if (sub.start_date && sub.next_billing_date) {
    const start = new Date(sub.start_date);
    const next = new Date(sub.next_billing_date);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(next.getTime())) {
      const days = Math.round((next.getTime() - start.getTime()) / 86400000);
      if (days >= 7) return days;
    }
  }
  return null;
};

const toMonthlyAmount = (subscription: Pick<SubscriptionRow, 'price' | 'billing_cycle' | 'start_date' | 'next_billing_date'>): number => {
  const price = parsePrice(subscription.price);
  const cycleDays = subscriptionCycleDays(subscription);
  if (cycleDays) {
    return (price * 30.4375) / cycleDays;
  }
  return subscription.billing_cycle === 'annually'
    ? price / 12
    : price;
};

// ─────────────────────────────────────────────
// 统计口径统一为 USD 基准：订阅可能用各种货币记账，直接把原始金额相加
// 会得出「影音占比 100.3%」这类混币元的错误结果。/api/fx/rates 有 6 小时
// 缓存的实时汇率，这里复用同一个缓存；取不到时用静态近似表兜底。
// ─────────────────────────────────────────────
const FALLBACK_RATES_TO_USD: Record<string, number> = {
  USD: 1, CNY: 7.2, EUR: 0.92, JPY: 150, GBP: 0.79, HKD: 7.8, TWD: 32, MOP: 8.03,
  KRW: 1350, SGD: 1.34, MYR: 4.7, THB: 35, VND: 24500, PHP: 56, IDR: 15800,
  INR: 83, PKR: 278, BDT: 110, LKR: 320, NPR: 133, KHR: 4100, LAK: 21000, MMK: 2100,
  BND: 1.34, MNT: 3400, KZT: 450, AUD: 1.5, NZD: 1.64, CAD: 1.36, CHF: 0.88,
  SEK: 10.5, NOK: 10.6, DKK: 6.9, ISK: 138, PLN: 4.0, CZK: 23, HUF: 360, RON: 4.6,
  BGN: 1.8, RSD: 108, UAH: 39, RUB: 92, TRY: 32, ILS: 3.7, AED: 3.67, SAR: 3.75,
  QAR: 3.64, KWD: 0.31, BHD: 0.38, OMR: 0.38, JOD: 0.71, EGP: 31, ZAR: 18.7,
  NGN: 800, KES: 145, GHS: 12, MAD: 10, BRL: 5.0, MXN: 17, ARS: 350, CLP: 900,
  COP: 4000, PEN: 3.7, UYU: 39, AZN: 1.7, GEL: 2.65, AMD: 405, BYN: 3.3, UZS: 12500,
};

// 汇率1单位货币 = rate 美元（/api/fx/rates 的 rates 以 USD 为基准：1 USD = rates[CNY] CNY）
const currencyToUsdRate = (currency: string | null | undefined): number => {
  const code = String(currency || 'USD').trim().toUpperCase() || 'USD';
  if (code === 'USD') return 1;
  const live = fxRatesCache?.rates?.[code];
  const perUsd = Number.isFinite(live) && live > 0 ? live : FALLBACK_RATES_TO_USD[code];
  return perUsd && perUsd > 0 ? 1 / perUsd : 1;
};

const toMonthlyAmountUsd = (sub: SubscriptionRow): number =>
  toMonthlyAmount(sub) * currencyToUsdRate(sub.currency);

// 统计接口需要汇率而缓存为空时，先拉一次（失败静默，用兜底表）
const ensureFxRates = async (): Promise<void> => {
  if (fxRatesCache && Date.now() - fxRatesCache.fetchedAt < 6 * 60 * 60 * 1000) return;
  try {
    const upstream = await directFetch('https://open.er-api.com/v6/latest/USD');
    const data: any = await upstream.json();
    if (data?.result === 'success' && data?.rates && typeof data.rates === 'object') {
      fxRatesCache = { rates: data.rates, fetchedAt: Date.now() };
    }
  } catch {
    // 拉不到就用 FALLBACK_RATES_TO_USD，界面照常出数
  }
};

const sanitizeCategoryName = (value: string | null | undefined): string => {
  const name = String(value || '').trim();
  return name || 'Unassigned';
};

const normalizeCategoryColor = (value: unknown): string => {
  const color = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#0054cd';
};

const sanitizeAccountName = (value: string | null | undefined, fallbackEmail = ''): string => {
  const name = String(value || '').trim();
  // V1.3.6：未填写账户的订阅不再显示 "Unassigned Account"，
  // 归入用户登录邮箱（与订阅页的账户过滤逻辑一致）
  return name || fallbackEmail.trim() || 'Unassigned Account';
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
  // V1.3.9：订阅开始时间——周期改为「订阅时间 → 下一个账单日」的间隔推导，
  // 不再依赖下拉选择的 billing_cycle（月/年之外还能自然支持季付等任意周期）
  if (!subscriptionColumnNames.has('start_date')) {
    await pool.execute('ALTER TABLE subscriptions ADD COLUMN start_date DATE NULL AFTER next_billing_date');
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
  for (const column of [
    'apple_id', 'wechat_id', 'qq_id', 'czl_id', 'github_id', 'gitee_id', 'avatar',
    // 第三方账号的展示名（绑定状态页显示用户名用）
    'apple_name', 'wechat_name', 'qq_name', 'czl_name', 'github_name', 'gitee_name',
    'google_name'
  ]) {
    if (!userColumnNames.has(column)) {
      await pool.execute(`ALTER TABLE users ADD COLUMN ${column} VARCHAR(255) NULL`);
    }
  }
  for (const indexName of ['uniq_users_apple_id', 'uniq_users_wechat_id', 'uniq_users_qq_id', 'uniq_users_czl_id', 'uniq_users_github_id', 'uniq_users_gitee_id']) {
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
      purpose ENUM('register', 'reset_password', 'change_email') NOT NULL,
      code_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      attempts INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_verification_codes_email_purpose (email, purpose)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  // 已存在的表扩展 purpose 枚举（换绑邮箱验证码）
  await pool.execute(`
    ALTER TABLE email_verification_codes
    MODIFY purpose ENUM('register', 'reset_password', 'change_email') NOT NULL
  `);

  // 订阅到期提醒防重表（每个订阅每个提醒日只发一次）
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS subscription_reminders (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      subscription_id VARCHAR(36) NOT NULL,
      user_id INT NOT NULL,
      remind_date DATE NOT NULL,
      days_before INT NOT NULL,
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_subscription_reminder (subscription_id, remind_date)
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

  // V1.3.6：通行密钥自定义命名（label）与最近使用时间（last_used_at），
  // 支持设置页展示具体凭据列表、重命名和删除。老库平滑加列。
  const [passkeyColumns]: any = await pool.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'webauthn_credentials'`
  );
  const passkeyColumnNames = new Set(
    Array.isArray(passkeyColumns)
      ? passkeyColumns.map((row: { COLUMN_NAME: string }) => row.COLUMN_NAME)
      : []
  );
  if (!passkeyColumnNames.has('label')) {
    await pool.execute("ALTER TABLE webauthn_credentials ADD COLUMN label VARCHAR(64) NULL AFTER backed_up");
  }
  if (!passkeyColumnNames.has('last_used_at')) {
    await pool.execute("ALTER TABLE webauthn_credentials ADD COLUMN last_used_at DATETIME NULL AFTER label");
  }

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

const buildAccountSummary = (subscriptions: SubscriptionRow[], ownerEmail = '') => {
  const map = new Map<string, { name: string; monthlyTotal: number; subscriptionCount: number; nextPaymentDate: string | null }>();

  subscriptions.forEach((sub) => {
    const name = sanitizeAccountName(sub.account, ownerEmail);
    const current = map.get(name) || {
      name,
      monthlyTotal: 0,
      subscriptionCount: 0,
      nextPaymentDate: null
    };

    current.monthlyTotal += toMonthlyAmountUsd(sub);
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
    current.monthlyTotal += toMonthlyAmountUsd(sub);
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

const buildStatsOverview = (subscriptions: SubscriptionRow[], ownerEmail = '') => {
  // V1.3.8：统计口径统一折算成 USD（订阅货币可能各不相同），
  // 再由前端按首页展示货币二次换算
  const monthlyForecast = subscriptions.reduce((acc, sub) => acc + toMonthlyAmountUsd(sub), 0);
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
    const monthlyUsd = toMonthlyAmountUsd(sub);
    if (sub.billing_cycle === 'monthly') {
      trend.forEach((month) => {
        month.value += monthlyUsd;
      });
      return;
    }

    const billingMonth = sub.next_billing_date && !Number.isNaN(new Date(sub.next_billing_date).getTime())
      ? new Date(sub.next_billing_date).getMonth()
      : currentMonthIndex;
    trend[billingMonth].value += parsePrice(sub.price) * currencyToUsdRate(sub.currency);
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
  // 占比改为按订阅数量计算（用户预期：2 娱乐/1 效率/1 影音 = 50/25/25），
  // 金额占比在混币场景下反而失真；分类月均金额（USD）一并提供给前端展示
  const categoryCountTotal = categoryTotals.reduce((acc, item) => acc + item.count, 0);
  const categoryBreakdown = categoryTotals.map((item) => ({
    name: item.name,
    count: item.count,
    amount: Number(item.monthlyTotal.toFixed(2)),
    value: categoryCountTotal > 0 ? Number(((item.count / categoryCountTotal) * 100).toFixed(1)) : 0,
    color: item.color
  }));

  const accountTotals = buildAccountSummary(subscriptions, ownerEmail);
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
  // 「查看详情」用：候选分类下每个订阅的月均金额（USD）
  const optimizationItems = optimizationCandidate
    ? subscriptions
        .filter((sub) => sanitizeCategoryName(sub.category) === optimizationCandidate.name)
        .map((sub) => ({
          name: String(sub.name || '').trim() || 'Subscription',
          amount: Number(toMonthlyAmountUsd(sub).toFixed(2))
        }))
    : [];

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
      potentialSavings,
      items: optimizationItems
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

const CODE_PURPOSES = ['register', 'reset_password', 'change_email'] as const;
type CodePurpose = typeof CODE_PURPOSES[number];
const CODE_TTL_MINUTES = 10;
const CODE_MAX_ATTEMPTS = 5;
const CODE_SEND_COOLDOWN_MS = 60 * 1000;
const CODE_HOURLY_LIMIT = 5;

// 微信 / QQ / Apple / CZL / GitHub / Gitee 匿名用户没有真实邮箱，用占位邮箱满足 users.email 的唯一约束。
// 占位邮箱不能用于收验证码，找回密码接口会显式拒绝。
const EMAIL_PLACEHOLDER_DOMAINS = [
  '@wechat.placeholder',
  '@qq.placeholder',
  '@apple.placeholder',
  '@czl.placeholder',
  '@github.placeholder',
  '@gitee.placeholder'
];
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

const CODE_PURPOSE_LABELS: Record<CodePurpose, string> = {
  register: '注册',
  reset_password: '密码重置',
  change_email: '换绑邮箱'
};

// UniDAYS 风格的一次性验证码邮件：白色背景 + 白卡片（紫色渐变品牌头 + 浅紫底托验证码），
// 纯文本回退保留。渐变在不支持的客户端（如 Outlook）退化为 bgcolor 纯色。
const renderVerificationCodeEmailHtml = (code: string, purposeText: string) => `
<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:28px 12px;background:#ffffff;font-family:-apple-system,'PingFang SC','Helvetica Neue','Microsoft YaHei',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #ece6f7;border-radius:20px;overflow:hidden;box-shadow:0 6px 24px rgba(124,77,196,0.12);">
    <tr>
      <td bgcolor="#8f6bc8" style="background-image:linear-gradient(135deg,#a98be0 0%,#8f6bc8 60%,#7c55b8 100%);padding:30px 40px 26px;text-align:center;">
        <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">DingYue 订阅管理助手</div>
        <div style="font-size:12px;color:#e6dbf8;margin-top:6px;letter-spacing:2px;">SUBSCRIPTION MANAGER</div>
      </td>
    </tr>
    <tr>
      <td style="padding:30px 40px 0;text-align:center;">
        <div style="font-size:23px;font-weight:700;color:#3c3350;">${purposeText}验证码</div>
      </td>
    </tr>
    <tr>
      <td style="padding:22px 40px 8px;text-align:center;">
        <div style="display:inline-block;background:#f4eefc;border-radius:16px;padding:18px 30px;">
          <span style="font-size:50px;font-weight:700;color:#9a6fd0;letter-spacing:13px;text-indent:13px;line-height:1.15;">${code}</span>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 40px 8px;text-align:center;">
        <div style="font-size:15px;color:#5b5470;line-height:1.8;">
          这是你的${purposeText}验证码。<br>
          验证码 ${CODE_TTL_MINUTES} 分钟内有效。如果不是你本人操作，请忽略这封邮件。
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:30px 40px 36px;">
        <div style="border-top:1px solid #efe9f9;padding-top:20px;text-align:center;font-size:12px;color:#9d96ad;line-height:1.7;">
          如需帮助，请联系 <a href="mailto:support@ngaasiu.studio" style="color:#8f6bc8;">support@ngaasiu.studio</a><br>
          请勿回复本邮件。
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;

// 订阅到期提醒邮件（与验证码同风格的紫头卡片），由 alert@ 发出。
// V1.3.9 按用户反馈重构：订阅名称放在方框外（换色加粗），
// 方框里放到期日期 + 金额（大号加粗，醒目）
const renderBillingReminderEmailHtml = (
  subName: string,
  daysBefore: number,
  dueDate: string,
  priceText: string,
  kind: 'due' | 'expired' = 'due'
) => `
<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:28px 12px;background:#ffffff;font-family:-apple-system,'PingFang SC','Helvetica Neue','Microsoft YaHei',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #ece6f7;border-radius:20px;overflow:hidden;box-shadow:0 6px 24px rgba(124,77,196,0.12);">
    <tr>
      <td bgcolor="#8f6bc8" style="background-image:linear-gradient(135deg,#a98be0 0%,#8f6bc8 60%,#7c55b8 100%);padding:30px 40px 26px;text-align:center;">
        <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">DingYue 订阅管理助手</div>
        <div style="font-size:12px;color:#e6dbf8;margin-top:6px;letter-spacing:2px;">SUBSCRIPTION MANAGER</div>
      </td>
    </tr>
    <tr>
      <td style="padding:28px 40px 0;text-align:center;">
        <div style="font-size:23px;font-weight:700;color:#3c3350;">${kind === 'expired' ? '订阅已到期' : '订阅到期提醒'}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:16px 40px 4px;text-align:center;">
        <div style="font-size:20px;font-weight:800;color:#7c55b8;">${subName}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 40px 8px;text-align:center;">
        <div style="display:inline-block;background:#f4eefc;border-radius:16px;padding:18px 34px;max-width:100%;">
          <div style="font-size:32px;font-weight:800;color:#7c55b8;line-height:1.25;">${dueDate}</div>
          ${priceText ? `<div style="font-size:20px;font-weight:700;color:#9a6fd0;margin-top:8px;">${priceText}</div>` : ''}
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 40px 8px;text-align:center;">
        <div style="font-size:15px;color:#5b5470;line-height:1.8;">
          ${kind === 'expired'
            ? '该订阅已到达账单日。如果仍在使用，请在 DingYue 中更新下一个账单日；不再使用可忽略本邮件。'
            : `${daysBefore > 0 ? `该订阅将于 <b>${daysBefore}</b> 天后到期续费。` : '该订阅将在今天到期续费。'}如果不再需要，请记得在到期前取消，避免自动扣费。`}
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:30px 40px 36px;">
        <div style="border-top:1px solid #efe9f9;padding-top:20px;text-align:center;font-size:12px;color:#9d96ad;line-height:1.7;">
          如需帮助，请联系 <a href="mailto:support@ngaasiu.studio" style="color:#8f6bc8;">support@ngaasiu.studio</a><br>
          本邮件由 DingYue 自动发送。
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;

// 每日到期提醒扫描：到期前 15/7/3 天 + 到期当天 + 已过期都发提醒（V1.3.9 新增后两档），
// subscription_reminders 表（订阅+提醒日+档位唯一）保证同一订阅同一档位只发一次。
// 已过期按订阅列表扫描：每个未处理过的账单日发一封「已到期」提醒（days_before = -1）。
const REMINDER_DAYS_BEFORE = [15, 7, 3, 0];
const runBillingReminders = async (): Promise<number> => {
  if (!alertMailer || !smtpConfigured) return 0;
  const [rows]: any = await pool.query(
    `SELECT s.id AS sub_id, s.name, s.next_billing_date, s.price, s.currency, s.billing_cycle,
            s.user_id, u.email
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     WHERE s.next_billing_date IS NOT NULL
       AND s.status IN ('normal', 'trial')
       AND (s.next_billing_date IN
         (CURDATE() + INTERVAL 15 DAY, CURDATE() + INTERVAL 7 DAY, CURDATE() + INTERVAL 3 DAY, CURDATE())
        OR s.next_billing_date < CURDATE())`
  );
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  let sent = 0;
  for (const row of rows) {
    if (!row.email || isPlaceholderEmail(row.email)) continue;
    const remindDate = String(row.next_billing_date).slice(0, 10);
    const daysBefore = Math.round(
      (new Date(remindDate).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000
    );
    const expired = daysBefore < 0;
    const dedupeDaysBefore = expired ? -1 : daysBefore;
    const [insertResult]: any = await pool.query(
      `INSERT IGNORE INTO subscription_reminders (subscription_id, user_id, remind_date, days_before)
       VALUES (?, ?, ?, ?)`,
      [row.sub_id, row.user_id, remindDate, dedupeDaysBefore]
    );
    if (!insertResult || insertResult.affectedRows === 0) continue;

    const priceText = Number(row.price) > 0
      ? `${currencySymbolServer(row.currency)}${Number(row.price).toFixed(2)}${row.billing_cycle === 'annually' ? ' / 年' : ' / 月'}`
      : '';
    const [y, m, d] = remindDate.split('-');
    const dueDateCN = `${y} 年 ${Number(m)} 月 ${Number(d)} 日`;
    const subject = expired
      ? `【DingYue】「${row.name}」订阅已到期`
      : daysBefore === 0
        ? `【DingYue】「${row.name}」今日到期`
        : `【DingYue】「${row.name}」将于 ${daysBefore} 天后到期`;
    try {
      await alertMailer.sendMail({
        from: ALERT_FROM,
        to: row.email,
        subject,
        html: renderBillingReminderEmailHtml(
          row.name,
          daysBefore,
          dueDateCN,
          priceText,
          expired ? 'expired' : 'due'
        ),
        text: expired
          ? `你的订阅「${row.name}」已于 ${remindDate} 到期。如仍在使用请更新下一个账单日。`
          : `你的订阅「${row.name}」将于 ${remindDate}（${expired ? '已过期' : daysBefore + ' 天后'}）到期${priceText ? '，金额 ' + priceText : ''}。如不再需要请记得取消。`
      });
      sent += 1;
    } catch (error) {
      // 发送失败时清除防重记录，下轮重试
      await pool.query('DELETE FROM subscription_reminders WHERE subscription_id = ? AND remind_date = ? AND days_before = ?', [row.sub_id, remindDate, dedupeDaysBefore]);
      console.error('Billing reminder send failed:', error instanceof Error ? error.message : error);
    }
  }
  return sent;
};

// 每小时整点后跑一次扫描（提醒日期由 SQL 精确匹配，防重表保证不重复发送）
const scheduleBillingReminders = () => {
  const tick = () => {
    void runBillingReminders()
      .then((sent) => { if (sent > 0) console.log(`Billing reminders sent: ${sent}`); })
      .catch((e) => console.error('Billing reminder scan failed:', e.message));
  };
  setTimeout(tick, 45 * 1000);
  setInterval(tick, 60 * 60 * 1000);
};

const sendVerificationCodeEmail = async (email: string, code: string, purpose: CodePurpose) => {
  const purposeText = CODE_PURPOSE_LABELS[purpose];
  const subject = `【DingYue】${purposeText}验证码`;
  const text = `你的 DingYue ${purposeText}验证码是：${code}\n\n验证码 ${CODE_TTL_MINUTES} 分钟内有效。如果不是你本人操作，请忽略这封邮件。`;
  const html = renderVerificationCodeEmailHtml(code, purposeText);

  if (!mailer) {
    console.log(`[dev] ${purposeText}验证码 ${email}: ${code}`);
    return;
  }
  await mailer.sendMail({ from: SMTP_FROM, to: email, subject, text, html });
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

const SOCIAL_PROVIDER_COLUMNS = ['google_id', 'apple_id', 'wechat_id', 'qq_id', 'czl_id', 'github_id', 'gitee_id'] as const;
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
  // 每个第三方渠道有配套的展示名列（google_name / github_name / ...），绑定状态页展示用户名用
  const nameColumn = providerColumn.replace(/_id$/, '_name');
  const displayName = name || '用户';

  const [byProvider]: any = await pool.execute(
    `SELECT * FROM users WHERE ${providerColumn} = ? LIMIT 1`,
    [providerId]
  );
  if (byProvider?.[0]) return byProvider[0];

  if (email) {
    // 已有同邮箱账户（例如邮箱注册用户）时直接关联该第三方账号
    const [byEmail]: any = await pool.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
    if (byEmail?.[0]) {
      await pool.execute(
        `UPDATE users SET ${providerColumn} = ?, ${nameColumn} = ? WHERE id = ?`,
        [providerId, displayName, byEmail[0].id]
      );
      return { ...byEmail[0], [providerColumn]: providerId, [nameColumn]: displayName };
    }
  }

  const placeholderEmail = createPlaceholderEmail(placeholderPrefix, providerId, placeholderDomain);
  try {
    await pool.execute(
      `INSERT INTO users (email, name, ${providerColumn}, ${nameColumn}) VALUES (?, ?, ?, ?)`,
      [placeholderEmail, displayName, providerId, displayName]
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

// ── 第三方 code 换用户信息（登录与绑定共用） ─────────────────

type SocialProfile = {
  id: string;
  name: string;
  email: string | null;
  providerColumn: SocialProviderColumn;
};

const exchangeGithubProfile = async (code: string): Promise<SocialProfile> => {
  const clientId = process.env.GITHUB_APP_ID || '';
  const clientSecret = process.env.GITHUB_APP_SECRET || '';
  if (!clientId || !clientSecret) {
    throw Object.assign(new Error('GitHub 登录暂未配置，请联系管理员'), { status: 501 });
  }
  // Accept: application/json 必传 —— GitHub 换 token 接口默认返回表单编码
  const tokenRes = await directFetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: String(code)
    }).toString()
  });
  const tokenData: any = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || '无效 code');
  }
  // GitHub API 强制要求 User-Agent 头，缺失时可能直接 403
  const userRes = await directFetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'DingYue-App'
    }
  });
  const profile: any = await userRes.json();
  if (!profile?.id) {
    throw new Error('无法获取用户信息');
  }
  return {
    id: String(profile.id),
    name: String(profile.name || profile.login || 'GitHub用户').trim(),
    email: typeof profile.email === 'string' && profile.email.includes('@') ? normalizeEmail(profile.email) : null,
    providerColumn: 'github_id'
  };
};

const exchangeGiteeProfile = async (code: string, redirectUri?: string): Promise<SocialProfile> => {
  const clientId = process.env.GITEE_APP_ID || '';
  const clientSecret = process.env.GITEE_APP_SECRET || '';
  if (!clientId || !clientSecret) {
    throw Object.assign(new Error('Gitee 登录暂未配置，请联系管理员'), { status: 501 });
  }
  const tokenRes = await directFetch('https://gitee.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri ? String(redirectUri) : 'https://ngaasiu.studio/'
    }).toString()
  });
  const tokenData: any = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || '无效 code');
  }
  const userRes = await directFetch('https://gitee.com/api/v5/user?access_token=' + encodeURIComponent(tokenData.access_token));
  const profile: any = await userRes.json();
  if (!profile?.id) {
    throw new Error('无法获取用户信息');
  }
  return {
    id: String(profile.id),
    name: String(profile.name || profile.login || 'Gitee用户').trim(),
    email: typeof profile.email === 'string' && profile.email.includes('@') ? normalizeEmail(profile.email) : null,
    providerColumn: 'gitee_id'
  };
};

const exchangeCzlProfile = async (code: string, redirectUri?: string): Promise<SocialProfile> => {
  if (!CZL_CLIENT_ID || !CZL_CLIENT_SECRET) {
    throw Object.assign(new Error('该登录方式暂未配置，请联系管理员'), { status: 501 });
  }
  const tokenRes = await directFetch(`${CZL_BASE_URL}/api/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code),
      client_id: CZL_CLIENT_ID,
      client_secret: CZL_CLIENT_SECRET,
      ...(redirectUri ? { redirect_uri: String(redirectUri) } : {})
    }).toString()
  });
  const tokenData: any = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || '无效 code');
  }
  const infoRes = await directFetch(`${CZL_BASE_URL}/api/oauth2/userinfo`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` }
  });
  const profile: any = await infoRes.json();
  if (!profile?.id) {
    throw new Error('无法获取用户信息');
  }
  // CZL 返回的邮箱不一定已验证，只有明确 verified 才允许按邮箱关联已有账户，
  // 否则视为匿名用户走占位邮箱，避免恶意抢绑他人邮箱账户。
  const verifiedEmail =
    profile.email_verified === true && typeof profile.email === 'string' && profile.email.includes('@')
      ? normalizeEmail(profile.email)
      : null;
  return {
    id: String(profile.id),
    name: String(profile.nickname || profile.username || '').trim() || '微信用户',
    email: verifiedEmail,
    providerColumn: 'czl_id'
  };
};

// 绑定第三方账号到当前用户：占用检查 + 写入 id 与展示名
const bindSocialAccount = async (
  userId: number,
  providerColumn: SocialProviderColumn,
  providerId: string,
  displayName: string
) => {
  const nameColumn = providerColumn.replace(/_id$/, '_name');
  const [takenRows]: any = await pool.execute(
    `SELECT id FROM users WHERE ${providerColumn} = ? AND id <> ? LIMIT 1`,
    [providerId, userId]
  );
  if (Array.isArray(takenRows) && takenRows.length > 0) {
    throw Object.assign(
      new Error('该第三方账号已绑定其他 DingYue 账号，请先前往那个账号的「第三方登录」页解绑，或换绑其他账号'),
      { status: 409 }
    );
  }
  await pool.execute(
    `UPDATE users SET ${providerColumn} = ?, ${nameColumn} = ? WHERE id = ?`,
    [providerId, displayName, userId]
  );
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
    if (purpose === 'register' || purpose === 'change_email') {
      // 注册 / 换绑邮箱：目标邮箱必须是「未注册」的
      const [rows]: any = await pool.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
      if (Array.isArray(rows) && rows.length > 0) {
        const reason = purpose === 'register' ? '该邮箱已注册，请直接登录' : '该邮箱已绑定其他 DingYue 账号，请换一个邮箱';
        return res.status(400).json({ error: reason });
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

// Google 登录共用的账号落库逻辑（id_token / access_token / code 三种凭证殊途同归）
const finishGoogleLogin = async (
  googleId: string,
  email: string,
  name: string
) => {
  const [rows]: any = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
  let user = rows[0];
  if (!user) {
    await pool.execute(
        'INSERT INTO users (email, name, google_id, google_name) VALUES (?, ?, ?, ?)',
        [email, name, googleId, name]
    );
    const [newRows]: any = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
    user = newRows[0];
  } else if (!user.google_id) {
    // 已存在的邮箱/密码账户首次使用 Google 登录时，补充关联 google_id
    await pool.execute('UPDATE users SET google_id = ?, google_name = ? WHERE id = ?', [googleId, name, user.id]);
    user.google_id = googleId;
  }
  return user;
};

// POST /api/auth/google — 三种凭证任选其一：
//   credential:   GIS 的 id_token（Web GIS / 原生 SDK）
//   accessToken:  Google OAuth 隐式流程的 access_token（网页端自定义按钮）
//   code+redirectUri: 授权码（桌面端整窗 OAuth，服务端用 secret 换取）
app.post('/api/auth/google', async (req, res) => {
  const { credential, accessToken, code, redirectUri } = req.body;
  try {
    let payload: any = null;

    if (credential) {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID
      });
      payload = ticket.getPayload();
    } else if (accessToken) {
      const uiRes = await directFetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const ui: any = await uiRes.json();
      if (!ui?.sub) {
        return res.status(400).json({ error: 'Google 凭证无效' });
      }
      payload = { sub: ui.sub, email: ui.email, name: ui.name };
    } else if (code) {
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
      if (!clientSecret) {
        return res.status(501).json({ error: 'Google 桌面登录暂未配置，请使用其他方式登录' });
      }
      const tokenRes = await directFetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(code),
          client_id: GOOGLE_CLIENT_ID,
          client_secret: clientSecret,
          redirect_uri: String(redirectUri || 'https://ngaasiu.studio/'),
          grant_type: 'authorization_code'
        }).toString()
      });
      const tokenData: any = await tokenRes.json();
      if (!tokenData.id_token) {
        return res.status(400).json({ error: 'Google 授权码无效: ' + (tokenData.error_description || tokenData.error || '未知错误') });
      }
      const ticket = await googleClient.verifyIdToken({
        idToken: tokenData.id_token,
        audience: GOOGLE_CLIENT_ID
      });
      payload = ticket.getPayload();
    } else {
      return res.status(400).json({ error: '缺少 Google 凭证' });
    }

    if (!payload?.email) {
      return res.status(400).json({ error: 'Google 账户未返回邮箱信息' });
    }
    const user = await finishGoogleLogin(payload.sub, payload.email, payload.name || payload.email);
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

// POST /api/auth/czl — CZL Connect 中继登录（默认限定微信上游）回传 code。
// 文档：授权 https://{base}/oauth2/authorize，换票 POST /api/oauth2/token（form），
// 用户信息 GET /api/oauth2/userinfo（Bearer）→ { id, username, nickname, email, avatar, upstreams }
app.post('/api/auth/czl', async (req, res) => {
  const { code, redirectUri } = req.body;
  if (!code) {
    return res.status(400).json({ error: '缺少登录 code' });
  }
  try {
    const profile = await exchangeCzlProfile(String(code), redirectUri ? String(redirectUri) : undefined);
    const user = await findOrCreateSocialUser({
      providerColumn: profile.providerColumn,
      providerId: profile.id,
      email: profile.email,
      name: profile.name,
      placeholderPrefix: 'czl',
      placeholderDomain: '@czl.placeholder'
    });
    if (!user) {
      return res.status(400).json({ error: '登录失败: 无法创建或匹配用户' });
    }
    res.json(buildAuthResponse(user));
  } catch (e: any) {
    if (e?.status === 501) return res.status(501).json({ error: e.message });
    if (process.env.NODE_ENV !== 'production') console.error('CZL login error:', e);
    res.status(400).json({ error: '登录失败: ' + e.message });
  }
});

// POST /api/auth/github — GitHub OAuth 登录后回传 code
app.post('/api/auth/github', async (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: '缺少 GitHub 登录 code' });
  }
  try {
    const profile = await exchangeGithubProfile(String(code));
    const user = await findOrCreateSocialUser({
      providerColumn: profile.providerColumn,
      providerId: profile.id,
      email: profile.email,
      name: profile.name,
      placeholderPrefix: 'github',
      placeholderDomain: '@github.placeholder'
    });
    if (!user) {
      return res.status(400).json({ error: 'GitHub 登录失败: 无法创建或匹配用户' });
    }
    res.json(buildAuthResponse(user));
  } catch (e: any) {
    if (e?.status === 501) return res.status(501).json({ error: e.message });
    if (process.env.NODE_ENV !== 'production') console.error('GitHub login error:', e);
    res.status(400).json({ error: 'GitHub 登录失败: ' + e.message });
  }
});

// POST /api/auth/gitee — Gitee OAuth 登录后回传 code
app.post('/api/auth/gitee', async (req, res) => {
  const { code, redirectUri } = req.body;
  if (!code) {
    return res.status(400).json({ error: '缺少 Gitee 登录 code' });
  }
  try {
    const profile = await exchangeGiteeProfile(String(code), redirectUri ? String(redirectUri) : undefined);
    const user = await findOrCreateSocialUser({
      providerColumn: profile.providerColumn,
      providerId: profile.id,
      email: profile.email,
      name: profile.name,
      placeholderPrefix: 'gitee',
      placeholderDomain: '@gitee.placeholder'
    });
    if (!user) {
      return res.status(400).json({ error: 'Gitee 登录失败: 无法创建或匹配用户' });
    }
    res.json(buildAuthResponse(user));
  } catch (e: any) {
    if (e?.status === 501) return res.status(501).json({ error: e.message });
    if (process.env.NODE_ENV !== 'production') console.error('Gitee login error:', e);
    res.status(400).json({ error: 'Gitee 登录失败: ' + e.message });
  }
});

// ─────────────────────────────────────────────
// 第三方账号绑定 / 解绑（登录后在「第三方登录」页操作）
// provider 统一用业务名：google / wechat(走 CZL 中继) / github / gitee
// ─────────────────────────────────────────────

const BIND_PROVIDER_COLUMNS = {
  google: 'google_id',
  wechat: 'czl_id',
  github: 'github_id',
  gitee: 'gitee_id'
} as const;
type BindProvider = keyof typeof BIND_PROVIDER_COLUMNS;

// POST /api/auth/bind/google — Google 绑定：提交登录页同款 id_token 凭证
app.post('/api/auth/bind/google', authRequired, async (req: AuthenticatedRequest, res) => {
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
    if (!payload?.sub) {
      return res.status(400).json({ error: 'Google 凭证无效' });
    }
    await bindSocialAccount(req.user!.userId, 'google_id', payload.sub, payload.name || payload.email || 'Google 账号');
    res.json({ success: true });
  } catch (e: any) {
    res.status(typeof e?.status === 'number' ? e.status : 400).json({ error: e.message || '绑定失败' });
  }
});

// POST /api/auth/bind/:provider — GitHub / Gitee / 微信(CZL) 绑定：提交 OAuth code
app.post('/api/auth/bind/:provider', authRequired, async (req: AuthenticatedRequest, res) => {
  const provider = String(req.params?.provider || '') as BindProvider;
  if (!(provider in BIND_PROVIDER_COLUMNS)) {
    return res.status(400).json({ error: '不支持的绑定方式' });
  }
  const { code, redirectUri } = req.body;
  if (!code) {
    return res.status(400).json({ error: '缺少绑定 code' });
  }
  try {
    const profile =
      provider === 'github'
        ? await exchangeGithubProfile(String(code))
        : provider === 'gitee'
          ? await exchangeGiteeProfile(String(code), redirectUri ? String(redirectUri) : undefined)
          : await exchangeCzlProfile(String(code), redirectUri ? String(redirectUri) : undefined);
    await bindSocialAccount(req.user!.userId, profile.providerColumn, profile.id, profile.name);
    res.json({ success: true });
  } catch (e: any) {
    res.status(typeof e?.status === 'number' ? e.status : 400).json({ error: e.message || '绑定失败' });
  }
});

// POST /api/auth/unbind/:provider — 解绑；解绑后账户必须仍保留至少一种登录方式
app.post('/api/auth/unbind/:provider', authRequired, async (req: AuthenticatedRequest, res) => {
  const provider = String(req.params?.provider || '') as BindProvider;
  if (!(provider in BIND_PROVIDER_COLUMNS)) {
    return res.status(400).json({ error: '不支持的解绑方式' });
  }
  try {
    const userId = req.user!.userId;
    const [rows]: any = await pool.query(
      `SELECT id, password_hash, google_id, apple_id, wechat_id, qq_id, czl_id, github_id, gitee_id
       FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    const user = rows?.[0];
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const column = BIND_PROVIDER_COLUMNS[provider];
    if (!user[column]) {
      return res.status(400).json({ error: '该方式尚未绑定' });
    }
    const otherSocialCount = Object.values(BIND_PROVIDER_COLUMNS)
      .filter((col) => col !== column && user[col])
      .length
      + (user.apple_id ? 1 : 0);
    let passkeyCount = 0;
    if (!user.password_hash) {
      const [pkRows]: any = await pool.query(
        'SELECT COUNT(*) AS count FROM webauthn_credentials WHERE user_id = ?',
        [userId]
      );
      passkeyCount = Number(pkRows?.[0]?.count || 0);
    }
    if (!user.password_hash && otherSocialCount === 0 && passkeyCount === 0) {
      return res.status(400).json({ error: '为了账户安全，请先设置密码或绑定其他登录方式后再解绑' });
    }
    await pool.execute(
      `UPDATE users SET ${column} = NULL, ${column.replace(/_id$/, '_name')} = NULL WHERE id = ?`,
      [userId]
    );
    res.json({ success: true });
  } catch (e: any) {
    console.error('Unbind error:', e);
    res.status(500).json({ error: e.message || '解绑失败' });
  }
});

// GET /api/security/bindings — 第三方绑定状态（含展示名）
app.get('/api/security/bindings', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const [rows]: any = await pool.query(
      `SELECT google_id, google_name, czl_id, czl_name, github_id, github_name, gitee_id, gitee_name
       FROM users WHERE id = ? LIMIT 1`,
      [req.user!.userId]
    );
    const user = rows?.[0];
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      bindings: [
        { provider: 'google', bound: Boolean(user.google_id), displayName: user.google_name || null },
        { provider: 'wechat', bound: Boolean(user.czl_id), displayName: user.czl_name || null },
        { provider: 'github', bound: Boolean(user.github_id), displayName: user.github_name || null },
        { provider: 'gitee', bound: Boolean(user.gitee_id), displayName: user.gitee_name || null }
      ]
    });
  } catch (e: any) {
    console.error('Bindings error:', e);
    res.status(500).json({ error: e.message || '加载绑定信息失败' });
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
      (id, user_id, name, icon, price, currency, billing_cycle, next_billing_date, start_date, category, account, region, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      sub.start_date || null,
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
      'next_billing_date', 'start_date', 'category', 'account', 'region', 'status'
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
        if ((field === 'next_billing_date' || field === 'start_date') && (!val || val === '')) {
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
    const accounts = buildAccountSummary(subscriptions, req.user!.email);
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
    const overview = buildStatsOverview(subscriptions, req.user!.email);
    res.json(overview);
  } catch (error: any) {
    console.error('Error fetching stats overview:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────
// V1.3.6 真实账单趋势（统计页年/月/日选择器数据源）
//
// 旧版 trendData 是按 next_billing_date 推的"未来 12 个月预测值"，且月度
// 视图只截取了含当前月的 6 个月——这就是"一年只有 4-9 月"的根因。
// 现改为以每个订阅的账单锚点（next_billing_date，缺失退回 created_at）向
// 过去/未来按周期展开出真实账单日序列：
//   • 年视图：所选年 1-12 月逐月账单合计（未来月份标记 forecast）
//   • 月视图：所选月 1-31 日逐日账单（月合计 = 日合计）
// 展开不早于订阅的 created_at（添加之前的账单不追溯）。
// ─────────────────────────────────────────────
const expandBillingDates = (
  sub: SubscriptionRow,
  rangeStart: Date,
  rangeEnd: Date
): Date[] => {
  const anchorRaw = sub.next_billing_date && !Number.isNaN(new Date(sub.next_billing_date).getTime())
    ? new Date(sub.next_billing_date)
    : null;
  const created = new Date(sub.created_at);
  if (Number.isNaN(created.getTime())) return [];
  // 锚点无效（无 next_billing_date）时，以创建日当期账单日近似
  const anchor = anchorRaw && anchorRaw.getTime() > created.getTime() ? anchorRaw : created;
  anchor.setHours(0, 0, 0, 0);

  const stepMonthsBase = sub.billing_cycle === 'annually' ? 12 : 1;
  const dates: Date[] = [];

  // V1.3.9：周期由「订阅时间 → 下一个账单日」推导；间隔接近整月（±3 天）时
  // 仍按月推进以保持账单日（如每月 31 日），否则按实际天数推进（季付/任意周期）
  const cycleDays = subscriptionCycleDays(sub);
  const stepMonths = cycleDays
    ? (Math.abs(Math.round(cycleDays / 30.4375) * 30.4375 - cycleDays) <= 3
        ? Math.max(1, Math.round(cycleDays / 30.4375))
        : 0)
    : stepMonthsBase;
  const stepDays = stepMonths === 0 ? (cycleDays || 30) : 0;
  const dayOfMonth = anchor.getDate();

  // 以「年+月」偏移生成与锚点同日的账单日，避免 setMonth 溢出（1/31 + 1月 → 3/3）
  const shift = (d: Date, months: number): Date => {
    const target = new Date(d);
    const day = target.getDate();
    target.setDate(1);
    target.setMonth(target.getMonth() + months);
    // 月末溢出保护：目标月天数不足时取该月最后一天
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day, lastDay));
    target.setHours(0, 0, 0, 0);
    return target;
  };
  const addDays = (d: Date, days: number): Date => {
    const target = new Date(d);
    target.setDate(target.getDate() + days);
    target.setHours(0, 0, 0, 0);
    return target;
  };
  const stepBack = (d: Date, k: number): Date => (stepMonths ? shift(d, -k * stepMonths) : addDays(d, -k * stepDays));
  const stepForward = (d: Date, k: number): Date => (stepMonths ? shift(d, k * stepMonths) : addDays(d, k * stepDays));

  // 向过去展开：下限放宽到「创建日再往前一个周期」——用户拿到账单后才把订阅
  // 录入 App（created 晚于实际扣费日），当期这笔记录必须能在趋势里看到，
  // 否则刚添加的订阅在当年趋势里永远是 0（V1.3.8 用户反馈）
  const currentPeriodStart = stepBack(anchor, 1).getTime();
  const earliest = Math.min(created.getTime(), currentPeriodStart) > rangeStart.getTime()
    ? Math.min(created.getTime(), currentPeriodStart)
    : rangeStart.getTime();
  for (let k = 0; ; k++) {
    const date = stepBack(anchor, k);
    if (date.getTime() < earliest) break;
    if (date.getTime() <= rangeEnd.getTime()) dates.push(date);
    if (k > 1200) break; // 保险丝：100 年
  }
  // 向未来展开（到 rangeEnd 为止）
  for (let k = 1; ; k++) {
    const date = stepForward(anchor, k);
    if (date.getTime() > rangeEnd.getTime()) break;
    dates.push(date);
    if (k > 1200) break;
  }
  return dates.sort((a, b) => a.getTime() - b.getTime());
};

app.get('/api/stats/trend', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const now = new Date();
    const year = Math.min(Math.max(Number(req.query.year) || now.getFullYear(), 1970), 2999);
    const month = req.query.month !== undefined
      ? Math.min(Math.max(Number(req.query.month), 1), 12)
      : null;

    const subscriptions = await fetchUserSubscriptions(req.user!.userId);
    const rangeStart = month
      ? new Date(year, month - 1, 1)
      : new Date(year, 0, 1);
    const rangeEnd = month
      ? new Date(year, month, 0, 23, 59, 59)
      : new Date(year, 11, 31, 23, 59, 59);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const monthTotals = new Array(12).fill(0);
    const daysInMonth = month ? new Date(year, month, 0).getDate() : 0;
    const dayTotals = new Array(daysInMonth).fill(0);

    subscriptions.forEach((sub) => {
      // V1.3.8：各订阅货币不同，趋势图统一折算成 USD 基准再累加，
      // 前端再按首页展示货币换算
      const priceUsd = parsePrice(sub.price) * currencyToUsdRate(sub.currency);
      expandBillingDates(sub, rangeStart, rangeEnd).forEach((date) => {
        if (date.getFullYear() !== year) return;
        monthTotals[date.getMonth()] += priceUsd;
        if (month && date.getMonth() === month - 1) {
          dayTotals[date.getDate() - 1] += priceUsd;
        }
      });
    });

    const months = monthTotals.map((value, index) => ({
      label: MONTH_LABELS[index],
      value: Number(value.toFixed(2)),
      // 未来月（1 日晚于今天）标记为预测值，前端虚化显示；当月算实际
      forecast: new Date(year, index, 1) > today
    }));
    const days = dayTotals.map((value, index) => ({
      label: String(index + 1),
      value: Number(value.toFixed(2)),
      forecast: new Date(year, month! - 1, index + 1) > today
    }));

    res.json({ year, month, months, days });
  } catch (error: any) {
    console.error('Error fetching stats trend:', error);
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

// PATCH /api/security/email — 换绑邮箱：新邮箱需先收验证码（purpose=change_email），
// 换绑前查库确认新邮箱未被其他账号占用。
app.patch('/api/security/email', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const nextEmail = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();

    if (!nextEmail || !isDeliverableEmail(nextEmail)) {
      return res.status(400).json({ error: '请输入有效的邮箱地址' });
    }
    if (!code) {
      return res.status(400).json({ error: '请输入新邮箱收到的验证码' });
    }

    const [currentRows]: any = await pool.query('SELECT id, email FROM users WHERE id = ? LIMIT 1', [userId]);
    const current = currentRows?.[0];
    if (!current) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (current.email === nextEmail) {
      return res.status(400).json({ error: '新邮箱与当前邮箱相同' });
    }

    const [dupRows]: any = await pool.query(
      'SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1',
      [nextEmail, userId]
    );
    if (Array.isArray(dupRows) && dupRows.length > 0) {
      return res.status(409).json({ error: '该邮箱已绑定其他 DingYue 账号，请换一个邮箱' });
    }

    await consumeVerificationCode(nextEmail, 'change_email', code);
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
    if (typeof error?.status === 'number') {
      return res.status(error.status).json({ error: error.message });
    }
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
    // V1.3.6：支持自定义命名；未命名时按已有序号生成默认名（如「通行密钥 2」）
    const [existingRows]: any = await pool.query(
      'SELECT COUNT(*) AS count FROM webauthn_credentials WHERE user_id = ?',
      [userId]
    );
    const nextIndex = Number(existingRows?.[0]?.count || 0) + 1;
    const label = String(req.body?.label || '').trim().slice(0, 64) || `通行密钥 ${nextIndex}`;
    await pool.execute(
      `INSERT INTO webauthn_credentials
         (user_id, credential_id, credential_public_key, counter, transports, device_type, backed_up, label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE counter = VALUES(counter), user_id = VALUES(user_id), label = VALUES(label)`,
      [
        userId,
        credential.id,
        Buffer.from(credential.publicKey).toString('base64url'),
        credential.counter,
        (credential.transports || []).join(','),
        credentialDeviceType,
        credentialBackedUp,
        label
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
      'UPDATE webauthn_credentials SET counter = ?, last_used_at = NOW() WHERE id = ?',
      [verification.authenticationInfo.newCounter, stored.id]
    );
    const [userRows]: any = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [stored.user_id]);
    res.json(buildAuthResponse(userRows[0]));
  } catch (error: any) {
    console.error('WebAuthn auth verify error:', error);
    res.status(400).json({ error: '通行密钥登录失败: ' + error.message });
  }
});

// ─────────────────────────────────────────────
// V1.3.6 通行密钥凭据管理（列表 / 重命名 / 删除）
// ─────────────────────────────────────────────
const PASSKEY_LIST_SQL = `
  SELECT id, label, device_type, backed_up, created_at, last_used_at
  FROM webauthn_credentials
  WHERE user_id = ?
  ORDER BY created_at ASC
`;

app.get('/api/webauthn/credentials', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const [rows]: any = await pool.query(PASSKEY_LIST_SQL, [req.user!.userId]);
    res.json((Array.isArray(rows) ? rows : []).map((row: any) => ({
      id: Number(row.id),
      label: String(row.label || '').trim() || '通行密钥',
      deviceType: row.device_type || null,
      backedUp: Boolean(row.backed_up),
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at || null
    })));
  } catch (error: any) {
    console.error('WebAuthn list credentials error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/webauthn/credentials/:id', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const label = String(req.body?.label || '').trim().slice(0, 64);
    if (!id || !label) {
      return res.status(400).json({ error: '名称不能为空' });
    }
    const [result]: any = await pool.execute(
      'UPDATE webauthn_credentials SET label = ? WHERE id = ? AND user_id = ?',
      [label, id, req.user!.userId]
    );
    if (result?.affectedRows === 0) {
      return res.status(404).json({ error: '通行密钥不存在' });
    }
    const [rows]: any = await pool.query(PASSKEY_LIST_SQL, [req.user!.userId]);
    res.json((Array.isArray(rows) ? rows : []).map((row: any) => ({
      id: Number(row.id),
      label: String(row.label || '').trim() || '通行密钥',
      deviceType: row.device_type || null,
      backedUp: Boolean(row.backed_up),
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at || null
    })));
  } catch (error: any) {
    console.error('WebAuthn rename credential error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/webauthn/credentials/:id', authRequired, async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const [result]: any = await pool.execute(
      'DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?',
      [id, req.user!.userId]
    );
    if (result?.affectedRows === 0) {
      return res.status(404).json({ error: '通行密钥不存在' });
    }
    const [rows]: any = await pool.query(PASSKEY_LIST_SQL, [req.user!.userId]);
    res.json((Array.isArray(rows) ? rows : []).map((row: any) => ({
      id: Number(row.id),
      label: String(row.label || '').trim() || '通行密钥',
      deviceType: row.device_type || null,
      backedUp: Boolean(row.backed_up),
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at || null
    })));
  } catch (error: any) {
    console.error('WebAuthn delete credential error:', error);
    res.status(500).json({ error: error.message });
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
  // 正文同时提供中英文，前端按用户语言选择显示。
  // V1.3.11：按用户要求补全所有功能的带编号使用说明
  res.json([
    {
      id: 'billing-reminders',
      title: { en: 'How billing reminders work', zh: '账单提醒是如何工作的' },
      summary: { en: 'Learn how upcoming renewals are detected and notified.', zh: '了解系统如何检测即将到来的续费并发送通知。' },
      content: {
        en: [
          '1. DingYue checks the next billing date of every subscription every day.',
          '2. Reminder emails are sent from alert@ngaasiu.studio to your account email 15 days, 7 days, 3 days before the billing date, and on the billing day itself.',
          '3. When a subscription passes its billing date without being updated, one "expired" email is sent for that date. If you edit the subscription start date or next billing date afterwards, a new reminder cycle begins for the new date.',
          '4. Each reminder date is only emailed once — editing other fields (name, category, etc.) will not trigger duplicate emails.',
          '5. Reminders also appear in the Message Center (Settings → Message Center) with severity levels: info, warning, critical.',
          '6. Tip: keep the next billing date accurate when adding or editing a subscription — all reminders are calculated from it.'
        ],
        zh: [
          '1. DingYue 每天都会检查每个订阅的下次扣费日期。',
          '2. 提醒邮件由 alert@ngaasiu.studio 发到你的账户邮箱：到期前 15 天、7 天、3 天各一封，到期当天再发一封。',
          '3. 账单日已过仍未更新的订阅，该日期会发一封「已到期」邮件；之后如果你重新编辑订阅时间或到期时间，新的日期会重新开始一轮提醒。',
          '4. 每个提醒日期只发一封邮件——修改名称、分类等其他字段不会导致重复发送。',
          '5. 提醒同时出现在消息中心（设置 → 消息中心），按紧急程度分为提示、警告、紧急三级。',
          '6. 小贴士：添加或编辑订阅时请保持下次扣费日期准确，所有提醒都基于这个日期计算。'
        ]
      }
    },
    {
      id: 'manage-subscriptions',
      title: { en: 'Adding, editing and deleting subscriptions', zh: '订阅的添加、编辑与删除' },
      summary: { en: 'Create subscriptions with start date, billing date, currency and more.', zh: '创建订阅：订阅时间、到期时间、货币等全流程说明。' },
      content: {
        en: [
          '1. Tap the blue "+" button in the bottom right corner on the Home, Subscriptions or Statistics page to open the Add Subscription form.',
          '2. Tap the dashed icon at the top left of the form to choose an icon: search online (iTunes catalog), pick from popular apps, or upload your own image.',
          '3. Fill in the subscription name (e.g. Spotify Premium), pick a category, and optionally add a region such as "US" or "CN".',
          '4. Choose a source (Apple App Store / Google Play / Direct Billing) and the account email the subscription belongs to — subscriptions can use any email, and the Statistics page can compare accounts.',
          '5. Enter the amount and currency. 160+ currencies are supported; the currency defaults to your Home display currency. Toggle "Free subscription" for free plans — they are excluded from spending totals but still get expiry reminders.',
          '6. Set the subscription start date (when you actually paid/subscribed) and the next billing date. The billing cycle is derived automatically from the interval between these two dates — monthly, quarterly, annual or any custom cycle works, so there is no cycle dropdown to worry about.',
          '7. Tap Save. The subscription appears in the list, the Dashboard totals and the timeline immediately.',
          '8. To edit: go to the Subscriptions page, tap a subscription card, change any field and save. To delete: open the subscription and use the delete option at the bottom.'
        ],
        zh: [
          '1. 在首页、订阅页或统计页点击右下角蓝色「+」按钮，打开添加订阅表单。',
          '2. 点击表单左上角的虚线图标选择图标：可在线搜索（iTunes 图标库）、从热门应用中挑选，或上传本地图片。',
          '3. 填写订阅名称（如 Spotify Premium），选择分类，可选填地区（如 国区、美区）。',
          '4. 选择来源（Apple 应用商店 / Google Play / 官网直付）和该订阅所属的账户邮箱——订阅可以填任何邮箱，统计页能按账户对比。',
          '5. 填写金额和币种，支持 160+ 种货币，默认跟随首页展示货币；免费订阅打开「免费订阅」开关即可——不计入支出统计，但保留到期提醒。',
          '6. 设置订阅时间（你实际付款/订阅的那天）和下一个账单日。周期由这两个日期的间隔自动推导——月付、季付、年付乃至任意周期都可以，不需要选频率。',
          '7. 点击保存。订阅会立即出现在订阅列表、首页合计和时间线里。',
          '8. 编辑：进入订阅页点击订阅卡片，修改任意字段后保存。删除：打开该订阅，使用底部删除按钮。'
        ]
      }
    },
    {
      id: 'timeline-guide',
      title: { en: 'Reading the billing timeline', zh: '账单时间线使用指南' },
      summary: { en: 'What the green, red and half-green-half-red dots mean.', zh: '绿点、红点、半绿半红的双色点分别是什么。' },
      content: {
        en: [
          '1. The timeline covers a 20-year span from January 2016 to December 2036. Scroll inside the card: the "Today" bubble is pinned at the top by default, scroll up to preview renewals up to 2036, scroll down to travel back to 2016.',
          '2. A green dot on the left marks when a subscription started (the subscription start date you entered).',
          '3. A red dot on the right marks a billing / renewal date — the next billing date and its future recurrences, shown as reminders.',
          '4. Past renewal dates are intentionally not lit: a subscription created in 2025 only highlights its start date and its upcoming billing dates, not every past Sep 28.',
          '5. If one date is both a subscription start AND another subscription\'s billing day, the dot is split into two colors — green on the left, red on the right.',
          '6. Each card shows the subscription name, the exact date (numeric, language-neutral) and whether it is a start or a renewal.',
          '7. Quarters without any events show a gray dot with the year and month, so you always know where you are on the axis.'
        ],
        zh: [
          '1. 时间线覆盖 2016 年 1 月到 2036 年 12 月共 20 年。在卡片内上下滑动即可：「今天」气泡默认固定在顶部，往上滑可以预览到 2036 年的续费，往下滑可以回看 2016 年。',
          '2. 左侧绿点表示订阅开始时间（你填写的「订阅时间」）。',
          '3. 右侧红点表示账单日/到期日——即下一个账单日及其未来周期投影，用作提醒。',
          '4. 历史账单日刻意不点亮：2025 年创建的订阅只会高亮它的开始时间和未来的账单日，过去每年 9 月 28 日不会亮红灯。',
          '5. 如果同一天既是某个订阅的开始时间、又是另一个订阅的账单日，这个点会对半分色——左绿右红。',
          '6. 每张卡片显示订阅名称、具体日期（纯数字，任何语言都一致）以及它是「订阅开始」还是「续费到期」。',
          '7. 没有任何事件的季度会显示灰色圆点和年月，方便定位当前在轴上的位置。'
        ]
      }
    },
    {
      id: 'statistics-guide',
      title: { en: 'Using the Statistics page', zh: '统计页使用指南' },
      summary: { en: 'Trend chart, forecast, categories, account comparison.', zh: '支出趋势、未来预测、分类明细、账户对比与优化建议。' },
      content: {
        en: [
          '1. Expenditure Trend: the bar chart is always in US dollars. The Y axis starts at 0; when your largest value is within $1,000 the scale is fixed at $0–1,000 with $100 steps, and when it exceeds $1,000 the scale stretches automatically (the step is 20% of your largest value, rounded to a clean number) so bars never hit the ceiling.',
          '2. Every bar shows its exact amount on top. Switch between Year (12 months) and Month (per day) with the toggle, swipe left/right or use the arrows to move between periods, and tap the year label to jump to any year.',
          '3. All amounts are converted to USD at live exchange rates first, so subscriptions in different currencies (CNY, EUR, JPY...) are summed correctly.',
          '4. Future Forecast: estimates the cost of the next billing cycle for all active subscriptions, converted to your Home display currency.',
          '5. Category Breakdown: percentages are based on subscription counts (e.g. 2 entertainment + 1 productivity + 1 video = 50% / 25% / 25%); the converted monthly amount is shown next to each category.',
          '6. Account Comparison: monthly spend per account email — great when your subscriptions use different emails.',
          '7. Optimization Tip: appears when one category has 2+ paid subscriptions; tap "View details" to see the individual subscriptions and potential savings.'
        ],
        zh: [
          '1. 支出趋势：柱状图始终以美元为单位。纵坐标从 0 开始，最大值不超过 $1,000 时固定用 $0–1,000（每 $100 一档）；超过 $1,000 时自动弹性拉伸（步长取最大值的 20% 并取整），柱体不会顶到图表上沿。',
          '2. 每根柱子上方都标注具体金额。用「年/月」切换视图，左右滑动或箭头切换时间段，点击年份标签可以直接跳到任意年份。',
          '3. 所有金额先按实时汇率折算成美元再绘图，所以人民币、欧元、日元等不同币种的订阅都能正确相加。',
          '4. 未来支出预测：估算所有活跃订阅下一个周期的合计花费，并自动换算成首页选择的货币显示。',
          '5. 分类明细：占比按订阅数量计算（例如 2 个娱乐 + 1 个效率 + 1 个影音 = 50% / 25% / 25%），每个分类旁边同时显示折算后的月均金额。',
          '6. 账户对比：按账户邮箱对比每月支出——订阅填了不同邮箱时一目了然。',
          '7. 优化建议：同一分类有 2 个及以上付费订阅时出现；点「查看详情」可以看到该分类下的订阅明细和预计可省金额。'
        ]
      }
    },
    {
      id: 'security-guide',
      title: { en: 'Passkeys and third-party accounts', zh: '通行密钥与第三方账号' },
      summary: { en: 'Passkeys, Google / GitHub / Gitee / WeChat binding.', zh: '通行密钥的添加登录，以及第三方账号的绑定与解绑。' },
      content: {
        en: [
          '1. Passkey sign-in lets you log in without a password. Add one in Settings → Profile & Security → Passkeys → Add passkey.',
          '2. On desktop, the system dialog (Touch ID / Windows Hello / security key) appears automatically; on Android it is handled by your credential provider such as Bitwarden or Google Password Manager — make sure it is enabled and unlocked in system settings.',
          '3. Each passkey can be renamed or deleted from the passkey list; deleting all login methods is prevented while one is still needed.',
          '4. Third-party accounts: Settings → Third-party login shows Google, GitHub, Gitee and WeChat binding status. Tap a provider to bind; tap Unbind to remove the link.',
          '5. Unbinding is refused if it would leave your account with no way to sign in (no password, no other social account and no passkey).'
        ],
        zh: [
          '1. 通行密钥可以免密码登录。在 设置 → 个人与安全 → 通行密钥 → 添加通行密钥 中创建。',
          '2. 桌面端会自动弹出系统验证（Touch ID / Windows Hello / 安全密钥）；安卓端由系统的凭据提供方处理（如 Bitwarden 或 Google 密码管理器），请确认其在系统设置中已启用并已解锁。',
          '3. 每把通行密钥都可以重命名或删除；系统会保证账户至少保留一种登录方式，不会全部删光。',
          '4. 第三方账号：设置 → 第三方登录 显示 Google、GitHub、Gitee、微信的绑定状态。点击对应渠道即可绑定，点击「解绑」可解除关联。',
          '5. 如果解绑后账户将没有任何登录方式（无密码、无其他社交账号、无通行密钥），系统会拒绝解绑。'
        ]
      }
    },
    {
      id: 'settings-guide',
      title: { en: 'Settings: currency, language and more', zh: '设置：货币、语言与更多' },
      summary: { en: 'Display currency, language, theme, notifications.', zh: '展示货币切换、语言、主题、消息中心与云同步。' },
      content: {
        en: [
          '1. Display currency: tap the currency chip on the Home total card to pick from 160+ currencies. All totals, forecasts and statistics re-convert instantly using live exchange rates.',
          '2. Language: Settings → Language supports English, 简体中文, 繁體中文, Latin and 한국어. Dates on the timeline are numeric so they look the same in every language.',
          '3. Theme: light / dark follows your account setting and applies across all pages.',
          '4. Message Center: billing reminders, trial endings and system notices appear here; tap the bell icon in Settings. Mark items read one by one or all at once.',
          '5. Cloud Sync: your subscriptions, settings and bindings are stored on the server automatically — signing in on a new device restores everything.'
        ],
        zh: [
          '1. 展示货币：点击首页总支出卡片右上角的货币标签，可从 160+ 种货币中选择。所有合计、预测和统计会按实时汇率即时换算。',
          '2. 语言：设置 → 语言 支持 English、简体中文、繁體中文、Latin、한국어。时间线上的日期使用纯数字，任何语言下显示一致。',
          '3. 主题：浅色 / 深色跟随账户设置，全站生效。',
          '4. 消息中心：账单提醒、试用即将结束和系统通知都会出现在这里（设置内点铃铛图标进入），可逐条或一键标记已读。',
          '5. 云同步：订阅、设置和第三方绑定都自动保存在服务器——换新设备登录后数据自动恢复。'
        ]
      }
    },
    {
      id: 'account-data',
      title: { en: 'Account and data', zh: '账户与数据' },
      summary: { en: 'Email change, data export and account deletion.', zh: '换绑邮箱、数据导出与账户注销。' },
      content: {
        en: [
          '1. Change email: Settings → Profile & Security → Email. A verification code is sent to the new address before the change takes effect.',
          '2. Change password: Settings → Profile & Security → Password.',
          '3. Export or permanently delete your account and all data: contact support@ngaasiu.studio — we respond within 15 business days (see Privacy Policy).',
          '4. Danger zone: Settings → Profile & Security → Delete account permanently removes all subscriptions and settings. This cannot be undone.'
        ],
        zh: [
          '1. 换绑邮箱：设置 → 个人与安全 → 邮箱。变更前会向新邮箱发送验证码确认。',
          '2. 修改密码：设置 → 个人与安全 → 密码。',
          '3. 导出或彻底删除账户及全部数据：联系 support@ngaasiu.studio，我们将在 15 个工作日内处理（详见隐私政策）。',
          '4. 危险区：设置 → 个人与安全 → 删除账户 会永久清除所有订阅和设置，不可恢复，请谨慎操作。'
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
    scheduleBillingReminders();
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