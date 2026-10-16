// 必须放在 antd 之前：这个补丁会替换 ReactDOM 的 render / unmount 等接口，
// 让 antd v5 的 message / notification / Modal 这类「静态方法」在 React 19 下可用。
// 不引它的话，控制台会一直警告 "antd v5 support React is 16 ~ 18"，
// 而且一旦用到那些静态方法就会直接失效（静默不弹窗）。
import '@ant-design/v5-patch-for-react-19';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('找不到 #root 挂载节点，检查 index.html');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
