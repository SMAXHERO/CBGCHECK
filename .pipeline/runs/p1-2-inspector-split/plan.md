# 执行计划 v1

- 计划版本：v2（由 v1 升版，见第 11 节变更记录）
- 冻结时间：2026-10-21T21:10:00+08:00
- 作者：模型 A（route: 当前会话 lead）
- 执行者：模型 B（route: 待指派，建议 teammate）

## 1. 目标与非目标

### 目标（可验证）

1. 把 `cbg-web/src/pages/InspectorReport.tsx`（1015 行）拆分为「页面壳 + 6 个 Tab 视图组件 + 共享工具」，页面主文件 ≤ 450 行（v2 修订，见第 11 节），每个新文件 ≤ 250 行。
2. **纯结构重构，只搬家不改行为**：JSX 结构、class 名、文案、数据流、请求次数与时序、组件挂载顺序均与改造前一致。
3. 所有 `useState` / `useEffect` / `useCallback` / `useMemo` / `useRef` 以及请求函数（`loadReport`、`run`、`runDemo`、`reloadRelics`、`runCalc`、`runPve`、`pollJob`）**保留在页面壳 `InspectorReport.tsx` 中**，不迁移，确保副作用顺序与依赖数组不变。
4. 各 Tab 视图为纯展示组件：通过**显式 props 类型**接收数据与回调，不自行发起请求、不新增状态（仅允许视图内部的纯 UI 派生，且需在 refactor-map 中注明）。
5. 保持 `export const InspectorReport = () => {...}` 具名导出、无 props 调用方式不变；`App.tsx` 不改。
6. 产出拆分映射证据 `.pipeline/evidence/refactor-map.md`：原文件行号区间 → 新文件/组件的一一对应。

### 非目标 / 明确不做

1. 不改视觉、交互、文案、class 名（全局 `src/index.css` 依赖这些类名）。
2. 不修改 `cbg-web/src/api/`、`cbg-web/src/index.css`、`cbg-web/src/store/`、`cbg-web/src/utils/`、`cbg-web/src/components/`、`cbg-web/src/App.tsx`、`cbg-web/package.json`（及 lock 文件）。
3. 不新增任何依赖；不引入新的全局状态（不加 context / zustand store）。
4. 不新建 `index.ts` 桶文件。
5. 不 git commit / git push；不修改 `.pipeline/templates/`；不修改其它 Dashboard / AccountScore / SoulReport 页面。
6. 不改 `tools/`、`docs/`、`README.md` 等仓库其它部分。
7. 不做“顺手优化”（如合并重复表格、抽取 PVE/CALC 的 `pollJob` 逻辑、修复已知小问题）——这些属于另一轮需求。

## 2. 输入

| 编号 | 类型 | 路径/来源 | 说明 |
|---|---|---|---|
| I1 | code | `D:\deepseek_work\github-work\cbg-web\src\pages\InspectorReport.tsx` | 待拆分的原文件，1015 行，改造前需先备份副本到 `.pipeline/evidence/InspectorReport.orig.tsx` 用于 diff 对比 |
| I2 | code | `D:\deepseek_work\github-work\cbg-web\src\api\inspector.ts` | 只读：确认类型 `CalcResult`、`InspectorMeta`、`InspectorReport`、`JobState`、`RelicList`、`SpeedCell` 的导出 |
| I3 | code | `D:\deepseek_work\github-work\cbg-web\src\components\ModuleTabs.tsx`、`src\hooks\useTheme.ts` | 只读：页面壳继续导入使用，不改 |
| I4 | doc | `D:\deepseek_work\github-work\.pipeline\templates\plan-template.md`、`acceptance.schema.json`、`artifact-profiles.md` | 产出格式约束 |
| I5 | config | `D:\deepseek_work\github-work\cbg-web\tsconfig*.json`、`vite.config.ts` | 只读：确认 `@/` 路径别名与严格模式 |

## 3. 产物清单

