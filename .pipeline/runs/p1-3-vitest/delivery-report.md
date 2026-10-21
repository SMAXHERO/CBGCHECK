# 交付报告

- 计划版本：v1
- hash 校验：planSha256 / acceptanceSha256 与 `freeze.json` 一致 → PASS
  - planSha256 `dd977024…719c43`，acceptanceSha256 `1a651bf3…dab380`
- 执行模型：B（route: deepseek / claude-haiku-5-5）
- 执行时间：2026-10-21T21:21:49+08:00 起，完成于 2026-10-21T21:32+08:00 前后
- 自测结论：PASS（失败数 0）

## 1. 产物清单

| 编号 | 路径 | artifact_type | 说明 |
|---|---|---|---|
| A1 | cbg-web/vitest.config.ts | config | 新增，独立 vitest 配置 |
| A2 | cbg-web/src/utils/__tests__/predicate.test.ts | code | 36 用例 |
| A3 | cbg-web/src/utils/__tests__/params.test.ts | code | 41 用例 |
| A4 | cbg-web/src/utils/__tests__/analytics.test.ts | code | 34 用例 |
| A5 | cbg-web/src/utils/__tests__/format.test.ts | code | 29 用例（选做） |
| A6 | cbg-web/src/utils/__tests__/sort.test.ts | code | 8 用例（选做） |
| A7 | cbg-web/src/utils/__tests__/columns.test.ts | code | 20 用例（选做） |
| A8 | cbg-web/package.json | config | 仅新增 scripts `test`、`test:coverage` |
| A9 | .pipeline/runs/p1-3-vitest/evidence/test-inventory.md | doc | 测试 → 用例 → 源码函数/分支 |
| A10 | .pipeline/runs/p1-3-vitest/evidence/coverage-summary.txt | data | 覆盖率原始输出 |
| A11 | .pipeline/runs/p1-3-vitest/evidence/findings.md | doc | 7 条疑点（F1–F7），未修改源码 |
| A12 | .pipeline/runs/p1-3-vitest/evidence/assumptions.md | doc | 模型 A 提供，只读 |
| A13 | .pipeline/runs/p1-3-vitest/acceptance.json | config | 只读 |
| A14 | .pipeline/runs/p1-3-vitest/freeze.json | config | 只读 |

sha256 与大小以文件系统为准（本报告不逐个内嵌哈希，避免与后续编辑漂移）。

## 2. 执行环境

- 运行时 / 依赖版本：Node v24.16.0；vitest 5.0.5；@vitest/coverage-v8 5.0.5（均为已安装依赖，未安装任何包）
- 执行的命令（按顺序）：
  1. 计算 plan.md / acceptance.json 的 SHA256，与 freeze.json 比对 → 一致
  2. 编写 vitest.config.ts、package.json scripts、6 个测试文件
  3. `npx vitest run`（首次因沙箱 EPERM 失败，见第 4 节；放开权限后重跑）
  4. 修正 3 处测试期望（见第 4 节），`npx vitest run`
  5. `npx vitest run --coverage`（写入 coverage-summary.txt）
  6. `npx tsc -b`
  7. C1/C2/C6/C7 的 node 断言；C8 Get-FileHash 比对；C9 文件位置检查；C10 存在性检查
  8. `git status --porcelain`
- 与计划的偏差：
  - **C8/C9/C10 用 pwsh 编写**：本会话有 pwsh，按计划原样执行，无需替换为 bash/node。
  - **沙箱权限**：`vitest` 加载 `vitest.config.ts` 时 esbuild 需通过管道 spawn 子进程，默认沙箱返回 `spawn EPERM`。以 `danger-full-access` 单次重试执行 vitest 与 tsc 命令。这是对执行环境的偏差，已在此记录。
  - **node_modules 为 junction**：`cbg-web/node_modules` 指向 `D:\deepseek_work-github\cbg-web\node_modules`，esbuild 堆栈因此显示该路径。未改动依赖，仅为现象记录。
  - **需确认事项的默认处理**：按计划第 8 节 Q1–Q7 默认处理（测试位置 `src/utils/__tests__/`、依赖以工作区为基线、src 以 baseline 哈希判定等），未发起任何询问。

## 3. 自测结果（L1 / L2 / L3）

