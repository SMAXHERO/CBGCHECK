# tools/cbg/pycommon

`soul-service` 与 `inspector-service` 共用的 HTTP 外壳，**纯标准库**，不依赖任何服务私有模块（`service` / `engine` / `cbg_inspector` 等）。

## 模块

| 文件 | 内容 |
|---|---|
| `httpkit.py` | `cors_headers`、`send_json`、`read_body`、`register_signal_handlers`、`serve` |
| `cli.py` | `add_server_args(parser, *, default_host, default_port)`：统一 `--host/--port` |

### 公共 API

- `cors_headers(handler, origin="*", methods=None, allow_headers="Content-Type", cache_control=None)`：写 CORS 头；`cache_control` 为 `None` 时不写 `Cache-Control`。只写头，不结束头部。
- `send_json(handler, status, payload, *, origin="*", cache_control="no-store", extra_cors=False)`：统一 JSON 写出（`ensure_ascii=False`、utf-8、`Content-Length`）。`extra_cors=True` 时写完整 CORS 三件套（inspector 形态），否则只写 `Allow-Origin`（soul 形态）。
- `read_body(handler) -> bytes`：按 `Content-Length` 读取请求体。
- `serve(host, port, handler_cls, banner, *, on_shutdown=None, install_signals=True, poll_interval=0.5, daemon_threads=False, server_attrs=None) -> 0`：创建 `ThreadingHTTPServer`、可选注册 SIGINT/SIGTERM、打印 banner、`serve_forever`、`server_close`。
- `register_signal_handlers(fn)`：注册退出信号，非主线程时忽略 `ValueError/OSError`。

## 两服务如何复用

两服务通过 `sys.path` 把 `tools/cbg` 加入搜索路径后 `from pycommon import ...`，因此可在任意 cwd 下各自独立启动：

```
python tools/cbg/soul-service/server.py --port 8790
python tools/cbg/inspector-service/server.py --port 8793
```

**对外行为保持不变**（以改造前采集的基线为准）：

- soul 错误信封 `{"ok": false, "code": ..., "msg": ...}`；`OPTIONS` 204 不带 `Cache-Control`。
- inspector 错误信封 `{"ok": false, "error": {"code": ..., "message": ...}}`；所有响应带 CORS 三件套与 `Cache-Control: no-store`。
- 两服务的错误信封**刻意不统一**，这是对外契约。

## 运行测试

在仓库根执行：

```
python -m unittest discover -s tools/cbg/pycommon/tests -t tools/cbg -v
```

测试在临时端口分别启动两服务，断言 health 与一条不触网的业务路由（soul: `/api/soul/demo`；inspector: `/api/inspector/meta`）。

基线对比（改造前后契约一致性）：

```
python tools/cbg/pycommon/tests/baseline_compare.py --check
```

## 已知现状

- `soul-service/web/` 目录在磁盘上**不存在**，因此 soul 的 `GET /`、`/web/*` 返回 404。这是改造前即存在的现状，本次**未补资源、未改路由**。
