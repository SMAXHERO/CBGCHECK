# C7 — README / refactor-map 质量 rubric 审查（模型 A 终审）

审查对象：`.pipeline/evidence/refactor-map.md`（A10）、`.pipeline/delivery-report.md`（B 交付报告，作为 README 性质文档）。
审查方法：逐行对照 `InspectorReport.orig.tsx` 与当前源码，不采信 B 的结论。

## 评分（1–5，3 为及格，任一维 <3 不通过）

| 维度 | 分 | 依据 |
|---|---|---|
| 行号准确性 | 4 | 6 个 Tab 区间（L421–564 / 566–634 / 636–717 / 719–853 / 855–922 / 924–1009）与原文件 `tab ===` 标记行一致（421/566/636/719/855/924）。区间末端经核对为对应块结束。扣 1 分：未标注末端 `)}` 所在行，读者需自行核对。 |
| 覆盖完整性 | 4 | 6 个 Tab 全部列出；共享常量/工具 L27–L103 有映射；壳内 hook/handler 有映射。扣 1 分：`L1–L25` 头部注释与 `L105` 之前的 `useState` 段仅以"留在壳"概括，未逐条列。 |
| 新结构说明 | 5 | 第 4 节明确列出 `onRun` 包装、`PveResult` 导出、类型收敛等非纯搬家改动，并解释语义等价（`runPve()` 默认 `refresh=false`）。 |
| 与事实一致性 | 3 | 声称"HeroTab 161 行 ≤250"✔；声称"最大 HeroTab"✔。但 refactor-map 第 4 节写"页面壳不再直接 import SpeedCell"，而 `SpeedCell` 实际已从壳删除，表述基本正确。一处不实：第 3 节写"派生值 … 留存"，实际 `heroGroups` 的 `useMemo` 依赖 `heroQuery/heroRarity`，映射未注明依赖。 |
| 可复核性 | 3 | 映射表给出了源行号，但未附 orig sha256 对应的复核命令；C3/C12 所用 fidelity 脚本的 Chinese 段在本机 grep 下报 `character value in \x{} is too large` 而失败（见 C8 发现 F1），导致 `jsx-fidelity.txt` 中"文案缺失 0"无法由脚本复现。这是本维度的主要扣分点。 |

**C7 结论：通过（平均 3.8，任一维 ≥3）。** 需在下一轮补：(1) fidelity 脚本的 CJK 比对改用 `grep -P` 的可移植写法或 Python 实现；(2) refactor-map 补充各 Tab 块末尾行号与复核命令。

## 文档一致性备注
- `delivery-report.md` §3 写"`npx tsc -b` 因 EPERM 改用 `tsc -p tsconfig.app.json --noEmit`"。本次 A 复跑：`tsc -p tsconfig.app.json --noEmit` 退出 0，结论成立；`npx tsc -b` 本次未复现（见 C8 §2）。
- `L1-L2-report.md` 中 C4 写"`npx tsc -p … --noEmit` PASS"，与 A 复跑一致。
- `delivery-report.md` 第 4 节"C11 人工抽检通过"：A 已逐 Tab 复核，属实（见 C8 §3）。
