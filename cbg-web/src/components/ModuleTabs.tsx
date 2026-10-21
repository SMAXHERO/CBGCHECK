import { NavLink } from 'react-router-dom';

/**
 * 顶部模块切换。
 *
 * 用路由（HashRouter）而不是组件内 state：
 *   - 每个模块有自己的地址（#/ 与 #/score），可以单独分享、刷新不丢
 *   - GitHub Pages 是静态托管，hash 路由不需要服务端重写规则
 *
 * 每个模块一个主色圆点，让人一眼知道自己在哪个模块（详见 index.css 的 .mod-tab）。
 */
export interface ModuleDef {
  to: string;
  label: string;
  hint: string;
  /** 圆点与选中态的颜色，用 CSS 变量由 index.css 提供 */
  dotClass: string;
}

export const MODULES: ModuleDef[] = [
  { to: '/', label: '角色查询', hint: '73 项条件实时筛选', dotClass: 'dot-a' },
  { to: '/score', label: '账号评分', hint: '御魂搭配评分 · 最快速', dotClass: 'dot-b' },
  { to: '/soul', label: '御魂报告', hint: '御魂概览 / 一速 / 评分分布 / 组合搜索', dotClass: 'dot-c' },
  { to: '/inspector', label: '看号分析', hint: '速度盘点 / PVE 预览 / 式神技能 / 库存 / 计算器', dotClass: 'dot-d' },
];

export const ModuleTabs = () => (
  <nav className="mod-tabs" aria-label="模块切换">
    {MODULES.map((m) => (
      <NavLink
        key={m.to}
        to={m.to}
        end={m.to === '/'}
        className={({ isActive }) => `mod-tab${isActive ? ' on' : ''}`}
        title={m.hint}
      >
        {/* 装饰性圆点：选中状态由 NavLink 自动输出的 aria-current 表达 */}
        <i className={`mod-dot ${m.dotClass}`} aria-hidden="true" />
        <span className="mod-label">{m.label}</span>
      </NavLink>
    ))}
  </nav>
);
