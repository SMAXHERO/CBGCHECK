# 模块四：看号分析（本地复刻）

模块四把 `https://yys.maydaylands.com/yys-cbg-inspector/`（「阴阳师藏宝阁看号工具」）
的六个页面在本地完整复刻，作为面板的第四个 Tab（`#/inspector`）。

它不依赖原站：给定一个藏宝阁商品链接 / 订单号，本地内核**自己**去藏宝阁拉
`equip_desc`，自己构建数据集、自己算速度/PVE/技能/库存，并在本地完成御魂组合搜索
（原站用的是浏览器里的 Web Worker，我们换成了 Python 内核）。

> 逆向过程与逐字节对拍见 `recon_mayday/`（仓库外的工作目录），本模块是它的工程化落地。

---

## 入口

| 入口 | 说明 |
|---|---|
| 模块一表格 →「看号」 | 每行「账号」格子里第三个按钮（评分 / 御魂 / 看号），点击跳到本页并自动出报告（`#/inspector?ordersn=…&serverid=…`） |
| 直接打开 `#/inspector` | 手动粘贴藏宝阁链接或订单号，或点「演示数据」 |
| `#/inspector?demo=1` | 载入内置演示数据（基准账号 XX菜，3397 件御魂），不需要服务与网络 |

演示数据来自 `tools/cbg/inspector-service/data/demo_equip_desc.json.gz`（598 KB，
就是藏宝阁 `equip_desc` 的原始 JSON）。所有页面都能在演示数据上完整工作，
包括 21 组 PVE 计算（结果按账号缓存 24h，第一次约 30 秒，之后秒开）。

---

## 六个页面

| Tab | 复刻内容 |
|---|---|
| 账号概览 | 速度亮点（散件一速 / 招财一速 / 头尾）、满速御魂与各号位分布、账号资产、图鉴、御魂规模、PVE 套件评分 |
| 速度盘点 | 满速御魂清单（单件速度）、11 个常用 PVP 四件套一速表（可按 4/6 号位主属性筛选）、散件一速 TOP5 组合、每个号位最高速 |
| PVE 预览 | 7 普通套 × 3 逢魔套 = 21 组最优组合，逐组显示伤害与面板，外加套件评分与高评分御魂件数 |
| 式神技能 | 按稀有度分组的技能等级（如 `555` / `515`）、技能未达标、存在多号机的式神、联动式神 |
| 御魂库存 | 3397 件御魂浏览：号位 tab、套装 / 主属性 / 副属性（可多选同时包含）过滤、按副属性速度排序 |
| 御魂计算器 | 指定式神 + 指标 + 面板预设（攻攻爆 / 生生爆 / 纯速度）+ 满暴 + 圆/四件套，搜索最优 6 件组合；「极速模式」与「精确模式」 |

---

## 数据链

### 1. 藏宝阁直连（默认）

```http
POST https://yys.cbg.163.com/cgi/api/get_equip_detail?client_type=h5
Content-Type: application/x-www-form-urlencoded
Referer: https://yys.cbg.163.com/cgi/mweb/equip/{serverid}/{ordersn}

serverid=17&ordersn=202610201501616-17-4G0RE3QTEDLIQ
```

匿名可用（实测 1~2 秒），返回 `{"status":1,"equip":{equip_desc, highlights, equip_name, server_name, collect_num, …}}`。
`equip_desc` 是一个 **JSON 字符串**，解析后包含 `heroes` / `inventory` / `hero_history` /
`damage`（勾玉）等字段——这就是所有页面的原始数据。

### 2. 原站 Server Action（兜底）

原站的「读取链接」是一个 Next.js Server Action：

```http
POST https://yys.maydaylands.com/yys-cbg-inspector/home
next-action: 7f86146ea431565837b3c1a8ca57bc784569cad10e
accept: text/x-component
content-type: text/plain;charset=UTF-8

[{"serverid":"17","ordersn":"202610201501616-17-4G0RE3QTEDLIQ"}]
```

响应约 3.2 MB 的 RSC flight 文本，其中一行含 `{"data":{"status":1,"equip":{…}}}` 以及同结构的
`dataset`（schemaVersion 11）。**无需登录、无 Cookie**。内核在直连失败时会自动降级到这条链。
但该链限流（约 12 次/分钟、冷却 9 分钟），所以正常情况请走直连。

### 3. 演示数据

`data/demo_equip_desc.json.gz`（即基准账号的 `equip_desc`），不联网。

---

## 数据格式（schemaVersion 11）

内核把 `equip_desc` 复刻成与原站一致的数据集：

