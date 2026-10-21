# 交付报告

- 计划版本：v1
- hash 校验：planSha256 / acceptanceSha256 与 `freeze.json` 一致 → PASS（plan.md e94738…、acceptance.json a98e9c…，字节数 17096 / 9759）
- 执行模型：B（route: 本会话执行模型）
- 执行时间：2026-10-21T21:50:45+08:00
- 自测结论：PASS（失败数 0；C1–C12 全部通过，C13/C14 为证据完整性项，已产出）

## 1. 产物清单

| 编号 | 路径 | artifact_type | 大小(bytes) | sha256 (前16) |
|---|---|---|---|---|
| A1 | cbg-web/src/components/ModuleHeader.tsx | code（新增） | 4359 | 91092406140783d5 |
| A2 | cbg-web/src/components/DashboardLayout.tsx | code（改） | 8805 | 7d1210e05e4f624d |
| A3 | cbg-web/src/pages/AccountScore.tsx | code（改） | 37753 | 51fdc1385932dbf0 |
| A4 | cbg-web/src/pages/SoulReport.tsx | code（改） | 25835 | 0a3cafb1845b03f4 |
| A5 | cbg-web/src/pages/InspectorReport.tsx | code（改） | 14447 | b047cb7f4628a385 |
| A6 | cbg-web/src/pages/Dashboard.tsx | code（改） | 22912 | af32d53105f89f5b |
| A7 | cbg-web/src/components/StatusBlock.tsx | code（改，untracked） | 1570 | 311b702d57b67708 |
| A8 | cbg-web/src/hooks/useExport.ts | code（新增） | 1181 | f78871879873dbdc |
| A9 | cbg-web/src/utils/export.ts | code | 未改（默认不改） | — |
| A10 | cbg-web/src/components/AlertBar.tsx | code | 未产出（G5 选做，DOM 不保真，见 refactor-map「不做」） | — |
| A11 | cbg-web/src/components/__tests__/ModuleHeader.test.tsx | code（新增） | 2830 | 23a0096e1bdf0d87 |
| A12 | .pipeline/runs/p1-4-crosscut/evidence/refactor-map.md | doc | 3627 | e49b277ebb7fc996 |
| A13 | .pipeline/runs/p1-4-crosscut/evidence/dom-fidelity.md | doc | 3840 | ca0613eb4ecfe750 |
| A14 | .pipeline/runs/p1-4-crosscut/evidence/assumptions.md | doc | 4152 | 55d5f1c3e7669936 |

附加（非清单产物，按计划引用编写）：`evidence/check-classnames.mjs`、`check-forbidden.mjs`、`check-minimal-guard.mjs`；`vitest.config.ts`（include 扩展，见第 5 节 B7）。

## 2. 执行环境

- 运行时 / 依赖版本：Node（本会话）；vite 7.3.7；vitest 5.0.5；react-dom（已存在）。**未执行 npm install，未新增依赖。**
- 执行的命令（按顺序）：
  1. `sha256sum` 校验 plan.md / acceptance.json 与 freeze.json
  2. 改造前快照：复制 6 个文件到 `evidence/baseline/`；记录禁止路径哈希 `forbidden-tree.sha256`
  3. 编辑：ModuleHeader 新增 → DashboardLayout / AccountScore / SoulReport / InspectorReport / Dashboard 替换 → StatusBlock 扩展 → useExport 新增 → Dashboard 接入 useExport
  4. `npx tsc -b`（C1，exit 0）
  5. `npx vite build`（C2，exit 0）
  6. `npx vitest run`（C3，exit 0，176 passed）
  7. `npx vitest run src/components/__tests__/ModuleHeader.test.tsx`（C4，exit 0，5 passed）
  8. `grep` 收敛指标（C5/C6/C9/C10，全部为 0 或仅 ModuleHeader）
  9. `node` 检查脚本 C7、C8、C11、C12（全部 exit 0 / OK 输出）
  10. `git status --porcelain` 自查（真实改动可见）
- 与计划的偏差：
  - **vitest 原 EPERM 阻塞已不再复现**，本次直接运行通过，未降级为 manual。
  - **vitest.config.ts include 扩展**（加入 `src/components/__tests__/**/*.test.tsx`），否则 A11 不会被收集。这是测试配置改动，非依赖变更，已记入 assumptions B7。
  - 测试总数 176 = 171 原用例 + 5 新增（计划允许新增 A11 用例）。
  - A3/A4/A5 的 `useTheme` 调用已删除（其 `theme/toggle` 仅服务于被替换的头部按钮，已逐处核对）。

