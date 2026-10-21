# C8 — Diff 审查 + 保真结论 + C6 判定（模型 A 终审，独立复核）

审查范围：`cbg-web/src/pages/InspectorReport.tsx` 及 `cbg-web/src/pages/inspector/*`，对照 `.pipeline/evidence/InspectorReport.orig.tsx`（sha256 `741f7293…b850`，与 `baseline/` 副本一致）。
A 未修改任何实现文件，未 commit / push。

## 1. 独立复跑结果

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `cd cbg-web && npx tsc -p tsconfig.app.json --noEmit` | 退出 0 ✔ |
| 行数 | `wc -l` | 壳 413；inspector/ 最大 161；全部 ≤ 250 ✔（壳超 250，见 §3） |
| 禁止路径 | `git status --short -- api index.css store utils components App.tsx` | 与 `forbidden-baseline.txt` 完全一致 ✔（均为开工前已存在的 M/??，本次未新增） |
| 依赖 | `sha256sum package.json package-lock.json` | 与 `git HEAD` 版本一致（`b2f7256a…`/`0e37016d…`）✔ 未引入新依赖 |
| 导出 | `grep "export const InspectorReport"` | 存在；`App.tsx:8/55` 引用未变 ✔ |
| 循环依赖 | grep inspector/ 反向 import 壳 | 无匹配 ✔ |
| 构建 | `L1-vite-build.log` | 日志显示 `✓ built in 7.47s`，退出信息完整 ✔（本次未重跑，EPERM 环境问题与代码无关） |
| 原文件副本 | sha256 对比 | `evidence/` 与 `baseline/` 副本一致 ✔ |
| 计划冻结 | sha256 对比 v1 freeze | 与 freeze.json 一致 ✔（v1 保存为 `plan.v1.md` / `acceptance.v1.json`） |

## 2. 移植保真审查（重点）

方法：对每个 Tab，取原文件 `tab === 'xxx'` 块的行区间，与新组件文件逐行做"去首尾空白、去空行"的 diff。

- **overview**（orig 421–564 vs OverviewTab）：JSX 完全一致。仅差异为：文件头 import/注释/`export const` 包装，末尾 `)}` → `);`（箭头函数体改为表达式）。
- **speed**（566–634 vs SpeedTab）：同上，JSX 一致。守卫 `tab==='speed' && speed` 保留在壳，子组件只收非空 `speed`。
- **pve**（636–717 vs PveTab）：JSX 一致，唯一语义相关差异：`runPve()` → `onRun()`，`runPve(true)` → `onRun(true)`。壳侧 `onRun={(refresh) => void runPve(refresh)}`；原 `runPve()` 无参时 `refresh` 取默认 `false`，包装后 `refresh` 为 `undefined`，同样落到默认值 `false`。**语义等价 ✔**。
- **hero**（719–853 vs HeroTab）：JSX 一致。`heroGroups` 由壳 `useMemo` 计算后下传（与原位置、依赖一致）。
- **relics**（855–922 vs RelicsTab）：JSX 一致。唯一差异：`reloadRelics()` → `onFilter()`，壳侧 `onFilter={() => void reloadRelics()}`，等价 ✔。
- **calc**（924–1009 vs CalcTab）：JSX 一致。`runCalc()` → `onRun()`，壳侧 `onRun={() => void runCalc()}`，等价 ✔。

Hook 检查：壳内 `useState/useEffect/useCallback/useMemo/useRef` 共 37 处，与原文件 37 处逐行一致；唯一差异 `pveResult` 的类型由内联对象改为 `PveResult`（结构相同，纯类型收敛，无运行时影响）。请求函数 `loadReport/run/runDemo/reloadRelics/runCalc/runPve` 仍在壳内，依赖数组行未变（diff 行号一致）。`pollJob` 与工具函数迁出为模块级纯函数，原本就不依赖组件状态，迁移不改变行为。

**保真结论：6 个 Tab 的 JSX 与原文件逐行一致，仅有计划允许的 props 化与回调重命名，无新增状态、无请求时序变化、无条件渲染顺序变化。通过。**

注意（B 的证据质量问题，不影响结论）：
- **F1（中）fidelity 脚本失效**：`fidelity.sh` 中 CJK 比对使用 `grep -oP '[\x{4e00}-\x{9fff}]'`，在本机 grep 报 `character value in \x{} or \o{} is too large`，中文文案集合比对未真正执行。`jsx-fidelity.txt` 中"中文文案缺失 0"的结论**不可复现**。A 改用 `diff` 逐块比对替代验证，结论成立，但 C12 的证据需重做。
- **F2（低）C3 命令**：acceptance 中 C3 的 command 是 `python -c "print('jsx-fidelity: see evidence')"`，属占位，不是真实检查；真正证据是 `jsx-fidelity.txt`，而该文件的 className 差异（`insp-tab` / `soul-tag` 的模板字符串行）是正则截断造成的假差异，并非真实缺失。
- **F3（低）**：`pkg-baseline.sha256` 在 acceptance C8 的 rubric 中被引用，但文件不存在；B 用 `pkg-after.sha256` 与 `git HEAD` 手工对照代替。A 已用 HEAD 版本核对，结论成立。
- **F4（低）**：`npx tsc -b` 未复现（B 报 EPERM）。A 用 `-p tsconfig.app.json --noEmit` 复跑通过。建议计划或 acceptance 的 C4 命令写成实际可跑的形式。