```jsonc
{
  "schemaVersion": 11,
  "account": {
    "title", "name", "serverName", "level", "fengzidu", "pvpScore", "pvpStage",
    "heroSummary", "relicSummary", "collectionSkinCount", "yuxingDama",
    "money", "stamina", "maxLevelRelicCount", "soulJade",
    "mysteryTalisman", "realityTalisman", "summonPower",
    "shikigamiDex": { "ssr", "sp", "ur", "uncollected500Days", "uncollected999Days", "uncollectedCoupon" },
    // 速度亮点（从 equip.highlights 文本解析）
    "scatteredFirstSpeed", "luckyFirstSpeed", "speedHeadCount", "speedTailCount"
  },
  "heroes": [ { "instanceId", "heroId", "name", "rarity", "level", "skillLevels": [5,5,5] } ],
  "relicsByPosition": { "1": [ [relic…] ], …, "6": [ … ] }
}
```

单件御魂（`relics`）关键字段（与原站一致）：

```jsonc
{
  "relicId": "<uuid>", "position": 1..6, "quality": 6, "level": 15,
  "suit": { "id", "name", "isTwoPieceSet", "twoPieceConfig" },
  "mainAttribute":   { "label": "攻击加成", "value": 55.0, "isPercent": true },
  "subAttributes":   [ { "label", "value", "isPercent" }, … ],   // 按原站权重排序
  "setBonusAttribute": null,                                      // 逢魔/首领御魂自带属性
  "enhancement": {
    "totals": [ { "label": "速度", "count": 6, "total": 17.18 }, … ],  // 同类合并
    "initialRollCount": 4, "enhancementCount": 5,                    // 初始词条 / 强化次数
    "enhancementStages": [ … 0/3/6/9/12/15 级各阶段主属性与累计副属性 … ]
  }
}
```

数值规则（原站 `9032` chunk）：

- 六星主属性成长：`value = initial + (maximum - initial) × level / 15`，
  例如攻击 `65 → 486`、速度 `12 → 57`、暴击 `10 → 55`、暴伤 `14 → 89`。
- 副属性一档成长值：速度 3、暴击 3、暴伤 4、攻击加成 3、攻击 27、生命加成 3、生命 114、
  防御加成 3、防御 5、效果命中 4、效果抵抗 4；实际强化 = `MAX_ROLL × Σ rate`，`rate ∈ [0.8, 1.0]`。
- `attributes` 里 `"速度+2.86"` 这类字符串直接给出最终值，不需要自己乘档位。

---

## 算法口径

### 速度盘点

- **满速御魂**：六星 +15，且副属性里「速度」正好吃满 **6 档**（`enhancement.totals` 中
  `label=="速度"` 的 `count==6`），2 号位还必须是速度主属性。
- **单件速度**：只有副属性 + 两件套加成，**不含主属性**。
- **一速组合**：每个号位取一件，2 号位强制速度主属性；四件套可凑套装（6 选 4 枚举），
  其余两号位任取。显示值 = 组合副属性之和 **+ 57**（六星速度主属性满值）。
- **散件 / 招财一速、头尾**：原站直接展示 `equip.highlights` 文本（如「散件一速158.76」），
  内核优先用 highlights，缺失时用本地算法兜底；头/尾由「2 号位速度主属性 + 速度副属性满 6 档」
  判定（主属性速度 = 头，其他 = 尾）。

### PVE 预览

- **套件评分**（原站 `45072` chunk）：只算六星 +15；2/4 号位主属性必须攻击加成、6 号位必须
  暴击或暴伤；「攻击加成 / 暴击 / 暴伤」各计 1 条有效词条（同类合并后的 count）；
  普通御魂上限 8 条，逢魔一件套额外 +3（上限 11）；单件 ≥5 条才展示，
  套件总分 = 展示御魂有效词条之和。汇总 7 个普通套 + 3 个逢魔套。
- **21 组最优**：对 7 普通套 × 3 逢魔套分别做 6 件组合搜索（每号位 1 件，四件套凑齐、
  逢魔一件套必须上），面板按满级须佐之男（`attack 4154 / critDamage 150 / critRate 12`）计算，
  满暴约束（`critRate ≥ 100`），指标 = 最终攻击 × 最终暴击伤害。
  普通两件套属性、逢魔一件套自带属性都计入；四件套的 2 件套属性也计入（与站点一致）。
  总平均值 = 21 组伤害的均值（基准账号 26,376）。

### 式神技能

- 只展示 `rarity ∈ {6,5,4}`（UR/SP/SSR），排除 heroId 900~910 与材料/达摩（10~16）；
- 联动式神按静态表 `isCollaboration` 单独分组；
- 达标 = 前三个技能等级逐位 ≥ 静态表 `lowestRank`（如 155）；
- 「技能未达标」= 同名式神里一个都不达标的组；「存在多号机」= 同名 ≥2 且至少一个达标。

### 御魂计算器

- **极速模式**（默认）：贪心初始化 + 逐号位爬山 + 暴击修复 + 对换优化，单次约 0.02~0.5 秒；
- **精确模式**：分支限界（后缀最大贡献为界 + 暴击可行性剪枝 + 支配剪枝），保证最优，
  但候选空间大时可能需要几分钟（站点同款算法在浏览器里也慢）；
- 支持面板预设 / 2、4、6 号位主属性多选 / 满暴 / 指定四件套 / 返回组数。

---

## 服务架构

