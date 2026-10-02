import React, { useEffect, useState } from 'react';
import {
  Apple, ArrowDown, BarChart3, BellRing, CalendarClock, Check, ChevronDown,
  Cloud, Coins, Download, Fingerprint, Github, Globe, Laptop, LogIn, Mail,
  Menu, MessageCircle, Monitor, RefreshCcw, ShieldCheck, Smartphone, Tv, Wallet, X,
} from 'lucide-react';
import { version as appVersion } from '../../package.json';

// V1.3.12 起附件改用带版本号的规范命名（FlClash 风格）：
//   DingYue-{版本}-android-arm64-v8a.apk / DingYue-{版本}-windows-{架构}.exe / DingYue-{版本}-macos-{架构}.dmg
// 版本号读自 package.json，发版时本页零维护；tag 一律用小写 v 前缀（如 v1.4.0）。
// 注意：新版 web 上线早于 Release 发布时，下载按钮会临时 404，发布后即恢复。
const RELEASE_BASE = `https://github.com/RosyCandy/DingYue/releases/download/v${appVersion}`;
const RELEASES_URL = 'https://github.com/RosyCandy/DingYue/releases';
const REPO_URL = 'https://github.com/RosyCandy/DingYue';
const ISSUES_URL = 'https://github.com/RosyCandy/DingYue/issues';
const CONTACT_EMAIL = 'support@ngaasiu.studio';

const DOWNLOADS = [
  { label: 'macOS', chip: 'Apple Silicon', file: `DingYue-${appVersion}-macos-arm64.dmg`, icon: <Apple size={18} /> },
  { label: 'macOS', chip: 'Intel 芯片', file: `DingYue-${appVersion}-macos-x64.dmg`, icon: <Laptop size={18} /> },
  { label: 'Windows', chip: 'x64', file: `DingYue-${appVersion}-windows-x64.exe`, icon: <Monitor size={18} /> },
  { label: 'Windows', chip: 'ARM64', file: `DingYue-${appVersion}-windows-arm64.exe`, icon: <Monitor size={18} /> },
  { label: 'Android', chip: 'APK', file: `DingYue-${appVersion}-android-arm64-v8a.apk`, icon: <Smartphone size={18} /> },
];

const FEATURES = [
  {
    icon: <Wallet size={22} />,
    title: '订阅一目了然',
    desc: '集中管理所有订阅服务：金额、周期、账户与地区，随时掌握每笔支出。',
  },
  {
    icon: <BellRing size={22} />,
    title: '到期不再意外',
    desc: '自动识别即将到期与免费试用的服务，续费前提前提醒，免费试用不再被扣费。',
  },
  {
    icon: <BarChart3 size={22} />,
    title: '支出统计与预测',
    desc: '按月/年预测总支出，多币种自动换算，分类统计帮你找到可以砍掉的开销。',
  },
];

const STATS = [
  { n: '5', label: '端全平台同步' },
  { n: '160+', label: '种货币自动换算' },
  { n: '5', label: '种界面语言' },
  { n: '30 天', label: '回收站防误删' },
];

const FAQ = [
  {
    q: 'DingYue 收费吗？',
    a: '目前完全免费，全部功能开放使用，没有内购，也没有广告。',
  },
  {
    q: '我的订阅数据安全吗？',
    a: '数据云端同步，仅本人账号登录可见；删除的订阅会先进入回收站保留 30 天，随时可以恢复，不会手一抖就没了。',
  },
  {
    q: '支持哪些平台？',
    a: 'Android、Windows、macOS 客户端与网页版已可用，iOS 版在准备中。数据全平台同步，一个账号通用。',
  },
  {
    q: '忘记续费怎么办？',
    a: '提前 15 / 7 / 3 天邮件提醒，到期当天还会再提醒一次；免费试用同样提醒，不会被默默扣费。',
  },
  {
    q: '支持哪些登录方式？',
    a: '邮箱验证码、Google、GitHub、Gitee、微信，以及免密码的通行密钥（Passkey），按习惯任选。',
  },
];

const LOGIN_METHODS = [
  { icon: <Mail size={16} />, label: '邮箱验证码' },
  { icon: <Globe size={16} />, label: 'Google' },
  { icon: <Github size={16} />, label: 'GitHub' },
  { icon: <Github size={16} />, label: 'Gitee' },
  { icon: <MessageCircle size={16} />, label: '微信' },
  { icon: <Fingerprint size={16} />, label: '通行密钥' },
];