| 编号 | 路径 | artifact_type | 说明 |
|---|---|---|---|
| A1 | `D:\deepseek_work\github-work\cbg-web\src\pages\InspectorReport.tsx` | code | 页面壳（改造）：保留全部 state/effect/handler、header、看号输入卡、概览头部卡、Tab 切换条，并按 `tab` 渲染子视图组件；≤ 450 行（v2） |
| A2 | `D:\deepseek_work\github-work\cbg-web\src\pages\inspector\constants.ts` | code | 抽出 `TABS`、`TabKey`、`METRIC_LABELS` 常量与类型；≤ 250 行 |
| A3 | `D:\deepseek_work\github-work\cbg-web\src\pages\inspector\helpers.tsx` | code | 抽出纯函数 `fmt`、`fmtInt`、`numText`、`parseCbgInput`、`pollJob`、`CellTable` 组件（含其 props 类型）；≤ 250 行 |
| A4 | `D:\deepseek_work\github-work\cbg-web\src\pages\inspector\OverviewTab.tsx` | code | 对应 `tab === 'overview'` 的整段 JSX（原 ~L434-L578）；≤ 250 行 |
| A5 | `D:\deepseek_work\github-work\cbg-web\src\pages\inspector\SpeedTab.tsx` | code | 对应 `tab === 'speed'` 的整段 JSX（原 ~L580-L668）；≤ 250 行 |
| A6 | `D:\deepseek_work\github-work\cbg-web\src\pages\inspector\PveTab.tsx` | code | 对应 `tab === 'pve'` 的整段 JSX（原 ~L670-L767）；≤ 250 行 |
| A7 | `D:\deepseek_work\github-work\cbg-web\src\pages\inspector\HeroTab.tsx` | code | 对应 `tab === 'hero'` 的整段 JSX（原 ~L769-L928）；≤ 250 行；如超限则按「未达标/多号机/联动」再拆 `HeroSections.tsx`，并在 refactor-map 注明 |
| A8 | `D:\deepseek_work\github-work\cbg-web\src\pages\inspector\RelicsTab.tsx` | code | 对应 `tab === 'relics'` 的整段 JSX（原 ~L930-L985）；≤ 250 行 |
| A9 | `D:\deepseek_work\github-work\cbg-web\src\pages\inspector\CalcTab.tsx` | code | 对应 `tab === 'calc'` 的整段 JSX（原 ~L987-L1088 之前的 calc 段）；≤ 250 行 |
| A10 | `D:\deepseek_work\github-work\.pipeline\evidence\refactor-map.md` | doc | 拆分映射：原文件行号区间 → 新文件/组件；列出每个搬迁块的源行号与目标位置 |
| A11 | `D:\deepseek_work\github-work\.pipeline\evidence\InspectorReport.orig.tsx` | code | 改造前原文件的完整副本（只读证据，用于 diff） |

> `artifact_type` 决定套用哪套验收档案（见 `artifact-profiles.md`）。以上全部为 code。

> 行号区间为执行者开工前以实际文件为准重新核对的参考值，若与 1015 行版本不符，以 refactor-map 中实际行号为准并在 map 中说明。

## 4. 接口与约定

- 目录结构：
  ```
  cbg-web/src/pages/
    InspectorReport.tsx          ← 页面壳（export const InspectorReport）
    inspector/
      constants.ts               ← TABS / TabKey / METRIC_LABELS
      helpers.tsx                ← fmt/fmtInt/numText/parseCbgInput/pollJob/CellTable
      OverviewTab.tsx
      SpeedTab.tsx
      PveTab.tsx
      HeroTab.tsx                ← (若超限则 + HeroSections.tsx)
      RelicsTab.tsx
      CalcTab.tsx
  ```
- 命名规范：
  - 视图组件统一 `XxxTab`，PascalCase，`export function XxxTab(props: XxxTabProps)`（或与原文件一致的 `export const` 箭头函数风格，二选一并全文统一）。
  - props 类型统一命名 `XxxTabProps`，与组件同文件导出。
  - 不使用 `default export`。
