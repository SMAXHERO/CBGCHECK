# -*- coding: utf-8 -*-
"""通用 CLI 参数辅助：统一 --host / --port 定义，默认值由各服务传入。"""
from __future__ import annotations

import argparse


def add_server_args(
    parser: argparse.ArgumentParser,
    *,
    default_host: str = "127.0.0.1",
    default_port: int,
) -> argparse.ArgumentParser:
    """向 parser 添加 --host 与 --port（默认值由服务指定）。返回 parser 便于链式调用。"""
    parser.add_argument("--host", default=default_host)
    parser.add_argument("--port", type=int, default=default_port)
    return parser
