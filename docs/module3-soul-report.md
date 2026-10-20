# 模块三：御魂报告（实现说明）

> 页面：`#/soul`，实现：`cbg-web/src/pages/SoulReport.tsx`
> 计算内核：`tools/cbg/soul-service/`（Python）
> 代理：`tools/cbg/scraper-service/server.mjs` 的 `/api/soul/*`
> 入口：模块一表格行内「御魂」按钮（`#/soul?ordersn=…&serverid=…`，与模块二「评分」同款联动）、
> 直接粘贴链接/订单号、上传 yyx；`#/soul?demo=1` 直接载入演示数据。

---

## 1. 为什么单独做一层 Python 内核

御魂报告要算的东西（散件一速、套装一速、头/尾判定、score 分布、组合搜索）来自对
「yys照妖镜」的逆向复刻，且**已经用服务端真实数据逐项对拍**：

| 能力 | 验证 |
|---|---|
| 散件一~五速 | 与服务端快照一致（158.939 / 158.064 / 155.976…） |
| 头/尾判定 | 与 CBG `equip_desc` 逐条 `rattr` 精确一致 |
| 面板/伤害公式 | worker 路径 vs teamBase 路径 delta=0 |
| score 语义 | 4299+4432 件御魂统计归纳（有效属性成长次数，-1=未评定） |

在 Node 里重写这些公式成本高且容易引入偏差，所以直接复用这份 Python 实现。
Node 只负责：**拉起进程 + 反向代理 + 统一 CORS**，不参与计算。

---

## 2. 架构

```
cbg-web (#/soul)
   │  GET/POST /api/soul/*          （只认伴随服务一个地址）
   ▼
scraper-service (Node, 8791)
   │  透明代理：原样转发 method/query/content-type，上传按字节流
   │  启动时 spawn Python 内核（--no-browser 时也会 spawn）
   ▼
soul-service (Python, 8792)
   ├─ 按 ordersn 缓存 yyx（gzip）/ report / precise，TTL 24h
   ├─ 数据源：照妖镜抓取接口 → 限流自动降级 CBG 直连 + 上传
   └─ 计算：calc_demo（搜索/面板/伤害）、parse_equip（精确头尾）
```

**端口**

| 端口 | 用途 | 修改方式 |
|---|---|---|
| 8791 | 伴随服务（浏览器 + API） | `--port` |
| 8792 | 御魂报告内核 | `--soul-port` / `CBG_SOUL_PORT` |

**Python 启动参数**：`--soul-python` / `CBG_PYTHON`（默认 Windows `python`，其它 `python3`）；
`--soul-dir` 可指定内核目录。

---

## 3. 数据来源

| 输入 | 走哪条路 | 需要联网 | 备注 |
|---|---|---|---|
| 藏宝阁商品链接 / 订单号 | 内核抓取（照妖镜接口 → CBG 直连降级） | 是 | 首次 5~15 秒，之后 24h 缓存 |
| 上传 yyx / 痒痒熊导出 | 本地解析 | 否 | 与官方导出文件完全兼容 |
| 「演示数据」按钮 | 内置 `data/demo_yyx.json` | 否 | 4299 件官方示例，用于自检 |

> 商品链接里的 `ordersn` 即可，**不需要 eid**（与模块二不同：模块二按 eid 查搭配方案，
> 模块三按 ordersn 拉御魂仓库）。

---

## 4. 页面能力

| 区块 | 接口 |
|---|---|
| 概览 / score 分布 / 各位置数量 | `GET /api/soul/report?ordersn=` |
| 一速四表（散件/命中/抵抗/套装） | 同上（`speeds` 字段） |
| 精确头/尾/17 速 | `GET /api/soul/precise?ordersn=` |
| TOP 御魂 | 同上（`top_souls`） |
| 组合搜索 | `POST /api/soul/search` + 轮询 `GET /api/soul/job?id=` |
| 上传 yyx | `POST /api/soul/report/upload`（multipart `file`） |
| 前端下拉枚举 | `GET /api/soul/meta` |

---

## 5. 启动与依赖

```bash
pip install requests                  # 仅模块三需要
node tools/cbg/scraper-service/server.mjs          # 正常模式（含浏览器）
node tools/cbg/scraper-service/server.mjs --no-browser   # 只用模块三：不拉浏览器
```

启动日志里会出现：

```
[soul] 正在启动内核（python=python，日志 …/soul-service.log）
[soul] 御魂报告内核已就绪（端口 8792）
```

`/api/health` 增加三个字段：`soulReady`、`soulPort`、`soulMessage`；前端据此判断模块三是否可用。

---

## 6. 联调测试

```bash
# 1) 起伴随服务（无需浏览器）
node tools/cbg/scraper-service/server.mjs --port 8791 --no-browser

# 2) 跑 9 项冒烟（health/meta/demo/上传/搜索/精确指标/报告）
python tools/cbg/scraper-service/soul-smoke.py
```

实测结果（2026-10-20）：**PASS=9 FAIL=0**。
报告 4432 件御魂，散件一速 158.938（与 CBG `equip_desc` 精确值 158.939 差 0.001，来自浮点舍入）。

---

## 7. 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 页面提示「模块三未就绪」 | Python 未装 / 缺 `requests` / 8792 被占 | 看 `soul-service.log`；`pip install requests`；换 `--soul-port` |
| `SOUL_SERVICE_UNAVAILABLE` | 内核进程退出 | 同上；也可直接 `python tools/cbg/soul-service/server.py --port 8792` 看报错 |
| 报告一直转圈 | 首次抓取慢或上游限流 | 内核会自动降级 CBG 直连；24h 内再次查询走缓存 |
| 上传报「未找到 hero_equips」 | 传错文件（不是 yyx/痒痒熊导出） | 用「御魂导出器」导出的 JSON |
| 前端 404 `/api/soul/*` | 伴随服务是旧版本 | 重启服务（新版本才注册代理路由） |

---

## 8. 与模块二的区别

| | 模块二 账号评分 | 模块三 御魂报告 |
|---|---|---|
| 输入 | 含 `eid` 的「御魂搭配」地址 | 商品链接 / 订单号 / yyx 文件 |
| 数据 | 站点算好的搭配方案评分 | 原始御魂仓库 |
| 依赖 | 已登录浏览器（会话） | 匿名接口 + 本地计算 |
| 输出 | 方案评分、速度核心 | 一速、评分分布、精确头尾、组合搜索 |

两者互不依赖：模块二浏览器没起来不影响模块三；模块三 Python 没装不影响模块一/二。
