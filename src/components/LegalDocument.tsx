import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

export type LegalDocumentKind = 'agreement' | 'privacy';

const ACCEPTED_KEY = 'legal_accepted_v1';

interface Section {
  h: { zh: string; en: string };
  p: { zh: string; en: string }[];
}

const AGREEMENT_SECTIONS: Section[] = [
  {
    h: { zh: '一、协议的接受', en: '1. Acceptance of Terms' },
    p: [{
      zh: '欢迎使用 DingYue 订阅管理助手（以下简称"本应用"）。您在注册账户或使用本应用前应仔细阅读本协议。您勾选同意、注册账户或实际使用本应用，即表示您已阅读并同意本协议的全部内容。',
      en: 'Welcome to DingYue (the "App"). Please read this agreement carefully before registering or using the App. By checking the consent box, registering an account or actually using the App, you confirm that you have read and agreed to this agreement.'
    }]
  },
  {
    h: { zh: '二、服务说明', en: '2. Service Description' },
    p: [{
      zh: '本应用为您提供订阅项目的信息记录与管理服务，包括订阅名称、金额、币种、周期、账单日期、分类与备注等。本应用仅记录您主动录入的信息，不连接您的银行、支付账户，也不代您执行任何付款、扣款或退订操作。',
      en: 'The App provides informational recording and management of your subscriptions, including names, amounts, currencies, cycles, billing dates, categories and notes. The App only records information you enter; it never connects to your bank or payment accounts and never executes payments, charges or cancellations on your behalf.'
    }, {
      zh: '汇率换算、支出趋势、未来预测等数据仅供参考，不构成任何财务建议。',
      en: 'Currency conversion, spending trends and forecasts are for reference only and do not constitute financial advice.'
    }]
  },
  {
    h: { zh: '三、账户与安全', en: '3. Account and Security' },
    p: [{
      zh: '您应妥善保管账户密码、验证码与通行密钥，并对账户下的全部活动负责。账户支持邮箱验证码登录、第三方账号（Google、GitHub、Gitee、微信）登录与通行密钥登录，您可选择启用或关闭部分登录方式。',
      en: 'You are responsible for safeguarding your password, verification codes and passkeys, and for all activity under your account. The App supports email verification-code login, third-party sign-in (Google, GitHub, Gitee, WeChat) and passkey login; you may enable or disable these methods.'
    }]
  },
  {
    h: { zh: '四、用户行为规范', en: '4. Acceptable Use' },
    p: [{
      zh: '您承诺不利用本应用从事任何违反法律法规或损害他人合法权益的活动，不上传违法、侵权或含恶意代码的内容，不尝试破解、爬取或干扰本应用的正常运行。',
      en: 'You agree not to use the App for any unlawful activity that infringes the rights of others, not to upload illegal, infringing or malicious content, and not to attempt to crack, scrape or interfere with the normal operation of the App.'
    }]
  },
  {
    h: { zh: '五、服务的变更与中止', en: '5. Changes and Availability' },
    p: [{
      zh: '我们可能因系统维护、升级或不可抗力暂停或中止部分服务，并将尽可能提前通知。我们保留根据经营需要调整、增删服务功能的权利。',
      en: 'We may suspend or discontinue parts of the service for maintenance, upgrades or force majeure events, with notice where reasonably possible. We reserve the right to adjust, add or remove features as needed.'
    }]
  },
  {
    h: { zh: '六、免责声明', en: '6. Disclaimer' },
    p: [{
      zh: '本应用按"现状"提供。在适用法律允许的最大范围内，我们对因使用或无法使用本应用导致的直接或间接损失（包括但不限于数据丢失、利润损失）不承担责任。您应自行备份重要数据。',
      en: 'The App is provided "as is". To the maximum extent permitted by law, we are not liable for direct or indirect losses arising from the use of or inability to use the App (including but not limited to data loss or lost profits). Please back up your important data.'
    }]
  },
  {
    h: { zh: '七、协议的变更', en: '7. Changes to This Agreement' },
    p: [{
      zh: '我们可能不时更新本协议。重大变更将通过应用内公告或邮件通知。变更后您继续使用本应用，即视为接受更新后的协议。',
      en: 'We may update this agreement from time to time. Material changes will be announced in the App or by email. Continued use of the App after changes constitutes acceptance of the updated agreement.'
    }]
  }
];

