# Lead 补遗：终审 H-1 的修复（对比度漏网件 + 测试盲区）

终审（A）判 pass=false，核心是 H-1：`.card-head .badge`、`.opt.on`（以及同模式的 `.guide-step .n`）
仍是「白字压品牌色 --accent（#ff5a45）＝ 3.09:1」，而 B 只迁移了 `.btn-primary`；
同时 `contrast.test.ts` 的配对表只校验令牌组合，**扫不到"某条规则自己拼出错误组合"**。

## 修复（Lead 直改，约 20 行）

| 文件 | 改动 |
|---|---|
| `cbg-web/src/index.css` | 三处实底白字改用 `--accent-btn`：`.opt.on`、`.card-head .badge`、`.guide-step .n`（各附注释说明为什么不能用品牌色） |
| `cbg-web/src/index.css` | 新增 `--danger-btn` / `--danger-btn-hover`：`--danger` 深色 #ff6b6b 压白字只有 **2.79**，`.btn-danger:hover` 实底改用 #c94a4a（**4.62**）；浅色沿用 #d4380d（4.80）。`--danger` 本身不动（仍用于文字/描边） |
| `cbg-web/src/utils/__tests__/contrast.test.ts` | ① 新增配对 `on-accent / danger-btn`（两主题）；② 新增「规则级静态扫描」两条断言：不得存在 `background: var(--accent)` + `color: var(--on-accent)` 的规则；凡有白字（`color: var(--on-accent)`）的规则，底色必须是 `--accent-btn` 或 `--danger-btn` |

这样再出现同类漏网会被测试直接拦下，而不是靠终审肉眼抓。

## 复跑（Lead，真实仓库）

```
npx vitest run       8 files / 209 tests passed（对比度 33 个用例）
npx tsc -b           exit 0
npx vite build       ✓ built in 7.29s
```

## 未随本轮处理的视觉判断项（需人眼确认一次）

- **M-3 层级压缩**：`--faint` 为达 4.5 变深后（深色 #818997 / 浅色 #666c76），与 `--dim` 的亮度差变小，
  辅助文字与次要文字的层次感被压缩。这是"可读性优先"的取舍；若观感不佳，可改为给 `--dim` 再提亮一档来拉开距离。
- **M-2 空态颜色变化**：SoulReport 的 `.soul-empty` 合并进 `.state-box` 后，空态文字由 `--faint` 变为 `--dim`（略深）。
- **M-1 空态间距**：`.score-loading`（行内 6px）与 `.soul-empty`（18px）并入 `.state-box` 后按变体取值，密集区域观感需确认。

以上三项无法用机器验证，建议在 `npm run dev` 下把四个模块过一遍（尤其浅色主题的空态与选中胶囊）。
