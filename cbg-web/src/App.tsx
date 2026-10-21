import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, App as AntApp, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { HashRouter, useLocation } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { AccountScore } from './pages/AccountScore';
import { SoulReport } from './pages/SoulReport';
import { InspectorReport } from './pages/InspectorReport';
import { useTheme } from './hooks/useTheme';

/**
 * 用 HashRouter 而不是 BrowserRouter：
 * GitHub Pages 是纯静态托管，访问 /some-path 会直接 404（没有服务端重写规则）。
 * hash 路由（#/）不参与服务端路径解析，刷新和分享链接都不会挂。
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    },
  },
});

/**
 * 模块切换：三个页面**始终挂载**，只切换显示。
 *
 * 为什么不用 <Routes>：路由切换会卸载页面组件，导致
 *   - 模块一已查到的结果、筛选条件、勾选项全部丢失；
 *   - 回到模块一还会触发「服务就绪自动查询」，重新打一轮藏宝阁接口；
 *   - 模块二/模块三已分析好的数据也会被清空。
 * 保持挂载后，切模块只是切显示：数据留在原地，只有用户明确点
 * 「查询 / 开始分析 / 刷新」时才重新取数。
 *
 * URL 保留 #/、#/score、#/soul 三条路由，分享、刷新、浏览器前进后退都正常。
 */
const ModuleSwitch = () => {
  const { pathname } = useLocation();
  const scoreActive = pathname.startsWith('/score');
  const soulActive = pathname.startsWith('/soul');
  const inspActive = pathname.startsWith('/inspector');
  const dashActive = !scoreActive && !soulActive && !inspActive;
  return (
    <>
      <div className="module-pane" hidden={!dashActive}>
        <Dashboard active={dashActive} />
      </div>
      <div className="module-pane" hidden={!scoreActive}>
        <AccountScore />
      </div>
      <div className="module-pane" hidden={!soulActive}>
        <SoulReport />
      </div>
      <div className="module-pane" hidden={!inspActive}>
        <InspectorReport />
      </div>
    </>
  );
};

/** antd 令牌：深色对齐 cbg-filter-kit 的设计令牌，浅色用 antd 默认色板 */
const antdTheme = (mode: 'dark' | 'light') =>
  mode === 'dark'
    ? {
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#ff5a45',
          colorBgBase: '#0e1014',
          colorBgContainer: '#161920',
          colorBgElevated: '#1c2029',
          colorBorder: '#272c37',
          colorBorderSecondary: '#1e222b',
          colorText: '#e9ecf2',
          colorTextSecondary: '#8f99ab',
          colorTextTertiary: '#626c7e',
          colorSuccess: '#34d07f',
          colorWarning: '#e5b567',
          colorLink: '#6aa9ff',
          borderRadius: 8,
          fontSize: 13,
          controlHeight: 30,
        },
        components: {
          Table: {
            headerBg: '#191d26',
            headerColor: '#8f99ab',
            rowHoverBg: '#1a1e27',
            rowSelectedBg: 'rgba(255,90,69,.14)',
            rowSelectedHoverBg: 'rgba(255,90,69,.18)',
            borderColor: '#1e222b',
            headerSplitColor: 'transparent',
            cellPaddingBlockSM: 5,
          },
          Drawer: { colorBgElevated: '#161920' },
          Tag: { defaultBg: '#232833' },
          Tooltip: { colorBgSpotlight: '#232833' },
        },
      }
    : {
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#ff5a45',
          colorBgLayout: '#f5f7fa',
          colorBgContainer: '#ffffff',
          colorBorder: '#e5e7eb',
          colorBorderSecondary: '#f0f0f0',
          colorText: '#1f2329',
          colorTextSecondary: '#6b7280',
          colorTextTertiary: '#9aa3b0',
          colorSuccess: '#16a34a',
          colorWarning: '#b45309',
          colorLink: '#1677ff',
          borderRadius: 8,
          fontSize: 13,
          controlHeight: 30,
        },
        components: {
          Table: {
            headerBg: '#fafafa',
            headerColor: '#6b7280',
            rowHoverBg: '#f5f7fa',
            rowSelectedBg: 'rgba(255,90,69,.08)',
            rowSelectedHoverBg: 'rgba(255,90,69,.12)',
            borderColor: '#f0f0f0',
            headerSplitColor: 'transparent',
            cellPaddingBlockSM: 5,
          },
          Drawer: { colorBgElevated: '#ffffff' },
        },
      };

const App = () => {
  const { theme: mode } = useTheme();
  return (
    <ConfigProvider locale={zhCN} theme={antdTheme(mode)}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <HashRouter>
            {/* 两个模块各占一条 hash 路由：可以单独分享、刷新不丢 */}
            <ModuleSwitch />
          </HashRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
};

export default App;
