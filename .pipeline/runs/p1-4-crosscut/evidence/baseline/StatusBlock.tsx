import type { ReactNode } from 'react';

/**
 * 空态 / 加载 的统一呈现。
 *
 * 之前各页面各写一套（.state-box / .soul-empty / .score-loading），
 * 视觉上已经趋同却散落在多处。这里收一个最小实现：
 *   - 复用既有的 .state-box 视觉，避免重做样式；
 *   - loading 时挂 role="status" 让读屏能听到「正在查询」；
 *   - 空态/说明用 role="note"，不打扰当前焦点。
 *
 * 只替换最明确的几处，其余页面保持原样（不做大范围重写）。
 */
interface Props {
  /** loading 时显示旋转指示器并播报状态 */
  loading?: boolean;
  /** 空态标题（较大字号） */
  title?: ReactNode;
  /** 次要说明，渲染在正文下方的小字 */
  hint?: ReactNode;
  children?: ReactNode;
}

export const StatusBlock = ({ loading = false, title, hint, children }: Props) => {
  if (loading) {
    return (
      <div className="state-box" role="status" aria-live="polite" aria-busy="true">
        <div className="spinner" />
        {children}
        {hint ? <div className="state-hint">{hint}</div> : null}
      </div>
    );
  }
  return (
    <div className="state-box" role="note">
      {title ? <div className="big">{title}</div> : null}
      {children}
      {hint ? <div className="state-hint">{hint}</div> : null}
    </div>
  );
};
