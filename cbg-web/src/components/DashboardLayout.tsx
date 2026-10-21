import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { ModuleHeader } from '@/components/ModuleHeader';
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
  const st = statusStyle(status);
  /** 本布局的根节点：四个模块页常驻挂载、只切 hidden，快捷键必须只对当前模块生效 */
  const rootRef = useRef<HTMLDivElement | null>(null);

  /**
   * 全局键盘动线：
   *   - Ctrl/Cmd + Enter：查询；查询中则等价「取消查询」（取消中忽略）；
   *   - Esc：查询中取消，否则不处理（不拦弹窗，antd 自己处理）。
   * 输入类控件内不响应 Esc / 其它快捷键，但 Ctrl/Cmd+Enter 例外——
   * 用户最常见的动作是「粘完条件直接查」。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // 当前模块被 App 用 hidden 藏起来时不响应（否则会在别的模块里误触发查询）
      if (rootRef.current?.closest('[hidden]')) return;
      const el = event.target as HTMLElement | null;
      const tag = el?.tagName;
      const editing =
        Boolean(el?.isContentEditable) || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const mod = event.ctrlKey || event.metaKey;

      if (mod && event.key === 'Enter') {
        // 等价于点「查询 / 取消查询」按钮：按钮禁用时同样不动作
        event.preventDefault();
        if (running) {
          if (!cancelling) onCancel();
        } else if (canQuery) {
          onQuery();
        }
        return;
      }
      if (editing) return;
      if (event.key === 'Escape' && running && !cancelling) {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [running, cancelling, canQuery, onQuery, onCancel]);

  return (
    <div className="app-shell" ref={rootRef}>
      <ModuleHeader
        title={title}
        badge={badge}
        themeVariant="svg"
        statusNode={
          <span
            className="status-pill"
            title={`数据来源：${SCRAPER_BASE}（本机伴随服务 + 已登录浏览器）`}
          >
            <i style={{ background: st.color }} />
            {st.label}
          </span>
        }
        conditionSearch={conditionSearch}
        meta={meta}
        chipsNode={
          conditions.length > 0 ? (
            <div className="chips">
              {conditions.map((c) => (
                <span className="chip" key={`${c.id}-${c.param}`}>
                  <span>{c.label}</span>
                  {c.display && <b>{c.display}</b>}
                  <i
                    className="x"
                    role="button"
                    tabIndex={0}
                    title={`移除条件：${c.label}`}
                    aria-label={`移除条件：${c.label}`}
                    onClick={() => onRemoveCondition(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onRemoveCondition(c.id);
                      }
                    }}
                  >
                    ✕
                  </i>
                </span>
              ))}
            </div>
          ) : null
        }
      />

      <div className="layout">
        <div className="side">{sidebar}</div>
        <div className="main">{children}</div>
      </div>

      <footer className="app-footer">
        <span className="kbd-hint">Ctrl/⌘+Enter 查询 · Esc 取消</span>
        <div className="cnt" aria-busy={running}>
          {/* 读屏播报：进度文案变化时由常驻的 aria-live 区域读出 */}
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {running ? (cancelling ? '正在停止查询' : (progressText ?? '正在查询')) : ''}
          </span>
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
            title="取消查询（Esc）· 保留已取到的部分结果"
          >
            {cancelling ? '正在停止…' : '取消查询'}
          </button>
        ) : (
          <button
            className={`btn btn-primary${dirty ? ' pulse' : ''}`}
            onClick={onQuery}
            disabled={!canQuery}
            title="查询（Ctrl+Enter）"
          >
            查询
          </button>
        )}
      </footer>
    </div>
  );
};