```
cbg-web (#/inspector)
   │  /api/inspector/*（GET/POST，204/JSON）
   ▼
Node 伴随服务 :8791（tools/cbg/scraper-service/server.mjs）
   │  自动 spawn + 透明代理
   ▼
Python 内核 :8793（tools/cbg/inspector-service/server.py）
   │  cbg_inspector（fetch → dataset → analysis → speed / calculator）
   ▼
藏宝阁 get_equip_detail（直连）或原站 server action（兜底）
```

接口（全部经 `8791` 代理，CORS 由 Node 统一处理）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/inspector/health` | 内核健康检查 |
| GET | `/api/inspector/meta` | 式神（273）/ 套装（70）/ 面板预设 / 指标 |
| GET | `/api/inspector/demo` | 演示数据完整报告 |
| GET | `/api/inspector/report?ordersn=&serverid=` 或 `?url=` | 完整报告（概览 + 速度 + PVE 评分 + 技能 + 库存统计） |
| GET | `/api/inspector/speed?…&fourth=&sixth=` | 速度盘点（可按 4/6 号位主属性筛选） |
| GET | `/api/inspector/relics?…&position=&suits=&mainAttribute=&subAttributes=&limit=` | 御魂库存查询 |
| POST | `/api/inspector/pve` | 提交 21 组 PVE 任务，返回 `jobId`；`refresh` 可跳过缓存 |
| POST | `/api/inspector/calc` | 提交计算器任务（极速/精确），返回 `jobId` |
| GET | `/api/inspector/job?id=` | 轮询任务（`status` / `progress` / `result`） |

内核只依赖 Python 标准库（**不需要 `requests`**）。

---

## 校准

蒸馏时用基准账号（XX菜 / 网易-携手同心，3397 件御魂）与原站逐项对拍：

| 项目 | 结果 |
|---|---|
| 账号概览 | 158.76 / 151.06 / 3头4尾 / 满速 124 / 各号位 15·3·27·26·21·32 / 8064 / 3397 / 抽卡 1663 / 图鉴 64·51·1 —— 全部一致 |
| 速度盘点 | 散件 TOP5（158.76 / 157.64 / 156.53 / 154.37 / 153.99）与 11 个套装一速表 —— 逐位一致 |
| PVE 评分 | 7 普通套 422/338/195/396/276/173/145、3 逢魔套 273/429/161 —— 一致 |
| 式神技能 | 御行达摩 6 / 多号机 2 / 未达标 19 / 联动 24 / UR1·SP59·SSR84 —— 一致 |
| 库存 | 8064 / 3397 / 629·413·708·475·732·440 / PVE 输出御魂 73·35·81·35·78·17 —— 一致 |
| PVE 21 组 | 逐组伤害与面板一致，总平均 26,376 一致 |
| 计算器 | 极速模式攻攻爆示例 29022.48（与站点同口径的近似解） |

自动化校验：`tools/cbg/scraper-service/inspector-smoke.py`（12 项，见文件头注释）。

---

## 性能与缓存

| 操作 | 耗时 |
|---|---|
| 拉取 + 构建数据集（直连） | 约 1~4 秒（磁盘缓存 24h 后 <0.1 秒） |
| 完整报告 | 约 0.3~1 秒（数据集已缓存时 0.2 秒） |
| PVE 21 组（首次，8 进程并行） | 约 30 秒；按账号缓存 24h，之后约 2 秒 |
| 计算器极速模式 | 0.02~0.5 秒 |
| 计算器精确模式 | 秒级~分钟（取决于候选空间） |

缓存目录：`tools/cbg/inspector-service/data/cache/`（`{serverid}_{ordersn}.json.gz` 数据集、
`pve_*.json` PVE 结果），随 `--ttl` 参数（默认 86400 秒）失效。

---

## 已知差异与注意事项

| 事项 | 说明 |
|---|---|
| 演示数据缺 `collect_num` | 原站「典藏皮肤数」取自 `equip.collect_num`，演示文件是 `equip_desc` 快照，没有这一项，所以显示 0；用真实链接时正常显示（基准账号为 3） |
| 原站 server action 限流 | 约 12 次/分钟、冷却 ≥9 分钟，报 `10500 访问频率超过限制`；正常走藏宝阁直连，不受影响 |
| 藏宝阁直连风控 | 与模块一/二同源：低频匿名可用，批量会被升级为登录/验证。模块四只做单账号查询，正常使用无压力 |
| 式神静态资料 | `data/static-heroes.json`（273 个式神：名字/稀有度/技能下限/联动标记/基础面板）与 `data/static-relic-suits.json`（70 个御魂套装、13 个逢魔一件套）来自原站静态接口，随游戏更新可能需要重新拉取 |
| 头/尾判定 | 原站用 `highlights` 文本；本地兜底算法按「2 号位速度主属性 + 速度副属性满 6 档」判定，与站点口径一致 |
| 计算器精确模式 | 与站点同款分支限界，理论上最优但慢；日常用默认的极速模式 |
