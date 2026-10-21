# DOM 保真对比（dom-fidelity）

改造前快照：`evidence/baseline/`（DashboardLayout.tsx、AccountScore.tsx、SoulReport.tsx、InspectorReport.tsx、Dashboard.tsx、StatusBlock.tsx 的改造前副本）。
快照哈希：`evidence/baseline-sha256.txt`。禁止路径哈希：`evidence/baseline/forbidden-tree.sha256`。

## 1. 每个调用点的 className 集合与文案集合

### 1.1 DashboardLayout（svg 变体）

- 改造前 className 集合：`app-shell, app-header, head-in, pill-tag, mod-tabs, status-pill, search-wrap-head, head-meta, icon-btn, chips, chip, x, ...`（来自 ModuleTabs + 自身）
- 改造后 className 集合：同上（顶部栏由 ModuleHeader 渲染；`status-pill`、`chips` 作为节点注入，类名不变）
- 文案集合：标题「藏宝阁数据面板」、badge「阴阳师 · 角色」、状态文案（连接中/实时/需登录/…）、搜索占位「搜索条件，例如「一速」「图鉴」「皮肤」」、title「数据来源：…」、aria-label「切换到浅色主题 / 切换到深色主题」
- 结论：一致（C8 `classMissing=[] textMissing=[]`）

### 1.2 AccountScore（text 变体）

- 改造前 className：`app-shell, app-header, head-in, pill-tag, mod-tabs, head-meta, icon-btn`
- 改造后：同上
- 文案：「藏宝阁数据面板」「阴阳师 · 角色」「数据源 {host}（本机伴随服务代理，无需登录藏宝阁）」、aria-label「切换主题」、按钮文本 `☀`/`🌙`
- 结论：一致。`meta` 为插值文案，改造前 JSX `数据源 {…}（…）`，改造后模板串 `数据源 ${…}（…）`，运行时字符串相同；C8 以静态片段断言（见 check-classnames.mjs）

### 1.3 SoulReport（text 变体）

- className：`app-shell, app-header, head-in, pill-tag, mod-tabs, head-meta, icon-btn`
- 文案：「藏宝阁数据面板」「阴阳师 · 御魂」「模块三：粘贴链接或上传 yyx，本地算御魂报告（不依赖站点前台）」、aria-label「切换主题」
- 结论：一致（C8 通过）

### 1.4 InspectorReport（text 变体）

- className：同上
- 文案：「藏宝阁数据面板」「阴阳师 · 看号」「模块四：粘贴链接，本地算速度 / PVE / 式神 / 库存 / 配装」、aria-label「切换主题」
- 结论：一致（C8 通过）

### 1.5 Dashboard 守卫态（minimal ×3）

- offline / need-browser / need-login|captcha 改造前：`app-shell > header.app-header > div.head-in > h1 + span.pill-tag（实时模式）`
- 改造后：`ModuleHeader minimal` 渲染相同结构（无 tabs、无按钮）
- 文案：「藏宝阁数据面板」「实时模式」
- 结论：一致（C12 通过：3 处 minimal 调用，minimal 分支不含 ModuleTabs/icon-btn）

### 1.6 Dashboard 导出（useExport）

- 改造前：`exportDisabled = live.rows.length === 0`；按钮 `onExportExcel → exportExcel(live.rows, listingExportColumns)`、`onExportCsv → exportCsv(...)`、`onPrint → printArea('print-area', '藏宝阁筛选结果')`
- 改造后：`useExport({rows: live.rows, columns: listingExportColumns, printAreaId:'print-area', printTitle:'藏宝阁筛选结果'})`，`disabled = rows.length === 0`，回调等价
- 文件名：仍由 utils/export.ts 默认参数生成（未变）
- 结论：行为等价，DOM 无变化（按钮 className/文案未动）

## 2. StatusBlock 扩展（A7）

- 默认（不传 className）：根类 `state-box`，与改造前一致
- 新增：可选 `className` 追加到根类；role/aria-live 语义保持不变

## 3. 验证结果

- C8 className 保真：`CLASSNAME_FIDELITY_OK`（见 `C8-classname-diff.txt`）
- C12 minimal 守卫：`MINIMAL_GUARD_OK`（见 `C12-minimal.txt`）
- C11 禁止路径：`FORBIDDEN_UNTOUCHED_OK`（见 `C11-forbidden.txt`）
- 全量单测：176 passed（见 `C3-vitest.log`）
