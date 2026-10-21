# 测试清单（test-inventory）

运行结果：6 个测试文件 / 168 个用例，全部通过（`npx vitest run --coverage`，详见 `coverage-summary.txt`）。

每个用例对应的源码函数/分支如下。

---

## 1. `predicate.test.ts`（36 用例）→ `src/utils/predicate.ts`

| 用例（describe › it） | 覆盖源码 |
|---|---|
| buildPredicate › 空参数时 match 为 null | `buildPredicate` 空 checks 分支 |
| buildPredicate › search_type 被忽略 | `buildPredicate` `key === 'search_type'` continue |
| buildPredicate › null/undefined/空串被跳过 | `buildPredicate` raw 空值 continue |
| buildPredicate › 未知键进入 skipped | `buildPredicate` `fn` 不存在 → skipped |
| buildPredicate › 已知键进入 applied | `buildPredicate` `fn` 存在 → applied |
| buildPredicate › 多条件 AND 语义 | `checks.every` |
| buildPredicate › 已知/未知键混合 | applied + skipped 同时 |
| classifyConditionSupport › 忽略 search_type 与空值 | `classifyConditionSupport` 三类 continue |
| classifyConditionSupport › localKeys vs serverOnlyKeys | `PREDICATES[key]` 分桶 |
| classifyConditionSupport › price_min/price_max 归并为 price | `norm` 归并 + `bucket.includes` 去重 |
| classifyConditionSupport › serverOnly 价格归并只报一次 | 同上（去重分支） |
| PREDICATES › 速度 ×100（max_sanjian_speed） | `SCALE_100` / `gte(..., true)` |
| PREDICATES › zhaocai 一速 ×100 | 同上 |
| PREDICATES › tou/wei/zhaocai_tou_speed 映射 tou_speed | 同上（映射关系） |
| PREDICATES › 整数 gte 八项 | `gte`（tou_counts/wei_counts/six_star_num/sign_days/pvp_score/pvp_stage/collect_num/goyu） |
| gte › 边界含等号 | `gte` `value >= target` |
| gte › undefined/NaN/null 字段返回 false | `gte` 非 number / 非有限数 分支 |
| gte › 目标值非法视为不限制 | `gte` `target === null` → true |
| gte › 速度 gte 对 null 字段 false | `SCALE_100` + 字段缺失分支 |
| equip_level › 小于等于语义 | `equip_level` 分支 |
| equip_level › 非数字参数不限制 | `v === null` 分支 |
| price_min/price_max › 边界含等号 | `price_min/price_max` 比较 |
| price › null 时两侧都不满足 | `row.price !== null` 分支 |
| price_min › 非数字不限制 | `v === null` 分支 |
| serverid › 多值逗号分隔、去空白 | `splitIds` + `serverid` |
| serverid › 仅分隔符时放行 | `!ids.length` 分支 |
| platform_type › 多值匹配 / 空串放行 | `platform_type` 分支 |
| pass_fair_show › 0/1/其他 三分支 | `pass_fair_show` 三分支 |
| UNSUPPORTED_PARAMS › 含典型不可判定参数 | 常量集合 |
| PARAM_LABELS › 关键参数中文名 | 常量映射 |
| ServerIndex › 跳过 _meta 与不完整条目 | `ServerIndex` 构造 `continue` |
| ServerIndex › name 命中/未命中 | `name()` |
| ServerIndex › search 空关键字返回全部 | `search` `!q` 分支 |
| ServerIndex › search 大小写不敏感（名称） | `search` toLowerCase |
| ServerIndex › search 按 id 子串 | `search` `String(entry[0]).includes` |
| ServerIndex › search 无命中 | `search` 空结果 |

## 2. `params.test.ts`（41 用例）→ `src/utils/params.ts`

