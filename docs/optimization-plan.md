# 全项目优化方案（2026-10-21）

> 配套代码改动见「附录 A」。本文件同时是**方案**与**验收基线**。
> 原则：只在能验证的地方动手；不做大重写；每项改动都能说清「解决了什么实际问题」。

## 0. 结论摘要

这个项目**基础质量高于同类个人项目**：已有设计令牌体系、hash 路由保留模块状态、
pre-push 敏感信息扫描、GitHub Actions 构建校验、密集且解释「为什么」的中文注释。
所以本轮优化**不是重构，而是收敛重复、补齐缺口**：

- **合并**：前端 4 份几乎相同的 HTTP request() → 1 个 api/client.ts（唯一 fetch 入口）。
- **加固**：伴生服务从「任意网页可调用、无口令」→ 可选令牌 + 来源白名单 + URL 白名单（默认行为不变）。
- **动线**：新增键盘动线（Ctrl/⌘+Enter 查询、Esc 取消）、进度 aria-live、焦点可见性。
- **可读性**：颜色收敛回令牌、状态呈现统一、本方案文档化。
- **明确不做**：4 个业务模块不合并（见 §3.3）；3 个后端服务不合并（成本大于收益）。

## 1. 现状评估

| 层 | 组成 | 规模 |
|---|---|---|
| 前端 | React 19 + Vite 7 + TS + antd 5 + ECharts 6 + zustand + React Query；4 个常驻挂载模块 | cbg-web/src 约 10.9k 行 |
| 伴生服务 | tools/cbg/scraper-service/server.mjs（Node，127.0.0.1:8791，拉起浏览器借用登录态） | 约 1.4k 行 |
| 计算内核 | soul-service（Python，御魂报告）、inspector-service（Python，看号分析） | 约 2.7k 行 |
| 交付 | start.bat 一键启动、docs/ 6 篇文档、GH Pages 自动部署、.githooks/pre-push 密钥扫描 | — |

**已具备的关键能力**（不要推翻，改造成本极高、收益为负）：hash 路由 + 模块常驻挂载、
设计令牌双主题、查询可取消 + 轮询进度、冻结式数据源（无快照兜底）、
A4 打印、Excel/CSV 带 BOM 导出、行内跳模块带 eid 上下文。

## 2. 问题清单（按性价比排序）

| # | 问题 | 证据 | 影响 | 处理 |
|---|---|---|---|---|
| P0-1 | 4 份重复的 request()，错误语义各不相同 | api/live.ts:84（不解析非 2xx body）、account.ts:257、soul.ts:130 与 inspector.ts:231（两份逐字相同） | 改一处漏三处；错误提示与重试不一致；新增接口靠复制粘贴 | **本轮合并** |
| P0-2 | 伴生服务对任意 Origin 开放且无口令 | server.mjs:617 的 CORS 常量；README「安全提醒」自述 | 用户点过「允许」的任意网页可驱动本机服务（含账号数据接口） | **本轮加固（默认兼容）** |
| P0-3 | 可及性缺口 | 全站无 :focus-visible 焦点环；无键盘查询/取消；进度仅视觉呈现 | 键盘与读屏用户动线断裂；也削弱「机器可读」 | **本轮补齐** |
| P0-4 | 样式仍有绕过令牌的硬编码 | index.css 2468 行单文件；:root 之外约 21 处 hex / 25 处 rgba / 18 处 !important | 切主题局部「切一半」；改版靠搜索替换 | **本轮收敛** |
| P1-1 | 两个 Python 服务各自实现 HTTP 外壳（CORS、JSON 信封、健康检查） | soul-service/server.py 222 行 / inspector-service/server.py 286 行 | 重复约 150 行；改协议要改两处 | 建议下一期抽 pycommon/http_service.py |
| P1-2 | 巨型页面组件 | Dashboard 549 / SoulReport 656 / AccountScore 935 / InspectorReport 1006 行 | 单文件认知负担高；多人并行易冲突 | 建议按「数据 hook / 视图块 / 表格列」拆分，一次一个模块 |
| P1-3 | 前端无自动化回归 | 只有 tsc -b + vite build | 重构靠人肉点页面 | 建议引入 vitest 覆盖 utils（predicate/params/analytics 纯函数，收益最高） |
| P1-4 | 横切能力散落页面 | 导出、打印、对比、空态各页各写一套 | 行为不一致 | 建议抽 useExport / StatusBlock（本轮已起头） |

