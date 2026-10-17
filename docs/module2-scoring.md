# 模块二：账号评分

输入一个藏宝阁账号地址，输出两件事：

1. **指定式神的御魂搭配方案评分**（默认须佐之男 / 阿修罗）
2. **每种御魂在 6 个位置上的最快速**

> 这个模块**不需要登录藏宝阁**。用到的三个接口都是匿名的，
> 只是它们没有 CORS 头，所以必须由本机伴随服务代理（浏览器直连会被拦）。

---

## 一、怎么拿到可用的地址

### 关键限制：`ordersn` ≠ `eid`

商品页地址里长这样：

```
https://yys.cbg.163.com/cgi/mweb/equip/47/202610161701616-47-C8MSKXBXH4B4E
                                    ↑serverid  └────────── ordersn ──────────┘
```

但下面三个接口要的是 **`eid`**：

```
202610161701613-47-SMSV5P0UFDMEW
```

**两者无法互相推导**（实测结论，别再试）：

| 尝试 | 结果 |
|---|---|
| 详情接口传 ordersn（各种 Referer 都试过） | `物品不存在` |
| 商品页 HTML 里找 eid | 不含（HTML 只有 9 KB） |
| 两个 id 首段的差值规律 | **不稳定**：两组差 3、一组差 -99997 |
| 只传 `client_type` 靠 Referer 推断 | `请选择服务器` |
| 只传 `serverid` | `流水号不能为空` |

### 正确的取法：用「御魂搭配」弹窗的地址

1. 打开账号的商品详情页
2. 切到「**御魂**」标签，点「**御魂搭配方案**」
3. 弹窗出现后，复制地址栏里那条：

```
https://yys.cbg.163.com/cgi/mweb/yuhun-collocation?eid=<eid>&serverid=<id>&isH5=true
```

4. 粘进模块二的输入框

> 这条地址**直接带 eid**，一行就能解析，是最省事的输入方式。
> 也可以手动填 `eid` + `serverid`（serverid 就是商品页 URL 里 `/equip/<47>/` 那个数字）。

界面会识别两种输入：含 eid 的地址直接分析；只有 ordersn 的商品页地址则提示补 eid。

---

## 二、三个接口

| 用途 | 接口 |
|---|---|
| 方案清单 | `GET /cgi/api/get_yys_heroes_matching_plan?client_type=h5&eid=<eid>&obj_serverid=<sid>` |
| 单套评分 | `GET /cgi/api/compute_yys_heroes_plan?client_type=h5&eid=<eid>&obj_serverid=<sid>&heroId=<h>&planId=<p>` |
| 账号详情（取御魂仓库） | `GET /cgi/api/get_equip_detail?client_type=h5&serverid=<sid>&eid=<eid>` |

### 方案清单的返回结构

```json
{
  "status": 1,
  "data": {
    "389": {
      "name": "须佐之男",
      "plans": [
        { "id": "105", "desc": [
            { "label": "御魂套装",   "value": "海月火玉+荒骷髅" },
            { "label": "246号位选择", "value": "攻攻暴/爆伤" },
            { "label": "属性限制",   "value": "满暴" }
        ]}
      ]
    }
  }
}
```

`data` 的键是 **heroId**：须佐之男 = 389，阿修罗 = 364。

### 评分的返回结构

```json
{
  "status": 1,
  "msg": "该式神御魂搭配方式计算成功！",
  "data": { "result": {
    "suit_vals": {
      "damage": 26468.3,          ← 页面上显示的「总评分」
      "attackAdditionVal": 9874.5,
      "maxHpAdditionVal": 15043.6,
      "defenseAdditionVal": 630.4,
      "speedAdditionVal": 112,
      "critRateAdditionVal": 102,
      "critPowerAdditionVal": 268,
      "debuffEnhance": 14.5,
      "debuffResist": 11.3
    },
    "suit_data": [ { "slot": 1, "star": 6, "level": 15, "attrs": [...] } ]
  }}
}
```

**评分是服务端按该账号实际御魂算出来的**，不是静态攻略——同一式神不同套装得分不同
（实测须佐之男 5 套：27480 ~ 21278；阿修罗 11 套：28512 ~ 20591）。

---

## 三、速度怎么算

御魂的速度有两部分：

```
速度 = attrs 里的「速度」值  +  Σ rattr.speedAdditionVal × 3
```

- `attrs` 是展示用的属性对，如 `["速度", "11.29"]`
- `rattr` 是**随机属性的归一化比例**（0~1，实测上限 0.9999），不是最终数值
- **乘 3 是实测校准出来的**：拿主属性 57 的 2 号位验证（rattr 和为 0）→ 总速度 57 ✓

### 2 号位的歧义（界面给了两种口径）

2 号位的**主属性可以是速度**，满值固定 57。所以：

| 口径 | P2 显示 | 用途 |
|---|---|---|
| **总速度**（含主属性） | 所有御魂都是 57.00 | 这个位置最快能到多少 |
| **仅副属性速度** | 各不相同（32.8 / 34.2 / 27.7…） | 谁的副属性速度堆得好，**有区分度** |

界面上可以切换。要横向比较御魂质量，用「仅副属性速度」更有意义。

---

## 四、实现位置

| 文件 | 作用 |
|---|---|
| `tools/cbg/scraper-service/accountAnalyze.mjs` | 服务端逻辑：解析地址、拉详情、算速度表、逐个方案算分 |
| `tools/cbg/scraper-service/server.mjs` | 路由 `POST/GET /api/account/analyze` |
| `cbg-web/src/api/account.ts` | 前端客户端与类型 |
| `cbg-web/src/pages/AccountScore.tsx` | 页面 |
| `cbg-web/src/components/ModuleTabs.tsx` | 顶部模块切换（两个 hash 路由：`#/` 与 `#/score`） |

### 为什么必须服务端代理

藏宝阁这三个接口**没有 CORS 头**（实测 `access-control-allow-origin` 为空），
浏览器从 `github.io` 或 `127.0.0.1:5173` 直接 `fetch` 会被拦。
服务端在本机发请求没有跨域限制。

好处是：**这些接口匿名可用**，所以这个模块不依赖你是否登录藏宝阁，
也不需要浏览器窗口开着。

### 独立命令行工具

不经过界面也能跑（同样匿名）：

```bash
# 账号评分（须佐之男 / 阿修罗）
node tools/cbg/account_score.mjs --url "<含 eid 的地址>"

# 只出速度表
node tools/cbg/soul_speed_table.mjs --serverid 47 --eid <eid> --sub-only
```

---

## 五、已知限制

| 限制 | 说明 |
|---|---|
| 必须给 eid | 商品页地址只有 ordersn，无法推导 eid。见第一节 |
| 分析耗时 | 方案多的式神要逐个算分（每个约 0.6 秒）。须佐 5 套 + 阿修罗 11 套 ≈ 15 秒 |
| 依赖本机服务 | 页面需要通过伴随服务代理；公网页面同样需要先点「允许」本地网络访问 |
| 评分口径由站点决定 | `damage` 是藏宝阁自己的算法，我们只是读取，无法解释每一项权重 |
| 只覆盖有方案的式神 | 站点只为 31 个常用式神提供搭配方案；没出现的式神无法评分 |
