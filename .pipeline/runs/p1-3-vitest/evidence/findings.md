# 缺陷与疑点（只记录，未修改源码）

以下均为测试编写过程中观察到的**当前行为**。测试已如实断言这些行为，以保证回归基线可用；
是否为缺陷需要业务/维护者确认。源码未做任何改动。

---

## F1 `buildSignVsSpeed`：价格为 null 时被写成 0（疑似不合理）

- **位置**：`cbg-web/src/utils/analytics.ts`，`buildSignVsSpeed`（第 124 行）
- **现象**：`price === null` 的记录仍会进入散点图，且价格维度被写为 `0`（元）。
  代码为 `Math.round(fenToYuan(r.price) ?? 0)`，`fenToYuan(null)` 返回 `null`，随后被 `?? 0` 吞掉。
- **复现**：`buildSignVsSpeed([{ sign_days: 1, sanjian_speed: 1, price: null, ... }])`
  返回 `value[2] === 0`。对应用例：`analytics.test.ts` →「price 为 null 时价格写为 0（当前行为，见 findings）」。
- **影响**：散点图上「价格为 0」的点会被误读为免费/极低价账号，干扰判断。
  与 `buildPriceHistogram` 中 null 价格被排除的处理不一致（直方图会过滤掉 null）。
- **建议**：散点应像 sign/speed 一样过滤 `price === null` 的记录，或在 tooltip 中显示「未标价」。由维护者决定。

## F2 价格维度口径不一致（与 F1 关联）

- **位置**：`analytics.ts` `computeAnalytics` 中 `pick(rows, 'price')` 只收集有限数值，null 被排除；
  而 `buildSignVsSpeed` 对 null 价格不排除。两个图表对「缺价」的口径不同。
- **影响**：同一批数据下，直方图与散点的样本基数可能不一致，用户难以对照。
- **建议**：统一口径（建议与直方图一致：缺价不入图）。

## F3 `predicate.ts`：`wei_speed` 与 `tou_speed` 映射同一快照字段

- **位置**：`predicate.ts` PREDICATES：`tou_speed`、`wei_speed`、`zhaocai_tou_speed` 均调用 `gte(row, 'tou_speed', ...)`。
- **现象**：`wei_speed`（尾速）与 `tou_speed`（头速）共用快照字段 `tou_speed`，无法区分「头速」与「尾速」。
  `zhaocai_tou_speed`（招财头速）同样映射到 `tou_speed`。
- **复现**：`buildPredicate({ wei_speed: '12000' })` 与 `buildPredicate({ tou_speed: '12000' })` 对同一行结果相同。
- **影响**：若用户同时设置头速与尾速条件，过滤结果可能与其期望不符（尾速条件实际按头速判定）。
- **建议**：确认快照是否存在独立的尾速字段；若存在则改映射。**待业务确认**（对应计划 Q7）。

## F4 `predicate.ts`：`pvp_stage`（段位）复用 `pvp`（积分）字段

- **位置**：`predicate.ts` `pvp_stage: (row, raw) => gte(row, 'pvp', raw)`，注释为「列表页里段位与积分同源」。
- **现象**：段位条件按积分数值比较。段位与积分数值语义不同（段位通常为小整数，积分为大整数）。
- **复现**：`buildPredicate({ pvp_stage: '5' })` 对 `pvp: 2000` 的行返回 true（2000 ≥ 5），等价于不过滤。
- **影响**：「斗技段位」条件实际无效或语义错误。
- **建议**：确认段位是否可从快照获取；若不能，应将 `pvp_stage` 归入 `UNSUPPORTED_PARAMS` 而非伪装成已生效。

## F5 `predicate.ts` `equip_level`：「小于等于」语义与其他条件相反（提示项）

- **位置**：`predicate.ts` `equip_level`：`row.equip_level <= v`。
- **现象**：其余数值条件为「大于等于」下限语义；`equip_level` 为上限语义（与面板文案一致，见源码注释）。
- **影响**：有意设计，非缺陷；仅提示阅读者注意语义差异，避免误改。

## F6 `params.ts` `buildParams`：同 key 多选字段去重依赖字段顺序（提示项）

- **位置**：`params.ts` 多选胶囊分支 `usedKeys`：同一 key 只取**第一个有值的**字段。
- **现象**：结果依赖 schema 字段出现顺序。schema 重排可能改变同 key 的选中结果。
- **影响**：既有约定（源码注释说明与原面板保持一致）。仅提示。

## F7 `format.ts` `formatRemain`：极短剩余时间统一显示为「1 分钟」（提示项）

- **位置**：`format.ts` `formatRemain`：`Math.max(1, Math.round(seconds / 60))`。
- **现象**：`formatRemain(30)` 与 `formatRemain(1)` 均得到「1 分钟」。
- **影响**：取整策略偏粗但不算错误。仅记录。

---

## 结论

- 未发现会导致当前测试失败或数据错误的**确定性缺陷**（所有测试按当前行为通过）。
- 需业务确认的疑点：**F3（尾速/头速映射）**、**F4（段位复用积分）**、**F1/F2（缺价口径）**。
- 以上均未修改源码，遵守计划「只测不改」约束。
