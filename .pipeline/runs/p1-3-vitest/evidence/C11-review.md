# C11 终审评审（模型 A，独立复核）

- 评审时间：2026-10-21 21:35（+08:00）
- 评审范围：plan.md v1、acceptance.json、freeze.json、delivery-report.md、evidence 全部文件、测试源码、`git diff HEAD`
- 结论：**PASS（L1 / L2 全部通过，L3 评审通过）**，附若干非阻断的遗留问题。

---

## 1. 独立复跑结果

环境：`cbg-web`，Node v24.16.0，vitest 5.0.5，@vitest/coverage-v8 5.0.5。
首次复跑时默认沙箱报 `spawn EPERM`（esbuild 加载 vitest.config.ts），与交付报告一致；按计划单次申请 `danger-full-access` 提升后复跑成功。

| 检查 | 命令 | 结果 |
|---|---|---|
| C3 | `npx vitest run` | ✅ 6 files / **168 tests passed**，exit 0 |
| C4 | `npx vitest run --coverage` | ✅ All files：**lines 100% (≥80)**，**branches 95.73% (≥70)**，funcs 100%，exit 0 |
| C5 | `npx tsc -b` | ✅ exit 0（首次因沙箱写 `node_modules/.tmp/*.tsbuildinfo` EPERM，提升权限后通过） |

覆盖率与交付报告、coverage-run.log 完全一致（未出现造假或陈旧输出；本次复跑时间戳 21:35，与证据 21:32 不同，属于真实重跑）。

## 2. 基线有效性（C8 / C6 / C7）

- **src 实现未改**：我独立计算 6 个 utils 文件 SHA256，与 `baseline.sha256` 逐个一致；`git diff HEAD -- cbg-web/src/utils` 输出为 0 行。✅
- **package.json**：`git diff HEAD` 显示仅新增 `test`、`test:coverage` 两个 scripts（原有 dev/build/preview/typecheck/seed/fetch/preview:style 全部保留），以及 devDependencies 新增 `@vitest/coverage-v8`、`vitest`（两者 `^5.0.5`）。
  - 注意：acceptance 的 C6 检查中 `devDependencies` 期望映射**不含** vitest 与 coverage-v8，按字面 C6 应当 FAIL；但 C6 的实际执行结果是 PASS，说明 C6 的 node 断言是以工作区当前值为准（即 plan Q2 的"以工作区 package.json 为依赖基线"）。这属于 acceptance 与 plan Q2 的表述内在矛盾，**判定为可接受**（见第 5 节遗留项 L-2）。
  - `dependencies` 与 HEAD 一致，未变。✅
- `package-lock.json` 在 `git status` 中为已修改（M），但 `baseline.sha256` 中记录的 lock 哈希 `576d8eec…` 与当前文件一致，说明 lock 在冻结前已处于该状态，本任务未额外改动。✅

## 3. 测试质量抽样（重点）

抽样方式：全量 grep 弱断言模式（`toBeDefined`/`toBeTruthy`/`not.toThrow` 等）→ 命中仅 `toHaveLength`、`toBeGreaterThan`，**无空断言**。随后逐行精读 predicate（36）、analytics（34）、params（41）三个文件的全部用例（共 ≥ 8 个/文件 满足要求），并核对源码中的关键分支。

**断言具体性（通过）**：期望值多为字面量或从业务规则手算，例如：
- predicate：`max_sanjian_speed=15800` 对 `sanjian_speed=158` 命中、`157.99` 不命中（×100 倍率语义正确）；`equip_level` ≤ 语义 100/99 通过、101 不通过。
- analytics：中位数 `2000 分 → ¥20`、四分位 `¥20 ~ ¥40`、`bounds [0,200,400,600]`、速度分段 `150~152 … 158+` 的归档边界、平台占比降序，均为手算值。
- params：往返一致性 `158 → 15800 → 158`、区间与单速度 ÷mult 回填，以及同 key 多选去重，均为可推导的真实值。

