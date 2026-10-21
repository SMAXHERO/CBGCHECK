# 执行计划 v1

- 计划版本：v1
- 冻结时间：2026-10-21T21:20:00+08:00
- 作者：模型 A（route: deepseek / claude-haiku-5-5）
- 执行者：模型 B（route: 同上，由调度指定）

## 1. 目标与非目标

### 目标（可验证）

1. 在 `cbg-web` 内建立 vitest 单元测试基线，纯函数层全部可通过 `npx vitest run` 运行且全绿。
2. 覆盖 `src/utils/predicate.ts`、`params.ts`、`analytics.ts` 三个核心模块（正常路径 + 边界 + 关键语义：×100/×10000 倍率、区间、排序、去重）。
3. 选做覆盖 `format.ts`、`sort.ts`、`columns.ts`。
4. 目标文件达到覆盖率阈值：lines ≥ 80%、branches ≥ 70%（`npx vitest run --coverage`）。
5. 不破坏既有构建：`npx tsc -b` 仍通过。
6. 产出测试清单、覆盖率摘要、缺陷发现报告，作为回归基线文档。

### 非目标 / 明确不做

1. 不修改任何 `src/` 下的实现代码（包括 `src/utils/*.ts`）。发现 bug 只记录，不修复。
2. 不改 `vite.config.mjs`，不改 `tsconfig*.json`，不改 `.pipeline/templates/`。
3. 不新增运行时依赖；不改已有依赖版本；不执行 `npm install`，不联网安装任何包。
4. 不做 React 组件测试、不做 e2e、不引入 jsdom/happy-dom。
5. 不 git commit / push。
6. 不对 `api/`、`components/`、`pages/` 写测试。

## 2. 输入

| 编号 | 类型 | 路径/来源 | 说明 |
|---|---|---|---|
| I1 | 源码 | `cbg-web/src/utils/predicate.ts` | 条件判定与参数支持分类（主要目标） |
| I2 | 源码 | `cbg-web/src/utils/params.ts` | 条件 ↔ 接口参数双向转换（主要目标） |
| I3 | 源码 | `cbg-web/src/utils/analytics.ts` | KPI / 分位数 / 直方图聚合（主要目标） |
| I4 | 源码 | `cbg-web/src/utils/format.ts`、`sort.ts`、`columns.ts` | 选做 |
| I5 | 源码 | `cbg-web/src/types.ts`、`cbg-web/src/api/searchSchema.ts` | 仅类型，测试中构造 fixture |
| I6 | 配置 | `cbg-web/tsconfig.app.json`、`cbg-web/vite.config.mjs` | 只读，用于对齐 `@` 别名 |
| I7 | 基线 | `.pipeline/runs/p1-3-vitest/evidence/baseline.sha256` | src/utils 与 package.json 的 SHA256 基线 |
| I8 | 已安装依赖 | `cbg-web/node_modules`：vitest 5.0.5、@vitest/coverage-v8 5.0.5 | 直接使用，禁止安装 |

## 3. 产物清单

| 编号 | 路径 | artifact_type | 说明 |
|---|---|---|---|
| A1 | `cbg-web/vitest.config.ts` | config | 独立 vitest 配置（alias、environment、include、coverage） |
| A2 | `cbg-web/src/utils/__tests__/predicate.test.ts` | code | predicate 单测 |
| A3 | `cbg-web/src/utils/__tests__/params.test.ts` | code | params 单测 |
| A4 | `cbg-web/src/utils/__tests__/analytics.test.ts` | code | analytics 单测 |
| A5 | `cbg-web/src/utils/__tests__/format.test.ts` | code | format 单测（选做） |
| A6 | `cbg-web/src/utils/__tests__/sort.test.ts` | code | sort 单测（选做） |
| A7 | `cbg-web/src/utils/__tests__/columns.test.ts` | code | columns 单测（选做） |
| A8 | `cbg-web/package.json` | config | 仅新增 scripts `test`、`test:coverage` |
| A9 | `.pipeline/runs/p1-3-vitest/evidence/test-inventory.md` | doc | 每个测试文件 → 用例清单 → 对应源码函数/分支 |
| A10 | `.pipeline/runs/p1-3-vitest/evidence/coverage-summary.txt` | data | 覆盖率命令原始摘要 |
| A11 | `.pipeline/runs/p1-3-vitest/evidence/findings.md` | doc | 缺陷/疑点（现象/复现/影响/建议），无则写"无" |
| A12 | `.pipeline/runs/p1-3-vitest/evidence/assumptions.md` | doc | 模型 A 已写的假设（只读参考） |
| A13 | `.pipeline/runs/p1-3-vitest/acceptance.json` | config | 验收合同 |
| A14 | `.pipeline/runs/p1-3-vitest/freeze.json` | config | 冻结记录 |

