import type { ReactNode } from 'react';

/**
 * 空态 / 加载 的统一呈现。
 *
 * 唯一基类是 .state-box，旧的按页面各写的空态/加载样式已全部收敛到这里；
 *   - loading 时挂 role="status" 让读屏能听到「正在查询」；
 *   - 空态/说明用 role="note"，不打扰当前焦点。
 */
/** 呈现形态：block 整块居中；compact 表格内紧凑；inline 单行左对齐 */
export type StatusVariant = 'block' | 'compact' | 'inline';

interface Props {
  /** loading 时显示旋转指示器并播报状态 */
  loading?: boolean;
  /** 空态标题（较大字号） */
  title?: ReactNode;
  /** 次要说明，渲染在正文下方的小字 */
  hint?: ReactNode;
  /** 呈现形态，默认 block；差异由 .state-box--{variant} 修饰类表达 */
  variant?: StatusVariant;
  /** 追加到根节点的 className（保留调用方既有视觉类名） */
  className?: string;
  children?: ReactNode;
}

export const StatusBlock = ({
  loading = false,
  title,
  hint,
  variant = 'block',
  className,
  children,
}: Props) => {
  const modifier = variant === 'block' ? '' : ` state-box--${variant}`;
  const extra = className ? ` ${className}` : '';
  const rootClass = `state-box${modifier}${extra}`;
  if (loading) {
    return (
      <div className={rootClass} role="status" aria-live="polite" aria-busy="true">
        <div className="spinner" />
        {children}
        {hint ? <div className="state-hint">{hint}</div> : null}
      </div>
    );
  }
  return (
    <div className={rootClass} role="note">
      {title ? <div className="big">{title}</div> : null}
      {children}
      {hint ? <div className="state-hint">{hint}</div> : null}
    </div>
  );
};
