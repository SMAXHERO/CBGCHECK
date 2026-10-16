# 筛选条件的来源与维护

本文说明**条件是从哪来的、为什么会过期、怎么更新**。区服列表已支持脚本自动同步，
条件字段定义目前仍需手工导出——原因见下。

---

## 一、两个数据文件

| 文件 | 内容 | 大小 | 谁生成 |
|---|---|---|---|
| `cbg-web/public/data/filters.json` | 13 组 / 72 项条件的定义 | ~140 KB | **手工导出**，无脚本 |
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

## 六、多久检查一次

| 项目 | 频率 | 命令 |
|---|---|---|
| 区服列表 | 开新区后，或每月 | `python tools/cbg/sync_servers.py --check` |
| 条件字段 | 发现界面缺条件时 | 见第三节 |
| 活动条件 | 有空时看一眼 | 服务日志里搜 `activity_filter_conditions` |