const PRIVACY_SECTIONS: Section[] = [
  {
    h: { zh: '一、我们收集的信息', en: '1. Information We Collect' },
    p: [{
      zh: '账户信息：注册时提供的邮箱地址、昵称（可选）、头像（可选），以及登录方式产生的第三方标识（如 Google/GitHub/Gitee 用户 ID）。',
      en: 'Account information: the email address, nickname (optional) and avatar (optional) you provide at registration, plus third-party identifiers created by your chosen sign-in method (e.g. your Google/GitHub/Gitee user ID).'
    }, {
      zh: '订阅数据：您主动录入的订阅名称、金额、币种、周期、账单日期、分类、地区、账户邮箱与备注。',
      en: 'Subscription data: the subscription names, amounts, currencies, cycles, billing dates, categories, regions, account emails and notes you enter.'
    }, {
      zh: '设备与日志信息：为保障服务安全所产生的必要访问日志（如登录时间、IP）。',
      en: 'Device and log information: the minimum access logs required to keep the service secure (e.g. sign-in time, IP address).'
    }, {
      zh: '我们不收集您的支付账户、银行卡号或任何支付凭据。',
      en: 'We never collect your payment accounts, card numbers or any payment credentials.'
    }]
  },
  {
    h: { zh: '二、信息的使用', en: '2. How We Use Information' },
    p: [{
      zh: '收集的信息仅用于：提供订阅记录与管理功能；按您设置的账单日期发送到期提醒邮件；登录与安全验证；改进应用体验。',
      en: 'The information is used solely to: provide subscription recording and management; send billing reminder emails based on the dates you set; authenticate sign-ins; and improve the experience.'
    }]
  },
  {
    h: { zh: '三、信息的存储与保护', en: '3. Storage and Security' },
    p: [{
      zh: '数据通过加密连接（HTTPS）传输，存储于受访问控制的数据库中，密码经不可逆加密保存。我们采取合理的行业安全措施防止数据被未经授权地访问、披露或篡改。',
      en: 'Data is transmitted over encrypted connections (HTTPS) and stored in access-controlled databases; passwords are stored using irreversible hashing. We apply reasonable industry security measures against unauthorized access, disclosure or tampering.'
    }]
  },
  {
    h: { zh: '四、信息的共享', en: '4. Information Sharing' },
    p: [{
      zh: '我们不会出售您的个人信息。仅在以下情形中共享必要信息：发送验证码与提醒邮件时向邮件服务商传输收件邮箱；实现第三方登录时与对应平台交换必要的身份标识；法律法规要求时向有权机关提供。',
      en: 'We never sell your personal information. We only share what is necessary: recipient email addresses with our mail service provider to deliver codes and reminders; identity identifiers with the corresponding platform to enable third-party sign-in; and information to competent authorities when required by law.'
    }]
  },
  {
    h: { zh: '五、第三方登录', en: '5. Third-Party Sign-In' },
    p: [{
      zh: '使用 Google、GitHub、Gitee、微信登录时，我们会获取您授权的基础信息（用户 ID、昵称、邮箱），用于创建或关联本应用账户。相关数据的处理同样受对应平台隐私政策约束。',
      en: 'When signing in with Google, GitHub, Gitee or WeChat, we receive the basic information you authorize (user ID, nickname, email) to create or link your account. That data is also governed by the respective platform\'s privacy policy.'
    }]
  },
  {
    h: { zh: '六、您的权利', en: '6. Your Rights' },
    p: [{
      zh: '您可以随时在应用内查看、更正您的资料与订阅数据，解除第三方账号绑定，或删除通行密钥。如需导出或彻底删除账户及全部数据，请通过 support@ngaasiu.studio 联系我们，我们将在 15 个工作日内处理。',
      en: 'You can review and correct your profile and subscription data, unlink third-party accounts and delete passkeys at any time in the App. To export or completely delete your account and all data, contact support@ngaasiu.studio — we will respond within 15 business days.'
    }]
  },
  {
    h: { zh: '七、未成年人保护', en: '7. Minors' },
    p: [{
      zh: '本应用面向成年人提供，我们不主动收集未成年人的个人信息。',
      en: 'The App is intended for adults; we do not knowingly collect personal information from minors.'
    }]
  },
  {
    h: { zh: '八、政策更新与联系方式', en: '8. Updates and Contact' },
    p: [{
      zh: '本政策可能不时更新，更新后将在本页面发布。如有任何疑问，请联系 support@ngaasiu.studio。',
      en: 'This policy may be updated from time to time; updates will be posted on this page. For any questions, contact support@ngaasiu.studio.'
    }]
  }
];

