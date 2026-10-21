# 执行计划 v1

- 计划版本：v1
- 冻结时间：2026-10-21T20:50:00+08:00
- 作者：模型 A（route: 当前会话 lead）
- 执行者：模型 B（route: 待指派，建议 teammate）

## 1. 目标与非目标

### 目标（可验证）

1. 新建共享模块 `tools/cbg/pycommon/`（纯标准库），抽取两个服务中**真正重复**的 HTTP 外壳：CORS 头、JSON 响应写出、请求体读取、服务器启动/端口与 CLI 参数解析、SIGINT/SIGTERM 退出处理。
2. `tools/cbg/soul-service/server.py` 与 `tools/cbg/inspector-service/server.py` 改为调用该模块；两者仍可各自独立 `python server.py` 启动。
3. 对外行为不变：路由集合、HTTP 状态码、响应 JSON 字段结构（含两服务各自不同的错误信封）、CORS 头、日志格式保持一致。
4. 新增标准库 `unittest` 测试：在临时端口分别启动两个服务，断言 `/health`（soul: `/api/soul/health`；inspector: `/api/inspector/health`）与至少一个业务路由的状态码与响应字段。
5. 改造前后对同一组请求的响应（状态码、Content-Type、CORS 头、JSON 字段名）做对比，结果一致。

### 非目标 / 明确不做

1. 不修改 `tools/cbg/scraper-service/`（含其 `server.mjs`，即便工作区中该文件已有未提交改动）。
2. 不修改 `cbg-web/`、`.pipeline/templates/`，不 git commit / git push。
3. 不统一两服务的错误信封（soul 为 `{ok,code,msg}`，inspector 为 `{ok,error:{code,message}}`）——这是对外契约，保持原样。
4. 不重写 `service.py` / `engine.py` / `cbg_inspector/` 等业务逻辑，不改路由表的业务语义。
5. 不引入第三方依赖（`requests` 仅在已有业务代码中使用，共享模块不得新增对它的依赖）。
6. 不修改 README 之外的无关文档；README 仅可增加一小段关于 pycommon 与运行测试的说明。

## 2. 输入

| 编号 | 类型 | 路径/来源 | 说明 |
|---|---|---|---|
| I1 | code | `tools/cbg/soul-service/server.py` | 待改造，约 222 行；Handler 使用 `_json/_file`、类属性 `allow_origin`、`ServiceError→{ok,code,msg}` |
| I2 | code | `tools/cbg/inspector-service/server.py` | 待改造，约 286 行；Handler 使用 `send_json/send_error_json/_cors`、`App` 对象、信号退出 |
| I3 | code | `tools/cbg/soul-service/service.py`、`tools/cbg/inspector-service/service.py` | 只读：确认 `ServiceError(status, code, msg)` 的字段定义，不修改 |
| I4 | doc | `.pipeline/templates/plan-template.md`、`acceptance.schema.json`、`artifact-profiles.md` | 产出格式约束 |
| I5 | doc | `README.md`（仓库根及 `tools/cbg/soul-service/README.md`） | 仅允许追加一段说明 |

## 3. 产物清单

