# C18 终审复核：P1-5 样式轮（模型 A）

- 复核人：模型 A（终审，独立会话）
- 复核日期：2026-10-21
- 复核范围：只读审查 + 独立复跑；未修改任何实现文件，未 commit / push，未 npm install。
- 环境说明：`ops_bash` 执行器在本轮启动即崩溃（EXECUTOR_UNAVAILABLE / CreateFileMapping），改用 pwsh。esbuild 子进程被沙箱 EPERM 拦截，对 vitest / tsc / vite build 各申请了一次 danger-full-access 提权复跑，均为复核用途。

---

## 1. 复跑结果

| 项 | 命令 | 结果 |
|---|---|---|
| 全量单测 | `npx vitest run`（cbg-web） | **205 passed / 205**，8 个文件全绿（contrast.test.ts 29 用例） ✅ |
| 对比度单测 | `npx vitest run src/utils/__tests__/contrast.test.ts` | 29 用例通过（含于上条） ✅ |
| 类型检查 | `npx tsc -p tsconfig.app.json --noEmit` | exit 0 ✅ |
| 生产构建 | `npx vite build` | exit 0，built in 7.49s，3832 modules ✅ |

说明：`tsc -b` 因 `node_modules` 为指向 `D:\deepseek_work-github\cbg-web\node_modules` 的符号链接，写 `.tsbuildinfo` 时 EPERM，故以等价的 `tsc -p tsconfig.app.json --noEmit` 替代（与 B 一致，属环境限制）。

---

## 2. 对比度独立验算（非信 B 的表）

按 WCAG 2.1 相对亮度公式，在 PowerShell 中一次性重算（公式：`(Lmax+0.05)/(Lmin+0.05)`，线性化阈值 0.03928）：

| 配对 | 前景 | 背景 | 重算值 | 阈值 | 结论 |
|---|---|---|---|---|---|
| 深色 --faint | #818997 | surface #161920 | **4.99** | 4.5 | ✅ |
| 深色 --faint | #818997 | surface-2 #1c2029 | **4.63** | 4.5 | ✅ |
| 深色 --faint | #818997 | surface-3 #232833 | **4.19** | 4.5 | ❌ 未覆盖（见遗留 L-1） |
| 深色 白字 | #ffffff | accent #ff5a45 | 3.09 | 4.5 | 旧值，已不再用于 btn-primary |
| 深色 白字 | #ffffff | accent-btn #cc4837 | **4.62** | 4.5 | ✅ |
| 浅色 --faint | #666c76 | #ffffff | **5.29** | 4.5 | ✅ |
| 浅色 --faint | #666c76 | surface-2 #f7f8fa | **4.98** | 4.5 | ✅ |
| 浅色 --faint | #666c76 | surface-3 #eef1f5 | **4.67** | 4.5 | ✅（与 B 报告一致） |
| 浅色 --link | #156fee | #ffffff | **4.63** | 4.5 | ✅ |
| 浅色 --ok | #12873d | #ffffff | **4.61** | 4.5 | ✅ |
| 浅色 白字 | #ffffff | accent-btn #cc4837 | **4.62** | 4.5 | ✅ |
| 浅色 accent | #ff5a45 | #ffffff | 3.09 | 3.0(UI) | ✅（品牌色仅作 UI 件） |

**结论：B 的 after 数值全部复现正确**，before/after 表可信。

---

## 3. 测试本身的可靠性（contrast.test.ts）

**解析方式**：
- `extractBlock` 用 `indexOf(selector)` 定位 `:root[data-theme='dark']` / `:root[data-theme='light']`，取到第一个 `{` 与其后第一个 `}` 之间。**可靠性：中等。** 只要两块内不嵌套大括号（当前 CSS 变量块满足），取值正确。若将来块内出现嵌套规则，会截断，但会表现为"找不到令牌"而非静默错误——`解析出两个主题的关键令牌` 用例会兜底拦截（它断言 `text/surface/surface-2/faint/accent/accent-btn/on-accent` 均解析为 6 位 hex）。
- `parseTokens` 只匹配 `--name: #hex;`，**rgba 被跳过**（符合注释）。**核心 17 个配对用到的令牌都是 hex，不存在 `var(--x)` 引用需要解析**——经核查，`:root` 块内配对令牌的值均为字面量 hex，未见 `var()` 间接引用，故"变量引用解析"问题在本测试范围内不存在。
- 注意：`dark` 只读 `:root[data-theme='dark']` 块，依赖 "默认 :root 与 dark 同步" 的约定（注释已写明）。若有人只改 `:root` 默认块而不改 dark 块，测试不会发现。属可接受但需记录（L-3）。

