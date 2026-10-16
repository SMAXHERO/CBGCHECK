# 筛选条件的来源与维护

本文说明**条件是从哪来的、为什么会过期、怎么更新**。区服列表已支持脚本自动同步，
条件字段定义目前仍需手工导出——原因见下。

---

## 一、两个数据文件

| 文件 | 内容 | 大小 | 谁生成 |
|---|---|---|---|
| `cbg-web/public/data/filters.json` | 13 组 / 73 项条件的定义 | ~140 KB | **手工导出**，无脚本 |
| `cbg-web/public/data/servers.json` | 区服清单（6 组 / 131 条） | ~22 KB | `tools/cbg/sync_servers.py` ✅ |

### filters.json 里有什么

每个字段记录的是「这个条件长什么样」，不是「它的值」：

```json
{
  "kind": "field",
  "label": "价格(元)",          // 界面显示名
  "innerLabel": "价格",
  "key": "price",               // 提交给藏宝阁接口的参数名
  "type": "range_input_with_select",
  "displayType": "range_input_with_select",
  "opType": "and",
  "valueMultiply": 100,         // 界面值 × 这个倍率 = 接口值
  "hintMin": "最低", "hintMax": "最高",
  "options": [...]              // 下拉/快捷档位的可选项
}
```

外层结构：

```json
{ "searchType": "role", "name": "角色", "totalFields": 72, "sections": [ { "label": "区服", "fields": [...] }, ... ] }
```

**注意**：这个文件**没有版本号、没有抓取时间、没有来源标记**。
所以你无法从文件本身判断它是否已经过期——这正是不足之处。

---

## 二、区服列表：已可自动同步 ✅

```bash
# 看有没有新区服（0=最新，1=有差异，可用于定时检查）
python tools/cbg/sync_servers.py --check

# 预览差异，不写文件
python tools/cbg/sync_servers.py

# 写入（含游戏内通道的额外分组）
python tools/cbg/sync_servers.py --write --include-ingame
```

数据来自藏宝阁自己的公开文件（地址写在其站点配置 `com_config.js` 里）：

| 配置项 | 地址 | 内容 |
|---|---|---|
| `ServerDataUrl` | `https://cbg-yys.res.netease.com/js/server_list_data.js` | 标准通道，5 组 |
| `ServerDataUrl2` | `https://cbg-yys.res.netease.com/js/server_list_data2.js` | 游戏内通道，多「中国-安卓联运」组 |
| `ServerDataUrl3` | `https://cbg-yys.res.netease.com/js/all_server_list2.js` | 全量，结构不同，备用 |

脚本的行为：

- **只增不删**：站点下架的区服会保留在文件里（历史查询结果可能还引用它们）
- **保持原有分组顺序**，新分组追加在后面
- 写入时附加一条 `groupId: "_meta"` 的元信息（同步时间、来源、数量）。
  它不是区服——前端 `useSearchConfig` 与 `ServerIndex` 都会过滤掉它
- `--include-ingame` 会并入「中国-安卓联运」这 10 条（去重后 4 个新 id）

**开新区时跑一次 `--write` 即可**，不需要改代码。

---

## 三、条件字段：需要手工更新 ⚠️

### 为什么没有脚本

`filters.json` 的内容来自 **`cbg-filter-kit`**（那个筛选助手扩展），
是对它条件面板定义的一次导出。本仓库没有生成它的代码——它是**一次性的快照**。

站点也没有「条件定义」的公开接口：实测 `/cgi/api/get_filter_config`、
`/cgi/api/server_list` 等路径都是 404。条件面板是站点前端脚本自己渲染的。

### 所以什么时候会失效

| 情况 | 表现 | 处理 |
|---|---|---|
| 站点**新增**一个条件（新玩法、新资产统计） | 界面上看不到这个条件，勾不了 | 重新导出 filters.json |
| 站点**删除**某个条件 | 界面上还显示，勾了提交后站点忽略或报错 | 重新导出 |
| 某条件的**选项**变了（如新增一个档位） | 快捷档位按钮少一个 | 重新导出 |
| 某条件的**倍率**变了（如价格从 ×100 改成 ×1） | 筛选结果明显不对 | 重新导出，并更新 `valueMultiply` |

### 怎么更新

1. 从 `cbg-filter-kit` 重新导出条件定义（覆盖 `cbg-web/public/data/filters.json`）
2. 核对默认条件仍然能对上字段（这一步是必须的，字段被删/改名会导致默认条件静默失效）：

   ```bash
   python tools/cbg/check_defaults.py
   ```

