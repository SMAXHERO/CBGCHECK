# 对比度 before / after（P1-5）

计算方法：WCAG 2.1 相对亮度对比度，由 `cbg-web/src/utils/__tests__/contrast.test.ts` 自动校验。
阈值：文本 4.5；UI 组件（accent 作填充/描边）3.0。背景取 `--surface` / `--surface-2`。

## 深色主题（`:root[data-theme='dark']`）

| 令牌 | 前景 before | 前景 after | 背景 | before 对比度 | after 对比度 | 阈值 | 结果 |
|---|---|---|---|---|---|---|---|
| --faint | #626c7e | #818997 | surface #161920 | 3.32 | 4.99 | 4.5 | ✅ |
| --faint | #626c7e | #818997 | surface-2 #1c2029 | 3.08 | 4.63 | 4.5 | ✅ |
| --on-accent | #ffffff | #ffffff | accent #ff5a45（before） → accent-btn #cc4837（after） | 3.09 | 4.62 | 4.5 | ✅ |
| --text | #e9ecf2 | 不变 | surface | 14.86 | 14.86 | 4.5 | ✅ |
| --dim | #8f99ab | 不变 | surface | 6.12 | 6.12 | 4.5 | ✅ |
| --text-mid | #c8cfdb | 不变 | surface | 11.23 | 11.23 | 4.5 | ✅ |
| --link | #6aa9ff | 不变 | surface | 7.31 | 7.31 | 4.5 | ✅ |
| --ok | #34d07f | 不变 | surface | 8.77 | 8.77 | 4.5 | ✅ |
| --warn | #e5b567 | 不变 | surface | 9.33 | 9.33 | 4.5 | ✅ |
| --danger | #ff6b6b | 不变 | surface | 6.34 | 6.34 | 4.5 | ✅ |
| --accent | #ff5a45 | 不变（品牌色） | surface | 5.70 | 5.70 | 3.0(UI) | ✅ |

## 浅色主题（`:root[data-theme='light']`）

| 令牌 | 前景 before | 前景 after | 背景 | before 对比度 | after 对比度 | 阈值 | 结果 |
|---|---|---|---|---|---|---|---|
| --faint | #9aa3b0 | #666c76 | surface #ffffff | 2.55 | 5.29 | 4.5 | ✅ |
| --faint | #9aa3b0 | #666c76 | surface-2 #f7f8fa | 2.40 | 4.98 | 4.5 | ✅ |
| --link | #1677ff | #156fee | surface | 4.10 | 4.63 | 4.5 | ✅ |
| --ok | #16a34a | #12873d | surface | 3.30 | 4.61 | 4.5 | ✅ |
| --on-accent | #ffffff | #ffffff | accent-btn #cc4837（before 为 accent #ff5a45 = 3.09） | 3.09 | 4.62 | 4.5 | ✅ |
| --accent | #ff5a45 | 不变（品牌色） | surface | 3.09 | 3.09 | 3.0(UI) | ✅ |
| --text / --dim / --text-mid / --warn / --danger | — | 不变 | surface | 4.83 ~ 15.78 | 不变 | 4.5 | ✅ |

## 调整说明（最小幅度，保持色相，只调明度）

- 深色 `--faint`：沿「白」方向混合 ≈19.5%，色相不变。
- 浅色 `--faint`：沿「黑」方向混合 ≈31% 后再加深至过 surface-2（测试发现 surface-2 上初版仅 4.37，已二次修正）。
- 浅色 `--link` / `--ok`：沿黑方向混合 ≈6.5% / ≈17%。
- 新增 `--accent-btn`（两主题同值 `#cc4837`，hover `#b53f2f`）：仅用于 `.btn-primary` 背景；`--accent` 未改。

## 例外清单

当前 `EXCEPTIONS` 为空：所有测试配对均已达阈值。

已知未纳入测试的项（不属于既定配对，记录以备终审）：

- 深色 `--faint` 在 `--surface-3 #232833` 上为 4.19，低于 4.5。该背景仅用于少量 hover/选中块，且 `--faint` 当前仅用于 10.5~12.5px 辅助提示。若终审要求覆盖 surface-3，可再提亮 `--faint` 或将该处列为例外（理由：次要辅助文字、hover 状态瞬时可见）。
- 浅色 `--faint` 在 `--surface-3 #eef1f5` 上约 4.67（达标）。

## 结论

R3 对比度：所有既定配对（13 项 × 2 主题，共 27 个断言 + 解析/自洽 2 个）全绿，例外清单为空且结构上强制 reason 非空。
