import React, { createContext, useContext, useEffect, useState } from 'react';

// 三种主题：浅色（默认）/ 深色 / 森林绿（可选，浅色底 + 森林绿主色）。
// Forest 通过 .forest 类换肤，与 .dark 互斥；用户在设置页选择并随 user_settings 持久化。
export type Theme = 'Light' | 'Dark' | 'Forest';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('Light');

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.toggle('dark', theme === 'Dark');
    root.classList.toggle('forest', theme === 'Forest');
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'Light' ? 'Dark' : 'Light'));
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
