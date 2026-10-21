# 假设与待确认（模型 A 代填默认值，禁止 ask_user_question）

| 编号 | 假设/问题 | 采用的默认处理 |
|---|---|---|
| Q1 | 测试文件位置：cbg-web/src/utils/__tests__/ 还是 cbg-web/tests/ | 采用 cbg-web/src/utils/__tests__/*.test.ts（就近、tsconfig include 之外但 vitest 自行发现） |
| Q2 | 仓库 HEAD 的 package.json 不含 vitest/@vitest/coverage-v8，工作区已加入（来源未知，可能是人工安装） | 视工作区当前版本为基线：依赖冻结 = 工作区 package.json 的 SHA256（见 baseline.sha256）。执行者不得再改依赖。 |
| Q3 | git 工作区存在大量与本任务无关的未提交改动（13 个 src 文件、README 等） | "src 未改"不以 git diff HEAD 判定，改用 baseline.sha256 中 utils 文件的 SHA256 比对；src 其他文件的改动不属于本任务范围，不纳入判定。 |
| Q4 | 覆盖率阈值依据 | 目标文件均为纯函数，分支可达性高。阈值定为 lines≥80%、branches≥70%（见 plan 第 7 节依据）。若执行者实测低于阈值，只能补测试，不得降阈值。 |
| Q5 | Intl/	oLocaleString('zh-CN') 输出依赖 Node ICU | Node 24 默认 full-icu。测试按 Node 24 结果编码；断言尽量用 	oLocaleString 同源表达式生成期望值，避免硬编码千分位。 |
| Q6 | 发现的潜在问题（如 nalytics.ts 中 uildSignVsSpeed 对 price 为 null 时 enToYuan 返回 null 再 ?? 0；predicate.ts 中 pvp_stage 复用 pvp 字段语义） | 不改源码；如实编码当前行为，并写入 findings.md。 |
| Q7 | wei_speed 与 	ou_speed 映射同一字段 	ou_speed | 视为当前既定行为，按现状编码；记入 findings.md 作为待业务确认项，不算失败。 |