const SUB_ROWS = [
  { icon: <Tv size={18} />, color: '#3f9d6a', name: '爱奇艺', meta: '月付 · 10/14 到期', price: '¥25.00', status: '即将到期', tone: 'bg-[#fdeada] text-[#b45309]' },
  { icon: <Cloud size={18} />, color: '#5b8fd4', name: 'iCloud', meta: '月付 · 自动续费', price: '¥21.00', status: '正常', tone: 'bg-[#e2f2e7] text-[#2f7d52]' },
  { icon: <Monitor size={18} />, color: '#c8483f', name: 'Netflix', meta: '月付 · 自动续费', price: '$15.49', status: '正常', tone: 'bg-[#e2f2e7] text-[#2f7d52]' },
  { icon: <CalendarClock size={18} />, color: '#7a6bc8', name: 'Notion', meta: '免费试用 · 11/02 结束', price: '免费', status: '试用中', tone: 'bg-[#e5edfb] text-[#3b6fd4]' },
];

const TREND_BARS = [
  { m: '4月', h: 38 }, { m: '5月', h: 56 }, { m: '6月', h: 47 },
  { m: '7月', h: 72 }, { m: '8月', h: 52 }, { m: '9月', h: 84 }, { m: '10月', h: 64 },
];

function go(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- 三段功能深潜的「应用截图」模拟件 ---------- */

function MockSubscriptions() {
  return (
    <div className="w-full max-w-sm rounded-[2rem] bg-white ring-1 ring-black/5 shadow-2xl shadow-primary/15 p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="font-extrabold text-on-surface text-sm">我的订阅</p>
        <span className="text-[11px] px-2.5 py-1 rounded-full bg-primary/10 text-primary font-bold">4 个活跃</span>
      </div>
      <div className="flex gap-1.5 mb-4">
        <span className="text-[11px] px-3 py-1 rounded-full bg-primary text-white font-bold">全部</span>
        <span className="text-[11px] px-3 py-1 rounded-full bg-surface-container-low text-on-surface-variant font-semibold">月付</span>
        <span className="text-[11px] px-3 py-1 rounded-full bg-surface-container-low text-on-surface-variant font-semibold">即将到期</span>
        <span className="text-[11px] px-3 py-1 rounded-full bg-surface-container-low text-on-surface-variant font-semibold">免费试用</span>
      </div>
      <div className="space-y-2.5">
        {SUB_ROWS.map((r) => (
          <div key={r.name} className="flex items-center gap-3 rounded-2xl bg-surface-container-low px-3.5 py-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0" style={{ backgroundColor: r.color }}>
              {r.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-on-surface truncate">{r.name}</p>
              <p className="text-[11px] text-on-surface-variant truncate">{r.meta}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-extrabold text-on-surface">{r.price}</p>
              <span className={`inline-block mt-0.5 text-[10px] px-2 py-0.5 rounded-full font-bold ${r.tone}`}>{r.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MockTimeline() {
  return (
    <div className="w-full max-w-sm">
      <div className="rounded-[2rem] bg-white ring-1 ring-black/5 shadow-2xl shadow-primary/15 p-6">
        <div className="flex items-center justify-between mb-5">
          <p className="font-extrabold text-on-surface text-sm">订阅时间线</p>
          <div className="flex items-center gap-3 text-[10px] text-on-surface-variant font-semibold">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#3f9d6a]" />订阅开始</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#d9534f]" />续费提醒</span>
          </div>
        </div>
        <div className="relative">
          <div className="absolute left-1/2 top-1 bottom-1 w-px bg-outline-variant/60 -translate-x-1/2" />
          {/* 绿点：订阅开始（左卡） */}
          <div className="relative py-3">
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[#3f9d6a] ring-4 ring-[#3f9d6a]/15" />
            <div className="w-[calc(50%-1.5rem)] rounded-2xl bg-surface-container-low px-3.5 py-2.5">
              <p className="text-[10px] text-[#2f7d52] font-bold">订阅开始</p>
              <p className="text-xs font-bold text-on-surface">爱奇艺 · 9/28</p>
            </div>
          </div>
          {/* 红点：续费提醒（右卡） */}
          <div className="relative py-3">
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[#d9534f] ring-4 ring-[#d9534f]/15" />
            <div className="ml-auto w-[calc(50%-1.5rem)] rounded-2xl bg-surface-container-low px-3.5 py-2.5">
              <p className="text-[10px] text-[#c2413c] font-bold">续费提醒</p>
              <p className="text-xs font-bold text-on-surface">iCloud · 10/14</p>
            </div>
          </div>
          {/* 今天气泡骑中轴 */}
          <div className="relative py-2 flex justify-center">
            <span className="relative z-10 text-[10px] font-bold text-white bg-[#14532d] px-3 py-1 rounded-full shadow">今天 10/02</span>
          </div>
          {/* 红点：续费提醒（右卡） */}
          <div className="relative py-3">
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[#d9534f] ring-4 ring-[#d9534f]/15" />
            <div className="ml-auto w-[calc(50%-1.5rem)] rounded-2xl bg-surface-container-low px-3.5 py-2.5">
              <p className="text-[10px] text-[#c2413c] font-bold">续费提醒</p>
              <p className="text-xs font-bold text-on-surface">Netflix · 11/01</p>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3 rounded-2xl bg-[#eef6ec] ring-1 ring-primary/15 px-4 py-3">
        <Mail size={16} className="text-primary shrink-0" />
        <p className="text-xs text-on-surface-variant leading-relaxed">
          邮件提醒提前 <b className="text-on-surface">15 / 7 / 3</b> 天送达，到期当天还会再提醒一次
        </p>
      </div>
    </div>
  );
}

function MockChart() {
  return (
    <div className="w-full max-w-sm rounded-[2rem] bg-white ring-1 ring-black/5 shadow-2xl shadow-primary/15 p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="font-extrabold text-on-surface text-sm">月度支出趋势</p>
        <span className="text-[11px] px-2.5 py-1 rounded-full bg-primary/10 text-primary font-bold">折算 USD</span>
      </div>
      <div className="flex items-end gap-2.5 h-40">
        {TREND_BARS.map((b, i) => (
          <div key={b.m} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
            <span className="text-[9px] font-bold text-on-surface-variant">${b.h}</span>
            <div
              className={`w-full rounded-t-lg ${i === TREND_BARS.length - 1 ? 'bg-primary' : 'bg-primary/25'}`}
              style={{ height: `${b.h}%` }}
            />
            <span className="text-[10px] text-on-surface-variant">{b.m}</span>
          </div>
        ))}
      </div>
      <div className="mt-5 pt-4 border-t border-outline-variant/40">
        <p className="text-[11px] font-bold text-on-surface-variant mb-2">分类占比（按订阅数）</p>
        <div className="flex flex-wrap gap-1.5">
          {[
            { c: '#3f9d6a', t: '娱乐 40%' },
            { c: '#5b8fd4', t: '视频 25%' },
            { c: '#7a6bc8', t: 'AI 20%' },
            { c: '#c8a84f', t: '其他 15%' },
          ].map((x) => (
            <span key={x.t} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-on-surface-variant bg-surface-container-low rounded-full px-2.5 py-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: x.c }} />{x.t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- 页脚栏目 ---------- */

function FooterCol({ title, links }: { title: string; links: { label: string; href: string; external?: boolean; onClick?: () => void }[] }) {
  return (
    <div>
      <p className="text-sm font-extrabold text-white mb-4">{title}</p>
      <ul className="space-y-2.5">
        {links.map((l) => (
          <li key={l.label}>
            {l.onClick ? (
              <button onClick={l.onClick} className="text-sm text-white/60 hover:text-white transition-colors">
                {l.label}
              </button>
            ) : (
              <a
                href={l.href}
                target={l.external ? '_blank' : undefined}
                rel={l.external ? 'noreferrer' : undefined}
                className="text-sm text-white/60 hover:text-white transition-colors"
              >
                {l.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- 主组件 ---------- */

export default function LandingPage({ onEnter }: { onEnter: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // 落地页挂载期间把 :root 的主色/底色临时换成森林淡绿（body 背景与过界露底同步），卸载时还原
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--primary', '#2f7d52');
    root.style.setProperty('--surface', '#f4f8f2');
    return () => {
      root.style.removeProperty('--primary');
      root.style.removeProperty('--surface');
    };
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const solid = scrolled || mobileOpen;
  const navBtn = solid
    ? 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low'
    : 'text-white/85 hover:text-white hover:bg-white/10';

  const jump = (id: string) => {
    setProductsOpen(false);
    setMobileOpen(false);
    go(id);
  };

  return (
    <div className="landing-root min-h-screen bg-surface text-on-surface">
      {/* ==================== 页眉导航栏（JetBrains 式） ==================== */}
      <header className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${solid ? 'bg-white/92 backdrop-blur-md shadow-[0_1px_0_rgba(0,0,0,0.06)]' : 'bg-transparent'}`}>
        <div className="max-w-6xl mx-auto pl-5 pr-4 sm:px-8 h-16 flex items-center gap-6">
          <button
            onClick={() => { setMobileOpen(false); setProductsOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            className="flex items-center gap-2.5 shrink-0"
          >
            <img src="/icon.png" alt="DingYue" className="w-8 h-8 rounded-lg" />
            <span className={`font-extrabold tracking-tight text-lg ${solid ? 'text-on-surface' : 'text-white'}`}>DingYue</span>
          </button>

          {/* 桌面导航 */}
          <nav className="hidden lg:flex items-center gap-1 flex-1">
            <div className="relative">
              <button
                onClick={() => setProductsOpen((v) => !v)}
                className={`relative z-20 flex items-center gap-1 px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${navBtn}`}
              >
                产品
                <ChevronDown size={14} className={`transition-transform duration-200 ${productsOpen ? 'rotate-180' : ''}`} />
              </button>
              {productsOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setProductsOpen(false)} />
                  <div className="absolute left-0 top-full mt-2 z-20 w-[32rem] rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 p-5 grid grid-cols-[1.25fr_1fr] gap-6">
                    <div>
                      <p className="text-[11px] font-extrabold tracking-widest text-on-surface-variant/70 mb-3">客户端下载</p>
                      <div className="space-y-1">
                        {DOWNLOADS.map((d) => (
                          <a
                            key={d.file}
                            href={`${RELEASE_BASE}/${d.file}`}
                            className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-container-low transition-colors group"
                          >
                            <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">{d.icon}</span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-sm font-bold text-on-surface leading-tight">{d.label} <span className="text-[11px] font-semibold text-on-surface-variant">({d.chip})</span></span>
                              <span className="block text-[10px] text-on-surface-variant/80 truncate">{d.file}</span>
                            </span>
                            <Download size={15} className="text-on-surface-variant/40 group-hover:text-primary transition-colors shrink-0" />
                          </a>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col">
                      <p className="text-[11px] font-extrabold tracking-widest text-on-surface-variant/70 mb-3">了解更多</p>
                      <div className="space-y-1">
                        {[
                          { label: '功能亮点', id: 'features' },
                          { label: '到期提醒', id: 'remind' },
                          { label: '支出统计', id: 'stats' },
                          { label: '常见问题', id: 'faq' },
                        ].map((x) => (
                          <button
                            key={x.id}
                            onClick={() => jump(x.id)}
                            className="w-full text-left rounded-xl px-3 py-2.5 text-sm font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-colors"
                          >
                            {x.label}
                          </button>
                        ))}
                      </div>
                      <a
                        href={RELEASES_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-auto pt-3 border-t border-outline-variant/40 text-xs font-bold text-primary hover:underline"
                      >
                        全部历史版本 →
                      </a>
                    </div>
                  </div>
                </>
              )}
            </div>
            <button onClick={() => jump('features')} className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${navBtn}`}>功能</button>
            <a href={RELEASES_URL} target="_blank" rel="noreferrer" className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${navBtn}`}>更新日志</a>
            <button onClick={() => jump('faq')} className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${navBtn}`}>常见问题</button>
          </nav>

          {/* 右侧：联系我们 + 登录注册 */}
          <div className="hidden lg:flex items-center gap-2 ml-auto shrink-0">
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className={`px-3.5 py-2 rounded-lg text-sm font-semibold transition-colors ${navBtn}`}
            >
              联系我们
            </a>
            <button
              onClick={onEnter}
              className="flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-primary text-white text-sm font-bold shadow-md shadow-primary/25 hover:opacity-90 active:scale-95 transition-all"
            >
              <LogIn size={15} /> 登录 / 注册
            </button>
          </div>

          {/* 移动端右侧 */}
          <div className="lg:hidden ml-auto flex items-center gap-1.5">
            <button
              onClick={onEnter}
              className={`px-3.5 py-2 rounded-full text-xs font-bold transition-all active:scale-95 ${solid ? 'bg-primary text-white shadow-md shadow-primary/25' : 'bg-white/90 text-[#14532d]'}`}
            >
              登录 / 注册
            </button>
            <button
              onClick={() => { setMobileOpen((v) => !v); setProductsOpen(false); }}
              aria-label="菜单"
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${solid ? 'text-on-surface hover:bg-surface-container-low' : 'text-white hover:bg-white/10'}`}
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {/* 移动端下拉面板 */}
        {mobileOpen && (
          <div className="lg:hidden bg-white/97 backdrop-blur-md border-t border-outline-variant/30 shadow-xl max-h-[calc(100dvh-4rem)] overflow-y-auto">
            <div className="px-5 py-4 space-y-5">
              <div>
                <p className="text-[11px] font-extrabold tracking-widest text-on-surface-variant/70 mb-2">客户端下载</p>
                <div className="space-y-1">
                  {DOWNLOADS.map((d) => (
                    <a
                      key={d.file}
                      href={`${RELEASE_BASE}/${d.file}`}
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-container-low transition-colors"
                    >
                      <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">{d.icon}</span>
                      <span className="flex-1 min-w-0 text-sm font-bold text-on-surface">{d.label} <span className="text-[11px] font-semibold text-on-surface-variant">({d.chip})</span></span>
                      <Download size={15} className="text-on-surface-variant/40 shrink-0" />
                    </a>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[11px] font-extrabold tracking-widest text-on-surface-variant/70 mb-2">了解更多</p>
                <div className="space-y-1">
                  {[
                    { label: '功能亮点', id: 'features' },
                    { label: '到期提醒', id: 'remind' },
                    { label: '支出统计', id: 'stats' },
                    { label: '常见问题', id: 'faq' },
                  ].map((x) => (
                    <button
                      key={x.id}
                      onClick={() => jump(x.id)}
                      className="w-full text-left rounded-xl px-3 py-2.5 text-sm font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-colors"
                    >
                      {x.label}
                    </button>
                  ))}
                  <a
                    href={RELEASES_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center rounded-xl px-3 py-2.5 text-sm font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-colors"
                  >
                    更新日志（GitHub）
                  </a>
                  <a
                    href={`mailto:${CONTACT_EMAIL}`}
                    className="flex items-center rounded-xl px-3 py-2.5 text-sm font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-colors"
                  >
                    联系我们
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* ==================== Hero：全屏背景大图（模版站式） ==================== */}
      <section className="relative min-h-[100svh] flex items-center justify-center overflow-hidden">
        <img src="/bg.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#07150c]/80 via-[#0a1d11]/45 to-surface" />

        <div className="relative z-10 text-center px-5 pt-28 pb-24 max-w-3xl mx-auto">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/12 border border-white/25 backdrop-blur text-white/90 text-xs font-bold tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7ee2a8] animate-pulse" />
            v{appVersion} · 全平台数据同步
          </span>
          <h1 className="mt-6 text-white">
            <span className="landing-serif italic block text-6xl sm:text-8xl font-bold tracking-tight drop-shadow-[0_4px_24px_rgba(0,0,0,0.45)]">
              DingYue
            </span>
            <span className="block mt-3 text-3xl sm:text-5xl font-extrabold tracking-tight drop-shadow-[0_2px_16px_rgba(0,0,0,0.4)]">
              订阅管理助手
            </span>
          </h1>
          <p className="mt-6 text-white/90 text-base sm:text-xl leading-relaxed max-w-xl mx-auto drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]">
            把散落各处的订阅集中到一处——记录、提醒、统计，让每一笔自动续费都清清楚楚。
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={onEnter}
              className="px-8 py-3.5 rounded-full bg-[#3f9d6a] hover:bg-[#358a5b] text-white font-bold text-sm shadow-xl shadow-black/25 hover:opacity-95 active:scale-95 transition-all"
            >
              立即登录 / 注册
            </button>
            <button
              onClick={() => go('download')}
              className="px-8 py-3.5 rounded-full bg-white/10 backdrop-blur border border-white/40 text-white font-bold text-sm hover:bg-white/20 active:scale-95 transition-all flex items-center gap-2"
            >
              <Download size={16} /> 下载客户端
            </button>
          </div>
          <p className="mt-7 text-xs sm:text-sm text-white/70 drop-shadow">支持 iOS · Android · Windows · macOS · Linux · 网页版</p>
        </div>

        <button
          onClick={() => go('features')}
          aria-label="向下浏览"
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 text-white/70 hover:text-white animate-bounce"
        >
          <ArrowDown size={26} />
        </button>
      </section>

      {/* ==================== 功能亮点 ==================== */}
      <section id="features" className="scroll-mt-20 max-w-6xl mx-auto px-5 sm:px-8 pt-20 sm:pt-24 pb-4">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <p className="text-xs font-extrabold tracking-[0.25em] text-primary uppercase">Features</p>
          <h2 className="mt-3 text-3xl sm:text-4xl font-black tracking-tight">为「我的钱花在哪」而生</h2>
          <p className="mt-4 text-on-surface-variant leading-relaxed">
            流媒体、云存储、AI 工具……订阅越攒越多，扣费日期却记不住。DingYue 把它们放到同一张清单里替你盯着。
          </p>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-white rounded-3xl p-6 ring-1 ring-outline-variant/50 hover:ring-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
                {f.icon}
              </div>
              <h3 className="font-extrabold text-on-surface mb-2">{f.title}</h3>
              <p className="text-sm text-on-surface-variant leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ==================== 深潜一：集中管理 ==================== */}
      <section id="manage" className="scroll-mt-20 max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        <div>
          <p className="text-xs font-extrabold tracking-[0.25em] text-primary uppercase">Organize</p>
          <h2 className="mt-3 text-3xl sm:text-4xl font-black tracking-tight leading-tight">
            一个地方，装下你所有的订阅
          </h2>
          <p className="mt-4 text-on-surface-variant leading-relaxed">
            金额、周期、账户与地区一目了然。无论是视频会员、云存储还是 AI 工具，打开 DingYue 就能看到完整的订阅清单。
          </p>
          <ul className="mt-6 space-y-3">
            {[
              '账单周期随心选：月付 / 季度付 / 年付 / 免费试用',
              '160+ 种货币自动换算，跨境订阅不再心算',
              '自定义分类与图标，订阅列表一眼认出',
              '删除进回收站保留 30 天，误删随时找回',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5 text-sm text-on-surface-variant">
                <span className="mt-0.5 w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Check size={12} strokeWidth={3} />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-center lg:justify-end">
          <MockSubscriptions />
        </div>
      </section>

      {/* ==================== 深潜二：到期提醒 ==================== */}
      <section id="remind" className="scroll-mt-20 bg-surface-container-low/60">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div className="flex justify-center lg:justify-start order-2 lg:order-1">
            <MockTimeline />
          </div>
          <div className="order-1 lg:order-2">
            <p className="text-xs font-extrabold tracking-[0.25em] text-primary uppercase">Reminders</p>
            <h2 className="mt-3 text-3xl sm:text-4xl font-black tracking-tight leading-tight">
              续费日期，提前知道
            </h2>
            <p className="mt-4 text-on-surface-variant leading-relaxed">
              自动识别即将到期与免费试用的服务，续费前提前邮件提醒。免费试用到期前也会喊你一声，不再被「自动转付费」偷袭。
            </p>
            <ul className="mt-6 space-y-3">
              {[
                '提前 15 / 7 / 3 天邮件提醒，到期当天再提示一次',
                '时间线只标关键节点：订阅开始与下一次续费',
                '已过期订阅单独标记，未处理前不会消失',
                '重复提醒自动去重，同一账单日只发一封',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-sm text-on-surface-variant">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ==================== 深潜三：支出统计 ==================== */}
      <section id="stats" className="scroll-mt-20 max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        <div>
          <p className="text-xs font-extrabold tracking-[0.25em] text-primary uppercase">Statistics</p>
          <h2 className="mt-3 text-3xl sm:text-4xl font-black tracking-tight leading-tight">
            花出去的钱，看得清清楚楚
          </h2>
          <p className="mt-4 text-on-surface-variant leading-relaxed">
            按月 / 年预测总支出，多币种统一折算比较，分类统计帮你找到可以砍掉的开销。
          </p>
          <ul className="mt-6 space-y-3">
            {[
              '月度 / 年度支出趋势图，发现悄悄涨价的订阅',
              '多币种折算统一比较，手机电脑看到同一个数',
              '分类占比按订阅数统计，大头开销一眼定位',
              '未来支出预测，预算心里有底',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5 text-sm text-on-surface-variant">
                <span className="mt-0.5 w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Check size={12} strokeWidth={3} />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-center lg:justify-end">
          <MockChart />
        </div>
      </section>

      {/* ==================== 数据带 ==================== */}
      <section className="bg-[#14351f] text-white">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {STATS.map((s) => (
            <div key={s.label}>
              <p className="text-4xl sm:text-5xl font-black tracking-tight text-[#8fe0b0]">{s.n}</p>
              <p className="mt-2 text-sm text-white/70">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ==================== 数据安全与登录方式 ==================== */}
      <section className="bg-white">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div>
            <p className="text-xs font-extrabold tracking-[0.25em] text-primary uppercase">Security</p>
            <h2 className="mt-3 text-3xl sm:text-4xl font-black tracking-tight leading-tight">
              你的数据，只属于你
            </h2>
            <p className="mt-4 text-on-surface-variant leading-relaxed">
              订阅数据云端同步，隐私仅存本人账号。一个账号在手机、电脑、网页之间实时一致，换设备也不用搬家。
            </p>
            <ul className="mt-6 space-y-3">
              {[
                { icon: <ShieldCheck size={15} />, t: '数据仅存本人账号，不向任何第三方共享' },
                { icon: <RefreshCcw size={15} />, t: '回收站软删除，30 天内随时恢复误删的订阅' },
                { icon: <Coins size={15} />, t: '一个账号全平台通用，数据实时保持一致' },
              ].map((x) => (
                <li key={x.t} className="flex items-start gap-2.5 text-sm text-on-surface-variant">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    {x.icon}
                  </span>
                  {x.t}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-[2rem] bg-surface-container-low/70 ring-1 ring-outline-variant/50 p-6 sm:p-8">
            <p className="font-extrabold text-on-surface mb-1">多种登录方式</p>
            <p className="text-xs text-on-surface-variant mb-5">按习惯任选，通行密钥免密码更省心</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {LOGIN_METHODS.map((m) => (
                <div key={m.label} className="flex items-center gap-2 rounded-xl bg-white ring-1 ring-outline-variant/60 px-3 py-3 text-sm font-semibold text-on-surface">
                  <span className="text-primary">{m.icon}</span>
                  {m.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ==================== 下载 ==================== */}
      <section id="download" className="scroll-mt-20 bg-surface">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <p className="text-xs font-extrabold tracking-[0.25em] text-primary uppercase">Download</p>
            <h2 className="mt-3 text-3xl sm:text-4xl font-black tracking-tight">下载客户端</h2>
            <p className="mt-4 text-on-surface-variant text-sm sm:text-base">
              当前版本 v{appVersion} · 全平台数据同步，一个账号通用
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-4xl mx-auto">
            {DOWNLOADS.map((d) => (
              <a
                key={d.file}
                href={`${RELEASE_BASE}/${d.file}`}
                className="flex items-center gap-3 p-4 bg-white rounded-2xl ring-1 ring-outline-variant/50 hover:ring-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all group"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  {d.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-on-surface">{d.label} <span className="text-xs font-semibold text-on-surface-variant">({d.chip})</span></p>
                  <p className="text-[11px] text-on-surface-variant truncate">{d.file}</p>
                </div>
                <Download size={16} className="text-on-surface-variant/40 group-hover:text-primary transition-colors shrink-0" />
              </a>
            ))}
            <div className="flex items-center gap-3 p-4 bg-white/60 rounded-2xl ring-1 ring-outline-variant/30 opacity-70">
              <div className="w-10 h-10 rounded-xl bg-surface-container-low text-on-surface-variant/60 flex items-center justify-center shrink-0">
                <Apple size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-on-surface-variant">iOS</p>
                <p className="text-[11px] text-on-surface-variant/70">敬请期待</p>
              </div>
            </div>
          </div>
          <p className="text-center text-xs text-on-surface-variant/70 mt-6">
            <a href={RELEASES_URL} className="text-primary hover:underline font-semibold" target="_blank" rel="noreferrer">
              查看全部历史版本 →
            </a>
          </p>
        </div>
      </section>

      {/* ==================== 常见问题 ==================== */}
      <section id="faq" className="scroll-mt-20 bg-surface">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 pb-20">
          <div className="text-center mb-10">
            <p className="text-xs font-extrabold tracking-[0.25em] text-primary uppercase">FAQ</p>
            <h2 className="mt-3 text-3xl sm:text-4xl font-black tracking-tight">常见问题</h2>
          </div>
          <div className="space-y-3">
            {FAQ.map((f) => (
              <details key={f.q} className="group rounded-2xl bg-white ring-1 ring-outline-variant/50 open:ring-primary/40 px-5 transition-all">
                <summary className="flex items-center justify-between py-4 cursor-pointer list-none font-bold text-on-surface text-sm sm:text-base [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <ChevronDown size={18} className="text-on-surface-variant group-open:rotate-180 transition-transform shrink-0 ml-4" />
                </summary>
                <p className="pb-4 text-sm text-on-surface-variant leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
          <p className="text-center text-sm text-on-surface-variant mt-8">
            还有别的问题？<a href={`mailto:${CONTACT_EMAIL}`} className="text-primary font-bold hover:underline">写信给我们</a>，我们会尽快回复。
          </p>
        </div>
      </section>

      {/* ==================== 页脚（JetBrains 式四栏） ==================== */}
      <footer className="bg-[#0e2416] text-white">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-14 pb-8">
          <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
            <div>
              <div className="flex items-center gap-2.5">
                <img src="/icon.png" alt="DingYue" className="w-9 h-9 rounded-xl" />
                <span className="font-extrabold tracking-tight text-lg">DingYue</span>
              </div>
              <p className="mt-4 text-sm text-white/60 leading-relaxed max-w-xs">
                订阅管理助手——把散落各处的订阅集中到一处，记录、提醒、统计，让每一笔自动续费都清清楚楚。
              </p>
              <div className="mt-5 flex items-center gap-2.5">
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="GitHub 仓库"
                  className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 hover:text-white transition-colors"
                >
                  <Github size={17} />
                </a>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  aria-label="邮件联系我们"
                  className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 hover:text-white transition-colors"
                >
                  <Mail size={17} />
                </a>
              </div>
            </div>
            <FooterCol
              title="产品"
              links={[
                { label: '功能亮点', href: '#features', onClick: () => jump('features') },
                { label: '到期提醒', href: '#remind', onClick: () => jump('remind') },
                { label: '支出统计', href: '#stats', onClick: () => jump('stats') },
                { label: '下载客户端', href: '#download', onClick: () => jump('download') },
              ]}
            />
            <FooterCol
              title="支持"
              links={[
                { label: `联系我们（${CONTACT_EMAIL}）`, href: `mailto:${CONTACT_EMAIL}` },
                { label: '常见问题', href: '#faq', onClick: () => jump('faq') },
                { label: 'GitHub Issues', href: ISSUES_URL, external: true },
              ]}
            />
            <FooterCol
              title="资源"
              links={[
                { label: 'GitHub 仓库', href: REPO_URL, external: true },
                { label: '更新日志', href: RELEASES_URL, external: true },
                { label: '隐私政策', href: '/privacy/' },
                { label: '用户协议', href: '/agreement/' },
              ]}
            />
          </div>
          <div className="mt-12 pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/45">
            <p>© 2026 DingYue · v{appVersion} · 数据云端同步，隐私仅存本人账号</p>
            <p className="flex items-center gap-5">
              <a href="/privacy/" className="hover:text-white/80 transition-colors">隐私政策</a>
              <a href="/agreement/" className="hover:text-white/80 transition-colors">用户协议</a>
            </p>
            <p>用心管理每一笔订阅</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
