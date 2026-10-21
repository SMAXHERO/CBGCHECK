# 执行计划 v1：P1-5 样式轮（空态统一 / 减少动态 / 对比度）

- 计划版本：v1
- 冻结时间：2026-10-21T22:10:00+08:00
- 作者：模型 A（route: 架构与终审，lead）
- 执行者：模型 B（route: 执行者，待指定）

## 1. 目标与非目标

### 目标（可验证）

1. **空态/加载态统一**：`.state-box` 为唯一基类；`StatusBlock` 支持 `variant: 'block' | 'compact' | 'inline'`，差异由修饰类 `.state-box--compact` / `.state-box--inline` 表达；4 个调用点全部迁移；`.score-loading`、`.soul-empty` 的 CSS 定义删除，`grep -rn 'score-loading\|soul-empty' cbg-web/src` 为 0 命中（CSS 与 TSX 均无引用）。
2. **减少动态效果覆盖到图表层**：`components/charts/theme.ts` 导出 `prefersReducedMotion()`（含 `matchMedia` 不可用时返回 false 的兜底）与 `chartMotionOptions()`；`EChart.tsx` 默认 option 合并 `animation:false, animationDuration:0`（reduce 时）。CSS 段确认覆盖 `.spinner`、`.mini-spinner`、`.btn.pulse`、`.opt.shake`，且无 `animation` 简写覆盖回去。正常用户动画保留。
3. **对比度达标 + 自动化测试**：新增 `cbg-web/src/utils/__tests__/contrast.test.ts`，解析 `src/index.css` 两个主题块 token，按配对计算 WCAG 2.1 对比度，阈值：普通文本 4.5、大文本/UI 组件 3.0。无法达标的项进入带理由的例外清单（测试内声明）。按最小幅度只调明度调整 token；产出 before/after 表。

### 非目标 / 明确不做

1. 不改 `--accent` 品牌色相；不做整体配色重设计。
2. 不新增依赖，不改 `package.json`、`vite.config.mjs`、`vitest.config.ts`、`src/api/`、`src/store/`。
3. 不做用户可设置的「减少动态」开关，只跟随系统媒体查询。
4. 不 git commit / push；不改 `.pipeline/templates/`。
5. 不引入浏览器端视觉测试（本轮无浏览器，视觉正确性由终审审 CSS diff）。

## 2. 输入

| 编号 | 类型 | 路径/来源 | 说明 |
|---|---|---|---|
| I1 | 源码 | `cbg-web/src/index.css` | 设计令牌（:root 约 L1–125）、`.state-box`（L1028）、`.score-loading`（L1522）、`.soul-empty`（L2271）、`@media (prefers-reduced-motion)`（约 L2584） |
| I2 | 源码 | `cbg-web/src/components/StatusBlock.tsx` | 当前 `className` 透传，无 variant |
| I3 | 源码 | `cbg-web/src/components/FilterPanel.tsx:183`、`cbg-web/src/pages/Dashboard.tsx:390,458,464`、`cbg-web/src/pages/AccountScore.tsx:671`、`cbg-web/src/pages/SoulReport.tsx:61,622` | 4 个调用点所在文件 |
| I4 | 源码 | `cbg-web/src/components/charts/theme.ts`、`cbg-web/src/components/charts/EChart.tsx` | 图表层 |
| I5 | 基线 | `cbg-web/src/utils/__tests__/`、`cbg-web/src/components/__tests__/` | 现有 vitest 用例（基线 176，见 assumptions Q7） |
| I6 | 决策记录 | `.pipeline/runs/p1-5-style/evidence/assumptions.md` | 默认处理清单 |

Lead 实测基线（已复核）：深色 faint/surface 3.32、浅色 faint 2.55、accent 3.09、link 4.10、ok 3.30；`--on-accent #fff` on `--accent` 两主题均为 **3.09**（`.btn-primary` 文本不达标，见 Q1）。

## 3. 产物清单

| 编号 | 路径 | artifact_type | 说明 |
|---|---|---|---|
| A1 | `cbg-web/src/index.css` | code | 令牌调整、`.state-box` 变体、删除两处旧定义、reduced-motion 复核 |
| A2 | `cbg-web/src/components/StatusBlock.tsx` | code | 增加 `variant` prop |
| A3 | `cbg-web/src/components/FilterPanel.tsx` | code | 迁移到 StatusBlock/ state-box 统一写法（如需） |
| A4 | `cbg-web/src/pages/AccountScore.tsx` | code | `.score-loading` → `StatusBlock variant="inline" loading` |
| A5 | `cbg-web/src/pages/SoulReport.tsx` | code | `.soul-empty` → `StatusBlock variant="compact"` |
| A6 | `cbg-web/src/pages/Dashboard.tsx` | code | 保留 StatusBlock 调用；如需显式 `variant="block"` |
| A7 | `cbg-web/src/components/charts/theme.ts` | code | `prefersReducedMotion()`、`chartMotionOptions()` |
| A8 | `cbg-web/src/components/charts/EChart.tsx` | code | 默认 option 合并 reduce 动画关闭 |
| A9 | `cbg-web/src/utils/__tests__/contrast.test.ts` | code | 对比度自动化测试（新增） |
| A10 | `.pipeline/runs/p1-5-style/evidence/contrast-before-after.md` | doc | 对比度 before/after 表 + 例外清单理由 |
| A11 | `.pipeline/runs/p1-5-style/evidence/state-unify-map.md` | doc | 4 处迁移映射、删除确认 grep |
| A12 | `.pipeline/runs/p1-5-style/evidence/reduced-motion-audit.md` | doc | 动画清单与覆盖结论 |

