# 御魂报告内核（模块三）

给 `cbg-web` 的「御魂报告」模块提供计算能力。由 `tools/cbg/scraper-service/server.mjs`
在启动时**自动拉起**（默认端口 8792），前端只访问伴随服务的 `/api/soul/*`，由 Node 透明代理到这里。

## 来源

计算逻辑来自对 [yys照妖镜](http://91zhaoyaojing.com) 的逆向复刻（本仓库 `reverse_zyj/`），
已与服务端数据逐项对拍：散件一~五速、头/尾判定、score/zscore 语义、面板/伤害公式等。

- `engine.py`：报告、一速、评分分布、精确头尾、组合搜索
- `service.py` / `store.py` / `server.py`：HTTP API、缓存（24h）、任务队列
- `vendor/`：`calc_demo.py`（组合搜索/面板/伤害）、`yyx_client.py`（抓取）、
  `parse_equip.py`（CBG equip_desc 精确指标）、`yyx_parser.py`（格式解析）

## 依赖

- Python 3.10+
- `requests`（`pip install requests`）

## 独立运行（调试用）

```bash
python server.py --port 8792
# API： http://127.0.0.1:8792/api/soul/health
# 页面：http://127.0.0.1:8792/ （可选的内置调试页；正式入口在 cbg-web 的 #/soul）
```

## 数据与缓存

`data/` 下按 ordersn 缓存原始 yyx（gzip）与报告摘要，TTL 24 小时；不提交到仓库。

## 由伴随服务代理的接口

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/soul/health` | 内核健康检查 |
| GET | `/api/soul/meta` | 式神 / 套装 / 指标枚举 |
| GET | `/api/soul/demo` | 内置示例数据报告 |
| GET | `/api/soul/report?ordersn=&serverid=`（或 `cbg_url=`） | 报告（缓存优先） |
| POST | `/api/soul/report/upload` | 上传 yyx（multipart `file`） |
| GET | `/api/soul/precise?ordersn=` | 精确头/尾/17 速（CBG equip_desc） |
| POST | `/api/soul/search` | 组合搜索（异步任务） |
| GET | `/api/soul/job?id=` | 搜索结果轮询 |

## 合规

数据来自藏宝阁公开页面与第三方免费工具，仅作个人学习/自建工具展示；请低频使用、缓存结果、不转售数据。