**断言是否真的生效（已确认）**：
- 阈值常量 `TEXT=4.5` / `UI=3.0` 直接参与 `toBeGreaterThanOrEqual`，不是空转。
- 我做了推演：若把 `--faint` 改回 `#626c7e`（原值，dark on surface = 3.32），`dark: --faint on surface` 用例会以 `expected 3.32 to be greater than or equal to 4.5` 失败。**断言有真实拦截力。**
- 但 PAIRS 中**没有** `on-accent on accent`（即旧的 3.09 配对）。这是有意的：`accent` 已不再承担白字背景，换成 `accent-btn` 的配对才是正确约束。不过这意味着**若有人把 `.btn-primary` 改回 `var(--accent)`，测试不会失败**（见 H-1）。

**例外清单是否空转**：
- `EXCEPTIONS = []`，`isException` 永远返回 undefined，所以"例外分支"在当前是**死代码**，不是空转断言——它没有放水任何配对。
- 例外的 reason 校验用例 `例外清单每一项都带 reason 且字段完整` 在空清单下是**空循环通过**，属于占位，不构成证据。这一点 B 的报告已说明"结构上强制 reason 非空"，我认可其设计，但需注意它当前不验证任何东西。

**"先调断言再让代码过"的排查**：
- 对比 before/after：B 的 `contrast-before-after.md` 明确记录 "浅色 --faint 初版仅 4.37，测试发现后二次修正"——这是**先让测试暴露问题，再改代码**，方向正确。
- 阈值 4.5/3.0 未被下调，PAIRS 也未删减，属于"改代码达标"而非"改断言迁就"。**未发现篡改断言的迹象。** ✅

---

## 4. 视觉统一审查（index.css / StatusBlock / 调用点）

**删除确认**：
- `score-loading`、`soul-empty` 在 `cbg-web/src` 全目录（ts/tsx/css）**0 命中**。✅ C1 通过，且 state-unify-map 所述的注释残留已清理。
- `.state-box` 基类定义（L1038，`padding:40px 16px; text-align:center; color:var(--dim)`）保留为唯一基类。✅

**修饰类**：
- `.state-box--compact`（padding 18px 12px，font 12.5px）与 `.state-box--inline`（flex 单行左对齐）均已定义，子选择器 `.big`、`.spinner` 也对应。✅
- `StatusBlock.variant` 三态 `block | compact | inline` 类型收窄正确；`block` 不加修饰类，渲染的根 class 为 `state-box` 或 `state-box--compact|inline` + 可选 className。✅
- DOM 语义：loading 分支 `role="status" aria-live="polite" aria-busy="true"`，非 loading 分支 `role="note"`。FilterPanel 原为无 role 的裸 div，现获得 `role="note"`，属于**无害的语义增强**（不打扰焦点）。

**调用点迁移（4 处 + Dashboard）**：
- AccountScore:672 → `variant="inline" loading`。✅ 原 `score-loading` 的 role/aria 保持。
- SoulReport:62、:623 → `variant="compact"`。✅ 两处都是在表格/表格容器上下文（`.soul-table-wrap`）内。**compact 不会撑破布局**：compact 只改 padding 与字号，不设定宽度/高度/overflow，宽度由容器流式决定；`.soul-table-wrap` 本身承担滚动。✅
- FilterPanel:184 → 默认 block。✅ 保留 `<br/>` 内容。
- Dashboard 3 处未改，已是 StatusBlock。✅

**间距/颜色变化（已在报告中声明，我确认其合理）**：
- AccountScore 加载由 AntD `Spin` 改为统一 `.spinner`：视觉变化，已声明。
- SoulReport 空态颜色由 `--faint` 变为 `--dim`（compact 基色继承 block 的 `--dim`）：**这是一处降级，不是升级**——`--dim` 对比度 6.12 高于 `--faint`，可读性更好，但"层次"上空态文字变亮，与表格其它 `--faint` 辅助文字的层级略有错位。属观感问题，非缺陷（见 M-2）。