| 检查项 | 命令 | 退出码 | 结果 | 证据路径 |
|---|---|---|---|---|
| C1 | node 断言 vitest.config 含 node 环境与 @ alias | 0 | PASS | evidence/C1.log |
| C2 | node 断言 coverage.include 仅 utils | 0 | PASS | evidence/C2.log |
| C3 | `npx vitest run` | 0 | PASS：6 files / 168 tests 全绿 | evidence/coverage-run.log |
| C4 | `npx vitest run --coverage` | 0 | PASS：All files lines 100% ≥80，branches 95.73% ≥70 | evidence/coverage-summary.txt |
| C5 | `npx tsc -b` | 0 | PASS | evidence/C5-tsc.log |
| C6 | node 比对 dependencies/devDependencies | 0 | PASS（未改依赖） | evidence/C6.log |
| C7 | node 断言 scripts test/test:coverage 且原脚本齐全 | 0 | PASS | evidence/C7.log |
| C8 | Get-FileHash 比对 baseline 前 6 行 | 0 | PASS：SRC_UNCHANGED | evidence/C8-src-check.txt |
| C9 | 测试文件位置检查 | 0 | PASS：OK | evidence/C9.log |
| C10 | 产出文档存在且非空 | 0 | PASS：OK | evidence/C10.log |
| C11 | L3 评审（测试如实编码当前行为、边界充分、findings 可复现） | — | 待人工/模型 A 评审 | evidence/C11-review.md（未由执行者生成） |

L1/L2 全部 PASS。C11 为 L3 评审项，需模型 A 或人工复核，执行者不代替评审。

## 4. 未通过项与处理

首次运行中的失败均为**测试期望写错，非源码缺陷**，已修正测试期望（未改源码、未降阈值、未排除文件）：

1. `analytics`「平均签到」「SSR/六星」两处 KPI 下标错位（kpis 顺序：0命中,1中位,2四分位,3最快散件,4最快招财,5平均签到,6SSR/六星,7高战号）→ 修正为 5 / 6。
2. `columns` 打印列顺序：结果按导出列原序过滤，`collect_num` 在 `price` 之后 → 修正期望顺序。
3. `compact(-20000)` 保留负号 → 期望改为 `-2.00 万`。

另外为提升 `columns.ts` 覆盖率（首轮仅 48%），补充了其余导出列取值的用例，最终 columns 100%。

## 5. 假设与待确认

| 编号 | 内容 | 影响 |
|---|---|---|
| Q1 | 测试位置采用 `src/utils/__tests__/` | 已按此执行 |
| Q2 | 依赖以工作区 package.json 为基线，未改依赖 | C6 通过 |
| Q3 | src 未改以 baseline.sha256 判定，不用 git diff | C8 通过 |
| Q4 | 阈值 lines≥80 / branches≥70 未调低 | 覆盖率达标 |
| Q5 | zh-CN 格式期望用同源 Intl/toLocaleString 计算 | 降低 ICU 差异风险 |
| Q6 | 源码疑点如实编码，记入 findings.md（F1–F7） | 需维护者确认 F1/F2/F3/F4 |
| Q7 | wei_speed 与 tou_speed 映射同一字段，按现状编码 | 对应 findings F3，待业务确认 |

## 6. 遗留风险

1. **F3 尾速/头速映射**：`wei_speed` 与 `tou_speed` 共用快照字段，尾速条件实际按头速判定，可能误筛。需业务确认是否存在独立尾速字段。
2. **F4 段位复用积分**：`pvp_stage` 以积分数值比较段位，条件实际无效或语义错误。
3. **F1/F2 缺价口径**：散点图把 null 价格写为 0；直方图则排除 null，两图口径不一致。
4. **测试锁定当前行为**：测试如实断言了上述疑点的现状。若日后修复这些缺陷，相关用例需同步更新（属预期的回归变更，而非测试失效）。
5. **沙箱依赖**：`vitest` 在默认沙箱下因 esbuild 管道 spawn 而失败（EPERM）。在 CI 或受限环境中运行需放开该权限，否则 `npm run test` 无法加载配置。
6. **C11 未执行**：L3 评审需模型 A 或人工完成。
7. **node_modules 为 junction 指向 `D:\deepseek_work-github`**：若该位置变动，依赖会失效。