> 所有 A2–A7 的 artifact_type 为 code；A1、A8 为 config；A9、A11 为 doc；A10 为 data。

## 4. 接口与约定

- 目录结构：
  ```
  cbg-web/
    vitest.config.ts                     (新增)
    src/utils/__tests__/*.test.ts        (新增，6 个文件)
  ```
- 命名规范：测试文件名与被测模块同名 `<module>.test.ts`；`describe` 用模块名；`it` 用中文描述「行为」。
- 对外接口 / 函数签名（被测对象，只读，不得修改）：
  - `predicate.ts`：`classifyConditionSupport(params: SearchParams): ConditionSupport`、`buildPredicate(params: SearchParams): PredicateResult`、`ServerIndex`（class）、`UNSUPPORTED_PARAMS: Set<string>`、`PARAM_LABELS: Record<string,string>`
  - `params.ts`：`fid(si, fi)`、`summarize(field, value, serverName)`、`buildParams(schema, selected, serverName)`、`applyParams(schema, params, selected)`、`isSelectable(field)`
  - `analytics.ts`：`buildPriceHistogram(prices, bins=8)`、`buildSpeedTiers(speeds)`、`buildPlatformShare(rows)`、`buildSignVsSpeed(rows)`、`computeAnalytics(rows)`（注：`quantile`、`mean`、`pick`、`yuan` 未导出，经 `computeAnalytics` 间接覆盖）
  - `format.ts`：`fenToYuan`、`formatPrice`、`formatPriceCompact`、`formatNumber`、`formatSpeed`、`formatPercent`、`formatRemain`、`formatSignYears`、`formatDateTime`、`compact`
  - `sort.ts`：`compareBy(field, dir)`
  - `columns.ts`：`listingExportColumns`、`listingPrintColumns`
- 数据 fixture：测试内构造最小 `Listing` 对象（用 `as Listing` 或完整字段工厂函数 `makeListing(overrides)`），不得读取仓库外的真实数据文件。
- 编码与格式规范：UTF-8；测试文件使用 TypeScript；与现有代码风格一致（单引号、分号、2 空格）。
- 断言约定：期望值优先用字面量；涉及 `toLocaleString('zh-CN')` / `Intl` 的期望值用同源表达式计算，避免依赖 ICU 差异。

## 5. 环境与命令

- 运行时与版本：Node v24.16.0（已验证）；vitest 5.0.5；@vitest/coverage-v8 5.0.5。
- 依赖与安装方式：**不安装**。依赖已在 `cbg-web/node_modules`。禁止 `npm install` / `pnpm add` 等任何安装命令。
- 构建 / 运行 / 测试命令（工作目录均为 `D:\deepseek_work\github-work\cbg-web`）：
  - 测试：`npx vitest run`
  - 覆盖率：`npx vitest run --coverage`
  - 类型检查：`npx tsc -b`
  - 等价 npm script：`npm run test`、`npm run test:coverage`
