# 执行计划 v1

- 计划版本：v1
- 冻结时间：2026-10-21T21:50:00+08:00
- 作者：模型 A（route: provider/model）
- 执行者：模型 B（route: provider/model）

## 1. 目标与非目标

### 目标（可验证）

1. **G1 顶部栏收敛**：新增 `cbg-web/src/components/ModuleHeader.tsx`，统一渲染 `<header className="app-header"><div className="head-in">…</div>[chips]</header>` 结构；`DashboardLayout`、`AccountScore`、`SoulReport`、`InspectorReport` 四个入口各使用一次。`pages/*.tsx` 与 `DashboardLayout.tsx` 中不再出现手写的 `className="app-header"` / `className="icon-btn"`。
2. **G2 主题切换按钮单源**：主题切换 SVG（月亮/太阳）与按钮逻辑只存在于 `ModuleHeader.tsx`（或其内部私有子组件）。
3. **G3 状态块收敛**：`StatusBlock` 支持透传 `className`（保留各页既有视觉类名）与统一 `role`/`aria-live` 语义；`Dashboard`、`AccountScore`、`SoulReport`、`FilterPanel` 中的空态/加载占位改用 `StatusBlock`，类名与文案不变。
4. **G4 导出逻辑内聚**：新增 `cbg-web/src/hooks/useExport.ts`，封装 `exportExcel` / `exportCsv` / `printArea` 的调用、禁用判断（`rows.length === 0`）与文件名生成；`Dashboard.tsx` 只调用该 hook。`exportCsv|exportExcel|printArea` 的直接调用只出现在 `utils/export.ts` 与 `hooks/useExport.ts`。
5. **G5 错误条收敛（选做，D 项）**：`AlertBar` 作为可选抽取。仅当能保持 DOM 与 className 完全不变时才做；否则在 `evidence/refactor-map.md` 中记录「不做」及理由。

### 非目标 / 明确不做

1. 不改 `cbg-web/src/index.css`（不新增类；如确需新增，必须先在 `evidence/assumptions.md` 证明无法复用现有类，并经 A 批准）。
2. 不改 `cbg-web/src/api/`、`cbg-web/src/store/`、`cbg-web/vite.config.mjs`（注：实际配置文件可能为 `vite.config.ts`，见第 8 节 Q2）。
3. 不改任何业务逻辑、接口参数、事件语义、禁用条件；不改文案。
4. 不新增运行时依赖；不执行 `npm install`。
5. 不 `git commit` / `git push`；不改 `.pipeline/templates/`。
6. 不把 `AccountScore` / `SoulReport` / `InspectorReport` 的主题按钮统一为 SVG（见第 4 节「保真约束」），视觉零变化优先于「统一」。

## 2. 输入

| 编号 | 类型 | 路径/来源 | 说明 |
|---|---|---|---|
| I1 | code | `D:\deepseek_work\github-work\cbg-web\src\components\DashboardLayout.tsx` | 顶部栏 A（含 SVG 主题图标、`.search-wrap-head`、`.chips`、服务状态灯） |
| I2 | code | `D:\deepseek_work\github-work\cbg-web\src\pages\AccountScore.tsx` (行 590–609) | 顶部栏 B（文本图标 `☀`/`🌙`，`aria-label="切换主题"`，`head-meta` 为纯文本） |
| I3 | code | `D:\deepseek_work\github-work\cbg-web\src\pages\SoulReport.tsx` (行 331–347) | 顶部栏 C（同 B 变体） |
| I4 | code | `D:\deepseek_work\github-work\cbg-web\src\pages\InspectorReport.tsx` (行 248–262) | 顶部栏 D（同 B 变体） |
| I5 | code | `D:\deepseek_work\github-work\cbg-web\src\pages\Dashboard.tsx` (行 199–296) | Dashboard 的 3 个守卫态头部（offline / need-browser / need-login；仅 `h1 + pill-tag`，无 `ModuleTabs`、无主题按钮） |
| I6 | code | `D:\deepseek_work\github-work\cbg-web\src\components\StatusBlock.tsx` | 现有状态块组件（`.state-box`） |
| I7 | code | `D:\deepseek_work\github-work\cbg-web\src\utils\export.ts` | 导出工具（Excel/CSV/打印） |
| I8 | code | `D:\deepseek_work\github-work\cbg-web\src\components\ModuleTabs.tsx` | 模块切换（被 ModuleHeader 复用，不改其 DOM） |
| I9 | code | `D:\deepseek_work\github-work\cbg-web\src\hooks\useTheme.ts` | 主题 hook（返回 `theme`、`toggle`） |
| I10 | doc | `D:\deepseek_work\github-work\.pipeline\templates\acceptance.schema.json` | 验收 schema |
| I11 | config | `D:\deepseek_work\github-work\cbg-web\vitest.config.ts`、`package.json` | 测试与构建脚本 |

