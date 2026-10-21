# 交付报告：P1-5 样式轮（模型 B 执行）

## 0. 冻结基线（第一步）

| 项 | 值 |
|---|---|
| plan.md sha256 | `ebe48b3c9c53c99261d6945bda2c12310426356f5e45f15f9ecdf652bf9f2b9c` |
| acceptance.json sha256 | `02b9457d64592b495c026b42004df9aa23182170f491fd64488d3d177dea8357` |
| freeze.json | 描述式（allowedPaths / forbiddenPaths / frozenDeliverables / baselineTests=176），无 plan/acceptance 哈希字段 |
| artifacts 清单一致性 | acceptance.json 的 A1–A12 路径与 plan.md 第 3 节逐一一致，全部文件存在 |
| **freezeMatched** | **true** |

## 1. 执行范围

| 产物 | 路径 | 状态 |
|---|---|---|
| A1 | cbg-web/src/index.css | 完成：令牌最小调整、`--accent-btn`、`.state-box--compact/--inline`、删除 `.score-loading` / `.soul-empty`；reduce 段审计未改 |
| A2 | cbg-web/src/components/StatusBlock.tsx | 完成：`variant: 'block' \| 'compact' \| 'inline'` |
| A3 | cbg-web/src/components/FilterPanel.tsx | 完成：裸 `div.state-box` → `StatusBlock` |
| A4 | cbg-web/src/pages/AccountScore.tsx | 完成：`score-loading` → `StatusBlock variant="inline" loading`，移除未用的 `Spin` |
| A5 | cbg-web/src/pages/SoulReport.tsx | 完成：两处 `soul-empty` → `StatusBlock variant="compact"` |
| A6 | cbg-web/src/pages/Dashboard.tsx | 未改动（已是 StatusBlock，默认 block） |
| A7 | cbg-web/src/components/charts/theme.ts | 完成：`prefersReducedMotion()`、`chartMotionOptions()` |
| A8 | cbg-web/src/components/charts/EChart.tsx | 完成：setOption 前合并 motion 选项 |
| A9 | cbg-web/src/utils/__tests__/contrast.test.ts | 完成（新增，29 用例） |
| A10 | evidence/contrast-before-after.md | 完成 |
| A11 | evidence/state-unify-map.md | 完成 |
| A12 | evidence/reduced-motion-audit.md | 完成 |

未修改：package.json、package-lock.json、vite.config.mjs、vitest.config.ts、src/api/、src/store/、.pipeline/templates/（本轮由我触碰的文件仅限上表）。未 npm install，未 commit/push，未新增依赖。

## 2. 验收检查结果（acceptance.json C1–C17）

| 检查 | 命令 / 方式 | 结果 | 证据 |
|---|---|---|---|
| C1 | grep score-loading\|soul-empty | **0** ✅ | evidence/C1.log |
| C2 | grep -c state-box-- StatusBlock.tsx | 2（期望字面 1）⚠️ 语义满足 | C2.log |
| C3 | grep compact\|inline index.css | 4（期望字面 2）⚠️ 语义满足 | C3.log |
| C4 | 含 variant 的文件数 | 2 ✅ | C4.log |
| C5 | state-box\|StatusBlock 文件数 | 5，exit 0 ✅ | C5.log |
| C6 | state-unify-map.md 存在 | ✅ | — |
| C7 | theme.ts 导出 2 个 | 2 ✅ | C7.log |
| C8 | EChart 引用 chartMotionOptions | 2（import + 使用，期望字面 1）⚠️ 语义满足 | C8.log |
| C9 | reduced-motion-audit.md 存在 | ✅ | — |
| C10 | contrast.test.ts 含 4.5/3.0 | 5 ✅ | C10.log |
| C11 | `npx vitest run contrast.test.ts` | 29 用例中全部通过（修正 light --faint 后）✅ | C11 随 C13 |
| C12 | contrast-before-after.md 存在 | ✅ | — |
| C13 | 全量 vitest | **205 passed / 0 failed**（基线 176 + 新增 29）✅ | evidence/C13.log |
| C14 | tsc 类型检查 | exit 0 ✅ | evidence/C14.log |
| C15 | vite build | exit 0，built in 8.18s ✅ | evidence/C15.log |
| C16 | package*.json 无 diff | **FAIL（环境/前序改动）** ❌ | C16 见下 |
| C17 | 禁止路径无 diff | **4 个文件命中（前序改动）** ❌ | 见下 |

