# 重构映射（refactor-map）

计划版本：v1 · 执行：模型 B

## 1. 重复点 → 收敛位置

| 重复点 | 改造前 | 收敛到 | 调用点 |
|---|---|---|---|
| 顶部栏 `<header className="app-header">` 结构 | 4 处手写 + 3 处 Dashboard 守卫手写 | `components/ModuleHeader.tsx` | DashboardLayout、AccountScore、SoulReport、InspectorReport（完整模式各 1）+ Dashboard（minimal ×3） |
| 主题切换按钮（`icon-btn`） | 4 处手写（1 SVG 变体 + 3 文本变体） | `ModuleHeader.tsx` 内私有 `ThemeToggle`（`variant: svg \| text`） | 同上，由 ModuleHeader 渲染 |
| 主题 SVG（月亮/太阳） | DashboardLayout 中内联两段 SVG | `ModuleHeader.tsx` 的 `ThemeSvgIcon`（单源） | C9：`M13.5 9.6A5.8` 仅命中 ModuleHeader.tsx |
| 导出（Excel/CSV/打印）+ 禁用判断 | Dashboard 内直接调用 `exportExcel/exportCsv/printArea` 与 `exportDisabled` | `hooks/useExport.ts` | Dashboard 仅调用 `useExport`（C10=0） |
| 空/加载占位 `.state-box` | Dashboard 3 处已用 StatusBlock；其余 3 处为旧类名 | StatusBlock 扩展 `className` | 见第 3 节「不做」 |

## 2. 顶部栏的三种模式（参数化）

ModuleHeader 不是「四个完全一致的顶部栏」（原审计结论不成立，见 assumptions Q8）。实际为：

- **svg（完整）**：DashboardLayout。含 `status-pill`、`search-wrap-head`、`chips`（在 head-in 外）、SVG 主题按钮。
- **text（完整）**：AccountScore / SoulReport / InspectorReport。无状态灯与搜索框，主题按钮为 `☀`/`🌙` 文本，`aria-label="切换主题"`。
- **minimal（精简）**：Dashboard 的 offline / need-browser / need-login|captcha 守卫态。仅 `h1 + pill-tag`，无 tabs、无主题按钮。

## 3. 调用点清单

| 调用点 | 模式 | 状态 |
|---|---|---|
| `components/DashboardLayout.tsx` | svg | 已替换 |
| `pages/AccountScore.tsx` | text | 已替换 |
| `pages/SoulReport.tsx` | text | 已替换 |
| `pages/InspectorReport.tsx` | text | 已替换 |
| `pages/Dashboard.tsx` 守卫 offline | minimal | 已替换 |
| `pages/Dashboard.tsx` 守卫 need-browser | minimal | 已替换 |
| `pages/Dashboard.tsx` 守卫 need-login/captcha | minimal | 已替换 |
| `pages/Dashboard.tsx` 导出 | useExport | 已替换 |

## 4. 「不做」清单（含理由）

| 项 | 决定 | 理由 |
|---|---|---|
| AccountScore `.score-loading` → StatusBlock | 不做 | 原节点为 `<Spin/>` + 文本，外层类 `score-loading`；StatusBlock 为 `state-box` + spinner，视觉与 DOM 不等价（违反 DOM 零变化） |
| SoulReport `.soul-empty`（2 处）→ StatusBlock | 不做 | 原类名 `soul-empty` 为专属样式；StatusBlock 根类不同 |
| FilterPanel `.state-box`（1 处）→ StatusBlock | 不做 | 原节点无 `role`；StatusBlock 非 loading 分支会添加 `role="note"`，DOM 变化 |
| AlertBar（G5 选做）抽取 | 不做 | `.score-need.score-error` 与 `.soul-alert.err` 结构/类名不同，无法同组件在 className 不变前提下输出 |
| 三个模块页主题统一为 SVG | 不做 | 视觉改动，超出范围（Q1） |
| 修改 index.css / api / store / vite.config.* | 不做 | 禁止路径（C11 已验证无 diff） |

## 5. 收敛指标结果

- `app-header`（pages + DashboardLayout，排除 ModuleHeader）：0（C5 通过）
- `icon-btn`（pages + DashboardLayout）：0（C6 通过）
- ModuleHeader 使用次数：DashboardLayout/AccountScore/SoulReport/InspectorReport 各 1（C7 通过）
- 主题 SVG 路径：仅 ModuleHeader.tsx（C9 通过）
- Dashboard 直接导出调用：0（C10 通过）
