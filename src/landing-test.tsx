// 仅本地预览落地页用（vite dev 访问 /landing-test.html），不参与生产构建。
// ZCode 桌面壳等 Electron UA 会被 App 判定为桌面端跳过落地页，这里绕过 App.tsx 直接挂载。
import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import LandingPage from './components/LandingPage';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LandingPage onEnter={() => window.alert('进入应用')} />
  </React.StrictMode>,
);