- 对外接口：
  - `pages/InspectorReport.tsx` 仅导出 `InspectorReport`（无 props）。其余新符号只在 `pages/inspector/` 内部被引用。
  - 子组件 props 要求显式类型。典型形态（执行者按实际字段补全，不得擅自改语义）：
    - `OverviewTabProps`：`{ report: InspectorReportData; ov: InspectorReportData['account']; pve: InspectorReportData['pveScores'] | undefined; speed: InspectorReportData['speed'] | undefined; sourceText: string }` 之类，**仅传纯数据**，不传 setter 之外的副作用函数。
    - `RelicsTabProps`：需传 `relics`、`relicPosition`、`relicSuits`、`relicMain` 及 `setRelicPosition/setRelicSuits/setRelicMain`、`onFilter: () => void`（即 `reloadRelics`）。
    - `CalcTabProps`：需传 `meta`、`calc*` 全部状态与 setter、`calcJob`、`calcRunning`、`calcResult`、`onRun: () => void`。
    - `PveTabProps`：需传 `pve`、`pveJob`、`pveRunning`、`pveResult`、`onRun: (refresh?: boolean) => void`。
    - `HeroTabProps`：需传 `heroSkills`（非空）、`heroGroups`、`heroQuery`、`heroRarity` 及 setter。
    - `SpeedTabProps`：需传 `speed`（非空）。
    - 回调保持原签名（`onRun` 对 PVE 仍支持 `refresh` 参数，`pollJob` 的 `setPveJob/setCalcJob` 仍由页面壳传入）。
- 数据 schema：本次不改任何 API 类型，`src/api/inspector.ts` 只读。
- 编码与格式规范：
  - TypeScript 严格模式（沿用 tsconfig），不使用 `any`；新增代码沿用现有 2 空格缩进、单引号、分号风格（与原文件一致）。
  - 注释：保留原文件所有中文注释（包括文件头 `模块四` 六标签说明块与 `/** ... */` 函数注释）；拆出的文件头需写明该 Tab 对应原文件块的说明（如“对应原页面「速度盘点」标签”）。注释风格：解释“为什么”，不写“做了什么”的废话。
  - 不改 class 名、不改 `key` 生成规则、不改 `aria-*` 与 `title` 文案。

## 5. 环境与命令

- 运行时与版本：Node 与 pnpm 沿用仓库现有环境；TypeScript ^5.7、Vite ^7、React ^19（以 `cbg-web/package.json` 为准，不得变更）。
- 依赖与安装方式：不安装任何新依赖。若需要 `node_modules` 直接沿用现有安装；禁止执行 `npm install <pkg>` / `pnpm add`。
- 构建 / 运行 / 测试命令（工作目录均为 `D:\deepseek_work\github-work\cbg-web`）：
  - 类型检查：`npx tsc -b`（退出码必须为 0）
  - 构建：`npx vite build`（退出码必须为 0）
  - 行数检查（工作目录仓库根）：`wc -l cbg-web/src/pages/InspectorReport.tsx cbg-web/src/pages/inspector/*.ts cbg-web/src/pages/inspector/*.tsx`，页面壳 ≤ 450、其余每个文件 ≤ 250
- 禁止引入的依赖或服务：任何新 npm 包、新 Python 包、新全局状态库（zustand 新 store、react-context 新 provider）。

## 6. 执行步骤

