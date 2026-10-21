# 减少动态效果（prefers-reduced-motion）审计（P1-5）

## 1. 动画清单（全部 keyframes / animation 声明）

| 选择器 | 动画 | 用途 | 位置（index.css） |
|---|---|---|---|
| `.spinner` | `spin 0.7s linear infinite` | 加载指示器（StatusBlock 使用） | ~L1059 |
| `.mini-spinner` | `spin 0.7s linear infinite` | 小型加载指示器 | ~L309 |
| `.btn.pulse` | `pulse-shadow 1.6s ease-in-out infinite` | 主按钮脉动阴影 | ~L325 |
| `.opt.shake` | `shake 0.2s linear` | 超出 maxChecked 抖动 | ~L739 |

## 2. 覆盖结论

`index.css` 的 `@media (prefers-reduced-motion: reduce)`（约 L2584）使用通配 `*, *::before, *::after` 选择器，对所有元素设置：

- `animation-duration: 0.01ms !important`
- `animation-iteration-count: 1 !important`
- `transition-duration: 0.01ms !important`
- `scroll-behavior: auto !important`

因此上表四类动画全部被覆盖（`!important` 胜过普通 `animation` 简写）。

**简写覆盖检查**：所有 `animation:` 声明均位于 reduce 媒体块之前（L300–L1100 区间），文件末尾的 reduce 段之后没有任何 `animation` 简写会覆盖回去。结论：无需移动 reduce 段，也无需额外 `!important`。

## 3. 图表层（JS 动画）

此前 reduce 段只能覆盖 CSS，ECharts 的 JS 动画不受影响。本轮新增：

- `charts/theme.ts`：`prefersReducedMotion()`（matchMedia 不可用时返回 false）与 `chartMotionOptions()`（reduce 时返回 `{ animation: false, animationDuration: 0 }`，否则 `{}`）。
- `charts/EChart.tsx`：`setOption` 前以 `{ ...chartMotionOptions(), ...option }` 合并；调用方显式写的 `animation` 仍优先，保证可覆盖。

## 4. 未改动（保留正常动画）

- 不删除任何 keyframes；正常用户（未开启系统减少动态）的全部动画保持原样。
- 未增加用户可设置的开关（Q4：只跟随系统媒体查询）。

## 5. 风险 / 未验证项

- 本轮无浏览器环境，无法实际切换系统「减少动态」并肉眼验证图表动画关闭；以代码路径与 CSS 审计为依据，交由终审视觉复核。
- `chartMotionOptions` 为纯函数，未加专门单元测试（计划为可选项）。