| 用例 | 覆盖源码 |
|---|---|
| fid › 生成 sectionIndex_fieldIndex | `fid` |
| summarize × 9 | `summarize`：null/checkbox/select_server/数组/区间/单速度/普通值/symbol 各分支 |
| buildParams › 空选择仅 search_type | `buildParams` 初始态 |
| buildParams › schema 无 searchType 回退 role | `schema.searchType \|\| 'role'` |
| buildParams › note 跳过 | `field.kind === 'note'` |
| buildParams › 区服去重逗号拼接 | 分支 1 select_server |
| buildParams › 开关输出「是」 | 分支 2 checkbox |
| buildParams › 区间 ×mult（min 侧 / max 侧） | 分支 3 range |
| buildParams › single_select_and_input selectKey/inputKey ×mult | 分支 4 |
| buildParams › 单速度空值不输出 | 分支 4 空判断 |
| buildParams › 多选同 key 去重 | 分支 5 `usedKeys` |
| buildParams › 多选 display 经 options 映射 | 分支 5 `optionLabel` |
| buildParams › 纯数字 ×mult 与 NaN 分支 | 分支 6 `Number.isFinite` |
| buildParams › 无 key 跳过 | 分支 6 `!key` |
| buildParams › 未选中不输出 | `selected.has` |
| applyParams › 清空 selected | `selected.clear()` |
| applyParams › 区服回填 / 空串得空数组 | select_server 回填 |
| applyParams › 开关回填 | checkbox 回填 |
| applyParams › 区间 ÷mult 双侧 / 单侧 | range 回填 |
| applyParams › 单速度 ÷mult 双侧 / 单侧 | single_select 回填 |
| applyParams › 多选仅回填有效选项 / 全无效不回填 | opts 过滤 |
| applyParams › 同 key 仅回填第一个生效 | `used` 集合 |
| applyParams › 普通数字 ÷mult | 末尾普通分支 |
| applyParams › 无 key / 缺参不回填 | 缺省分支 |
| 往返一致性 × 2 | `buildParams` ↔ `applyParams`（158↔15800，区间+单速度） |
| isSelectable × 4 | `isSelectable` 各分支 |

## 3. `analytics.test.ts`（34 用例）→ `src/utils/analytics.ts`

| 用例 | 覆盖源码 |
|---|---|
| buildPriceHistogram × 7 | 空/单值/等宽/最大值边界/label 含 ~/bins/bounds |
| buildSpeedTiers × 4 | 边界归档、<150、过滤 0 计数 |
| buildPlatformShare × 6 | 映射 1-4、null→未知、未知编码、降序、颜色 |
| buildSignVsSpeed × 5 | null 过滤、value 结构、price null→0、≤500 原样、>500 抽样 |
| computeAnalytics × 12 | 空输入、priceBins、中位数（奇/偶）、四分位、最快一速、hint、高战号占比、平均签到、SSR/六星、收藏合计、分布组件 |

（私有函数 `quantile` / `mean` / `pick` / `yuan` 经上述导出函数间接覆盖。）

## 4. `format.test.ts`（29 用例）→ `src/utils/format.ts`

| 函数 | 用例 |
|---|---|
| fenToYuan | null/undefined→null、0、负数 |
| formatPrice | null→'-'、zh-CN 货币（同源 Intl 期望） |
| formatPriceCompact | null→'-'、≥万、<万、边界 10000 元 |
| formatNumber | null/undefined/NaN、默认位数、指定位数 |
| formatSpeed | null→'-'、两位小数 |
| formatPercent | 默认一位、指定位数 |
| formatRemain | null、≤0 已结束、天/小时/分钟分支、最少 1 分钟 |
| formatSignYears | null、天→年 |
| formatDateTime | null/空串、T 替换与截断、无 T 截断 |
| compact | 亿、万、<万千分位、负数阈值 |

## 5. `sort.test.ts`（8 用例）→ `src/utils/sort.ts`

| 用例 | 覆盖 |
|---|---|
| 数字升/降序 | `compareBy` 数值分支 |
| null/undefined 永远排最后（升/降） | 缺失值分支 |
| 两边都缺失返回 0 | `aMissing && bMissing` |
| 字符串 zh-CN localeCompare 升/降 | 字符串分支 |
| 相等键稳定性 | `Array.prototype.sort` 稳定性 |

## 6. `columns.test.ts`（20 用例）→ `src/utils/columns.ts`

| 用例 | 覆盖 |
|---|---|
| 导出列 key 唯一、title/value 完整 | `listingExportColumns` 结构 |
| 打印列为导出列子集、key 清单 | `listingPrintColumns` |
| price 分→元取整（含 null）、numeric | `yuan` |
| 其余直接映射列逐一取值 / zhaocai round2 / numeric 标记 | 各列 `value` 闭包 |
| tou_wei 拼接 / wei_num 缺省 / tou_num null | `tou_wei` 分支 |
| 速度列 round2 与 null | `round2` |
| allow_bargain 是/否 | 三元分支 |
| url 拼接 / server_id null | `url` 闭包 |
| titles 「、」 / highlights 「 / 」 / 空数组 | `join` 分隔符 |

---

覆盖率（v8）：All files lines 100% / branches 95.73%；predicate 98.57%、params 94.4%、analytics 91.78% 分支（未覆盖分支见 coverage-summary.txt）。
