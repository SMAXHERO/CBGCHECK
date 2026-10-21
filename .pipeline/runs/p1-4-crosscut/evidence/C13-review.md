# C13 终审评审（模型 A，独立复核）

- 评审对象：P1-4 横切收敛（plan v1，B 交付）
- 评审时间：2026-10-21 21:53（Asia/Shanghai）
- 评审方法：独立复跑命令 + 以改造前快照（`evidence/baseline/`，sha256 已核）为基线逐 diff 对照；未修改任何实现文件。

## 1. 独立复跑结果

| 项 | 命令 | 结果 | 备注 |
|---|---|---|---|
| 类型检查 | `npx tsc -p tsconfig.app.json --noEmit` 与 `tsconfig.node.json --noEmit` | exit 0 | `npx tsc -b` 在本沙箱因写 `node_modules/.tmp/tsbuildinfo` 报 EPERM（即使一次性提权仍失败），属**环境问题**，已用 `--noEmit` 等价替代验证类型 |
| 单测 | `npx vitest run`（提权一次） | exit 0，**7 files / 176 passed（0 failed）** | 171 原用例 + ModuleHeader 5 用例 = 176，符合预期。沙箱下会 `esbuild spawn EPERM`，提权后正常 |
| 生产构建 | `npx vite build`（提权一次） | exit 0，built in 7.29s | |
| C5 | grep `app-header`（pages+DashboardLayout，排除 ModuleHeader） | 0 | PASS |
| C6 | grep `icon-btn` | 0 | PASS |
| C7 | 四入口 `<ModuleHeader` 计数 | 各 1 | PASS；Dashboard 另有 3 次 minimal 调用（Q6 允许） |
| C8 | `check-classnames.mjs` | `CLASSNAME_FIDELITY_OK` | PASS（见 §3 对其强度的评注） |
| C9 | grep `M13.5 9.6A5.8` | `ModuleHeader.tsx` + 测试文件 | PASS（测试文件仅以 `not.toContain` 形式引用该串，无实质影响） |
| C10 | grep 导出直接调用于 Dashboard | 0 | PASS |
| C11 | `check-forbidden.mjs` | `FORBIDDEN_UNTOUCHED_OK files=15` | PASS；已核对 api/*、store、index.css、vite.config.mjs 的 sha256 与 `forbidden-tree.sha256` **完全一致** |
| C12 | `check-minimal-guard.mjs` | `MINIMAL_GUARD_OK` | PASS |

## 2. 保真审查（逐调用点，以改造前快照为基线）

**ModuleHeader 结构层序**（`h1 → pill-tag → ModuleTabs → status-pill → search-wrap-head → head-meta → 主题按钮`，chips 在 `head-in` 外）与改造前 DashboardLayout 逐行一致。

| 调用点 | 改造前 | 改造后 | 结论 |
|---|---|---|---|
| DashboardLayout（svg） | header>head-in 内：h1, pill, ModuleTabs, status-pill, search, head-meta, 主题按钮；chips 在 head-in 外 | ModuleHeader svg 模式，同序；statusNode/conditionSearch/meta/chipsNode 原样注入 | 保真 ✅ |
| AccountScore（text） | h1, pill(阴阳师·角色), ModuleTabs, head-meta(数据源…), 文本主题按钮 aria="切换主题" | 同序；meta 为模板串，运行时文本相同 | 保真 ✅ |
| SoulReport（text） | h1, pill(阴阳师·御魂), ModuleTabs, head-meta(模块三…), 文本按钮 | 同 | 保真 ✅ |
| InspectorReport（text） | h1, pill(阴阳师·看号), ModuleTabs, head-meta(模块四…), 文本按钮 | 同 | 保真 ✅ |
| Dashboard 守卫 ×3（minimal） | `header.app-header > div.head-in > h1 + pill(实时模式)` | `ModuleHeader minimal` 渲染相同 DOM（无 tabs/按钮） | 保真 ✅ |

**文本主题按钮**：`title` 动态、`aria-label` 固定 `切换主题`、子节点 `☀`/`🌙` 与原版一致 ✅
**SVG 主题按钮**：`title`/`aria-label` 动态（`切换到浅色/深色主题`），两段 SVG 路径/属性与原 DashboardLayout 逐字一致 ✅

**行为副作用检查**：页面 `useTheme()` 调用已从三个模块页删除。baseline 的 `theme/toggle` 仅服务于被替换的头部按钮（diff 显示只删了该处使用），tsc 通过，无遗留引用 ✅。DashboardLayout 的快捷键 `useEffect`、footer、`aria-busy`、`sr-only` 区域**均在改造前 baseline 中已存在**（diff 仅显示 header 段变化），不是本轮引入 ✅。

**结论：未发现「为收敛而顺带改行为」**——无默认参数变化、无事件语义变化、chips 渲染条件（`conditions.length > 0`）保持、搜索框条件渲染保持。

## 3. StatusBlock / 空态加载态（保真）

- `StatusBlock`：仅新增可选 `className`，默认 `rootClass = 'state-box'`，role/aria-live 逻辑不变 ✅
- Dashboard 中既有 StatusBlock 调用点未被改动（Dashboard diff 只有 header 与 export 两段）✅
- AccountScore `.score-loading` / SoulReport `.soul-empty`×2 / FilterPanel `.state-box`：**未替换**，与 refactor-map「不做」一致，理由（DOM/类名不等价）成立 ✅（按保真优先，接受该决定）

## 4. useExport 语义对照（HEAD/baseline Dashboard 内联 vs hook）

| 维度 | 改造前 | 改造后 | 结论 |
|---|---|---|---|
| 禁用条件 | `exportDisabled = live.rows.length === 0` | `disabled = rows.length === 0`（传入 `live.rows`） | 等价 ✅ |
| Excel | `exportExcel(live.rows, listingExportColumns)` | `exportExcel(rows, columns)`，columns=`listingExportColumns` | 等价 ✅ |
| CSV | `exportCsv(live.rows, listingExportColumns)` | 同上 | 等价 ✅ |
| 打印 | `printArea('print-area','藏宝阁筛选结果')` | `printArea(printAreaId, printTitle)`，参数同值 | 等价 ✅ |
| 文件名 | utils/export.ts 默认参数 | 未改 utils/export.ts，仍由其生成 | 不变 ✅ |
| 调用顺序 | 点击即调用 | 点击即调用（useCallback 包裹，无额外异步） | 等价 ✅ |
| 依赖数组 | 无（内联闭包每次渲染新建） | `useCallback([rows, columns])` / `[printAreaId, printTitle]` | 语义等价；`rows` 变化时回调重建，`columns` 为模块常量，行为不变 ✅ |

Dashboard 中三个按钮的 `disabled={exportDisabled}` 仍绑定 `exporter.disabled`，行为一致 ✅。

## 5. 测试质量（ModuleHeader.test.tsx，5 用例）

- 使用 `renderToStaticMarkup` + `MemoryRouter`，**未引入 jsdom / @testing-library**（已核 package.json：本轮 diff 中仅 vitest/@vitest/coverage-v8 与 test 脚本，见 §6 注）✅
- 断言具体：minimal 不含 `mod-tabs`/`icon-btn`；text 的 `aria-label="切换主题"` + `☀|🌙` 正则；svg 无固定 aria 且含 `<svg`；chips 位置（`indexOf` 序）；可选节点缺省不渲染。**非空断言**，能在结构错位时失败 ✅
- 评注（非阻断）：chips 位置断言用 `search-wrap-head` 作为锚点，`headInClose` 变量名与语义（实为"搜索框位置"）不完全对应，属命名瑕疵。
- 评注（非阻断）：未覆盖 `themeVariant` 的点击 toggle 行为，但原本亦无该类测试，可接受。

## 6. 禁止项与依赖（git 视角）

- `package.json`：有 diff，但**不是本轮 B 引入**——其 mtime 为 21:37（早于 B 执行的 21:50），且含 vitest/@vitest/coverage-v8 依赖与 test 脚本，属于前序（测试基建）改动；B 的 changed-files 也列出了 `M cbg-web/package.json`。B 本轮未新增依赖、未 `npm install` ✅（需注意：该 diff 的依赖变更对本轮是既成事实，不是本轮的违规。）
- `src/index.css`、`src/api/*`、`src/store/*`、`vite.config.mjs`：sha256 与 baseline 完全一致，**本轮未改** ✅（`git diff HEAD` 显示的大量差异为前序未提交工作，与本轮无关。）
- `vitest.config.ts`：untracked 新文件（B7 include 扩展），属测试基建，非禁止路径 ✅

## 7. 发现的问题（按严重度）

| 严重度 | 问题 | 归因 | 是否阻断 |
|---|---|---|---|
| — | 无行为/视觉改动、无收敛不彻底的阻断性问题 | — | — |
| 低 | C8 脚本只比对 className 集合与静态文案片段，**不校验结构层序**；层序由本评审人工 diff 确认，但未形成机器检查。建议后续加 `renderToStaticMarkup` 快照。 | impl（脚本强度） | 否（遗留） |
| 低 | C9 验收文义「只出现在 ModuleHeader.tsx」，实际测试文件也含该串（`not.toContain` 断言）。字面不完全符合，语义无影响。 | spec（验收措辞） | 否（遗留） |
| 低 | 测试变量名 `headInClose` 与语义不符（指向搜索框）。 | impl（命名） | 否（遗留） |
| 低 | `StatusBlock.className` 当前无调用方（预留 API，B 自述）。 | impl（预留） | 否（遗留） |
| 低 | `FilterPanel.tsx` 含 role/aria/键盘改动（无障碍）且未在本轮 plan 范围内——但经 baseline 核实它**不在本轮 diff 中**（非 B 引入，属前序未提交工作）。应由 Lead 确认归属，不计入本轮。 | env/归属 | 否 |
| 环境 | `npx tsc -b` 在沙箱因写 tsbuildinfo EPERM（提权仍失败）；vitest/vite build 需提权。用 `--noEmit` 等价验证类型。 | env | 否 |

## 8. 遗留项（不阻断）

1. 浏览器端视觉回归未做（B 已自述），建议在 `pnpm run dev` 下人工点四个模块顶部栏与主题切换。
2. C8 建议升级为真实渲染快照比对（结构层序机器化）。
3. 未 commit / push（符合要求）。
4. `tsc -b` 的 tsbuildinfo 写入问题应在可写环境下复跑确认（本次以 `--noEmit` 等价）。

## 9. 结论

- 所有验收检查（C1–C12）独立复跑通过；类型、单测（176）、构建均通过。
- 保真审查：ModuleHeader 三种模式在层序、className、文案、aria、title 上与改造前逐一一致；useExport 语义与原内联逻辑等价；StatusBlock 默认输出不变。
- 未发现顺带改行为；禁止路径未改。
- **判定：pass = true，attribution = none。** 上述低严重度问题均为遗留/命名/脚本强度，不阻断。