**注意（Lead 复核结论，覆盖原审计）**：
- 原审计称「顶部栏重复 4 次且完全一致」——**不准确**。DashboardLayout 版本带 SVG 图标、搜索框、chips、状态灯、动态 aria-label；三个模块页是另一套文本图标变体。若强行统一为一种，会改变 DOM 与视觉，违反硬约束 1。因此 ModuleHeader 必须以**参数化**方式覆盖两种变体（见第 4 节）。
- 另有 **3 个 Dashboard 守卫态头部** 也是 `app-header`，原审计未计入。计划将其一并收敛为 ModuleHeader 的「精简模式」，使 `app-header` 的唯一写入点是 `ModuleHeader.tsx`。
- `exportCsv|exportExcel|printArea` 当前只被 `Dashboard.tsx` 引用，抽 hook 是纯搬移。

## 3. 产物清单

| 编号 | 路径 | artifact_type | 说明 |
|---|---|---|---|
| A1 | `D:\deepseek_work\github-work\cbg-web\src\components\ModuleHeader.tsx` | code | 新增：统一顶部栏（参数化：title/badge/statusNode/conditionSearch/meta/chips/themeVariant） |
| A2 | `D:\deepseek_work\github-work\cbg-web\src\components\DashboardLayout.tsx` | code | 改：顶部栏改用 ModuleHeader；其余（底部操作条、快捷键）不动 |
| A3 | `D:\deepseek_work\github-work\cbg-web\src\pages\AccountScore.tsx` | code | 改：顶部栏改用 ModuleHeader（themeVariant=text） |
| A4 | `D:\deepseek_work\github-work\cbg-web\src\pages\SoulReport.tsx` | code | 改：顶部栏改用 ModuleHeader；`.soul-empty` 空态改用 StatusBlock（保留类名） |
| A5 | `D:\deepseek_work\github-work\cbg-web\src\pages\InspectorReport.tsx` | code | 改：顶部栏改用 ModuleHeader |
| A6 | `D:\deepseek_work\github-work\cbg-web\src\pages\Dashboard.tsx` | code | 改：3 个守卫头部改用 ModuleHeader（精简模式）；导出判断改用 useExport |
| A7 | `D:\deepseek_work\github-work\cbg-web\src\components\StatusBlock.tsx` | code | 改：增加可选 `className` 透传，统一 role/aria-live 语义（不改默认渲染） |
| A8 | `D:\deepseek_work\github-work\cbg-web\src\hooks\useExport.ts` | code | 新增：导出 hook（excel/csv/print + disabled + 文件名） |
| A9 | `D:\deepseek_work\github-work\cbg-web\src\utils\export.ts` | code | 可能改：仅当需要为 hook 暴露文件名/禁用辅助函数时；默认不改 |
| A10 | `D:\deepseek_work\github-work\cbg-web\src\components\AlertBar.tsx` | code | 选做（G5）：仅当 DOM 完全保真时新增，否则不产出 |
| A11 | `D:\deepseek_work\github-work\cbg-web\src\components\__tests__\ModuleHeader.test.tsx` | code | 新增：ModuleHeader 的 DOM 快照/className 断言（若执行环境允许 jsdom 渲染；否则改为静态结构断言，见第 5 节） |
| A12 | `D:\deepseek_work\github-work\.pipeline\runs\p1-4-crosscut\evidence\refactor-map.md` | doc | 产出：重复点 → 收敛位置 → 4+3 个调用点 |
| A13 | `D:\deepseek_work\github-work\.pipeline\runs\p1-4-crosscut\evidence\dom-fidelity.md` | doc | 产出：每个调用点改造前后的 className 集合与文案集合对比 |
| A14 | `D:\deepseek_work\github-work\.pipeline\runs\p1-4-crosscut\evidence\assumptions.md` | doc | 产出：执行者遇到的假设与默认处理 |