---

## 5. reduced-motion 审查

**`prefersReducedMotion()`（theme.ts:139）**：
- 显式处理了 `typeof window === 'undefined'`（SSR）与 `typeof window.matchMedia !== 'function'`（旧环境/测试桩），缺失时返回 `false`，即**默认保留动画**，不误伤正常用户。✅ 这是正确的失败方向。

**`EChart.tsx` 合并顺序（:135）**：
- `{ ...chartMotionOptions(), ...option }`：**展开顺序正确**——`option` 在后，调用方显式写的 `animation` 会覆盖默认的 `false`。这满足"只在 reduce 时关闭、调用方可覆盖"的要求。✅
- 注意一个细节：`chartMotionOptions()` 在**正常模式返回 `{}`**，所以正常用户的 option 原样透传，**不影响任何现有图表**。✅
- 但这里有一个局限：`chartMotionOptions` 只在 `setOption` 时求值一次（依赖 `option` 变化才重新执行）。若用户在会话中途切换系统"减少动态"，已渲染图表不会即时响应，直到下一次 option 变化。属可接受的行为，但应记录（M-1）。

**CSS reduce 段（index.css:2569）**：
- 通配 `*, *::before, *::after` + `!important` 覆盖 `animation-duration / iteration-count / transition-duration / scroll-behavior`。
- 复核清单中的动画：`.spinner`(spin)、`.mini-spinner`(spin)、`.btn.pulse`(pulse-shadow)、`.opt.shake`(shake)——**全部被覆盖**。
- `animation-duration:0.01ms` + `iteration-count:1` 对 `infinite` 动画成立（spinner 与 pulse 会在 0.01ms 内结束）。✅ 与 B 的审计一致。
- reduce 段位于文件末尾（L2569），此后无 `animation` 简写回写。✅ 我通过 grep 复核：`animation:` 声明均位于 reduce 段之前。

---

## 6. 副作用审查（token 调整影响面）

**`--faint` 变深（深色 3.32→4.99，浅色 2.55→5.29）**：
- 这是本轮影响面最大的改动。`--faint` 被用于 ~50 处（grep 计数），包括辅助提示、页脚、`.cancel-hint`、`.hint` 等。
- 深色 `--faint #818997` 与 `--dim #8f99ab` 的亮度差极小（4.99 vs 6.12 on surface）。**层次风险：** 深色下 `--faint` 与 `--dim` 已经非常接近，原本"`--faint` 比 `--dim` 更弱"的层级感被压缩，辅助文字与次要文字视觉趋同。这属于**设计层次变平**的副作用，需终审人工确认（M-3）。
- 浅色 `--faint #666c76` 接近 `--text-mid`/`--dim` 的灰阶，同样存在层级压缩。
- 报告承认"允许观感变化"，但**未评估层级压缩**。这是我认为的主要视觉遗留风险。

**`.btn-primary` 用色完整性**：
- 默认态 `background: var(--accent-btn)`（:1116）✅
- hover `background: var(--accent-btn-hover)`（:1171，`:hover:not(:disabled)`）✅
- disabled：`.btn:disabled` 仅设 `opacity:0.45`，背景仍为 `--accent-btn`，白字在 0.45 透明度下对比度会显著下降，但这是**所有按钮统一的禁用策略**，非本轮引入，记录即可（L-2）。
- active / focus 态：未单独定义，沿用默认，无 `--accent` 残留。✅

**遗漏的 `background: var(--accent)` + 白字（重要）**：
我核对了所有 `background: var(--accent)` 站点及其 `color: var(--on-accent)`：

| 行 | 选择器 | 白字 | 对比度 | 处理 |
|---|---|---|---|---|
| 619 | `.card-head .badge` | `--on-accent` | **3.09** | ❌ **未迁移**（徽标数字） |
| 737 | `.opt.on` | `--on-accent` | **3.09** | ❌ **未迁移**（选中的选项按钮） |
| 408 | （需确认，见下） | — | — | 见注 |
| 1434 | `.mod-dot.dot-a` | 无文字 | — | 纯色点，不适用，✅ |

