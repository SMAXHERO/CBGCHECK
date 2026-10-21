# 空态 / 加载态统一：迁移映射（P1-5）

唯一基类：`.state-box`。差异仅由修饰类表达：`.state-box--compact`、`.state-box--inline`；`block` 为默认（无修饰类）。

## StatusBlock 接口

```ts
type StatusVariant = 'block' | 'compact' | 'inline';
// 根 class = `state-box` + (variant !== 'block' ? ` state-box--${variant}` : '') + (className ? ` ${className}` : '')
```

## 4 处调用点迁移

| # | 文件:行 | 迁移前 | 迁移后 | 说明 |
|---|---|---|---|---|
| 1 | `pages/AccountScore.tsx:672` | `<div class="score-loading" role="status">` + `<Spin/>` | `<StatusBlock variant="inline" loading>…</StatusBlock>` | 用统一 spinner 替换 AntD `Spin`（视觉变化：spinner 样式由 `.spinner` 提供，已删除无用的 `Spin` import）。role/aria 保持。 |
| 2 | `pages/SoulReport.tsx:62` | `<div class="soul-empty">暂无数据</div>` | `<StatusBlock variant="compact">暂无数据</StatusBlock>` | 表格内空态（Q5）。 |
| 3 | `pages/SoulReport.tsx:623` | `<div class="soul-empty">没有满足条件的组合…</div>` | `<StatusBlock variant="compact">…</StatusBlock>` | 表格容器内空态（Q5）。 |
| 4 | `components/FilterPanel.tsx:183` | `<div class="state-box">…</div>` | `<StatusBlock>…</StatusBlock>` | 原裸 div，改走 StatusBlock，保留 `<br/>` 内容。 |

Dashboard 的 3 处（L390、L458、L464）原本已是 `StatusBlock`，默认 `variant="block"`，未改动。

## 删除确认

- 删除 `index.css` 中 `.score-loading` 定义段（原 L1522 附近）。
- 删除 `index.css` 中 `.soul-empty` 定义段（原 L2271 附近）。

## 收敛验证

| 检查 | 命令 | 结果 |
|---|---|---|
| C1 旧类名无引用 | `grep -rn "score-loading\|soul-empty" cbg-web/src` | 0 命中（已修正 StatusBlock 注释中的历史引用） |
| C2 StatusBlock 修饰类 | `grep -c "state-box--" StatusBlock.tsx` | 2（模板字符串 + 注释，见下方说明） |
| C3 CSS 修饰类 | `grep -c "\.state-box--compact\|\.state-box--inline" index.css` | 4（2 个选择器 + 2 个 `.big`/`.spinner` 后代选择器） |
| C4 调用点 | 含 variant="inline"/"compact" 的文件数 | 2（AccountScore、SoulReport） |
| C5 统一基类使用 | 含 state-box/StatusBlock 的文件数 | 5 |

**说明（计数差异）**：`acceptance.json` 的 C2 / C3 期望值（1 / 2）是按字面 `state-box--` 出现次数写的。实际 StatusBlock 因模板字符串与注释各出现一次得到 2，CSS 因后代选择器得到 4。语义上均满足「存在 compact 与 inline 修饰类并被使用」，计数字面值与 plan 意图有出入，已在交付报告中如实列出，未篡改检查项。