1. 复制原文件作为证据：`cp cbg-web/src/pages/InspectorReport.tsx .pipeline/evidence/InspectorReport.orig.tsx`；记录其 sha256 与行数（1015）。
2. 阅读原文件，确认 6 个 Tab 块的实际起止行号，并把区间写入 refactor-map 草稿。
3. 新建 `cbg-web/src/pages/inspector/constants.ts`：迁移 `TABS`、`TabKey`、`METRIC_LABELS`，保持内容字节级一致（值与顺序不变）。
4. 新建 `cbg-web/src/pages/inspector/helpers.tsx`：迁移 `fmt`、`fmtInt`、`numText`、`parseCbgInput`、`pollJob`、`CellTable`，保持函数体与注释不变；`CellTable` 显式声明 props 类型（已有 `{ cells: SpeedCell[] }`，保持）。
5. 逐个新建 Tab 视图组件（A4–A9）：把对应 `{tab === 'xxx' && (...)}` 的 JSX 原样搬入组件 `return`，把它依赖的状态/回调改为 props。**JSX 内部一个字符都不改**（class、文案、key、条件分支、嵌套结构）；仅把 `tab === 'xxx' && ` 这层条件留在页面壳里。
6. 改造 `InspectorReport.tsx`（A1）：删除已迁出的常量与函数、删除已迁出的 JSX，改为在原位置渲染 `{tab === 'overview' && <OverviewTab ... />}` 等。保留所有 hook 调用、effect、handler、顶层 `<div className="app-shell">`、header、看号输入卡、概览头部卡、Tab 切换按钮组，以及 `sourceText`、`heroGroups` 等派生值。
7. 检查 `hero` 与 `speed` 等 Tab 的守卫条件（如 `tab === 'speed' && speed`、`tab === 'hero' && heroSkills`）保留在页面壳中，子组件收到的 props 类型应为非空，避免在子组件里重复判空改变语义。
8. 若某 Tab 超过 250 行，按自然子块（如 HeroTab 的「未达标 / 多号机 / 联动 / 全部技能」四段）再拆出 `HeroSections.tsx` 或同类文件，并在 refactor-map 中登记。
9. 运行 `npx tsc -b`，直至退出码 0。
10. 运行 `npx vite build`，直至退出码 0。
11. 运行行数检查，确认每个新文件与页面主文件 ≤ 250。
12. 生成 `.pipeline/evidence/refactor-map.md`：以表格列出「原文件行号区间 → 新文件 / 组件 / 位置」，并注明未迁移的 hook/handler 留在页面壳的行号。
13. 运行 `git status --short`，记录结果到 `.pipeline/evidence/git-status-after.txt`，证明只改动了允许路径。
14. 对比 JSX 文本保真度（建议）：对每个 Tab 块，把原文件对应区间与新组件 JSX 去掉缩进后做字符串比对，结果记录到 `.pipeline/evidence/jsx-fidelity.txt`。
15. 不 commit、不 push。完成后汇报：产物清单、三条命令退出码、行数表、refactor-map 路径。

## 7. 验收标准

见 `acceptance.json`（需求 → 检查项追溯）。本计划冻结后，验收项只允许通过升版本修改。

核心验收概要：
- R1 纯搬家：`refactor-map.md` 存在且覆盖原文件全部 6 个 Tab 块；JSX 保真度比对输出存在。
- R2 类型与构建：`npx tsc -b` 与 `npx vite build` 均退出 0。
- R3 行数：页面主文件 ≤ 450 行（v2）；所有 inspector/ 下新文件 ≤ 250 行。
- R4 禁止路径未被触碰：`git status` 中不出现 `src/api/`、`src/index.css`、`src/store/`、`src/utils/`、`src/components/`、`src/App.tsx`、`package.json` 的改动（相对于本次开工前快照）。
- R5 无新增依赖：`package.json` 与 lock 文件 sha256 与开工前一致。
- R6 导出不变：`InspectorReport.tsx` 仍有 `export const InspectorReport`，`App.tsx` 中的引用未变。
- R7 无循环依赖：子组件不 import `InspectorReport.tsx`；`helpers` / `constants` 不 import 任何 Tab 组件。

## 8. 假设与待确认