**边界覆盖（通过）**：空数组、单值、null/undefined/NaN/空串、等号边界（gte、price_min/max、equip_level、sign_days=500）、超 500 点抽样、奇偶中位数、serverid 仅分隔符放行。

**"改坏实现也能过"的弱断言检查（抽查结论：未发现明显假测试，但有 3 处偏弱，见下）**：
1. `predicate.test.ts` 第 135–138 行「serverOnly 下的价格归并同样只报一次」：测试名称称为 serverOnly，但注释自己承认 `price_*` 实际在本地（localKeys），断言 `filter(k==='price')).toHaveLength(1)` 仅防重复，**测试名与语义不符**。不影响正确性，但名称误导。
2. `analytics.test.ts` 第 214–223 行「空输入 KPI」循环内 `if (i === 6) continue;` 为死代码式分支（随后又单独断言 `kpis[6]`），可读性差；断言本身正确。
3. `params.test.ts` 第 220–229 行「纯数字输入 ×mult：有限数值参与倍率，非数字原样输出」：标题宣称验证倍率，但前半段 `sign_days` 字段 valueMultiply 缺省为 1，并未真正验证乘法；乘法在第 231–236 行另有用例覆盖，故只是**标题误导**，非断言缺失。
4. `analytics.test.ts` 第 238–243 行「偶数个样本时中位数为两中值的线性插值」：只断言 `raw === 2000`，对 [1000,3000] 而言线性插值恰等于均值，**无法区分"插值"与"取下/取上中位数"两种实现**。属于弱断言，但不属于假测试（结果确为 2000，且 `quantile` 的正确性由其他奇数用例与 P25/P75 用例交叉约束）。

以上 4 点均为**测试质量瑕疵，不影响"全绿 + 覆盖达标"的结论，不改变 pass 判定**。已在第 5 节列为遗留项，建议后续迭代修正命名与补充区分性用例。

## 4. findings（F1–F7）逐条判定

| 编号 | 我的判定 | 核对依据 | 严重度 |
|---|---|---|---|
| F1 `buildSignVsSpeed` 缺价写 0 | **真实缺陷**（口径不当） | 源码第 124 行 `Math.round(fenToYuan(r.price) ?? 0)` 确认：null 价被吞为 0，散点图会把"未标价"画成 0 元 | **中** |
| F2 价格口径不一致 | **真实缺陷**（与 F1 同源，属口径统一问题） | `computeAnalytics` 的 `pick(rows,'price')` 排除 null，与散点不一致，确认 | **中** |
| F3 wei/zhaocai_tou_speed 映射 tou_speed | **真实缺陷（高风险，待业务确认）** | predicate.ts 63、64 行 `gte(row,'tou_speed',...)` 确认三键共用同一字段。若快照确有独立尾速字段，则尾速筛选结果错误 | **高** |
| F4 pvp_stage 复用 pvp 积分 | **真实缺陷（语义错误）** | predicate.ts 72 行 `gte(row,'pvp',raw)` 确认。段位条件按积分比较，实际无效。应归入 UNSUPPORTED_PARAMS | **高** |
| F5 equip_level 上限语义 | **有意的业务取舍**（非缺陷） | 源码第 77 行 ≤ 语义，注释说明与面板文案一致。仅提示 | 低（提示） |
| F6 buildParams 同 key 去重依赖顺序 | **有意的既有约定**（非缺陷） | 源码注释说明与原面板一致。仅提示 | 低（提示） |
| F7 formatRemain 取整为 1 分钟下限 | **有意的取舍**（非缺陷） | 取整策略偏粗，不算错误。仅记录 | 低（提示） |

**关于 findings 中"断言是否固化错误行为"的核查**：
- F1/F2、F3、F4 三处确实被测试**如实断言为当前（疑似错误）行为**，例如 `analytics.test.ts:189-192` 断言 price=null → value[2]===0，`predicate.test.ts:155-160` 断言 wei/zhaocai_tou 与 tou_speed 同字段。这是 plan 明确要求的"如实编码当前行为、记入 findings"，**符合规范**，不属于"断言错误"。
- 但需注意：这意味着若修复 F1/F3/F4，这些用例需同步更新（交付报告遗留风险 4 已声明）。我认为这是可接受的"回归基线"语义。
- **未发现需要强制修正测试的"断言错误"**（即测试与源码行为不符的情况）——全部 168 个用例与源码当前行为一致，这一点由 vitest 全绿证实。

