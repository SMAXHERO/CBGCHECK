# C8 终审：diff 审查 + L3 黑盒结论

- 评审模型：模型 A（终审，独立会话，未采信执行者结论）
- 评审范围：`tools/cbg/soul-service/server.py`、`tools/cbg/inspector-service/server.py`、新增 `tools/cbg/pycommon/`

## 一、L1/L2 独立复跑结果

| 检查 | 命令 | 结果 |
|---|---|---|
| C1 | `python -m py_compile …`（5 个文件） | exit 0，PASS |
| C2 | AST import 静态检查（禁止 service/engine/requests/cbg_inspector/store/vendor） | `OK []`，PASS |
| C3 | `unittest …TestStandaloneStart` | 由 C4 全套覆盖（两服务独立启动 health 200，PASS） |
| C4 | `unittest discover -s tools/cbg/pycommon/tests -t tools/cbg -v` | 8 tests OK，PASS |
| C5 | `baseline_compare.py --check` | `NO_DIFF`，PASS |
| C6 | 禁止路径 git status（见下） | 按增量口径 PASS（见二） |

## 二、C6 口径判定

禁止路径 `tools/cbg/scraper-service/`、`cbg-web/`、`.pipeline/templates/` 当前有 git 状态，但 mtime 实测：
- `cbg-web/src/api/client.ts` 2026-10-21 20:17:42
- `tools/cbg/scraper-service/server.mjs` 2026-10-21 20:21:55
- `.pipeline/templates/`（目录内文件）2026-10-21 20:36:36

而执行窗口为 `freeze.json` 20:37:50 之后、服务文件改造 20:44 左右。以上路径全部早于执行窗口，且 `git status` 输出与 `C6-git-status.txt` 执行前证据一致，**本次未触碰这些路径**。按“相对执行前基线的增量”口径判定 **C6 PASS**。

## 三、diff 审查（Lead 关注点）

`git diff HEAD -- tools/cbg/soul-service/server.py tools/cbg/inspector-service/server.py`（47 insertions / 70 deletions）：
- 仅做外壳抽取：`_json`/`send_json`/`_cors`/`_body` 委托 pycommon；`main()` 的 `ThreadingHTTPServer`+banner+`serve_forever` 改为 `serve()`。
- 路由表、`ServiceError` 映射、错误信封函数 (`send_error_json`)、`App` 对象、`WEB_DIR` 静态服务、`/api/shutdown` 均未改动。业务逻辑未被重写。
- `pycommon` 无第三方依赖（C2 + 人工核对 import 列表：仅 `json/signal/threading/http.server/typing/argparse/__future__`）。
- **死代码检查**：`inspector/server.py` 仍保留 `import threading`、`import time`、`import traceback`、`import json` 等，需确认仍被使用；`soul/server.py` 的 `json` 仍用于 `_json`/body 解析。未发现明显死代码阻断项（`inspector` 的 `threading` 由 `App`/`_shutdown_later` 使用，属正常）。
- **轻微偏差（已记录在交付报告，本次确认）**：soul 的 Ctrl-C 原打印 `bye`，现静默。仅 stdout 文案，HTTP 行为不变，**可接受**。
- 核实更正：`inspector` 的 `_cors()` 仍被 `server.py` 第 94、102 行（静态/文件响应路径）直接调用，**不是死代码**，前述“可能未使用”的担忧已排除。`threading/time/traceback/json` 均有实际使用。

## 四、L3 黑盒行为核对（重点）

在临时端口 soul 18781 / inspector 18782 启动新版本，并在 18791 / 18792 启动 `git archive HEAD` 的原版本作对照（测试后已全部终止，无残留监听）。

| 请求 | 新版 | HEAD 版 | 结论 |
|---|---|---|---|
| `GET /api/soul/health` | 200 JSON keys `[ok,stats]` | 200 同 | SAME |
| `GET /api/soul/demo` | 200 同键集 | 200 同键集 | SAME |
| `GET /api/soul/nope` | 404 `{ok,msg}` | 404 `{ok,msg}` | SAME（soul 信封未变） |
| `GET /` (soul, web 缺失) | 404 `{ok,msg}` | 404 `{ok,msg}` | SAME（Q1 现状保持） |
| `OPTIONS /api/soul/health` | 204，`Allow-Origin/Methods/Headers` 存在 | 同 | SAME（无 Cache-Control，与基线一致） |
| `GET /api/inspector/health` | 200 `[cacheDir,ok,ready,service,stats,uptime,version]` | 同 | SAME |
| `GET /api/inspector/meta` | 200 同键集 | 同 | SAME |
| `GET /api/inspector/nope` | 404 `{ok,error:{code,message}}` | 同 | SAME（inspector 信封未变） |
| `OPTIONS /api/inspector/health` | 204 | 204 | SAME |
| `GET /` (inspector 静态) | 200 text/html | 200 text/html | SAME |

CORS 与 Cache-Control 头对比：`GET` 类响应两侧一致（inspector 三件套 + `Cache-Control: no-store`；soul `Allow-Origin` + `Cache-Control: no-store`）。两服务错误信封保持各自不同，**未被统一**。

## 五、结论

- L1/L2：C1–C6 全部 PASS（C6 按增量口径）。
- L3：C7 PASS；C8 终审：对外行为与 HEAD 一致，diff 仅为外壳抽取，业务逻辑未变，无第三方依赖，禁止路径未被本次改动。
- 遗留非阻断项：`inspector/server.py` 的 `_cors` 可能成为未使用包装（建议清理）；soul Ctrl-C 文案偏差（已记录）。

**C8 PASS（附非阻断建议）**。