- **`.card-head .badge` 与 `.opt.on` 是白字压 `--accent` 的 3.09 配对，并未纳入 `--accent-btn`。** 它们不是 `btn-primary`，所以不在 B 的迁移范围内，但它们**同样违反 4.5 阈值**，而 `contrast.test.ts` 因为 PAIRS 只含 `on-accent on accent-btn`，**不会拦截这两处**。这是测试覆盖的盲区，也是本轮的一个遗漏（H-1 的具体实例）。
- 注：`.opt.on` 的 3.09 是否算 UI 组件（3.0 阈值）有争议——选中态的文字属于文本，应按 4.5 计；徽标数字同理。判定为**文本**，故按 4.5 不达标。

---

## 7. C16 / C17 判定（不只看 git diff 是否有输出）

**判定依据：文件 mtime 与冻结时间线对比。**

冻结时间线：
- `plan.md` mtime：**21:59:33**
- `freeze.json` mtime：**21:59:53**
- `acceptance.json` frozenAt：22:10:00（注：该字段与文件 mtime 不一致，属 A 侧元数据，见 L-4）
- 本轮 B 的执行开始：约 **22:00**（据交付报告）

禁止路径 mtime：

| 路径 | mtime | 相对冻结 | 本轮是否触碰 |
|---|---|---|---|
| cbg-web/package.json | 21:37:47 | 早于 21:59:53 | **否**（前序） |
| cbg-web/package-lock.json | 21:18:41 | 早于 | **否**（前序） |
| cbg-web/vite.config.mjs | 2026/10/17 | 远早于 | **否** |
| cbg-web/vitest.config.ts | 21:55:32 | 早于 | **否**（前序 vitest 基建，早于冻结 4 分钟） |
| cbg-web/src/api/account.ts | 20:17:55 | 早于 | **否**（前序 P0） |
| cbg-web/src/api/inspector.ts | 20:18:02 | 早于 | **否**（前序 P0） |
| cbg-web/src/api/live.ts | 20:18:51 | 早于 | **否**（前序 P0） |
| cbg-web/src/api/soul.ts | 20:17:59 | 早于 | **否**（前序 P0） |
| cbg-web/src/store/useAppStore.ts | 2026/10/17 | 远早于 | **否** |
| .pipeline/templates/* | 21:58:32 | 早于 21:59:33 | **否**（在冻结前一分钟内由 A 侧置入，属模板，非 B 修改） |

**结论：本轮 B 未触碰任何禁止路径。** C16/C17 的 FAIL 来源是**冻结之前**的工作区未提交改动（前序 vitest 基建 + 前序 P0 api 改动），而非本轮执行产生。`git diff` 之所以有输出，是因为它对比的是 **git HEAD**，而非"本轮开始时的基线"。

**结论性裁定**：
- **C17 判定为"环境/基线定义问题"，非本轮缺陷。** 检查项的语义应为"本轮未修改禁止路径"，而当前实现以"相对 HEAD 无 diff"判定，二者不等价。建议 A 将 C17 的基线改为"冻结时间戳之后的 mtime 变化"，或在 freeze.json 中登记前序改动哈希后做差分。
- **C16 同理**：`package.json` 的 +6 行与 `package-lock.json` 的 +357 行是 21:18–21:37 的前序 vitest 基建（vitest.config.ts 21:55 为其配套）。**本轮 B 未新增依赖**——我核对：`package.json` 的 mtime 早于冻结，且 B 的交付报告明确"未 npm install"，C13 中 vitest 能运行说明依赖已在前序就位。
- 但严格按 acceptance.json 字面，C16/C17 **确实是 FAIL**（git diff 有输出）。我不因"语义上不是本轮改的"而擅自改判为 PASS。这需要 A 的最终裁定（见第 9 节）。

---

## 8. 遗留项（按严重度）

### 高（High）
- **H-1 白字压 `--accent` 的 3.09 残留两处**：`.card-head .badge`（:619）与 `.opt.on`（:737），白字 on `--accent #ff5a45` = 3.09，**未达 4.5**，且不在 `btn-primary` 迁移范围，测试也不覆盖。建议：这两处的文字背景改用 `--accent-btn`，或在测试 PAIRS 中补 `on-accent on accent`（会失败，需同步修复或列例外）。**这是本轮唯一会被视为"未达标"的实质缺陷。**

### 中（Medium）
- **M-1 reduce 仅在 option 变化时生效**：图表已渲染后切换系统"减少动态"不会即时生效。可接受，但应在 reduced-motion-audit.md 中明确记录为已知局限（当前审计文档未提及）。
- **M-2 SoulReport 空态颜色降级**：`--faint`→`--dim` 导致空态文字变亮，与表格辅助文字层级错位。观感问题，需终审确认是否接受。
- **M-3 `--faint` 变深导致层级压缩**：深色下 `--faint`(4.99) 与 `--dim`(6.12) 亮度差缩小，辅助与次要文字趋同。报告未评估。需人工视觉确认。

### 低（Low）
- **L-1 深色 `--faint` 在 `--surface-3` 上 4.19 未覆盖**：B 已如实记录。`--surface-3` 用于 hover/选中块，`--faint` 用于 10.5–12.5px 辅助提示，且 hover 瞬时可见。建议要么提亮 `--faint` 至 ≥4.5（约需 #8a92a1 量级），要么在 EXCEPTIONS 中列例外并写 reason。**不构成阻断。**
- **L-2 `.btn:disabled` 白字透明度**：opacity 0.45 下白字在 #cc4837 上对比度会降至约 2.x，属所有按钮统一策略，非本轮引入。记录即可。
- **L-3 对比度测试 dark 仅读 data-theme 块**：依赖 `:root` 与 dark 块同步的约定，无自动校验。建议补一条"两块同步"断言。
- **L-4 acceptance.json 元数据**：`frozenAt: 22:10:00` 晚于 `freeze.json` 的 21:59:53 且晚于 B 的执行，与文件实际冻结时间不一致，可能造成审计歧义。
- **L-5 EXCEPTIONS 为空时的 reason 校验为空循环**：不构成证据，建议在报告中注明此为占位机制。
- **L-6 `tsc -b` 环境限制**：`node_modules` 符号链接导致 EPERM，以等价 noEmit 替代，已记录。
- **L-7 C2/C3/C8 字面计数偏差**：语义满足，B 已如实列出，同意接受。

---

## 9. 结论

**技术验证层面：全部通过。** 205/205、tsc noEmit exit 0、vite build exit 0；对比度 after 数值我独立重算全部复现正确；reduced-motion 合并顺序、降级分支、CSS 覆盖均正确；state-box 统一与 StatusBlock variant 实现干净，无残留引用，4 处调用点迁移完整且 compact 不破坏表格布局；未发现 B 篡改断言或放水阈值的迹象。

**但存在一处实质性遗漏（H-1）：** `.card-head .badge` 与 `.opt.on` 仍为白字压 `--accent` 的 3.09，违反 WCAG AA 4.5 阈值，且因测试 PAIRS 未覆盖而未被发现。这与 P1-5"对比度达标"的目标直接冲突，应在本轮修复或显式列入例外（并给出理由）后才可视为达标。

**C16/C17：** 按 mtime 与冻结时间线判定，**本轮 B 未触碰任何禁止路径，FAIL 源于冻结前的前序未提交改动**，属于检查项基线定义问题（git HEAD 基线 vs 冻结基线）。我认为应在 A 侧裁定：要么修正 C16/C17 的判定基线，要么将前序改动登记进 freeze.json；**不建议直接将其判为本轮实现缺陷。**

**建议：** H-1 修复（或列例外）后可放行；M-2/M-3 需人工视觉确认；C16/C17 由 A 裁定基线。

---

## 10. 结论一览

- 技术验证：✅ 通过
- 对比度 after 数值：✅ 独立复现
- 测试可靠性：✅ 断言有效，无篡改迹象；⚠️ 覆盖盲区（H-1）
- 统一与 reduce 实现：✅
- 副作用：⚠️ --faint 层级压缩（M-3）、空态降级（M-2）
- C16/C17：⚠️ 判定为前序改动 + 基线定义问题，**非本轮缺陷**，待 A 裁定
- **总体：有条件通过**（需先解决 H-1）