## 4. 接口与约定

- **目录结构**：仅改第 3 节列出的文件；测试放 `cbg-web/src/utils/__tests__/`。
- **StatusBlock 接口**（A2）：
  ```ts
  type StatusVariant = 'block' | 'compact' | 'inline';
  interface Props {
    loading?: boolean;
    title?: ReactNode;
    hint?: ReactNode;
    variant?: StatusVariant;   // 默认 'block'
    className?: string;
    children?: ReactNode;
  }
  ```
  渲染根节点 class：`state-box` + (variant!=='block' ? ` state-box--${variant}` : '') + (className ? ` ${className}` : '')。
  loading 仍保留 `role="status" aria-live="polite" aria-busy="true"`；非 loading 保留 `role="note"`。
- **CSS 变体**（A1）：
  - `.state-box--compact`：padding 18px 12px，`.big` 不放大（仍 13px 粗体），用于表格内空态。
  - `.state-box--inline`：`display:flex; align-items:center; justify-content:flex-start; gap:10px; text-align:left; padding:6px 2px;`，spinner 的 margin 改 0。
  - 注意 `.spinner` 当前 `margin: 0 auto 10px`，inline 需覆盖为 `margin:0`。
- **图表动画 API**（A7）：
  ```ts
  export const prefersReducedMotion = (): boolean =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  export const chartMotionOptions = (): { animation: boolean; animationDuration: number } =>
    prefersReducedMotion() ? { animation: false, animationDuration: 0 } : {};
  ```
  在 `EChart.tsx` 的 `chart.setOption(option, {notMerge})` 之前，以 `{ ...chartMotionOptions(), ...option }` 合并（**option 自身若显式写 animation 则以 option 为准**，保持调用方可覆盖；但全站默认 option 不写 animation，故实际生效）。
- **对比度测试接口**（A9）：
  - 解析 `src/index.css`：取 `:root, :root[data-theme='dark']` 块与 `:root[data-theme='light']` 块内 `--name: #hex;` 声明（仅 hex，rgba 跳过并注释）。
  - 配对表（测试内常量）：`text/surface`, `text/surface-2`, `dim/surface`, `dim/surface-2`, `faint/surface`, `faint/surface-2`, `text-mid/surface`, `link/surface`, `ok/surface`, `warn/surface`, `danger/surface`, `accent/surface`（UI，阈值 3.0）, `on-accent/accent`（按钮文字，阈值 4.5）。
  - 阈值：文本类 4.5；UI 组件（accent 作为图标/边框/填充、link 作为按钮描边等）3.0。
  - 例外清单：测试内 `EXCEPTIONS: {theme, pair, threshold, reason}[]`，每项必须有 reason 字符串，测试断言 reason 非空。
- **编码**：TS strict，不用 `any`；CSS 只用 `var(--x)`，不写死颜色（`index.css` 约定 1）。
- **命名**：修饰类统一 `state-box--{variant}`。

## 5. 环境与命令

- 运行时：Node（仓库已就绪）；工作目录 `D:\deepseek_work\github-work\cbg-web`。
- 依赖：**已安装，禁止 `npm install`**（vitest 5.0.5 已就绪）。
- 测试：`npx vitest run`（读取 `vitest.config.ts`，include 已覆盖 `src/utils/__tests__/**/*.test.ts`）。
- 类型检查/构建：`npx tsc -b`、`npx vite build`（或 `npm run build`，等价于 `tsc -b && vite build`）。
- 禁止引入的依赖或服务：任何新 npm 包（含 `color`、`wcag-contrast`、`culori` 等对比度库）、任何浏览器/Playwright 依赖；对比度计算用纯 TS 实现。
- 禁止修改：`src/api/`、`src/store/`、`vite.config.mjs`、`vitest.config.ts`、`package.json`、`package-lock.json`、`.pipeline/templates/`。

## 6. 执行步骤

