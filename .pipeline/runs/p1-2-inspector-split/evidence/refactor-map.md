# 拆分映射（refactor-map）

原文件：`cbg-web/src/pages/InspectorReport.tsx`（改造前 1015 行，副本 `.pipeline/evidence/InspectorReport.orig.tsx`，sha256 `741f7293…b850`）。
行号以原文件副本为准。

## 1. 六个 Tab 块：原行号 → 新文件/组件

| 原行号区间 | 原内容 | 新文件 | 组件 | 备注 |
|---|---|---|---|---|
| L421–L564 | `tab === 'overview'` 整段 JSX（账号数据 / 御魂规模 / PVE 评分） | `inspector/OverviewTab.tsx` | `OverviewTab` | props: `report, ov, pve` |
| L566–L634 | `tab === 'speed' && speed` 整段 JSX（满速 / 散件 TOP5 / PVP 套件 / 清单） | `inspector/SpeedTab.tsx` | `SpeedTab` | props: `speed`（非空） |
| L636–L717 | `tab === 'pve'` 整段 JSX（21 组组合 / 高评分件数） | `inspector/PveTab.tsx` | `PveTab` | props: `pve, pveJob, pveRunning, pveResult, onRun` |
| L719–L853 | `tab === 'hero' && heroSkills` 整段 JSX（统计 / 未达标 / 多号机 / 联动 / 全部技能） | `inspector/HeroTab.tsx` | `HeroTab` | 体量 161 行 ≤250，未再拆 `HeroSections.tsx`；props: `heroSkills, heroGroups, heroQuery, heroRarity` + 2 setter |
| L855–L922 | `tab === 'relics'` 整段 JSX（御魂库存筛选 + 结果） | `inspector/RelicsTab.tsx` | `RelicsTab` | props: 3 状态 + 3 setter + `onFilter` |
| L924–L1009 | `tab === 'calc'` 整段 JSX（御魂计算器） | `inspector/CalcTab.tsx` | `CalcTab` | props: `meta` + 7 状态/setter + `calcJob, calcRunning, calcResult, onRun` |

## 2. 共享常量与工具

| 原行号区间 | 原内容 | 新位置 |
|---|---|---|
| L27–L35 | `TABS`、`TabKey` | `inspector/constants.ts` |
| L37–L50 | `METRIC_LABELS` | `inspector/constants.ts` |
| L52–L61 | `fmt`、`fmtInt`、`numText` | `inspector/helpers.tsx` |
| L63–L71 | `parseCbgInput` | `inspector/helpers.tsx` |
| L73–L81 | `pollJob` | `inspector/helpers.tsx` |
| L83–L103 | `CellTable`（新增具名 `CellTableProps` 接口，行为不变） | `inspector/helpers.tsx` |

## 3. 留在页面壳 `InspectorReport.tsx` 的部分（不迁移）

| 原行号区间 | 内容 | 说明 |
|---|---|---|
| L1–L25 | import + 模块说明注释 | import 按新路径调整；注释保留 |
| L105–L246 | 全部 `useState` / `useRef` / `useCallback` / `useEffect` | 状态与副作用**原样保留**，依赖数组不变 |
| L147–L162 | `loadReport` | 留存 |
| L164–L171 | `run` | 留存 |
| L173–L188 | `runDemo` | 留存 |
| L190–L204 | meta 加载 effect | 留存 |
| L206–L224 | 深链 effect | 留存 |
| L226–L241 | `reloadRelics` | 留存（作为 `onFilter` 下传） |
| L243–L246 | relics 自动加载 effect | 留存 |
| L248–L273 | `runCalc` | 留存（作为 `onRun` 下传） |
| L275–L291 | `runPve` | 留存（作为 `onRun` 下传，支持 `refresh` 参数） |
| L293–L317 | 派生值 `ov/speed/pve/heroSkills`、`heroGroups`(useMemo)、`sourceText` | 留存；按计划 Q5 在壳中计算后下传 |
| L319–L372 | 顶层 `app-shell`、header、看号输入卡 | JSX 原样保留 |
| L374–L419 | 概览摘要卡（chips + Tab 切换条） | JSX 原样保留 |
| L421/566/636/719/855/924 | 六个 `tab === 'xxx'` 守卫 | 守卫保留在壳中，内部渲染对应 Tab 组件 |

## 4. 新增的非视觉结构性改动（说明）

- 页面壳通过 `tab === 'x' && <XxxTab .../>` 渲染，守卫条件与原文件一致（`speed`、`heroSkills` 的非空守卫在壳内）。
- `PveTab` 的 `onRun` 以 `(refresh) => void runPve(refresh)` 包装：原文件 `runPve()` 无参调用时 `refresh` 默认为 `false`，包装后语义一致。
- `PveResult` 类型由 `PveTab.tsx` 导出，供页面壳 `useState` 使用（原为内联类型，结构完全相同）。
- 页面壳不再直接 import `type InspectorReport` 的 `SpeedCell`、`JobState` 之外的类型；`SpeedCell` 仅由 `helpers.tsx` 使用。

## 5. 未达标项

- **页面壳行数 413 > 250**（R4）：计划要求“保留全部 hook/handler/effect 在页面壳”，而这部分代码本身约 246 行，加上保留的 header/输入卡/摘要卡 JSX（约 167 行），在不迁移 hook、不改语义的前提下**无法压到 250 行以内**。详见 `delivery-report.md` 偏差条目。所有新增 Tab/工具文件均 ≤250（最大 `HeroTab.tsx` 161 行）。