> 说明：A1、A8、A11、A12–A14 为新增；其余为修改。A10 为条件产出。

## 4. 接口与约定

- **目录结构**：新组件放 `cbg-web/src/components/`，新 hook 放 `cbg-web/src/hooks/`，测试放 `__tests__/`（与现有 `utils/__tests__/` 风格一致）。
- **命名规范**：组件 PascalCase；hook `useXxx`；文件名与导出名一致。

### ModuleHeader 接口（A1）

```ts
interface ModuleHeaderProps {
  title: string;                    // 恒为 '藏宝阁数据面板'（保持现状，不参数化文案）
  badge?: string;                   // 对应 <span className="pill-tag">
  statusNode?: ReactNode;           // 仅 Dashboard 传入：状态灯 <span className="status-pill">…
  conditionSearch?: { value: string; onChange: (v: string) => void }; // 仅 Dashboard
  meta?: ReactNode;                 // 对应 <span className="head-meta">；模块页传纯文本
  chipsNode?: ReactNode;            // 仅 Dashboard：条件 chips（<div className="chips">）
  themeVariant: 'svg' | 'text';     // 'svg' = DashboardLayout 版；'text' = 三个模块页版
  // 内部 ModuleTabs 固定渲染，不参数化
}
```

- **保真约束（硬）**：
  - `themeVariant='svg'`：主题按钮 `className="icon-btn"`，`title`/`aria-label` 为动态文案（随 theme 变化），SVG 路径与属性逐字保留。
  - `themeVariant='text'`：主题按钮 `className="icon-btn"`，`title` 为动态文案，**`aria-label` 固定为 `"切换主题"`**，子节点为文本 `☀` / `🌙`（保留原样，含 emoji）。
  - `head-in` 内子节点顺序：`h1` → `pill-tag`（可选）→ `ModuleTabs` → `status-pill`（可选）→ `search-wrap-head`（可选）→ `head-meta`（可选）→ 主题按钮。注意：模块页没有 `status-pill`/搜索框，且 `head-meta` 在 DOM 中位于 ModuleTabs 之后——顺序必须与原版逐一一致。
  - `chips` 位于 `head-in` **外部**、`header` 内部，与原版一致。
  - Dashboard 守卫态（offline/need-browser/need-login）：仅渲染 `h1` + `pill-tag`，**不渲染** `ModuleTabs` 与主题按钮。ModuleHeader 需支持 `minimal` 布尔开关（或由调用方省略 themeVariant 时不渲染按钮与 tabs）以保真。**此为 ModuleHeader 的第三种模式，需在 dom-fidelity.md 逐条记录**。
- **`StatusBlock` 扩展（A7）**：新增可选 `className?: string`，拼接到根节点 className 末尾；默认不传时 DOM 与现状完全一致。`role`/`aria-live` 语义保持现有实现（loading=status+polite，非 loading=note）。模块页的 `.soul-empty` / `.score-loading` 改用 StatusBlock 时，**必须保留其原 className**，若 StatusBlock 外层 class 与原版不同则需以 `className` 参数覆盖根类（执行者必须在 dom-fidelity.md 证明；若无法在不改视觉前提下替换，则保持原样并记入 refactor-map「不做」）。
- **`useExport` 接口（A8）**：