## 3. 方案分期

### 3.1 P0（本轮执行，低风险、可验证）

1. **API 层合并**：新增 src/api/client.ts 作为唯一 fetch 出口。统一：超时、AbortError → 可读错误、
   非 JSON 响应、body.ok === false、ApiError(code, status, parsed)、GET 幂等重试。
   四个 API 模块只保留「路径 + 类型 + 超时」。**不变量**：导出类型/函数签名/超时语义不变，页面零改动。
2. **服务安全加固**（默认行为完全不变）：
   - CBG_PANEL_TOKEN：设置后除 /api/health 外要求 X-Panel-Token，恒定时间比较，401 JSON；
   - CBG_ALLOWED_ORIGINS：设置后仅回显白名单 Origin（含 Vary: Origin 与预检），未设置保持宽松并告警；
   - url 参数主机白名单（*.163.com）防 SSRF；请求体上限；
   - docs/ 与 README 同步「怎么开、怎么配」。
3. **操作动线**：Ctrl/⌘+Enter 查询、Esc 取消、输入框内不误触发；
   aria-live="polite" 播报进度；:focus-visible 焦点环；prefers-reduced-motion 降级。
4. **样式与状态呈现**：:root 外的硬编码色收敛为令牌；空/加载/错误态统一；打印样式复核。

### 3.2 P1（建议下一期，需单独排期）

- 拆巨型页面：优先 InspectorReport（1006 行，独立子页最多），按 Tab 拆组件；
- Python 服务抽公共 HTTP 外壳；
- 引入 vitest 覆盖 utils/predicate.ts、utils/params.ts、utils/analytics.ts（纯函数，零 DOM 依赖）；
- 条件状态入 URL（#/?q=...）实现「分享一套筛选」。

### 3.3 P2（明确不建议）

- **合并 4 个业务模块**：共性是「都读同一份账号数据」，但交互模型完全不同
  （筛选 / 评分 / 仓库分析 / 计算器）。硬合并会得到 3000+ 行超级页面，
  违背「机器可读 + 人类可读」，且现有 hidden 常驻挂载已解决共享状态问题。
- **合并 3 个后端服务**：scraper 是 Node（CDP 驱动浏览器），两个内核是 Python
  （requests / 数值计算）。跨语言合并成本远高于抽公共模块。

## 4. 数据安全专项

| 面 | 现状 | 本轮动作 | 后续建议 |
|---|---|---|---|
| 本机服务暴露 | 任意网页可调用 | 可选令牌 + Origin 白名单 + 参数白名单 | 保持只绑 127.0.0.1 |
| 密钥泄露 | pre-push 扫描已覆盖 | — | 已有；建议 CI 端再加 gitleaks |
| 数据落地 | 分析缓存写 cache/ | 复核缓存目录不入库（.gitignore） | 缓存加 TTL 清理 |
| 传输 | 仅本机 HTTP | 不做 TLS（无意义） | 禁止改成 0.0.0.0 监听 |

## 5. 操作动线（改造后）

    打开面板
      └─ 服务未就绪 → 引导页（只给步骤，不显示旧数据）
           └─ 在服务拉起的浏览器里登录 / 过滑块
      └─ 就绪 → 左栏选条件（可搜索、可折叠分组）
           ├─ 底部实时显示「已选 N 项 / 命中 M 条」
           ├─ 条件改动 → 「查询」按钮 pulse 提示「条件已改」
           └─ Ctrl/⌘+Enter 或点「查询」→ 进度 + 「取消」；Esc 取消
      └─ 结果 → KPI → 图表 → 明细表（排序/分页/勾选）
           ├─ 勾选 → 底部「对比清单」→ 抽屉横向对比
           ├─ 行内「评分 / 御魂 / 看号」→ 带 eid 跳模块（数据保留）
           └─ 导出 Excel / CSV / 打印 PDF

## 6. 可读性专项