| 编号 | 假设/问题 | 不确认时的默认处理 | 找谁确认 |
|---|---|---|---|
| Q1 | 行数上限 250 是否包含空行与注释 | 包含（wc -l 原始行数） | 用户 |
| Q2 | 子组件是否使用 `function` 声明还是沿用原文件的 `const X = () =>` 箭头风格 | 沿用原文件的 `const X = (props) =>` 箭头风格，全文统一 | 无需 |
| Q3 | HeroTab 体量是否会超 250 行 | 若超限按“未达标 / 多号机 / 联动 / 全部技能”拆出 `HeroSections.tsx`，不改语义 | 无需 |
| Q4 | 子组件是否允许接收 `setX` 形式的 setter 作为 props | 允许（仅转发状态 setter，不新增状态） | 用户 |
| Q5 | 派生值 `heroGroups`、`sourceText`、`ov/speed/pve/heroSkills` 放页面壳还是子组件 | 放页面壳计算，作为 props 下传（避免改变 useMemo 依赖与计算时机） | 无需 |
| Q6 | `wc -l` 在 Windows 下对 CRLF 行数计数是否一致 | 以 `wc -l` 为准，不做额外换算 | 无需 |
| Q7 | 仓库中 `cbg-web` 是否已存在未提交改动（git 显示 `InspectorReport.tsx` 为 M） | 执行前记录 `git diff --stat` 基线；验收只检查“本次新增的改动”不越界，已有改动不得在本次被回滚 | 用户（需确认是否要把现有 M 的改动也纳入本次 diff 审查） |

## 9. 自由度

- 必须照做：
  - 只改 A1–A9 与 A10–A11 所列路径；
  - JSX 内部不改任何字符（class 名、文案、结构、key 生成、条件分支）；
  - hook / effect / handler 全部留在页面壳，依赖数组不变；
  - 不新增依赖、不新增全局状态、不新建 index 桶文件；
  - 每个文件 ≤ 250 行。
- 可自行决定：
  - 子组件内部的局部变量命名（在不改变语义前提下）；
  - 是否为 HeroTab 额外拆出 `HeroSections.tsx`（仅在超限时）；
  - props 接口的字段组织方式（只要显式类型且不引入新状态）。
- 超出范围必须先问：
  - 任何对 JSX 文案、class、视觉的修改；
  - 把 state 或 effect 下沉到子组件；
  - 修改 `src/api/`、`src/components/`、`src/index.css` 或 `package.json`；
  - 任何 git commit / push。

## 10. A 的自检清单（冻结前逐项确认）

- [x] 每个产物都有精确路径和 `artifact_type`
- [x] 每个需求至少对应一个可执行检查项
- [x] 所有 L1/L2 检查都有命令、工作目录、期望结果、超时
- [x] 无歧义表述；歧义已列入第 8 节
- [x] 没有要求 B 做其能力范围外的事（工具 / 上下文 / 网络 / 权限）
- [x] 非功能要求（安全 / 性能 / 日志 / 许可）已写（不新增依赖、不改请求时序、不改文案）
- [x] 不可逆动作已标注需人工确认（git commit / push 明确禁止；无数据删除）

## 11. 变更记录（v1 → v2）

- 变更原因（spec 缺陷，见 `.pipeline/evidence/C8-review.md` §3）：v1 同时要求 (a) 全部 hook / effect / 请求函数 / 派生值留在页面壳（实测 1–246 行），(b) 保留 header、看号输入卡、概览摘要卡与 Tab 条 JSX（实测 247–413 行，共 167 行），而 (c) 页面主文件 ≤ 250 行。(a)+(b) 在不迁移 hook、不改 JSX 的约束下数学上不可达 250，属计划自相矛盾。
- 变更内容：仅将页面壳行数上限由 250 放宽为 450（A1、§1 目标 1、§5 行数检查、R3、R4 对应的 C6 口径）。其余约束一律不变：`inspector/` 下每个新文件 ≤ 250；hook 仍留壳；JSX 保真；禁止路径；无新依赖。
- 未放宽的项：所有 Tab 视图与工具文件仍 ≤ 250；不允许为凑行数把 hook 迁出壳（那会违反 §1 目标 3）。
- 当前实现是否满足 v2：是。页面壳 413 ≤ 450；9 个新文件最大 161 ≤ 250。**无需重新执行**，仅需按 v2 口径重新出具 C6 结论。
