import type { ReactNode } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { ModuleTabs } from '@/components/ModuleTabs';
import { useTheme } from '@/hooks/useTheme';
import { useRenderCount } from '@/hooks/useRenderCount';
import { SCRAPER_BASE, type ServiceStatus } from '@/api/live';

/**
 * 页面骨架：吸顶 header（标题 + 条件搜索 + 已选 chips）+ 两栏布局 + 底部固定操作条。
 *
 * 底部操作条同时承担「查询控制台」的角色：查询按钮、实时进度、服务状态灯都在这里，
 * 因为它们和查询这个动作强相关，放一起最顺手。
 */

interface Props {
  title: string;
  badge?: string;
  meta?: ReactNode;
  conditionSearch?: { value: string; onChange: (v: string) => void };
  sidebar: ReactNode;
  children: ReactNode;

  /** 查询相关 */
  status: ServiceStatus;
  running: boolean;
  /** 取消已受理，正在等当前这一页返回 */
  cancelling: boolean;
  hitCount: number;
  /** 查询中显示「已取回 N 条 / 共 M 条」 */
  progressText?: string | null;
  /** 条件改过但还没查询，按钮要显眼提示 */
  dirty: boolean;
  onQuery: () => void;
  /** 取消正在进行的查询 */
  onCancel: () => void;
  canQuery: boolean;

  onRemoveCondition: (id: string) => void;
  onExportExcel: () => void;
  onExportCsv: () => void;
  onPrint: () => void;
  /** 恢复内置默认条件（价格 500~1500 / 勾玉 / 散件一速 158） */
  onRestoreDefaults: () => void;
  exportDisabled?: boolean;
}

const STATUS_STYLE: Record<ServiceStatus, { color: string; label: string }> = {
  starting: { color: 'var(--warn)', label: '连接中' },
  ready: { color: 'var(--ok)', label: '实时' },
  'need-login': { color: 'var(--warn)', label: '需登录' },
  'need-captcha': { color: 'var(--warn)', label: '需滑块验证' },
  'need-browser': { color: 'var(--warn)', label: '未启动浏览器' },
  error: { color: 'var(--accent)', label: '异常' },
  offline: { color: 'var(--faint)', label: '未连接' },
};

/**
 * 查表必须有兜底：服务端返回的 status 未来可能多出新值（比如加个 'rate-limited'），
 * 那时前端不能因为一个找不到的 key 就整页崩掉——`st.color` 取 undefined 会直接抛错。
 */
const statusStyle = (s: ServiceStatus) =>
  STATUS_STYLE[s] ?? { color: 'var(--faint)', label: String(s || '未知') };

export const DashboardLayout = ({
  title,
  badge,
  meta,
  conditionSearch,
  sidebar,
  children,
  status,
  running,
  cancelling,
  hitCount,
  progressText,
  dirty,
  onQuery,
  onCancel,
  canQuery,
  onRemoveCondition,
  onExportExcel,
  onExportCsv,
  onPrint,
  onRestoreDefaults,
  exportDisabled,
}: Props) => {
  useRenderCount('DashboardLayout');
  const conditions = useAppStore((s) => s.conditions);
  const selectedIds = useAppStore((s) => s.selectedIds);
  const bumpReset = useAppStore((s) => s.bumpReset);
  const { theme, toggle } = useTheme();
  const st = statusStyle(status);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="head-in">
          <h1>{title}</h1>
          {badge && <span className="pill-tag">{badge}</span>}
          <ModuleTabs />
          <span
            className="status-pill"
            title={`数据来源：${SCRAPER_BASE}（本机伴随服务 + 已登录浏览器）`}
          >
            <i style={{ background: st.color }} />
            {st.label}
          </span>
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
          <button
            className="icon-btn"
            onClick={toggle}
            title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
            aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          >
            {theme === 'dark' ? (
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.9 5.9 0 1 0 7.1 7.1Z" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="8" cy="8" r="3.1" />
                <path d="M8 1.4v1.6M8 13v1.6M1.4 8h1.6M13 8h1.6M3.3 3.3l1.2 1.2M11.5 11.5l1.2 1.2M12.7 3.3l-1.2 1.2M4.5 11.5l-1.2 1.2" />
              </svg>
            )}
          </button>
        </div>

        {conditions.length > 0 && (
          <div className="chips">
            {conditions.map((c) => (
              <span className="chip" key={`${c.id}-${c.param}`}>
                <span>{c.label}</span>
                {c.display && <b>{c.display}</b>}
                <i className="x" title={`移除条件：${c.label}`} onClick={() => onRemoveCondition(c.id)}>
                  ✕
                </i>
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="layout">
        <div className="side">{sidebar}</div>
        <div className="main">{children}</div>
      </div>

      <footer className="app-footer">
        <div className="cnt">
          {running ? (
            <span className="query-progress">
              <span className="mini-spinner" />
              {cancelling ? '正在停止…' : (progressText ?? '正在查询…')}
              {!cancelling && <span className="cancel-hint">可随时点「取消查询」</span>}
            </span>
          ) : (
            <>
              已选 <b>{conditions.length}</b> 项 ｜ 命中 <b>{hitCount}</b> 条
              {selectedIds.length > 0 && (
                <>
                  {' '}
                  ｜ 对比清单 <b>{selectedIds.length}</b> 个
                </>
              )}
              {dirty && <span className="dirty-hint">条件已改，点「查询」更新数据</span>}
            </>
          )}
        </div>
        <button className="btn btn-ghost" onClick={bumpReset} disabled={!conditions.length || running}>
          清空
        </button>
        <button className="btn btn-ghost" onClick={onRestoreDefaults} disabled={running}>
          默认条件
        </button>
        <button className="btn btn-ghost" onClick={onExportExcel} disabled={exportDisabled}>
          导出 Excel
        </button>
        <button className="btn btn-ghost" onClick={onExportCsv} disabled={exportDisabled}>
          导出 CSV
        </button>
        <button className="btn btn-ghost" onClick={onPrint} disabled={exportDisabled}>
          打印 / PDF
        </button>
        {running ? (
          <button
            className="btn btn-danger"
            onClick={onCancel}
            disabled={cancelling}
            title="停止本次查询，保留已取到的部分结果"
          >
            {cancelling ? '正在停止…' : '取消查询'}
          </button>
        ) : (
          <button
            className={`btn btn-primary${dirty ? ' pulse' : ''}`}
            onClick={onQuery}
            disabled={!canQuery}
          >
            查询
          </button>
        )}
      </footer>
    </div>
  );
};