- 禁止引入的依赖或服务：jsdom、happy-dom、@testing-library/*、任何新 devDependency、任何网络请求、任何数据库/后端服务。

## 6. 执行步骤

1. 阅读 `src/utils/` 下目标源码与 `types.ts`、`searchSchema.ts`，列出每个导出函数的分支。
2. 新增 `cbg-web/vitest.config.ts`：
   ```ts
   import { defineConfig } from 'vitest/config';
   import { fileURLToPath, URL } from 'node:url';
   export default defineConfig({
     resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
     test: {
       environment: 'node',
       include: ['src/utils/__tests__/**/*.test.ts'],
       coverage: {
         provider: 'v8',
         include: [
           'src/utils/predicate.ts',
           'src/utils/params.ts',
           'src/utils/analytics.ts',
           'src/utils/format.ts',
           'src/utils/sort.ts',
           'src/utils/columns.ts',
         ],
         reporter: ['text', 'json-summary'],
         thresholds: { lines: 80, branches: 70 },
       },
     },
   });
   ```
   注意：`thresholds` 同时作用于 coverage 输出；若执行者发现 `format/sort/columns` 因 selected 而拉低整体，必须补测试而非调低阈值。
3. 在 `cbg-web/package.json` 的 `scripts` 中**仅新增**两行：`"test": "vitest run"`、`"test:coverage": "vitest run --coverage"`。不得修改 `dependencies`/`devDependencies`。
4. 编写 `predicate.test.ts`：覆盖 `buildPredicate`（空参/`search_type` 忽略/null undefined 空串跳过/未知键进 skipped/已知键进 applied/多条件 AND 语义）、`classifyConditionSupport`（localKeys vs serverOnlyKeys、价格 min/max 归并为 `price` 且只报一次）、`PREDICATES` 的关键语义（`SCALE_100` 对 `max_sanjian_speed=15800` 与快照 158 对齐；`gte` 对 undefined/NaN 字段返回 false；`equip_level` 为"≤"语义；`serverid`/`platform_type` 多值与空串；`pass_fair_show` 0/1/其他；`price_min`/`price_max` 边界含等号）、`ServerIndex`（跳过 `_meta` 与不完整条目、`name` 缺省返回原 id、`search` 空关键字返回全部、大小写与 id 子串匹配、`all`）。
5. 编写 `params.test.ts`：覆盖 `fid`、`summarize`（null/undefined/checkbox/select_server/数组/区间对象/单速度对象/普通值带 symbol）、`buildParams`（区服去重、开关、区间 ×mult、single_select_and_input 的 selectKey/inputKey 与 ×mult、多选胶囊同 key 去重、纯数字 ×mult、NaN 分支、note 跳过、无 key 跳过）、`applyParams`（清空 selected、区服回填、开关回填、区间 ÷mult、多选仅回填有效选项、普通数字 ÷mult）、`buildParams`↔`applyParams` 往返一致性（用 valueMultiply=100 的一速字段 158→15800→158）、`isSelectable`。
6. 编写 `analytics.test.ts`：覆盖 `buildPriceHistogram`（空、单值、等宽分箱计数总和=N、最大值落在最后一箱、labels 最后一个含"~"、bins 参数）、`buildSpeedTiers`（边界 150/152/154/156/158/200 归档、<150 与 158+ 名称、过滤 0 计数）、`buildPlatformShare`（映射 1→iOS 2→安卓 3/4、null→未知、未知编码→类型N、按数量降序、颜色仅安卓/iOS 有）、`buildSignVsSpeed`（null 过滤、超 500 个点抽样到 500、不超限原样返回）、`computeAnalytics`（空输入 KPI 为 '-'、中位数/P25/P75 数值、最快散件一速 toFixed(2)、高战号占比、签到均值/最长年份、priceBins=8、kpis 长度=8）。
7. 编写 `format.test.ts`（选做）：`fenToYuan`（null/undefined→null、0→0、负数）、`formatPrice`（null→'-'）、`formatPriceCompact`（≥10000 元→"万"、<10000 取整）、`formatNumber`（NaN/null/undefined→'-'）、`formatSpeed`、`formatPercent`、`formatRemain`（≤0→已结束、天/小时/分钟分支、最少 1 分钟）、`formatSignYears`、`formatDateTime`（null/''→'-'、截断到秒）、`compact`（亿/万/小数）。
8. 编写 `sort.test.ts`（选做）：`compareBy` 升降序、null/undefined 永远排最后（两个方向都验证）、两边都缺失返回 0、字符串按 zh-CN localeCompare、数字比较、稳定性（Array.prototype.sort 对相等键保持原序）。
9. 编写 `columns.test.ts`（选做）：导出列 key 唯一、`listingPrintColumns` 是 `listingExportColumns` 的子集且 key 与设计清单一致、`price` 列 分→元 取整（含 null）、`tou_wei` 列 null 与 `tou_num` 为 null 时返回 null、`allow_bargain` 为 是/否、`url` 列拼接格式、`titles`/`highlights` 的 join 分隔符。
10. 运行 `npx vitest run`，直到全绿（若某用例因断言期望错误而失败，修正**测试期望**使其如实反映当前源码行为；若怀疑源码有 bug，**不得改源码**，而是保留如实断言并在 findings.md 记录）。
11. 运行 `npx vitest run --coverage`，确认目标文件达到阈值；将输出保存到 `evidence/coverage-summary.txt`。
12. 运行 `npx tsc -b`，确认仍通过（注意：`tsconfig.app.json` 的 `include` 为 `src`，测试文件会被纳入类型检查；需确保测试文件通过类型检查，若需要可在测试中显式类型标注，**不得**为通过检查而修改 tsconfig）。
13. 自检 src 未改：运行 `Get-FileHash` 对 `evidence/baseline.sha256` 中列出的 utils 文件与 package.json 做比对，输出 diff 到 `evidence/src-check.txt`。
14. 产出 `evidence/test-inventory.md`、`evidence/findings.md`（无则写"无"）。
15. 回报模型 A：完成清单与所有命令原始输出路径。

## 7. 验收标准

见 `acceptance.json`（需求 → 检查项追溯）。

**覆盖率阈值依据**：
- 目标文件中 `predicate.ts`、`analytics.ts`、`params.ts` 的核心逻辑均为纯函数，无 DOM/网络依赖，分支可达性高，lines 80%、branches 70% 在合理工作量内可达。
- `format.ts`、`sort.ts`、`columns.ts` 体量小（59/26/62 行），若纳入统计，同样可达。
- `analytics.ts` 中 `quantile`、`mean`、`pick`、`yuan` 为私有函数，经 `computeAnalytics` 间接覆盖，不会因为未导出而拉低覆盖率。
- 阈值**不低于** 80/70，不高于可达上限；若执行者实测无法达到，须补测试而非降阈值。

本计划冻结后，验收项只允许通过升版本（v2）修改。

## 8. 假设与待确认

| 编号 | 假设/问题 | 不确认时的默认处理 | 找谁确认 |
|---|---|---|---|
| Q1 | 测试位置 `src/utils/__tests__/` vs `cbg-web/tests/` | 采用 `src/utils/__tests__/`（就近，与被测模块同目录树） | 模型 A / 项目维护者 |
| Q2 | HEAD 的 package.json 无 vitest，工作区已有（来源未知） | 以工作区当前 package.json 的 SHA256 为依赖基线；执行者不得改依赖 | 项目维护者 |
| Q3 | 仓库有大量无关未提交改动 | "src 未改"以 `baseline.sha256` 中 utils 文件 SHA256 为准，不用 `git diff HEAD` | 项目维护者 |
| Q4 | 覆盖率阈值 | lines≥80%、branches≥70%，以可达性为依据（见第 7 节） | 模型 A |
| Q5 | Node ICU 对 `zh-CN` 格式化的影响 | 期望值用同源表达式计算 | 模型 A |
| Q6 | 源码潜在问题（如 `buildSignVsSpeed` 对 price=null 写入 0；`pvp_stage` 复用 pvp 字段） | 如实编码当前行为，记入 findings.md，不改源码 | 项目维护者 |
| Q7 | `wei_speed` 与 `tou_speed` 映射同一 `tou_speed` 字段 | 视为既定行为，按现状编码，记入 findings.md 待业务确认 | 项目维护者 |

## 9. 自由度

- 必须照做：
  - 不修改 `src/` 下任何实现文件（baseline.sha256 为证）
  - 不安装依赖；不修改 package.json 的 dependencies/devDependencies
  - 测试文件只能放在 `cbg-web/src/utils/__tests__/` 下
  - 只允许新增 `cbg-web/vitest.config.ts`，不改 `vite.config.mjs`
  - 不 git commit/push；不改 `.pipeline/templates/`
  - 发现 bug 只记录，不修复
- 可自行决定：
  - 每个用例的具体写法与 fixture 结构（`makeListing` 工厂等）
  - 选做模块（format/sort/columns）的覆盖深度，只要整体满足阈值
  - 测试用例的分组方式（describe 嵌套）
- 超出范围必须先问：
  - 需要修改任何 src 实现文件、package.json 依赖、tsconfig、vite.config 的情况，必须停止并上报模型 A，不得自行决定（禁止 ask_user_question，统一上报）。

## 10. A 的自检清单（冻结前逐项确认）

- [x] 每个产物都有精确路径和 `artifact_type`（见第 3 节 A1–A14）
- [x] 每个需求至少对应一个可执行检查项（见 acceptance.json requirements→checks）
- [x] 所有 L1/L2 检查都有命令、工作目录、期望结果、超时（acceptance.json）
- [x] 无歧义表述；歧义已列入第 8 节（Q1–Q7）
- [x] 没有要求 B 做其能力范围外的事（工具 / 上下文 / 网络 / 权限）——不要求联网、不要求安装
- [x] 非功能要求（安全 / 性能 / 日志 / 许可）已写：不联网、不装包、不 commit；vitest 全量运行时间有 timeoutSec 约束
- [x] 不可逆动作已标注需人工确认：无（不 commit、不删除、不改依赖）
