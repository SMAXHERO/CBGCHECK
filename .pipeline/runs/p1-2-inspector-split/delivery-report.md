# 交付报告 — 模型 B（执行）

## 1. 冻结校验

- plan.md sha256 `fae6355b…d624` ✔ 与 freeze.json 一致
- acceptance.json sha256 `fcac2eda…82cc` ✔ 与 freeze.json 一致
- 结论：`freezeMatched: true`，按计划执行。

## 2. 产物清单（sha256）

| 编号 | 路径 | sha256 |
|---|---|---|
| A1 | cbg-web/src/pages/InspectorReport.tsx（页面壳，413 行） | `be5d36105cbd7c7eb150812fe6d6196210e44a7e4776ab6c5539ea30a404fef2` |
| A2 | cbg-web/src/pages/inspector/constants.ts | `ee5a40e347cb08cd0d3cb1a0ca96f14511b13eef7c6bec12f3570f2f4ffc395b` |
| A3 | cbg-web/src/pages/inspector/helpers.tsx | `70fa3c76cb97f60b8b9df89f777de728e116169940ef7a28b609e3e6151a0534` |
| A4 | cbg-web/src/pages/inspector/OverviewTab.tsx | `dd171a80b85dd9d0e66532afb0ab60fb2d10220dc531410903a6a2a1266fe087` |
| A5 | cbg-web/src/pages/inspector/SpeedTab.tsx | `cbc569b87720366b9eefbf1981f5f5b231b17ed9730581dd2560efbdefd6d067` |
| A6 | cbg-web/src/pages/inspector/PveTab.tsx | `d7cd37ce4e4d8434610559a77307f38616c14dc21827e92a54d68c0381153665` |
| A7 | cbg-web/src/pages/inspector/HeroTab.tsx | `ffa867c9eb01dbd4e3e56ca02c2aade38ed1df3c2ab451dce05e9db18825b86a` |
| A8 | cbg-web/src/pages/inspector/RelicsTab.tsx | `390efacc26981ebb22f3031da8bbf4ff8ff49104156538faca3ff97d46356534` |
| A9 | cbg-web/src/pages/inspector/CalcTab.tsx | `57568d09e7c6d84b3fdb1811e97f3f134d9d5c9edf4f21e0d9be7fb5415fb66c` |
| A10 | .pipeline/evidence/refactor-map.md | `73cefab03a6d5590d9a68e91f7cd00b7c67a6803adae3392a669d0035ed876c7` |
| A11 | .pipeline/evidence/InspectorReport.orig.tsx | `741f7293f5901287aa77cc5da518fc505b0ef5faf8a9d6b62e989f6a8d2fb850` |

完整哈希见 `.pipeline/evidence/artifact-sha256.txt`。`baseline/InspectorReport.orig.tsx` 与 A11 sha256 一致（已核对，复用）。

## 3. 环境与命令

- 工作目录：`D:\deepseek_work\github-work`（已 cd 确认；未使用默认 cwd）
- 未执行 `npm install`，未新增依赖；`package.json` / `package-lock.json` 哈希与基线一致。
- 类型检查：`npx tsc -p tsconfig.app.json --noEmit` → 0（见偏差 D2）
- 构建：`npx vite build` → 0，built in 7.47s
- 未 commit、未 push。

## 4. 验收结果（见 L1-L2-report.md）

- 通过：C1、C2、C3、C4、C5、C7、C8、C9、C10、C12；C11 人工抽检通过。
- **未通过：C6（页面壳 413 行 > 250）**。其余新增文件全部 ≤161 行。

## 5. 偏差（重要）

- **D1 页面壳行数超限（C6 / R4）**：计划同时要求「所有 hook/effect/handler 保留在页面壳」（约 246 行）与「页面主文件 ≤250 行」，并保留 header/输入卡/摘要卡 JSX（约 167 行）。两者在不迁移 hook 的前提下数学上不可能同时满足。我选择**遵守 hook 保留约束**（语义风险更大的是迁移 hook），因此 C6 对 `InspectorReport.tsx` 不通过。**需要 A/用户裁决**：(a) 允许把 hook 中的纯派生/请求函数抽到 `inspector/useInspectorReport.ts` 自定义 hook（不改依赖与时序），或 (b) 放宽页面壳行数上限。本次未擅自做。
- **D2 tsc 检查方式变化**：`npx tsc -b` 因 `node_modules` 符号链接指向仓库外不可写目录，写 tsbuildinfo 报 EPERM。改用 `tsc -p tsconfig.app.json --noEmit`，检查项相同（严格模式、noUnusedLocals 等全部生效），退出 0。
- **D3 构建沙箱提权**：`vite build` 因 esbuild 子进程 EPERM 失败，申请一次沙箱提升后通过。代码未受影响。
- **D4 已有未提交改动**：仓库中 `cbg-web/src/pages/InspectorReport.tsx` 等文件在本次开工前已是 M 状态（Q7 假设）。本次未回滚任何已有改动；`git status` 中禁止路径与开工前基线 `forbidden-baseline.txt` 完全一致，证明本次未越界。
- **D5 Q7 默认处理**：按计划第 8 节默认，未向用户提问（遵守禁止 ask_user_question 的指令）。

## 6. 假设（按计划第 8 节默认）

- Q1 行数含空行与注释（wc -l 原始值）。
- Q2 子组件沿用 `export const X = (props) =>` 箭头风格，全文统一。
- Q4 子组件接收 setter 作为 props（仅转发，不新增状态）。
- Q5 派生值（`heroGroups`、`sourceText`、`ov/speed/pve/heroSkills`）留在页面壳计算后下传。
- Q6 以 `wc -l` 为准。

## 7. 未决 / 遗留风险

- **C6 未通过**（见 D1），是本次交付的主要遗留项，需裁决后补做。
- `tsc -b` 增量缓存未更新（EPERM），后续若用 `tsc -b` 做 CI 需修复 `node_modules` 符号链接的写权限。
- 未在浏览器中做人工视觉回归；行为保证依据为：JSX 文本/className 集合 100% 一致（43/43，0 缺失）、hook 与依赖数组未改、请求函数未改、类型检查与构建通过。建议上线前补一次手工点击回归（6 个 Tab）。
- `InspectorReport.orig.tsx` 证据副本保留，便于 diff 复核。

## 8. 结论

拆分完成：6 个 Tab 视图 + 常量 + 工具共 9 个新文件，全部 ≤161 行；页面壳保留全部 hook/handler 与具名导出。**交付状态：部分交付（delivered = true，但 C6 未通过，需 A/用户裁决 D1 后方可视为完全通过）。**