3. 核对字段总数与分组数有没有意外变化：

   ```bash
   python -c "import json;d=json.load(open('cbg-web/public/data/filters.json',encoding='utf-8'));print('分组',len(d['sections']),'字段',sum(len(s['fields']) for s in d['sections']))"
   ```

4. 跑一次查询，确认关键条件仍然生效：

   ```bash
   python tools/cbg/check_defaults.py
   ```

### 一个好消息：参数是原样透传的

服务端把前端提交的条件**不做过滤地**转发给藏宝阁 `/cgi/api/query`：

```js
const params = { ...values, search_type, client_type: 'h5', view_loc: 'equip_list', page, count };
```

所以**只要界面上能提供这个参数，站点就认**。这意味着将来若要支持「手工补充条件」，
只需要在 `filters.json` 里加一条字段定义，不需要改查询链路。

---

## 四、站点还会下发「活动筛选条件」（目前为空）

查询接口的返回结构里有一个字段：

```json
{ "status": 1, "result": [...], "activity_filter_conditions": [] }
```

名字直译是「活动筛选条件」——推测站点在搞活动时通过它下发临时筛选条件。
**目前实测始终是空数组**，所以界面没有处理它。

如果将来发现它非空，可以在 `server.mjs` 里把它一并返回给前端，
再在条件面板上单独渲染成一组「活动条件」。这是预留的扩展点，不是当前的缺陷。

---

## 五、顺带：排序字段也是站点给的

查询返回里的 `order_headers` 给出了站点支持的排序：

```json
[ { "field": "selling_time", "name": "最新" },
  { "field": "collect_num",  "name": "收藏" },
  { "field": "price",        "name": "价格", "direction": ["ASC","DESC"] } ]
```

可以用来校验界面表头的排序字段是否仍然有效。

---

## 六、商品详情接口与「成交数据」（做行情/评分才会用到）

这一节记录一次完整的实测结论，供以后做「行情分析 / 性价比评分」时直接复用，
不要重新摸索。**结论有推翻过，所以把过程一并留下**。

### 6.1 两个接口的鉴权要求不同

| 接口 | 用途 | 鉴权 |
|---|---|---|
| `POST /cgi/api/query` | 列表：只能拿**在售** | **必须登录**（无 Cookie → `登录超时(e12)`） |
| `GET /cgi/api/get_equip_detail` | 详情：单个商品全部数据 | 见下方 6.4——**结论会随请求量变化** |

详情接口的参数必须**配对**，这是踩过的坑：

```bash
# 正确
GET /cgi/api/get_equip_detail?client_type=h5&serverid=11&eid=202610161901613-11-7MIJZTELMB6YU

# 只传 eid        → {"status":0,"msg":"请选择服务器"}
# 只传 serverid   → {"status":0,"msg":"流水号不能为空"}
# 配对错误        → {"status":0,"msg":"物品不存在"}
```

**`eid` 无法凭空构造**（格式是 `时间戳-服务器-随机串`，随机串不可推算），
只能从列表接口拿。这就是「详情不可独立使用」的根源。

### 6.2 列表接口的翻页特性

- **`count` 参数被忽略**，恒返回 **15 条/页**（传 30/50/100 都是 15）
- 靠 `page` 翻页；`total_num` 可信，页数 = `ceil(total/15)`
- 实测 500~550 元区间：274 条 = 19 页（第 19 页只有 4 条）

> **关于过滤条件**：列表接口**只接受有限参数**，多加一个就返回「非正常访问」。
> 目前采集脚本实际只发 `search_type=role` + `price_min` + `price_max` + `page`。
> 所以样本范围天然是「全服（无服务器配额）+ 一个价格窄带 + 当下在售」。

### 6.3 资产字段藏在 `equip_desc` 里（字段映射已校准）

详情接口的 `equip` 顶层只有展示信息，**勾玉/皮肤/图鉴这些值在一个 JSON 字符串里**：

```
equip.equip_desc  →  约 1.6 MB 的 JSON 字符串，88 个字段
```

字段映射已用**已知答案的记录**校准过（该商品详情页显示「勾玉 20.3万 / 签到1591天 /
风姿度 14991 / 式神皮肤数 329」）：

| 字段 | 含义 | 校准结果 |
|---|---|---|
| `goyu` | 勾玉 | `203319` = 页面 20.3万 ✅ |
| `sign_days` | 签到天数 | `1591` ✅ |
| `fengzidu` | 风姿度 | `14991` ✅ |
| `skin.ss` | **式神皮肤数** | `329` ✅ |
| `damo_count_dict` | 御行达摩 | **两层嵌套** `{星级:{id:数量}}`，必须递归求和 |
| `gouyu_card` | 永久勾玉卡 | `1` |
| `ssr_coin` / `sp_coin` | 图鉴币 | 语义未确认，先原样留存 |

