import type { ReactNode } from 'react';
import { ModuleTabs } from '@/components/ModuleTabs';
import { useTheme } from '@/hooks/useTheme';

/**
 * 统一顶部栏（吸顶 header）。
 *
 * 三种模式（DOM 与改造前逐字保真，见 evidence/dom-fidelity.md）：
 *   - 完整模式（默认）：h1 → pill-tag → ModuleTabs → status-pill → 搜索框 → head-meta → 主题按钮；
 *     下方可选 chips。themeVariant 决定主题按钮的呈现：
 *       · 'svg'：角色查询（DashboardLayout）用的月亮/太阳 SVG 图标；
 *       · 'text'：模块二/三/四用的文本图标 ☀ / 🌙。
 *   - 精简模式（minimal）：仅 h1 + pill-tag，不渲染 ModuleTabs 与主题按钮
 *     （Dashboard 的离线 / 需浏览器 / 需登录守卫态）。
 *
 * 主题切换 SVG 只在本文件出现（单源）。
 */

export type ModuleHeaderThemeVariant = 'svg' | 'text';

interface Props {
  title: string;
  /** 对应 <span className="pill-tag"> */
  badge?: string;
  /** 仅 Dashboard：服务状态灯（<span className="status-pill">…</span>） */
  statusNode?: ReactNode;
  /** 仅 Dashboard：条件搜索框 */
  conditionSearch?: { value: string; onChange: (v: string) => void };
  /** 对应 <span className="head-meta">；模块页传纯文本 */
  meta?: ReactNode;
  /** 仅 Dashboard：已选条件 chips（<div className="chips">），位于 head-in 外部 */
  chipsNode?: ReactNode;
  /** 主题按钮的呈现方式；minimal 模式下忽略 */
  themeVariant?: ModuleHeaderThemeVariant;
  /** true：精简模式，不渲染 ModuleTabs 与主题按钮 */
  minimal?: boolean;
}

const ThemeSvgIcon = ({ dark }: { dark: boolean }) =>
  dark ? (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.9 5.9 0 1 0 7.1 7.1Z" />
    </svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1.4v1.6M8 13v1.6M1.4 8h1.6M13 8h1.6M3.3 3.3l1.2 1.2M11.5 11.5l1.2 1.2M12.7 3.3l-1.2 1.2M4.5 11.5l-1.2 1.2" />
    </svg>
  );

/** 主题切换按钮（内部私有，单源） */
const ThemeToggle = ({ variant }: { variant: ModuleHeaderThemeVariant }) => {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  const label = dark ? '切换到浅色主题' : '切换到深色主题';
  if (variant === 'svg') {
    return (
      <button className="icon-btn" onClick={toggle} title={label} aria-label={label}>
        <ThemeSvgIcon dark={dark} />
      </button>
    );
  }
  return (
    <button className="icon-btn" onClick={toggle} title={label} aria-label="切换主题">
      {dark ? '☀' : '🌙'}
    </button>
  );
};

export const ModuleHeader = ({
  title,
  badge,
  statusNode,
  conditionSearch,
  meta,
  chipsNode,
  themeVariant = 'text',
  minimal = false,
}: Props) => {
  if (minimal) {
    return (
      <header className="app-header">
        <div className="head-in">
          <h1>{title}</h1>
          {badge && <span className="pill-tag">{badge}</span>}
        </div>
      </header>
    );
  }
  return (
    <header className="app-header">
      <div className="head-in">
        <h1>{title}</h1>
        {badge && <span className="pill-tag">{badge}</span>}
        <ModuleTabs />
        {statusNode}
        {conditionSearch && (
          <div className="search-wrap-head">
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5 14 14" />
            </svg>
            <input
              placeholder="搜索条件，例如「一速」「图鉴」「皮肤」"
              spellCheck={false}
              value={conditionSearch.value}
              onChange={(e) => conditionSearch.onChange(e.target.value)}
            />
          </div>
        )}
        {meta && <span className="head-meta">{meta}</span>}
        <ThemeToggle variant={themeVariant} />
      </div>
      {chipsNode}
    </header>
  );
};
