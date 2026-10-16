import { useEffect, useRef } from 'react';

/**
 * 开发期渲染审计。
 *
 * 无限更新循环（Maximum update depth exceeded）最难的是「不知道谁在刷」，
 * 而且 React 一旦判定循环就把整棵树卸载，日志经常来不及打全。
 * 这里把计数写进 localStorage，页面被卸载后依然能读到。
 *
 * 阈值取 5 次/秒：宁可多报一点，也别漏掉真正的循环。
 */
export const useRenderCount = (name: string): void => {
  const count = useRef(0);
  const windowStart = useRef(Date.now());

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    count.current += 1;
    const now = Date.now();

    if (now - windowStart.current >= 1000) {
      const total = count.current;
      count.current = 0;
      windowStart.current = now;
      try {
        const raw = localStorage.getItem('__render_audit');
        const audit: Record<string, number> = raw ? JSON.parse(raw) : {};
        audit[name] = (audit[name] ?? 0) + total;
        localStorage.setItem('__render_audit', JSON.stringify(audit));
      } catch {
        /* 隐私模式忽略 */
      }
      if (total > 5) {
        console.error(`[渲染审计] ${name}: ${total} 次/秒`);
      }
    }
  });
};
