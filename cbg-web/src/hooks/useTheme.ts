import { useEffect } from 'react';
import { useAppStore, type ThemeMode } from '@/store/useAppStore';

/** 读取首帧前由 index.html 内联脚本定下的主题，避免与 store 不一致 */
const initialTheme = (): ThemeMode => {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
};

/**
 * 主题：把当前模式写到 <html data-theme>，并持久化。
 *
 * 为什么不用 antd 的 ConfigProvider 一把梭：
 * 自定义组件（筛选面板、表格、图表）走的是自己的 CSS 变量，
 * 只有把主题落到 document 上，两边才能在同一个开关下同时切换。
 */
export const useTheme = (): { theme: ThemeMode; toggle: () => void; setTheme: (t: ThemeMode) => void } => {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  // 首次挂载：若 store 与 DOM 上的主题不一致（例如内联脚本跟随了系统偏好），以 DOM 为准
  useEffect(() => {
    const dom = initialTheme();
    if (dom !== theme) setTheme(dom);
    // 只在挂载时对齐一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem('cbg-theme', theme);
    } catch {
      /* 隐私模式下写不进去也不影响使用 */
    }
  }, [theme]);

  return {
    theme,
    setTheme,
    toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
  };
};