### C16 / C17 失败说明（如实记录，未篡改检查）

`git status` 显示 `cbg-web/package.json`、`cbg-web/package-lock.json`、`cbg-web/src/api/{account,inspector,live,soul}.ts` 已处于修改状态。其 mtime 分别为 21:37、21:18、20:18 等，**早于本轮执行开始（约 22:00）**，且我本轮未对这些文件做任何编辑。因此 C16/C17 的失败来源是本轮之前工作区的未提交改动，而非本轮执行产生。

按工作规则未执行 `git checkout` 等会丢弃他人改动的操作。请终审确认：这些前序改动是否属于本轮允许范围（若属于，需在冻结基线中登记；若不属于，需由 A 决定回退）。

## 3. 其它验证

- `npx tsc -b`：因 `node_modules` 为指向 `D:\deepseek_work-github\cbg-web\node_modules` 的符号链接，`tsc -b` 写 `node_modules/.tmp/*.tsbuildinfo` 被沙箱拒绝（EPERM）。改用等价的 `npx tsc -p tsconfig.app.json --noEmit`（exit 0）。**环境限制，已记录。**
- esbuild 子进程被沙箱拦截（EPERM spawn），vitest / vite build 通过一次 danger-full-access 提权完成。
- 本轮 bash 执行器中途崩溃（EXECUTOR_UNAVAILABLE，CreateFileMapping 错误），后续命令改用 PowerShell 执行；未绕过沙箱。`tsc -b` 基线因此只得到 noEmit 版本的基线（`baseline-tsc-noemit.log`）。
- 基线：vitest 176/176（`baseline-vitest.log`）。

## 4. 对比度结果摘要

- 深色 `--faint` 3.32 → 4.99（surface）/ 4.63（surface-2）
- 浅色 `--faint` 2.55 → 5.29（surface）/ 4.98（surface-2）
- 浅色 `--link` 4.10 → 4.63；`--ok` 3.30 → 4.61
- `.btn-primary`：新增 `--accent-btn #cc4837`，白字 3.09 → 4.62；`--accent` 品牌色未改
- 例外清单：为空（结构上强制 reason 非空）
- 已知未覆盖：深色 `--faint` 在 `--surface-3` 上 4.19（未纳入既定配对），见 contrast-before-after.md

## 5. 假设与默认处理（第 8 节，未询问用户）

Q1–Q7 全部按 plan 第 8 节默认处理（见 evidence/assumptions.md）。未调用 ask_user_question。

## 6. 风险与待终审项

1. C16/C17 因前序未提交改动失败（见第 2 节），需终审裁定。
2. C2/C3/C8 字面计数与 plan 期望有出入，语义满足，已如实列出。
3. 视觉变化：AccountScore 加载提示由 AntD Spin 改为统一 spinner；SoulReport 空态颜色由 `--faint` 变为 `--dim`（统一后的 compact 基色）。按本轮「允许观感变化」目标接受。
4. 无浏览器验证，图表动画关闭与视觉对比需终审人工复核。
5. 深色 `--faint` 在 `--surface-3` 上 4.19，未进测试；建议终审决定是否提亮或列例外。

## 7. 结论

功能目标 R1–R4 已在代码与测试层面完成并通过（205/205，tsc，vite build）。R5（禁止路径）与 C16 因前序工作区改动未满足，需终审裁定。