## 3. 自测结果（L1 / L2）

| 检查项 | 命令 | 退出码 | 结果 | 证据路径 |
|---|---|---|---|---|
| C1 | npx tsc -b | 0 | PASS | evidence/C1-tsc.log |
| C2 | npx vite build | 0 | PASS | evidence/C2-build.log |
| C3 | npx vitest run | 0 | PASS（176 passed，0 failed） | evidence/C3-vitest.log |
| C4 | npx vitest run …ModuleHeader.test.tsx | 0 | PASS（5 passed） | evidence/C4-moduleheader.log |
| C5 | grep app-header（pages+DashboardLayout，排除 ModuleHeader） | 0 | PASS（0） | evidence/C5-app-header.txt |
| C6 | grep icon-btn（pages+DashboardLayout） | 0 | PASS（0） | evidence/C6-icon-btn.txt |
| C7 | node 统计 `<ModuleHeader` 次数 | 0 | PASS（4 入口各 1） | evidence/C7-moduleheader-usage.txt |
| C8 | node check-classnames.mjs | 0 | PASS（CLASSNAME_FIDELITY_OK） | evidence/C8-classname-diff.txt |
| C9 | grep M13.5 9.6A5.8 | 0 | PASS（仅 ModuleHeader.tsx） | evidence/C9-svg-single-source.txt |
| C10 | grep 导出调用（Dashboard） | 0 | PASS（0） | evidence/C10-export-callsites.txt |
| C11 | node check-forbidden.mjs | 0 | PASS（FORBIDDEN_UNTOUCHED_OK，15 文件） | evidence/C11-forbidden.txt |
| C12 | node check-minimal-guard.mjs | 0 | PASS（MINIMAL_GUARD_OK） | evidence/C12-minimal.txt |
| C13 | refactor-map.md 完整性 | — | 已产出（含 4+3+ 导出调用点、AlertBar 不做理由） | evidence/refactor-map.md |
| C14 | dom-fidelity.md 完整性 | — | 已产出（每调用点 className/文案对比，与 C8 一致） | evidence/dom-fidelity.md |

说明：C7 的文件计数由 `node -e` 在 cbg-web 目录执行，结果 DashboardLayout/AccountScore/SoulReport/InspectorReport 均为 1。

## 4. 未通过项与处理

无。全部 L1/L2 检查通过，未触发修复轮次。

## 5. 假设与待确认

| 编号 | 内容 | 影响 |
|---|---|---|
| Q1 | 三个模块页主题按钮保持文本图标，未统一为 SVG | 视觉零变化；统一需另立需求 |
| Q5/B6 | AlertBar（G5）未交付，DOM 不保真 | 收敛范围少一项；不影响 R1–R5 |
| B3/B4 | AccountScore `.score-loading`、SoulReport `.soul-empty`×2、FilterPanel `.state-box` 未替换为 StatusBlock | DOM/视觉零变化优先；收敛度略低，记入 refactor-map「不做」 |
| B7 | vitest.config.ts include 扩展以收集 .tsx 组件测试 | 测试配置变更，非依赖；需 Lead 知悉 |
| Q4 | 工作区存在本次之前的大量未提交修改（api、store、index.css、README 等） | 本次未触碰这些文件；C11 证明禁止路径无新 diff |

## 6. 遗留风险

1. **C8 对插值文案的比对是静态片段断言**（meta 含 `SCRAPER_BASE` 插值）。运行时字符串等价，但 Lead 复跑时若要更强保证，可加一条真实渲染快照测试。
2. **StatusBlock 扩展未被任何调用点使用 className 参数**（因未替换任何占位），该扩展目前是未消费的 API，属预留能力。
3. **Dashboard 守卫 minimal 与完整模式共享同一 ModuleHeader**，后续若改 minimal 分支需同步检查 C12。
4. **未做浏览器端视觉回归**（仅静态 DOM 等价 + 单元测试）；建议在 `pnpm run dev` 下人工点一遍四个模块的顶部栏与主题切换。
5. 未 commit / push，工作区改动需 Lead 评审后再提交。
