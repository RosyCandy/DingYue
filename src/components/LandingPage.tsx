import React from 'react';
import {
  Bell, Wallet, BarChart3, Download, Apple, Monitor, Terminal,
  Package, Smartphone, LogIn,
} from 'lucide-react';
import { version as appVersion } from '../../package.json';

const RELEASE_BASE = 'https://github.com/RosyCandy/DingYue/releases/latest/download';

// 各平台下载指向 GitHub Release 的固定文件名（发版时按此命名上传附件）：
// DingYue-mac.dmg / DingYue-setup.exe / DingYue-amd64.deb / DingYue-x86_64.rpm
// DingYue-x86_64.AppImage / DingYue-arm64.AppImage / DingYue.apk
const DOWNLOADS = [
  { label: 'macOS', file: 'DingYue-mac.dmg', icon: <Apple size={18} /> },
  { label: 'Windows', file: 'DingYue-setup.exe', icon: <Monitor size={18} /> },
  { label: 'Debian / Ubuntu', file: 'DingYue-amd64.deb', icon: <Package size={18} /> },
  { label: 'Fedora / RedHat', file: 'DingYue-x86_64.rpm', icon: <Package size={18} /> },
  { label: 'Linux AppImage', file: 'DingYue-x86_64.AppImage', icon: <Terminal size={18} /> },
  { label: 'Android APK', file: 'DingYue.apk', icon: <Smartphone size={18} /> },
];

const FEATURES = [
  {
    icon: <Wallet size={22} />,
    title: '订阅一目了然',
    desc: '集中管理所有订阅服务：金额、周期、账户与地区，随时掌握每笔支出。',
  },
  {
    icon: <Bell size={22} />,
    title: '到期不再意外',
    desc: '自动识别即将到期与试 ending 的服务，续费前提前提醒，免费试用不再被扣费。',
  },
  {
    icon: <BarChart3 size={22} />,
    title: '支出统计与预测',
    desc: '按月/年预测总支出，多币种自动换算，分类统计帮你找到可以砍掉的开销。',
  },
];

export default function LandingPage({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="min-h-screen bg-surface">
      {/* 顶部品牌栏 */}
      <header className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img src="icon.png" alt="DingYue" className="w-8 h-8 rounded-lg" />
          <span className="font-bold text-on-surface">DingYue</span>
        </div>
        <button
          onClick={onEnter}
          className="flex items-center gap-1.5 text-sm font-bold text-primary hover:opacity-80 active:scale-95 transition-all"
        >
          <LogIn size={16} /> 进入应用
        </button>
      </header>

      <main className="max-w-4xl mx-auto px-6">
        {/* Hero */}
        <section className="text-center pt-14 pb-12">
          <img src="icon.png" alt="DingYue" className="w-24 h-24 rounded-[22%] shadow-lg mx-auto mb-6" />
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight text-on-surface">
            DingYue 订阅管理助手
          </h1>
          <p className="mt-4 text-on-surface-variant text-base sm:text-lg max-w-xl mx-auto leading-relaxed">
            把散落各处的订阅集中到一处——记录、提醒、统计，
            <br className="hidden sm:block" />
            让每一笔自动续费都清清楚楚。
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={onEnter}
              className="px-8 py-3.5 rounded-xl bg-primary text-white font-bold text-sm shadow-lg shadow-primary/25 hover:opacity-90 active:scale-95 transition-all"
            >
              立即登录 / 注册
            </button>
            <a
              href="#download"
              className="px-8 py-3.5 rounded-xl border border-outline-variant/30 text-on-surface font-bold text-sm hover:bg-surface-container-low active:scale-95 transition-all flex items-center gap-2"
            >
              <Download size={16} /> 下载客户端
            </a>
          </div>
          <p className="mt-4 text-xs text-on-surface-variant/70">支持 iOS · Android · Windows · macOS · Linux</p>
        </section>

        {/* 功能亮点 */}
        <section className="grid sm:grid-cols-3 gap-4 py-8">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-surface-container-low rounded-2xl p-5">
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-3">
                {f.icon}
              </div>
              <h3 className="font-bold text-on-surface text-sm mb-1.5">{f.title}</h3>
              <p className="text-xs text-on-surface-variant leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </section>

        {/* 下载区 */}
        <section id="download" className="py-12">
          <h2 className="text-2xl font-black tracking-tight text-on-surface text-center">下载客户端</h2>
          <p className="text-center text-on-surface-variant text-sm mt-2 mb-6">
            当前版本 v{appVersion} · 全平台数据同步，一个账号通用
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-3xl mx-auto">
            {DOWNLOADS.map((d) => (
              <a
                key={d.label}
                href={`${RELEASE_BASE}/${d.file}`}
                className="flex items-center gap-3 p-4 bg-surface-container-low rounded-xl hover:bg-surface-container transition-colors group"
              >
                <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  {d.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-on-surface">{d.label}</p>
                  <p className="text-[11px] text-on-surface-variant truncate">{d.file}</p>
                </div>
                <Download size={16} className="text-on-surface-variant/50 group-hover:text-primary transition-colors shrink-0" />
              </a>
            ))}
          </div>
          <p className="text-center text-xs text-on-surface-variant/70 mt-5">
            <a
              href="https://github.com/RosyCandy/DingYue/releases"
              className="text-primary hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              查看全部历史版本 →
            </a>
          </p>
        </section>
      </main>

      <footer className="border-t border-outline-variant/10 mt-8">
        <div className="max-w-4xl mx-auto px-6 py-6 text-center text-xs text-on-surface-variant/70">
          DingYue 订阅管理助手 · v{appVersion} · 数据云端同步，隐私仅存本人账号
        </div>
      </footer>
    </div>
  );
}
