# 假设与默认处理（模型 A，v1）

本轮不允许 ask_user_question，以下问题按最合理默认处理。

| 编号 | 假设 | 默认处理 | 依据 |
|---|---|---|---|
| Q1 | 三个模块页的主题按钮是否统一为 SVG | 不统一，保留文本图标 `☀`/`🌙` 与 `aria-label="切换主题"` | 硬约束「视觉零变化」；统一属视觉改动 |
| Q2 | `vite.config.mjs` 文件名 | 已确认存在 `cbg-web/vite.config.mjs`，只读不改 | 目录实测 |
| Q3 | 沙箱中 vitest 报 `EPERM spawn` | 测试项记为阻塞；执行者需在可 spawn 环境复跑，不得伪造通过 | Lead 实测 `npx vitest run` 与 `node vitest.mjs run` 均失败 |
| Q4 | 工作区已有大量未提交修改 | 只改 A1–A14 范围；基线以改造前 sha256 快照为准；不回退他人改动 | `git status` 显示 README、api、store、index.css 等已 M |
| Q5 | AlertBar（G5）是否必须交付 | 选做；DOM 不保真则不交付，记入 refactor-map | 硬约束 1 |
| Q6 | Dashboard 守卫态精简头部是否纳入 ModuleHeader | 纳入（minimal 模式）；无法保真则豁免并说明 | 使 `app-header` 唯一写入点为 ModuleHeader |
| Q7 | 是否允许为 ModuleHeader 测试引入 jsdom / @testing-library | 不允许新增依赖；用 `react-dom/server` 或结构断言 | 硬约束「不新增运行时依赖」 |
| Q8 | 原审计「4 个顶部栏完全一致」 | 不成立：DashboardLayout 为 SVG+搜索+chips+状态灯变体，三个模块页为文本图标变体；按参数化收敛，不强行统一 | 逐文件读取比对 |
| Q9 | acceptance 中 C8/C11/C12 所引用的检查脚本 | 由执行者在 `evidence/` 下编写（check-classnames.mjs、check-forbidden.mjs、check-minimal-guard.mjs）；脚本需基于改造前快照（sha256 与 className 集合）做比对 | 验收需要可机器执行的检查 |
| Q10 | 改造前快照的存放 | 执行者在第 1 步把改造前文件拷贝到 `evidence/baseline/`（或仅存 sha256 + className 集合 JSON），供 C8/C11/C12 使用 | 没有快照则无法证明「保真」 |

## 执行者（模型 B）补充假设与决定

| 编号 | 事项 | 处理 | 依据 |
|---|---|---|---|
| B1 | freeze.json 嵌套结构校验 | sha256 与字节数均与 freeze.json 一致（plan.md e94738…、acceptance.json a98e9c…） | 实测 sha256sum |
| B2 | vitest 原阻塞（EPERM spawn） | 复测时已可正常运行（`npx vitest run` 通过，171 原用例 + 5 新用例） | C3 日志 `evidence/C3-vitest.log` |
| B3 | AccountScore/SoulReport 的 `.score-loading` / `.soul-empty` 能否替换为 StatusBlock | **不替换**：StatusBlock 根类为 `state-box` 且带 spinner/role，与原 `score-loading`/`soul-empty` 视觉与 DOM 不等价，违反硬约束「DOM 零变化」，按计划第 6 步第 4 条记入 refactor-map「不做」 | 计划 4 与 A4 要求 |
| B4 | FilterPanel `.state-box` 能否替换 | **不替换**：原节点无 `role`，StatusBlock 非 loading 分支会加 `role="note"`，属 DOM 变化 | 同上 |
| B5 | StatusBlock 扩展 | 仅新增可选 `className`；默认不传时输出与原实现逐字一致（`state-box` 根类） | A7 |
| B6 | AlertBar（G5） | **不做**：`.score-need.score-error` 与 `.soul-alert.err` 类名与结构不同，同组件无法在 className 不变前提下输出 | Q5 |
| B7 | vitest include 配置 | 为让 A11 运行，把 `vitest.config.ts` 的 `include` 扩展为追加 `src/components/__tests__/**/*.test.tsx`。属测试配置而非依赖；未触碰禁止路径 | 计划 5 与 A11；C11 已验证禁止路径未变 |
| B8 | A11 写法 | 用 `react-dom/server` 的 `renderToStaticMarkup` + MemoryRouter，未引入 jsdom / @testing-library | Q7 |
| B9 | useExport 类型 | 使用 `@/types` 的 `ExportColumn<T>`；未改 `utils/export.ts`（A9 不需要） | 计划 A9 默认不改 |
| B10 | 测试数 | 171 原用例全绿；另 A11 新增 5 个，总计 176，符合「允许新增 A11 用例」 | C3 |
| B11 | 检查脚本 | C8/C11/C12 脚本由执行者编写于 `evidence/`；C8 的 meta 插值文案以静态片段断言（见 check-classnames.mjs 注释） | Q9 |