1. **基线**：`cd cbg-web && npx vitest run` 记录用例数（期望 176 全绿）；`npx tsc -b`、`npx vite build` 记录通过状态。把结果写入 `evidence/baseline.log`。
2. **对比度（先测后改）**：新增 `contrast.test.ts`（A9），跑一次记录 before 数值（失败项可先不断言，仅输出表）；产出 `contrast-before-after.md` 的 before 段。
3. **令牌最小调整**：只调明度，保持色相。目标：
   - 深色 `--faint` 提亮到 ≥4.5（对 surface `#161920`）；
   - 浅色 `--faint` ≥4.5、`--link` ≥4.5、`--ok` ≥4.5、`--accent` 作为文字用途时 ≥4.5（若 accent 仅作填充则在例外清单，理由：品牌填充色，文字统一用 `--text`）；
   - `.btn-primary`：按 Q1 执行——新增 `--accent-btn`（两主题各定义，压暗到白字 ≥4.5）用于 `.btn-primary` 背景，hover 同步。**不改 `--accent`**。
   - 更新测试断言使其全绿。
4. **状态块统一**：实现 A2（StatusBlock variant）、A1 中 `.state-box--compact/--inline`；迁移 A4、A5、A3/A6（A3 当前是裸 `div.state-box`，改用 `StatusBlock` 或保留 class 均可，但必须走同一基类）；删除 `.score-loading`（L1522 附近）与 `.soul-empty`（L2271 附近）两段 CSS。
5. **动画审计**：复核 `.spinner`、`.mini-spinner`、`.btn.pulse`、`.opt.shake` 在 reduce 段都被 `animation-duration:0.01ms !important` 覆盖；检查无 `animation:` 简写在 reduce 之后覆盖（若有，将 reduce 段移至文件末尾或加 `!important`）。写 `reduced-motion-audit.md`。
6. **图表层**：实现 A7、A8；在 `theme.ts` 旁加单元测试（可选，放 `src/utils/__tests__/` 不计入强制）。
7. **收敛验证**：执行第 7 节全部 L1/L2 检查，产出 `state-unify-map.md`。
8. 写 evidence 三件（A10–A12）与 `assumptions.md` 更新。

## 7. 验收标准

见 `acceptance.json`（需求 → 检查项追溯）。本计划冻结后，验收项只允许通过升版本修改。

要点：
- R1 空态统一：grep 收敛指标 + StatusBlock variant 类型 + tsc。
- R2 reduce 覆盖：grep 图表层引用 + CSS 审计文件存在。
- R3 对比度：`contrast.test.ts` 全绿 + 例外清单 reason 非空。
- R4 回归：176 用例（或 evidence 注明的实测基线）全绿、tsc、vite build 通过。
- R5 禁止路径：`git diff --name-only` 不包含禁止路径。

## 8. 假设与待确认

| 编号 | 假设/问题 | 不确认时的默认处理 | 找谁确认 |
|---|---|---|---|
| Q1 | `.btn-primary` 白字/accent 3.09 不达 4.5 | 新增 `--accent-btn` 令牌压暗按钮底色，不改 `--accent` 品牌色 | 终审（lead） |
| Q2 | `--faint` 深 3.32 / 浅 2.55 | 调亮至 ≥4.5；纯装饰用途进例外清单 | lead |
| Q3 | `--link`、`--ok` 浅色不达标 | 同色相压暗至 ≥4.5 | lead |
| Q4 | 动画关闭范围 | 仅系统 reduce 媒体查询 | — |
| Q5 | SoulReport 表格内空态 | 用 `state-box--compact` | — |
| Q6 | 测试位置 | `src/utils/__tests__/contrast.test.ts`，不改 vitest 配置 | — |
| Q7 | 「176 用例」基线 | 执行前实测为准，写入 baseline.log 注明 | — |

## 9. 自由度

- **必须照做**：不改 `--accent` 色值；不引新依赖；不 commit；只改第 3 节列出的文件；空态统一必须以 `.state-box` 为唯一基类；删除 `.score-loading` / `.soul-empty` 定义；对比度测试必须存在且通过（例外必须有 reason）。
- **可自行决定**：具体的明度数值（以「刚好过阈值 + 微留余量 ≥4.6」为准，即最小幅度）；`--accent-btn` 的具体色值；compact/inline 的 padding 细节；A3 是否改为 StatusBlock。
- **超出范围必须先问**：修改品牌色相、新增依赖、改动 `src/api/` / `store/` / 配置文件、删除除 `.score-loading` / `.soul-empty` 以外的 CSS 类。

## 10. A 的自检清单（冻结前逐项确认）

- [x] 每个产物都有精确路径和 `artifact_type`
- [x] 每个需求至少对应一个可执行检查项
- [x] 所有 L1/L2 检查都有命令、工作目录、期望结果、超时
- [x] 无歧义表述；歧义已列入第 8 节
- [x] 没有要求 B 做其能力范围外的事（工具 / 上下文 / 网络 / 权限）
- [x] 非功能要求（安全 / 性能 / 日志 / 许可）已写（无新依赖、无网络、无 commit）
- [x] 不可逆动作已标注需人工确认（本轮无不可逆动作；删除 CSS 段可由 git 回退）
