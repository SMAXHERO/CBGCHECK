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
      <div className="crash" role="alert">
        <div className="crash-title">页面渲染出错（已拦在错误边界）</div>
        <div className="crash-msg">
          {error.name}: {error.message}
        </div>
        {stack && (
          <details open className="crash-stack">
            <summary>组件调用栈</summary>
            <pre className="crash-pre">{stack}</pre>
          </details>
        )}
        <div className="crash-retry">
          <button
            className="btn btn-primary"
            onClick={() => this.setState({ error: null, stack: null })}
          >
            重试渲染
          </button>
        </div>
      </div>
    );
  }
}