## 5. 遗留问题（按严重度）

| 编号 | 严重度 | 问题 | 处理建议 |
|---|---|---|---|
| L-1 | **高（源码缺陷，只记录）** | F3 尾速/头速映射、F4 段位复用积分，可能导致用户筛选结果错误 | 交业务/维护者确认快照字段；确认后修源码并同步更新对应用例 |
| L-2 | 中（验收合同不一致） | acceptance 的 C6 期望 devDependencies 不含 vitest / @vitest/coverage-v8，但 plan Q2 与实际工作区均已含。C6 实际 PASS 是因其比对的是工作区值而非 HEAD 值 | 建议把 acceptance C6 期望更新为含两个新 devDep 的映射（升版本 v2 或在评审中豁免），避免后续审计误判 |
| L-3 | 中（口径） | F1/F2 缺价口径不一致 | 业务统一口径后修源码 |
| L-4 | 低（测试质量） | 第 3 节 4 处偏弱/误导命名：predicate「serverOnly 价格归并」、analytics 空输入死分支与偶数中位数弱断言、params「纯数字 ×mult」标题与断言不符 | 后续小修：改名、补充区分性用例（如 [1000,4000] 区分插值与取整） |
| L-5 | 低（环境） | vitest / tsc 在默认沙箱下因 esbuild 与 tsbuildinfo 写入报 EPERM，需提升权限才能跑；CI 需放开该权限 | 记入运行说明 |
| L-6 | 低（证据） | `evidence/coverage-summary.txt` 与 `coverage-run.log` 字节级相同（同一次运行输出的两份副本），不是独立摘要 | 可接受；若需区分可在 summary 中补充阈值判定结论 |
| L-7 | 低（证据） | `C5-tsc.log` 为空文件（0 字节）。tsc 的通过证据目前只能依赖退出码，日志中无输出 | 建议执行者把 `npx tsc -b; echo EXIT=$?` 的结果写入该日志 |
| L-8 | 低（环境） | `cbg-web/node_modules` 为指向 `D:\deepseek_work-github` 的 junction，esbuild 堆栈因此显示该路径 | 记录即可，不阻断 |

## 6. L3 rubric 评分（acceptance C11）

- accuracy（测试如实编码当前行为、断言正确）：**4/5**。断言与源码一致，但有 L-4 的 4 处瑕疵（名称/弱断言），不足 5。
- completeness（边界与分支覆盖充分）：**4/5**。lines 100%、branches 95.73%，覆盖面远超阈值；扣分点为 analytics 偶数中位数等弱断言未区分实现。
- clarity（findings 描述清晰可复现）：**5/5**。F1–F7 均给出位置、现象、复现、影响、建议，并与源码行号对得上（已逐条核实）。

三项均 ≥ 4，满足 C11 通过条件。

## 7. 本次评审是否修改任何文件

- **未修改**任何 `cbg-web/src/` 实现代码、`vite.config.mjs`、`tsconfig*.json`、`package.json`、`.pipeline/templates/`。
- **未修改**测试文件（评审发现的 L-4 瑕疵属可选改进，不构成"测试错误"，按计划不强制修正，留作遗留）。
- **未执行** git commit / push / npm install。
- 本次仅新增本文件 `evidence/C11-review.md`。

## 8. 最终判定

- L1（C1–C8）：全部通过（C3/C4/C5 本次独立复跑确认）。
- L2（C9、C10）：通过。
- L3（C11）：通过（rubric 4/4/5）。
- **总判定：PASS**，attribution = none（非实现/规格/环境阻断）。
- 高严重度遗留项 L-1（F3/F4 源码语义缺陷）不阻断本轮（按任务要求只记录），须由业务确认后另起修复任务。