| 编号 | 路径 | artifact_type | 说明 |
|---|---|---|---|
| A1 | `tools/cbg/pycommon/__init__.py` | code | 包初始化，导出公共符号 |
| A2 | `tools/cbg/pycommon/httpkit.py` | code | 共享 HTTP 外壳：`cors_headers(handler, origin, methods, headers, extra)`、`send_json(handler, status, payload, *, extra_headers=None)`、`read_body(handler)`、`json_error_envelope` 由调用方传入的 builder 决定；`serve(host, port, handler_cls, banner_lines)` 含信号处理与 `serve_forever` |
| A3 | `tools/cbg/pycommon/cli.py` | code | 通用 CLI 参数辅助：`add_common_server_args(parser, default_port, ...)`，统一 `--host/--port` 定义（默认值由服务传入） |
| A4 | `tools/cbg/soul-service/server.py` | code | 改造：Handler 继承/使用 pycommon，保留 `_file`、路由、错误信封 `{ok,code,msg}` 与 `allow_origin` 行为 |
| A5 | `tools/cbg/inspector-service/server.py` | code | 改造：Handler 使用 pycommon，保留 `send_error_json` 信封 `{ok,error:{code,message}}`、`_cors` 中 `Cache-Control: no-store`、`App` 与 `serve_static` 行为 |
| A6 | `tools/cbg/pycommon/tests/test_servers.py` | code | unittest：临时端口起两服务，断言 health + 业务路由；并做改造前后头部/状态码断言 |
| A7 | `tools/cbg/pycommon/tests/__init__.py` | code | 测试包标识（空文件或最小内容） |
| A8 | `tools/cbg/pycommon/README.md` | doc | 模块用途、两服务如何复用、如何运行测试（约 30 行以内） |
| A9 | `README.md`（仓库根） | doc | 仅追加一小节“本机服务共享代码与测试”指向 A8 与测试命令；不得改动其他章节 |

> 注：A9 为唯一允许修改的既有文档；若执行者认为根 README 不必改动，可跳过并在报告中说明（属 Q2 的默认处理）。

## 4. 接口与约定

- 目录结构：
  ```
  tools/cbg/pycommon/
    __init__.py
    httpkit.py
    cli.py
    README.md
    tests/
      __init__.py
      test_servers.py
  ```
- 导入方式：两服务均已用 `sys.path.insert(0, HERE)` 引入本地模块；pycommon 位于 `tools/cbg/pycommon`，服务需额外 `sys.path.insert(0, <tools/cbg 绝对路径>)` 后 `from pycommon.httpkit import ...`。`tools/cbg/` 不得依赖 cwd。
- 命名规范：模块与函数使用 snake_case；保留两服务现有方法名（`_json`、`send_json`、`send_error_json`、`_cors` 等）作为薄包装，避免改动业务路由代码。
- 对外接口 / 函数签名 / 数据 schema（必须保持）：
  - soul：`GET /`、`GET /index.html`、`GET /web/*`、`GET /api/soul/{health,report,precise,job,meta,demo}`、`POST /api/soul/report/upload`、`POST /api/soul/search`、`OPTIONS *`。错误体 `{"ok":false,"code":...,"msg":...}`；`OPTIONS` 204 带 `Access-Control-Allow-Origin/Methods/Headers`（Methods 为 `GET, POST, OPTIONS`）；JSON 响应带 `Cache-Control: no-store`。
  - inspector：`/api/inspector/{health,meta,demo,report,speed,relics,pve,calc,job}`、`POST /api/shutdown`、静态 `/` 与 `web/`。错误体 `{"ok":false,"error":{"code":...,"message":...}}`；所有响应带 CORS 三件套与 `Cache-Control: no-store`。
  - pycommon 公共 API（建议，B 可微调但需在 README 说明）：
    - `cors_headers(handler, origin="*", methods=None, allow_headers="Content-Type", cache_control=None)`：写 CORS 头，`cache_control` 为 None 时不写。
    - `send_json(handler, status, payload, *, origin="*", cache_control="no-store")`：统一 JSON 写出（ensure_ascii=False、utf-8、Content-Length）。
    - `read_body(handler) -> bytes`：按 Content-Length 读取。
    - `serve(host, port, handler_cls, banner, *, on_shutdown=None) -> int`：创建 `ThreadingHTTPServer`、注册 SIGINT/SIGTERM（忽略 ValueError/OSError）、打印 banner、`serve_forever`、`server_close`。返回 0。
    - `add_server_args(parser, *, default_host="127.0.0.1", default_port)`。
- 编码与格式规范：UTF-8；Python 3.10+ 语法；与现有代码一致（`from __future__ import annotations`、中文注释与日志可保留）；日志仍走 `log_message` → stderr，格式 `[HH:MM:SS] msg`。

