# -*- coding: utf-8 -*-
"""共享 HTTP 外壳：CORS 头、JSON 写出、请求体读取、服务启动与信号处理。

只依赖标准库；不 import 任何服务私有模块（service / engine / cbg_inspector 等）。
"""
from __future__ import annotations

import json
import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Optional, Sequence


def cors_headers(
    handler: BaseHTTPRequestHandler,
    origin: str = "*",
    methods: Optional[str] = None,
    allow_headers: Optional[str] = "Content-Type",
    cache_control: Optional[str] = None,
) -> None:
    """写 CORS 头；cache_control 为 None 时不写 Cache-Control。

    注意：仅写头，不调用 end_headers()，由调用方决定何时结束头部。
    """
    handler.send_header("Access-Control-Allow-Origin", origin)
    if methods is not None:
        handler.send_header("Access-Control-Allow-Methods", methods)
    if allow_headers is not None:
        handler.send_header("Access-Control-Allow-Headers", allow_headers)
    if cache_control is not None:
        handler.send_header("Cache-Control", cache_control)


def send_json(
    handler: BaseHTTPRequestHandler,
    status: int,
    payload: Any,
    *,
    origin: str = "*",
    cache_control: Optional[str] = "no-store",
    extra_cors: bool = False,
) -> None:
    """统一 JSON 写出：ensure_ascii=False、utf-8、Content-Length、CORS 头。

    extra_cors=True 时写入完整 CORS 三件套（Methods/Headers），与 inspector 的
    `_cors()` 一致；默认只写 Allow-Origin，与 soul 的 `_json()` 一致。
    """
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    if extra_cors:
        cors_headers(
            handler,
            origin=origin,
            methods="GET, POST, OPTIONS",
            allow_headers="Content-Type",
            cache_control=cache_control,
        )
    else:
        handler.send_header("Access-Control-Allow-Origin", origin)
        if cache_control is not None:
            handler.send_header("Cache-Control", cache_control)
    handler.end_headers()
    handler.wfile.write(body)


def read_body(handler: BaseHTTPRequestHandler) -> bytes:
    """按 Content-Length 读取请求体；无或为 0 时返回空 bytes。"""
    n = int(handler.headers.get("Content-Length") or 0)
    return handler.rfile.read(n) if n else b""


def register_signal_handlers(
    handler_fn: Callable[[int, Any], None],
    signals: Sequence[int] = (signal.SIGINT, signal.SIGTERM),
) -> None:
    """注册退出信号；非主线程或平台不支持时静默忽略（ValueError/OSError）。"""
    for sig in signals:
        try:
            signal.signal(sig, handler_fn)
        except (ValueError, OSError):
            pass


def serve(
    host: str,
    port: int,
    handler_cls: type,
    banner: Sequence[str] = (),
    *,
    on_shutdown: Optional[Callable[[], None]] = None,
    install_signals: bool = True,
    poll_interval: float = 0.5,
    daemon_threads: bool = False,
    server_attrs: Optional[dict] = None,
) -> int:
    """创建 ThreadingHTTPServer 并 serve_forever；返回 0。

    - banner：启动时逐行打印到 stdout。
    - on_shutdown：收到 SIGINT/SIGTERM 时先调用（用于设置 stopping 标记等）。
    - install_signals=False 时不注册信号（由调用方自行处理）。
    - server_attrs：启动前挂到 server 实例上的属性（如 inspector 的 app）。
    """
    srv = ThreadingHTTPServer((host, port), handler_cls)
    srv.daemon_threads = daemon_threads
    for key, value in (server_attrs or {}).items():
        setattr(srv, key, value)

    if install_signals:
        def _bye(signum, frame):                              # noqa: ARG001
            print("收到退出信号，正在关闭…", flush=True)
            if on_shutdown is not None:
                on_shutdown()
            threading.Thread(target=srv.shutdown, daemon=True).start()

        register_signal_handlers(_bye)

    for line in banner:
        print(line, flush=True)
    try:
        srv.serve_forever(poll_interval=poll_interval)
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0