- **机器可读**：API 单入口 + ApiError.code 语义；类型集中在 types.ts / api/*.ts；
  CSS 只用令牌变量（新色必须先在两套主题里定义）。
- **人类可读**：注释继续解释「为什么」；本方案文档 + 附录改动清单；
  新增能力在 README 对应章节出现一次即可，不重复铺陈。

## 7. 验收标准

1. cd cbg-web && npx tsc -b 通过；npx vite build 通过。
2. node --check tools/cbg/scraper-service/server.mjs 通过；未设环境变量时启动行为与改造前一致。
3. grep -rn "fetch(" cbg-web/src/api 只命中 client.ts。
4. 页面无新增运行时依赖；package.json 依赖不变。
5. 回滚：改动集中在 src/api/、src/index.css、src/components/、server.mjs、docs/，
   按目录 git checkout 即可回滚，不涉及数据迁移。

## 附录 A 本轮已落地（2026-10-21）

### A1 API 层合并（P0-1）

| 文件 | 变化 |
|---|---|
| cbg-web/src/api/client.ts | **新增**。唯一 fetch 实现：SCRAPER_BASE、ApiError{code,status,parsed}、request<T>(path, init?, opts?)、默认 30s、GET 幂等重试 1 次（仅网络错误/5xx，超时与 4xx 不重试） |
| cbg-web/src/api/live.ts | 删除本地 request 与 AbortController；SCRAPER_BASE 原样 re-export（页面导入路径不变）；health 仍吞异常返回 offline（3s，显式关重试）；**保留 409 BUSY 的结构化返回**，不让「服务正忙」退化成「服务不可达」 |
| cbg-web/src/api/account.ts | 删除富错误版 request；NEED_EID 的 code/parsed 语义保留 |
| cbg-web/src/api/soul.ts / inspector.ts | 删除两份逐字相同的 request（约 30 行 × 2） |

验证：`grep -rn "fetch(" cbg-web/src/api` 仅命中 client.ts；`npx tsc -b`、`npx vite build` 均通过。

### A2 服务安全加固（P0-2，默认行为不变）

| 项 | 实现 |
|---|---|
| 访问令牌 | `CBG_PANEL_TOKEN` / `--token`；除 `/api/health` 外校验 `X-Panel-Token`（或 `?token=`）；SHA-256 + timingSafeEqual；未设置时放行并打印告警 |
| 来源白名单 | `CBG_ALLOWED_ORIGINS` / `--allowed-origins`；设置后回显白名单 Origin + `Vary: Origin`；未设置保持原 `Access-Control-Allow-Origin: *`（逐字节未变） |
| SSRF 防护 | 仅对「带 scheme 的完整链接」强制 https 且主机以 `.163.com` 结尾；相对路径/裸 eid 行为不变 |
| 请求体上限 | `readBody` 超 1MB 返回 413 + `Connection: close`（代理上传仍 32MB） |
| 文档 | 新增 `docs/security.md`；README 安全提醒/已知限制、`docs/self-host.md`、`docs/getting-started.md` 同步 |

独立验证（Lead 复测）：未设环境变量启动 `--no-browser --port 18799` →
`/api/health` 200 + `access-control-allow-origin: *`、`/api/result` 200、
OPTIONS 预检 204，与改造前一致；测试进程与端口已清理。

### A3 操作动线与可及性（P0-3）

- 键盘：`Ctrl/⌘+Enter` 查询（查询中改为取消）、`Esc` 仅查询中取消；
  输入框/文本域/contenteditable 内只响应前者；非当前模块（`hidden`）不误触发。
- 读屏：底部进度 `aria-live="polite"`；加载态 `role="status"`、错误 `role="alert"`；
  条件分组头 `role="button"` + `aria-expanded/controls` + Enter/Space 折叠；
  分段控件 `aria-pressed`（顶部模块是路由链接，用 NavLink 自带 `aria-current`，不硬造 `aria-selected`）。
- 视觉：`:focus-visible` 焦点环；`prefers-reduced-motion` 降级；小按钮 26→28px 命中区。

### A4 样式与状态呈现（P0-4）

- `:root` 外硬编码色收敛为令牌；两套主题各补 `--on-accent`、`--switch-knob`、`--shadow-soft`。
- 新增 `StatusBlock.tsx`（空态/加载统一），替换 Dashboard 最明确的 3 处；其余空态不动。
- `ErrorBoundary` 内联样式改为令牌类（修复浅色主题下仍显示深色块的问题）。
- 打印区保留固定黑白灰（纸面不跟主题变）；18 处 `!important` 属 antd/打印必需，未删除。

### A5 P1-1 已落地：Python 服务公共外壳（任务板双模型流水线执行）

执行方式：任务板 3 张卡串行 —— **A 规划**（`opencode-go/claude-haiku-5-5`）→ **B 执行+自测**（`deepseek-account/deepseek-v4.1-flash-1017`）→ **A 终审**（haiku，独立会话）。契约、证据、交付报告见仓库 `.pipeline/`。

| 项 | 内容 |
|---|---|
| 新增 | `tools/cbg/pycommon/`：`httpkit.py`（CORS 头、JSON 响应、请求体读取、服务启动/信号/CLI 参数）、`cli.py`、`tests/`（8 个 unittest）、`README.md` |
| 改造 | `tools/cbg/soul-service/server.py`、`tools/cbg/inspector-service/server.py` 改为复用共享模块（两文件合计 −70 / +47 行） |
| 行为不变 | A 用 `git archive HEAD` 起改造前版本做对照：9 组请求（health / demo / meta / 404 / 静态页 / OPTIONS）状态码、JSON 键集、CORS 与 Cache-Control 头逐项 SAME；两个错误信封仍各自不同（soul `{ok,code,msg}`、inspector `{ok,error:{code,message}}`） |
| 验证 | `python -m unittest discover -s tools/cbg/pycommon/tests -t tools/cbg` → 8 tests OK；`baseline_compare.py --check` → `NO_DIFF`（Lead 在真实仓库复跑同样通过） |
| 非阻断差异 | soul 服务 Ctrl-C 不再打印 `bye`（仅 stdout 文案）；计划外补了 `tests/baseline_compare.py` 与 `baseline.json`（检查项 C5 引用但未列入产物清单，已在交付报告记录） |

> 流水线本身的经验：B 会话的 cwd 是工作区根，若那里残留同名的 `.pipeline/`，相对路径会指向旧契约并"校验通过"——首轮 B 就这么跑偏了。修法是卡片 prompt 里锁定绝对路径 + 先 `pwd` 自证；这条已写进 `.pipeline/plan.md` 的经验记录。

### A6 P1-2 已落地：拆分 InspectorReport（同一套任务板流水线）

| 项 | 内容 |
|---|---|
| 结果 | `cbg-web/src/pages/InspectorReport.tsx` **1015 → 413 行**；新增 `src/pages/inspector/` 8 个文件（6 个 Tab 视图 + `constants.ts` + `helpers.tsx`，全部 ≤161 行） |
| 做法 | 纯搬家：所有 hooks（27 处）与请求函数留页面壳，Tab JSX 迁到视图组件；回调 props 化（`runPve()` → `onRun()` 等，语义等价）；`export const InspectorReport` 与 `App.tsx` 不变 |
| 保真证据 | 终审 A 逐块 diff：6 个 Tab JSX 与原文件逐行一致；Lead 独立比对 `className` 缺失 0 / 中文文案缺失 0 / hooks 数一致（`.pipeline/runs/p1-2-inspector-split/evidence/jsx-fidelity-lead.txt`） |
| 契约修正 | 终审判定 C6（壳 ≤250 行）是 **spec 缺陷**：计划同时要求「hooks 全留壳」+「壳带 header/输入卡/Tab 条」+「壳 ≤250」，数学上不可达。A 升 v2 把壳上限放宽到 450，并证明当前实现（413）已满足 v2、无需重跑 |
| 暴露的问题 | 验收脚本本身有瑕疵：`fidelity.sh` 的 CJK grep 在本机直接报错、C3 是占位命令、C8 引用的基线文件不存在。Lead 用 `fidelity.py` 重做并留 `C8-review-addendum.md`；契约瑕疵记入下轮待修 |

> 流水线治理更新：产物已按 run 归档到 `.pipeline/runs/<任务>/`（见 `.pipeline/README.md`），避免下轮会话读到旧契约。

### A7 P1-3 已落地：纯函数层 vitest 回归基线（同一套流水线）

| 项 | 内容 |
|---|---|
| 产物 | `cbg-web/vitest.config.ts`；`src/utils/__tests__/` 6 个测试文件（predicate 36 / params 41 / analytics 34 / format 29 / sort 8 / columns 20 = **168 用例**）；`package.json` 新增 `test`、`test:coverage` |
| 依赖 | 仅 devDependencies 新增 `vitest`、`@vitest/coverage-v8`（^5.0.5），运行时依赖不变 |
| 验证 | Lead 在真实仓库复跑：6 files / **168 tests passed**（约 0.21s）；覆盖率 lines **100%**、branches **95.73%**（阈值 80/70）；`tsc -b` 通过 |
| 纪律 | **只测不改**：src 实现零改动（baseline sha256 与 `git diff HEAD` 双重确认） |
| 意外收获 | 测试过程中发现并记录 7 条疑点，其中 **F3（`wei_speed`/`zhaocai_tou_speed` 与 `tou_speed` 共用同一字段）**、**F4（`pvp_stage` 用 pvp 积分比较，段位筛选实际无效）** 被 A 判定为**高严重度真实缺陷**；测试如实固化现状，修复时需同步改用例 |
| 遗留 | 4 处测试命名/断言偏弱（如偶数中位数用例无法区分插值与取整）；acceptance C6 期望未含新增 devDep（审计口径瑕疵）；沙箱下 `npx vitest`/`tsc` 需放开 esbuild 子进程权限 |

> 本轮另一条经验：卡片会话在默认沙箱下会因 esbuild 子进程 `EPERM` 卡在审批，需要放宽权限才能跑 vitest/tsc；
> 这是环境限制，不是代码问题。

### A8 P1-4 已落地：修复 F3/F4 两个筛选语义缺陷

| 项 | 内容 |
|---|---|
| F3 | `wei_speed`（尾速度）、`zhaocai_tou_speed`（招财头速）原先都映射到 `row.tou_speed` → 「尾速」实际在筛头速。快照里没有尾速字段（`wei_num` 是尾个数） |
| F4 | `pvp_stage`（斗技段位）原先映射到 `row.pvp`（积分）→ 段位条件按分数比较，等于无效 |
| 修法 | 不从"换一个字段凑"入手，而是按项目既有机制把三者从 `PREDICATES` 移除、加入 `UNSUPPORTED_PARAMS`，并在界面归入「服务端已筛选、本地无法核对」；补 `PARAM_LABELS.wei_speed` |
| 用例 | 删除固化了错误行为的旧用例，新增 3 个回归用例（skipped / match=null / serverOnly 归类） |
| 验证 | `npx vitest run` 6 files / **171 tests passed**；覆盖率 lines 100% / branches 95.73%；`tsc -b`、`vite build` 通过 |
| 记录 | `.pipeline/runs/p1-4-fix-f3-f4/README.md`（含"为什么不映射到别的字段"的证据） |

> 这一轮由 Lead 直接完成（约 16 行实现 + 用例同步），没有再开卡片：问题边界清楚、验证手段就是已有的测试，
> 走卡片反而增加往返成本。

### A9 P1-4 已落地：横切收敛（顶栏 / 导出）

| 项 | 内容 |
|---|---|
| 新增 | `components/ModuleHeader.tsx`：统一顶栏，含三种模式（完整 svg 主题按钮 / 文本主题按钮 / minimal 守卫态），主题切换 SVG 全站单源；`hooks/useExport.ts`：把导出 Excel/CSV/打印 + 禁用条件从 Dashboard 抽出 |
| 收敛 | 4 个入口（DashboardLayout + 3 个模块页）+ Dashboard 的 3 处守卫态顶栏全部走 ModuleHeader；`pages/*` 与 DashboardLayout 中 `app-header` / `icon-btn` 归零 |
| 保真 | A 以改造前快照逐调用点 diff：DOM 层序、className、文案、aria/title、chips 位置一致；`useExport` 的禁用条件/文件名/调用顺序/依赖数组与原内联逻辑等价；未发现"顺带改行为" |
| 验证 | 真实仓库：`tsc -b` 0；vitest **7 files / 176 tests passed**（171 + ModuleHeader 5）；`vite build` 通过 |
| 未做（有意） | 视觉层的空态/加载态统一：`.soul-empty` / `.score-loading` 与 `.state-box` 的 DOM/内边距不等价，替换会改变观感。本轮只给 `StatusBlock` 加了 `className` 透传能力（预留，暂无调用方），把"视觉统一"留到专门的样式轮 |
| 遗留 | C8 只比对 className 集合与文案，不校验结构层序（由终审人工 diff 兜底）；建议后续用 `renderToStaticMarkup` 快照做成机器检查 |

### A10 P1-5 已落地：样式轮（空态统一 / reduced-motion / 对比度）

| 项 | 内容 |
|---|---|
| 空态/加载态统一 | 以 `.state-box` 为唯一基类 + `.state-box--compact` / `--inline` 两个变体；`StatusBlock` 增加 `variant`；删除 `.score-loading` / `.soul-empty`，4 个调用点全部迁移（表格内用 compact） |
| reduced-motion | CSS 段原本已覆盖动画/过渡；本轮补上 **ECharts 的 JS 动画**：`charts/theme.ts` 新增 `prefersReducedMotion()` / `chartMotionOptions()`（matchMedia 缺失时安全降级），`EChart.tsx` 在 `setOption` 前合并，reduce 时 `animation:false` |
| 对比度 | 新增 `src/utils/__tests__/contrast.test.ts`（**33 个用例**）：解析两主题令牌算 WCAG，普通文本 4.5 / UI 3.0，另有规则级静态扫描；修 token：深色 `--faint` 3.32→4.99、浅色 `--faint` 2.55→5.29、`--link` 4.10→4.63、`--ok` 3.30→4.61；新增 `--accent-btn`/`--danger-btn` 承载白字实底（`--accent` 品牌色保持不变） |
| 终审发现 | A 判 FAIL：`.opt.on` / `.card-head .badge` / `.guide-step .n` 仍白字压品牌色（3.09），且测试只校验令牌组合、扫不到规则级错误 → Lead 补修并把「规则级白字实底必须是 `--*‑btn`」写成断言 |
| 验证 | 真实仓库：vitest **8 files / 209 tests passed**；`tsc -b` 0；`vite build` 通过 |

> 需人眼确认的视觉项（无法机器验证）：`--faint` 变深后的层级压缩、空态文字由 faint→dim、空态间距变化。
> 记录在 `.pipeline/runs/p1-5-style/evidence/lead-followup.md`。

### A11 未执行（按下期排期）

其余横切抽取（对比抽屉、打印视图的进一步复用）；
P2 的模块/服务合并按 §3.3 结论不做；
建议：`.pipeline/runs` 下的历史产物可考虑在正式发版前归档或移出仓库。

## 附录 B 变更记录

- 2026-10-21 初版：P0 落地 + P1/P2 建议。
- 2026-10-21 追加：P1-1（Python 服务公共外壳）用任务板双模型流水线落地（A=haiku / B=deepseek-flash）；P1-2/3/4 仍待排期。
- 2026-10-21 追加：P1-2（拆分 InspectorReport 1015→413 行）落地；终审把 C6 阈值判为 spec 缺陷并升 v2；流水线产物改为 `.pipeline/runs/` 归档。
- 2026-10-21 追加：P1-3（vitest 168 用例 + 覆盖率基线）落地；顺带暴露 F3/F4 两个高严重度筛选语义缺陷。
- 2026-10-21 追加：修复 F3/F4（尾速/招财头速误用头速、段位误用积分），改为「仅服务端筛选」+ 回归用例，用例数 171。
- 2026-10-21 追加：P1-4 横切收敛落地（ModuleHeader 统一顶栏 + useExport），用例数 176；视觉层空态统一留待样式轮。
- 2026-10-21 追加：P1-5 样式轮落地（空态统一 + ECharts reduced-motion + 对比度基线 33 用例），用例数 209。