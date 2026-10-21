# -*- coding: utf-8 -*-
"""tools/cbg 本机服务的共享 HTTP 外壳（纯标准库）。

导出：
    httpkit: cors_headers / send_json / read_body / serve / register_signal_handlers
    cli:     add_server_args
"""
from __future__ import annotations

from .cli import add_server_args
from .httpkit import (
    cors_headers,
    read_body,
    register_signal_handlers,
    send_json,
    serve,
)

__all__ = [
    "add_server_args",
    "cors_headers",
    "read_body",
    "register_signal_handlers",
    "send_json",
    "serve",
]
