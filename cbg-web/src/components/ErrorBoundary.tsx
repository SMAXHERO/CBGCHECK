import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * 顶层错误边界。
 *
 * 开发期渲染异常最坑的一点是：React 19 会把出错的组件树整个卸载，
 * 页面变成空白，而错误信息可能只出现在控制台甚至被日志截断。
 * 这个边界把异常连同组件栈直接画在页面上，避免「白屏 + 无线索」。
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 控制台也留一份，方便复制
    console.error('[ErrorBoundary] 渲染异常：', error, info.componentStack);
    this.setState({ stack: info.componentStack ?? null });
  }

  render(): ReactNode {
    const { error, stack } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          maxWidth: 860,
          margin: '24px auto',
          padding: '20px 22px',
          background: '#1c2029',
          border: '1px solid #ff5a45',
          borderRadius: 12,
          color: '#e9ecf2',
          font: '13px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: '#ff5a45', marginBottom: 8 }}>
          页面渲染出错（已拦在错误边界）
        </div>
        <div style={{ color: '#ff8b74', marginBottom: 10, whiteSpace: 'pre-wrap' }}>
          {error.name}: {error.message}
        </div>
        {stack && (
          <details open>
            <summary style={{ cursor: 'pointer', color: '#8f99ab', marginBottom: 6 }}>
              组件调用栈
            </summary>
            <pre
              style={{
                background: '#0f1218',
                border: '1px solid #272c37',
                borderRadius: 8,
                padding: 10,
                fontSize: 11.5,
                overflow: 'auto',
                maxHeight: 320,
                color: '#c3cbd9',
                whiteSpace: 'pre-wrap',
              }}
            >
              {stack}
            </pre>
          </details>
        )}
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => this.setState({ error: null, stack: null })}
            style={{
              padding: '7px 14px',
              borderRadius: 8,
              border: 0,
              background: '#ff5a45',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            重试渲染
          </button>
        </div>
      </div>
    );
  }
}