export default function LegalDocument({ kind, onBack }: { kind: LegalDocumentKind; onBack: () => void }) {
  const isAgreement = kind === 'agreement';
  const title = isAgreement ? '用户协议' : '隐私政策';
  const enTitle = isAgreement ? 'Terms of Service' : 'Privacy Policy';
  const sections = isAgreement ? AGREEMENT_SECTIONS : PRIVACY_SECTIONS;

  const handleAgree = () => {
    try { localStorage.setItem(ACCEPTED_KEY, new Date().toISOString()); } catch { /* ignore */ }
    onBack();
  };

  const handleExit = () => {
    if (/Electron/i.test(navigator.userAgent)) {
      // 桌面壳：main.cjs 拦截 app://quit 并退出应用
      window.location.href = 'app://quit';
      return;
    }
    if (Capacitor.isNativePlatform()) {
      void CapApp.exitApp();
      return;
    }
    window.close();
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <header className="safe-area-header fixed top-0 w-full z-50 glass-effect">
        <div className="flex items-center gap-2 px-4 h-16 w-full max-w-2xl mx-auto">
          <button onClick={onBack} aria-label="返回"
                  className="w-10 h-10 -ml-2 flex items-center justify-center rounded-full active:bg-surface-container-high transition-colors">
            <ArrowLeft size={22} />
          </button>
          <h1 className="text-lg font-bold text-on-surface">{title}</h1>
        </div>
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto px-6 pt-24 pb-40 overflow-y-auto no-scrollbar">
        <p className="text-xs text-on-surface-variant">生效日期 / Effective date：2026-09-29</p>
        {sections.map((section) => (
          <section key={section.h.zh} className="mt-6">
            <h2 className="text-base font-bold text-on-surface">{section.h.zh}</h2>
            {section.p.map((para, index) => (
              <p key={index} className="text-sm text-on-surface-variant mt-2 leading-relaxed">{para.zh}</p>
            ))}
            <h2 className="text-sm font-bold text-on-surface mt-4">{section.h.en}</h2>
            {section.p.map((para, index) => (
              <p key={`en-${index}`} className="text-xs text-on-surface-variant/80 mt-1.5 leading-relaxed">{para.en}</p>
            ))}
          </section>
        ))}
        <p className="text-xs text-on-surface-variant mt-8">
          完整版本同时发布于 / Also available at:{' '}
          <a href={isAgreement ? 'https://ngaasiu.studio/agreement' : 'https://ngaasiu.studio/privacy'}
             target="_blank" rel="noreferrer" className="text-primary font-bold">
            ngaasiu.studio/{isAgreement ? 'agreement' : 'privacy'}
          </a>
        </p>
      </main>

      <div className="fixed bottom-0 left-0 w-full z-50 bg-surface border-t border-outline-variant/10 px-6 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="max-w-2xl mx-auto flex gap-3">
          <button onClick={handleExit}
                  className="flex-1 py-3 rounded-xl border border-outline-variant/30 text-on-surface-variant font-bold text-sm active:scale-95 transition-all">
            退出本应用
          </button>
          <button onClick={handleAgree}
                  className="flex-1 py-3 rounded-xl bg-primary text-white font-bold text-sm active:scale-95 transition-all">
            同意并继续
          </button>
        </div>
      </div>
    </div>
  );
}