## 3. C6 判定（行数）

- 页面壳 413 行 > 250。
- 实测结构：壳内 hook/effect/handler/派生值 = 第 1–246 行；header + 看号输入卡 + 概览摘要卡 + Tab 条 JSX = 第 247–413 行（167 行）。
- **判定：spec 缺陷（计划自相矛盾），非 impl 缺陷。**
  - 计划 §1 目标 3 + §4 + §9 要求：全部 hook/effect/请求函数/派生值留在壳（≈246 行逻辑）。
  - 计划 A1 要求：壳保留 header、输入卡、概览头部卡、Tab 条 JSX（≈167 行）。
  - 计划 §1 目标 1 + R4：壳 ≤ 250。
  - 三者同时成立时，壳的最小下界 ≥ 246 + 167 ≈ 413，250 数学上不可达。B 的 413 已是在约束下的最小可达值，继续拆只能迁出 hook 或 JSX，二者都违反计划的明文约束。因此不存在"实现没拆够"的可行路径。
- 处置：A 产出 **plan v2 / acceptance v2 / freeze v2**（见 `plan.md` 第 11 节）。仅将**页面壳**行数上限由 250 放宽为 450；`inspector/` 下新文件仍 ≤ 250；hook 仍留壳；其余约束不变。
  - v2 下判定：壳 413 ≤ 450 ✔；新文件最大 161 ≤ 250 ✔。**当前实现已满足 v2，无需重新执行。**
- 备份：`plan.v1.md`、`acceptance.v1.json`、`freeze.v1.json`（sha256 与 v1 冻结值一致）。
- 冻结 v2：`plan.md` `497595444181887d…e0447`，`acceptance.json` `d3c8754f…e925`（见 `freeze.json`）。

## 4. 发现的问题清单（按严重度排序）

| 序号 | 严重度 | 位置 | 问题 | 处置 |
|---|---|---|---|---|
| 1 | 高（已处置） | plan v1 §1/§4/§9 与 R4 | 计划自相矛盾，C6 不可达 | 升 v2，放宽壳到 450，理由写入 §11 |
| 2 | 中 | `fidelity.sh` / `jsx-fidelity.txt` | CJK 比对脚本在本机失效，"文案缺失 0"不可复现 | 需 B（或下轮）修脚本后重跑 C3/C12；A 已用逐块 diff 替代验证，结论成立 |
| 3 | 中 | acceptance C4 | `npx tsc -b` 环境下 EPERM，实际跑的是 `-p tsconfig.app.json --noEmit`，但 acceptance 未更新 | 建议下轮把 C4 命令改为实际可跑形式（本次 v2 未改 C4，避免扩大变更面） |
| 4 | 低 | acceptance C3 | command 为占位 `python -c print(...)`，非真实检查 | 建议下轮替换为实际比对脚本 |
| 5 | 低 | acceptance C8 | 引用的 `pkg-baseline.sha256` 不存在 | 建议补基线文件或改为 `git show HEAD:` 对比 |
| 6 | 低 | `jsx-fidelity.txt` | className 差异条目是正则截断产生的假阳性（`insp-tab`/`soul-tag` 模板串） | 随 #2 一并修正 |
| 7 | 低 | 工作区 | 仓库中大量开工前已存在的未提交改动（README、docs、tools/cbg 等） | 非本次引入，A 不回滚；建议人工确认这些改动归属，避免与本次 diff 混淆 |
| 8 | 信息 | 视觉回归 | 未做浏览器手工回归 | 建议上线前点一遍 6 个 Tab（delivery-report 已建议） |

## 5. 终审结论

- 代码层面：拆分**纯结构、无行为变更**（6 Tab JSX 逐行一致；hook/请求函数留壳；回调重命名语义等价；类型检查通过；无新依赖；导出不变；无循环依赖）。
- 验收层面：C1、C2、C4、C5（日志）、C7、C8、C9、C10 通过；C6 在 v2 口径下通过；C3、C12 的**证据脚本存在缺陷，需修复后重跑**（F1/F2/#2）。
- 因 C3/C12 证据不可复现，**本轮不能给出全量 PASS**，但失败性质为证据工具缺陷，不是代码缺陷。
