# P1-4：修复 F3 / F4（筛选语义缺陷）

- 执行者：Lead（本轮为 7~16 行的小修 + 用例同步，未再走 A/B 卡片；判定依据来自 P1-3 终审 A 的 findings）
- 时间：2026-10-21
- 关联：`.pipeline/runs/p1-3-vitest/evidence/findings.md`（F3/F4）、`C11-review.md`（严重度=高）

## 问题

| 编号 | 现象 | 根因 |
|---|---|---|
| F3 | 「尾速度 ≥ 15」勾选后，实际按**头速度**筛选；「招财头速」同样 | `PREDICATES` 里 `wei_speed`、`zhaocai_tou_speed` 都被映射到 `row.tou_speed`。快照只有头速字段（`wei_num` 是尾个数，不是尾速） |
| F4 | 「斗技段位 ≥ N」实际是拿**积分** `row.pvp` 比较 | `pvp_stage` 被映射到 `row.pvp`。站点上 `pvp_stage`（段位）与 `pvp_score`（积分）是两个独立参数；快照只有积分（实测值 2400 / 3060） |

## 判定（为什么不是"改成映射别的字段"）

列表接口返回的 35 个快照字段里**没有**尾速、也没有段位（`public/data/listings.json` 全量核对：无 `wei_speed` / `pvp_stage`）。
所以正确做法不是找另一个字段凑，而是按项目既有机制（`classifyConditionSupport`）
把它们归入"仅服务端筛选"：站点会筛，本地如实标注，不假装核对。

## 改动

| 文件 | 改动 |
|---|---|
| `cbg-web/src/utils/predicate.ts` | 从 `PREDICATES` 移除 `wei_speed` / `zhaocai_tou_speed` / `pvp_stage`（附原因注释）；三者加入 `UNSUPPORTED_PARAMS`；补 `PARAM_LABELS.wei_speed = '尾速度'` |
| `cbg-web/src/utils/__tests__/predicate.test.ts` | 删除"三者都映射到 tou_speed"的旧用例与 `pvp_stage` 整数 gte 用例；新增 3 个回归用例：不做本地过滤（skipped + match=null）、头速不被尾速复用、三者进 `serverOnlyKeys` |
| `README.md` | 「服务端已筛选 vs 未生效」一节加 2026-10-21 修正说明 |
| `cbg-web/README.md` | 用例数 168 → 171 |

## 验证（Lead，真实仓库）

```
npx vitest run           → 6 files / 171 tests passed（189ms）
npx vitest run --coverage→ lines 100% / branches 95.73%（阈值 80/70）
npx tsc -b               → exit 0
npx vite build           → ✓ built in 7.14s
```

行为变化（对用户可见）：勾选尾速度 / 招财头速 / 斗技段位 后，界面不再声称"本地已筛"，
而是按「服务端已筛选、本地无法核对」提示；头速、积分条件的筛选结果不变。