两个容易写错的点：

1. **`skin` 不是皮肤列表，而是 `{分类: [...]}`**。
   取 `Object.keys(skin).length` 只会得到**分类数 9**，不是皮肤数。
   要按分类展开求和；`ss` 分类才是页面显示的「式神皮肤数」。
   分类有：`yard` / `yys` / `jiejie` / **`ss`** / `guard` / `battle` / `yinyangshu` / `shishenlu` / `gamble`。
2. **`damo_count_dict` 只加一层会得到 0**，必须递归。

### 6.4 ⚠️ 风控是**递进的**，不是「能用/不能用」

这一条最重要，也是我推翻自己结论的地方：

| 请求量 | 详情接口的表现 |
|---|---|
| 几次（低频手测） | ✅ `status=1`，返回 1.8 MB 完整数据，**连 Referer 都不校验** |
| 几十次（批量采集） | ❌ `status=2`，`为了您的账号安全，请登录之后继续访问！` `SESSION_TIMEOUT` |
| 更密集 | ❌ `status=6`，`需要验证手机` `MOBILE_AUTH` |

实测：批量跑到**列表第 3 页**就被要求手机验证；30 次详情请求后，匿名路径彻底关闭
（冷却 60 秒后仍然拒绝，说明不是简单的短时限流）。

**所以任何批量采集都必须保守限速**，否则会把「低频时可行」的路自己堵死。
一次风控换来的教训，写在这里省得再交一次学费。

### 6.5 「已售出 / 历史成交」拿不到，只能向前追踪

| 尝试 | 结果 |
|---|---|
| 列表接口传 `status=4`（已售出） | **参数被忽略**，返回的仍全是在售（`status=2`） |
| 站点「最近成交」页 `/cgi/mweb/pl/recent-trade` | 页面存在，接口 `query_recent_trade_history` 返回 `status:1` 但 **`result: []`** |
| 给上面这个接口加筛选参数 | 任意加一个就 `非正常访问`（有严格的来源校验） |
| `/cgi/api/my_orders` | 只有**你自己买的**订单（含 `pay_time`、`price`、完整商品） |
| `trade_history/get_user_trade_info` 等 | `非正常访问` |
| 收藏列表 `/cgi/api/my_collects` | **已售的会被移除**，翻不出历史成交 |

**唯一可行路径**：先记下在售商品的 `eid` 当种子 → 之后用详情接口复查 →
**`equip.status` 变成 6（"买家取走"）就是卖掉了**，同时能拿到 `selling_time`（成交时间）
和成交价。也就是说：

> **没有历史回溯能力，只能从现在开始向前追踪。** 成交样本 = 恰好在你扫描时卖掉的那些。

参考脚本：`tools/cbg/harvest_market.mjs`（列表+详情采集）、
`tools/cbg/fetch_detail_sample.mjs`（小样本抽样）。

### 6.6 一个容易混淆的坑：两个不同的 `status`

| 位置 | 值 | 含义 |
|---|---|---|
| 响应顶层 `status_code` | `"MOBILE_AUTH"` / `"SESSION_TIMEOUT"` | **访问控制**状态 |
| `equip.status` | `6` | **商品**状态：已售出（"买家取走"） |

顶层还有个 `status` 字段（`1`=成功，`2`=失败），和 `equip.status` 完全是两回事。
写判断逻辑时务必区分，否则会把「需要验证手机」误判成「商品已售出」。

### 6.7 想采「2000 元及以下」的现实约束

2000 元及以下**约 10000 条（触顶）**，全量采集不现实：

| 环节 | 量级 |
|---|---|
| 列表翻页 | 10000 ÷ 15 ≈ **667 页**（实测第 3 页就被拦） |
| 详情抓取 | **10000 次** × 约 1 MB |
| 按 3 秒/次估算 | **8 小时以上**，中途必然触发风控 |

正确做法是**按价格分层抽样**（评分只需要每个价位带有足够样本，不需要全量），
分层之间留足间隔。建议分层：200~500 / 500~1000 / 1000~2000 / 2000~5000，各取约 100~150 条。

---

## 七、多久检查一次

| 项目 | 频率 | 命令 |
|---|---|---|
| 区服列表 | 开新区后，或每月 | `python tools/cbg/sync_servers.py --check` |
| 条件字段 | 发现界面缺条件时 | 见第三节 |
| 活动条件 | 有空时看一眼 | 服务日志里搜 `activity_filter_conditions` |
| 成交追踪（若做行情模块） | 保守限速，见 6.4 | `node tools/cbg/harvest_market.mjs` |