## 5. 环境与命令

- 运行时与版本：Python 3.13.9（已确认可用）；标准库 + 既有 `requests`。
- 依赖与安装方式：无新增依赖。测试使用 `unittest`（标准库），无需 pytest。
- 构建 / 运行 / 测试命令：
  - 启动 soul（人工冒烟）：`python tools/cbg/soul-service/server.py --port 18790`
  - 启动 inspector（人工冒烟）：`python tools/cbg/inspector-service/server.py --port 18793`
  - 测试：`python -m unittest discover -s tools/cbg/pycommon/tests -t tools/cbg -v`（在仓库根执行）
  - 语法检查：`python -m py_compile tools/cbg/pycommon/*.py tools/cbg/soul-service/server.py tools/cbg/inspector-service/server.py`
- 禁止引入的依赖或服务：pytest 以外的第三方包；Flask/FastAPI/aiohttp 等 Web 框架；任何对外网络请求（测试不得访问 CBG 外网，`/api/*` 中仅测试不触网的端点，如 `health`、`meta`、`demo`；业务路由断言限定为 `meta`/`demo`/`/api/soul/demo`，禁止依赖抓取）。

## 6. 执行步骤

1. 阅读两个 `server.py` 与对应 `service.py` 中 `ServiceError` 定义，确认错误字段（只读）。
2. 对两个服务当前版本做**基线采集**：启动各自服务于临时端口，记录 `/api/*/health`、`/api/*/meta`（inspector）、`/api/soul/demo`、`OPTIONS` 的状态码、`Content-Type`、CORS 头、`Cache-Control`、JSON 键集合，保存为 `tools/cbg/pycommon/tests/baseline.json`（或测试内硬编码期望，二选一并在测试中使用）。
3. 新建 `tools/cbg/pycommon/`（A1–A3），实现 `httpkit.py` 与 `cli.py`，保证不 import 任何服务私有模块。
4. 改造 `soul-service/server.py`（A4）：`Handler` 的 `_json` 委托 `send_json`，`do_OPTIONS` 委托 `cors_headers`，`main()` 的 `ThreadingHTTPServer` + `serve_forever` + banner 改为 `serve(...)`；路由与错误映射不动。
5. 改造 `inspector-service/server.py`（A5）：`send_json`、`_cors`、`_shutdown_later` 中的 `server.shutdown` 保持原语义；`main()` 使用 `serve(...)`，保留 `App` 与 `signal` 行为（若 `serve` 不便接管 `App`，允许 `main` 保留自己的 `_bye` 注册，但需复用 pycommon 的 `register_signal_handlers`）。
6. 编写 `tests/test_servers.py`（A6）与 `tests/__init__.py`（A7）：用 `subprocess` 在随机空闲端口（`socket` 绑定 0 取端口）启动两服务，超时 15 秒内轮询 health；断言：
   - soul：`GET /api/soul/health` → 200、`ok==true`、含 `stats`；`GET /api/soul/demo` → 200 且 `ok` 或业务字段存在（以基线为准）；`OPTIONS /api/soul/health` → 204 且含 `Access-Control-Allow-Origin`；404 路由返回 `{"ok":false,"msg":...}`。
   - inspector：`GET /api/inspector/health` → 200、`ok==true`、`service=="inspector"`；`GET /api/inspector/meta` → 200 且 `ok` 字段存在（以基线为准）；未知 API → 404 且 `error.code=="NOT_FOUND"`；任一响应含 `Cache-Control: no-store` 与 `Access-Control-Allow-Origin: *`。
   - 测试结束 `terminate()` 子进程并 `wait`。
7. 改造后重跑步骤 2 的基线采集脚本（可复用测试的请求列表），与基线 diff，差异仅允许出现在 `Date/Server` 等非契约头；记录 diff 到 `evidence/baseline-diff.txt`。
8. 编写 `tools/cbg/pycommon/README.md`（A8），并在根 README 追加小节（A9，见 Q2）。
9. 运行第 5 节的全部命令，将输出写入 `evidence/` 对应文件。
10. 确认 `git status` 中 `tools/cbg/scraper-service/` 无新增改动（由本次任务引起）；若有，回滚本次引起的改动（不得回滚他人已有改动）。