```ts
interface UseExportOptions<T> {
  rows: T[];
  columns: ExportColumn<T>[];
  printAreaId: string;  // 'print-area'
  printTitle: string;   // '藏宝阁筛选结果'
}
// 返回 { exportExcel(): void; exportCsv(): void; print(): void; disabled: boolean }
// disabled = rows.length === 0（与 Dashboard 现有 exportDisabled 完全一致）
```
  - 文件名仍由 `utils/export.ts` 的默认参数生成（不改变文件名规则）。
- **编码与格式**：遵循现有代码风格（单引号、分号、2 空格缩进、中文注释）；不引入新 lint 规则。

## 5. 环境与命令

- 运行时：Node v24.16.0；仓库根 `D:\deepseek_work\github-work`；前端工程 `D:\deepseek_work\github-work\cbg-web`。
- 依赖：已安装，**禁止 `npm install`**。
- 构建/类型：`cd D:\deepseek_work\github-work\cbg-web && npx tsc -b`、`npx vite build`。
- 测试：`cd D:\deepseek_work\github-work\cbg-web && npx vitest run`（期望 171 passed，0 failed）。
- **已知环境阻塞（Lead 已实测）**：在本会话的沙箱中，`vitest` 启动 worker 时报 `EPERM spawn`，`npx vitest run` 无法完成。执行者须：
  1. 首先尝试在**可 spawn 子进程的环境**（非沙箱或提权一次性审批）运行测试；
  2. 若仍 EPERM，则在 `evidence/assumptions.md` 记录该阻塞与时间戳，**不得伪造通过结果**；测试项状态记为 `manual`（见 acceptance.json passCriteria），由 Lead 在可运行环境复跑。
- 禁止引入的依赖或服务：不新增任何 npm 包；不引入 CSS-in-JS；不引入新的测试框架（jsdom/@testing-library 若未安装则不得使用，A11 改为静态结构断言或 `react-dom/server` 的 `renderToStaticMarkup`，后者须确认已存在于依赖树）。

## 6. 执行步骤

1. **建立基线**：记录 `git -C D:\deepseek_work\github-work status --short`（工作区已有大量未提交修改，执行者不得回退或 stash 他人改动）；对以下文件计算 sha256 作为改造前快照，写入 `evidence/dom-fidelity.md` 附录：`DashboardLayout.tsx`、`AccountScore.tsx`、`SoulReport.tsx`、`InspectorReport.tsx`、`Dashboard.tsx`、`StatusBlock.tsx`。
2. **抽取 ModuleHeader（A1）**：按第 4 节接口实现三种模式（svg / text / minimal）。
3. **替换 4+3 个调用点（A2、A3、A4、A5、A6）**：逐个替换；每替换一处，在 `dom-fidelity.md` 记录该处改造前后 className 集合与文案集合（用 `renderToStaticMarkup` 或静态抽取比对）。
4. **StatusBlock 扩展（A7）并替换空/加载块**：Dashboard 的 3 处已用 StatusBlock，保持不变；AccountScore 的 `.score-loading`、SoulReport 的 `.soul-empty`（2 处）、FilterPanel 的 `.state-box`（1 处）评估是否可替换；**不可保真则不替换**，记入 refactor-map。
5. **抽取 useExport（A8）**，Dashboard 改为调用 hook；`exportCsv|exportExcel|printArea` 的直接引用移出 Dashboard。
6. **（选做）AlertBar（A10）**：仅当 `.score-need.score-error` 与 `.soul-alert.err` 能用同一组件在不改 className 的前提下输出时才实施；否则跳过并记录。
7. **测试（A11）**：新增 ModuleHeader 结构测试；运行 `npx vitest run`，记录结果。
8. **类型与构建**：`npx tsc -b` 与 `npx vite build` 必须通过。
9. **收敛指标自检**（见 acceptance.json C6–C9）。
10. **产出证据**：`evidence/refactor-map.md`、`evidence/dom-fidelity.md`、`evidence/assumptions.md`。
11. **不 commit、不 push**；将改动文件清单写入 `evidence/changed-files.txt`（`git status --short` 输出）。

