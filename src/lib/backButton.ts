import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

/**
 * Android 物理返回键处理：
 * - 弹窗/子页面通过 useBackHandler 注册“关闭自己”的回调，返回键优先触发它；
 * - 没有任何注册者时，非仪表盘页返回到仪表盘，仪表盘再按一次才退出应用。
 */
type BackHandler = () => void;

const stack: BackHandler[] = [];

const consumeBack = (): boolean => {
  if (stack.length === 0) return false;
  stack[stack.length - 1]();
  return true;
};

/** 在弹窗或子页面中注册返回键回调，active=false 时暂停；卸载时自动注销。 */
export function useBackHandler(handler: BackHandler, active = true): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!active) return;
    const fn: BackHandler = () => handlerRef.current();
    stack.push(fn);
    return () => {
      const index = stack.indexOf(fn);
      if (index >= 0) stack.splice(index, 1);
    };
  }, [active]);
}

/** 在应用根组件挂载一次，接管系统返回键。 */
export function useAndroidBackButton(getTab: () => string, goToDashboard: () => void): void {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handle: { remove: () => Promise<void> } | null = null;
    void CapApp.addListener('backButton', () => {
      if (consumeBack()) return;
      if (getTab() !== 'dashboard') {
        goToDashboard();
        return;
      }
      void CapApp.exitApp();
    }).then((h) => {
      handle = h;
    });
    return () => {
      void handle?.remove();
    };
    // 仅挂载时注册一次，tab 通过参数读取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