## 7. 验收标准

见 `acceptance.json`（需求 → 检查项追溯）。本计划冻结后，验收项只允许通过升版本修改。

## 8. 假设与待确认

| 编号 | 假设/问题 | 不确认时的默认处理 | 找谁确认 |
|---|---|---|---|
| Q1 | soul-service 的 `web/` 目录当前磁盘上**不存在**（`_file` 对 `/` 与 `/web/*` 会返回 404）。是否需要保留该行为，还是误删的资源？ | 视为现状，**保持行为不变**，不补资源、不改路由；在报告中注明 | 项目 owner |
| Q2 | 根 `README.md` 当前已有未提交改动（`M README.md`）。是否允许在其中追加小节？ | 允许，但仅追加 A9 指定的一小节，且不覆盖/重排已有未提交内容；若冲突风险高则跳过 A9 并在报告说明 | 项目 owner |
| Q3 | `tools/cbg/scraper-service/server.mjs` 已有未提交改动，本次不触碰。 | 完全不改动，不 stash、不回滚 | 项目 owner |
| Q4 | 两服务错误信封不统一（soul: `msg`；inspector: `error.message`）。是否要求统一？ | **不统一**，视为对外契约，保持原样（硬约束 1） | 项目 owner |
| Q5 | 测试是否需要 pytest？ | 不需要，使用 `unittest`（标准库，满足“不引入第三方依赖”） | — |
| Q6 | `pycommon` 放在 `tools/cbg/pycommon` 是否合适（建议路径）？ | 按建议路径执行 | 项目 owner |

## 9. 自由度

- 必须照做：
  - 不改 `scraper-service/`、`cbg-web/`、`.pipeline/templates/`；不 git commit / push。
  - 路由集合、状态码、错误信封、CORS 头、`Cache-Control` 与改造前一致（以基线 diff 为准）。
  - 仅用标准库；测试用 `unittest`。
  - 两服务各自独立可启动，pycommon 不依赖服务私有模块。
- 可自行决定：
  - `httpkit.py` 内部函数拆分方式、是否保留 `_json` 等方法名作为薄包装。
  - 基线采集是写成脚本还是测试内硬编码期望。
  - `serve()` 是否接收 `on_shutdown` 回调，或由 inspector 保留自身信号注册（只要复用了共享的注册函数）。
- 超出范围必须先问：
  - 需要改动两服务的 `service.py` / `engine.py` / `cbg_inspector/` 业务代码。
  - 需要统一错误信封、改变任一路由的 HTTP 语义。
  - 需要新增第三方依赖或改动 `.gitignore`。
  - 需要修改 README 中已有未提交改动的既有章节（见 Q2）。

## 10. A 的自检清单（冻结前逐项确认）

- [x] 每个产物都有精确路径和 `artifact_type`（见第 3 节 A1–A9，文档类为 doc，代码类为 code）
- [x] 每个需求至少对应一个可执行检查项（见 acceptance.json requirements→checks 追溯）
- [x] 所有 L1/L2 检查都有命令、工作目录、期望结果、超时（见 acceptance.json）
- [x] 无歧义表述；歧义已列入第 8 节（Q1–Q6）
- [x] 没有要求 B 做其能力范围外的事（工具 / 上下文 / 网络 / 权限）——测试不触网，仅本机临时端口
- [x] 非功能要求（安全 / 性能 / 日志 / 许可）已写：日志格式保持、无新依赖、CORS 不扩大（仍为 `*` / 配置值，不新增放开面）、测试 ≤ 60 秒
- [x] 不可逆动作已标注需人工确认：无删除/迁移类动作；如需删除 `pycommon` 或回滚 README 需人工确认