## 7. 验收标准

见 `acceptance.json`（需求 → 检查项追溯）。本计划冻结后，验收项只允许通过升版本（v2）修改。

## 8. 假设与待确认

| 编号 | 假设/问题 | 不确认时的默认处理 | 找谁确认 |
|---|---|---|---|
| Q1 | 三个模块页的主题按钮是否应统一为 SVG 图标？ | **不统一**：保留文本图标（`☀`/`🌙`），保证视觉零变化；统一属于视觉改动，超出本轮范围 | 产品 / Lead |
| Q2 | 「vite.config.mjs」在仓库中可能实为 `vite.config.ts`，且当前工作区有未提交修改 | 以文件实际存在为准；只要不修改该文件即满足约束 | Lead |
| Q3 | 171 个测试在本沙箱因 `EPERM spawn` 无法运行 | 记为 `manual`，执行者在可运行环境跑；Lead 复跑确认 | Lead |
| Q4 | 工作区已有大量未提交修改（README、api、store 相关文件已 M） | 执行者只在上述 A1–A14 范围内改动，不回退他人改动；验收比较以「改造前快照」为基线 | Lead |
| Q5 | `AlertBar`（G5）是否必须交付？ | **选做**：仅在 DOM 保真时交付，否则记入 refactor-map 为「不做」，不算验收失败 | Lead |
| Q6 | Dashboard 守卫态的精简头部是否纳入 ModuleHeader？ | **纳入**（minimal 模式），使 `app-header` 唯一写入点为 ModuleHeader；若执行者证明无法保真，允许保留并在收敛指标中豁免 | Lead |
| Q7 | 是否允许为 ModuleHeader 测试引入 jsdom / @testing-library | **不允许新增依赖**；用 `react-dom/server` 静态渲染（若依赖树已有）或纯结构断言 | Lead |

## 9. 自由度

- **必须照做**：
  - 所有 `className`、文案、`role`、`aria-*`、`title` 与改造前逐字一致（`dom-fidelity.md` 为证）；
  - 不改 `index.css`、`api/`、`store/`、`vite.config.*`；
  - 不引入新依赖、不 `npm install`、不 commit/push；
  - 不改 `.pipeline/templates/`。
- **可自行决定**：
  - ModuleHeader 内部实现细节（子组件拆分、是否用 `React.memo`），只要 DOM 输出不变；
  - useExport 的内部实现（是否 `useCallback`），只要返回接口一致；
  - 是否把 `statusNode` 做成专用子组件；
  - 测试的具体写法（在第 5 节约束内）。
- **超出范围必须先问（写入 assumptions.md 并停止该子项，不得擅自扩大）**：
  - 修改 `index.css` 或新增 CSS 类；
  - 统一三个模块页的主题图标样式（视觉变化）；
  - 修改任何业务逻辑、接口、文案；
  - 触碰 `api/`、`store/`、`vite.config.*`；
  - 新增 npm 依赖。

## 10. A 的自检清单（冻结前逐项确认）

- [x] 每个产物都有精确路径和 `artifact_type`
- [x] 每个需求至少对应一个可执行检查项（见 acceptance.json requirements 追溯）
- [x] 所有 L1/L2 检查都有命令、工作目录、期望结果、超时
- [x] 无歧义表述；歧义已列入第 8 节（Q1–Q7）
- [x] 没有要求 B 做其能力范围外的事（B 无需网络；vitest EPERM 已列为环境阻塞并给出降级路径）
- [x] 非功能要求（安全 / 性能 / 日志 / 许可）已写（无新依赖、无网络、导出逻辑不变）
- [x] 不可逆动作已标注需人工确认（commit/push 明确禁止；无删除操作）
