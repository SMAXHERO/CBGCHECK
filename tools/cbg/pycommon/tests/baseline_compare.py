# -*- coding: utf-8 -*-
"""改造前后契约对比脚本。

用法（仓库根执行）：
    python tools/cbg/pycommon/tests/baseline_compare.py --capture OUT.json   # 采集
    python tools/cbg/pycommon/tests/baseline_compare.py --check             # 与基线比对

对两个服务在临时端口启动，对固定请求列表记录：状态码、Content-Type、
Access-Control-* 头、Cache-Control、JSON 键集合（递归）。仅忽略 Date/Server。
--check 读取 tests/baseline.json 与当前实现比对，无差异输出 NO_DIFF 并退出 0。
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
BASELINE = HERE / "baseline.json"

SERVICES = {
    "soul": {
        "script": REPO / "tools/cbg/soul-service/server.py",
        "requests": [
            ("GET", "/api/soul/health", None),
            ("GET", "/api/soul/demo", None),
            ("GET", "/api/soul/no-such-route", None),
            ("GET", "/", None),
            ("OPTIONS", "/api/soul/health", None),
        ],
    },
    "inspector": {
        "script": REPO / "tools/cbg/inspector-service/server.py",
        "requests": [
            ("GET", "/api/inspector/health", None),
            ("GET", "/api/inspector/meta", None),
            ("GET", "/api/inspector/demo", None),
            ("GET", "/api/inspector/no-such-route", None),
            ("OPTIONS", "/api/inspector/health", None),
        ],
    },
}

KEEP_HEADERS = ("Content-Type", "Access-Control-Allow-Origin",
                "Access-Control-Allow-Methods", "Access-Control-Allow-Headers",
                "Cache-Control")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _keys(obj, prefix=""):
    """递归提取 JSON 键路径集合（不含值）。"""
    out = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            p = f"{prefix}.{k}" if prefix else k
            out.add(p)
            out |= _keys(v, p)
    elif isinstance(obj, list) and obj:
        out |= _keys(obj[0], prefix + "[]")
    return out


def _do(base: str, method: str, path: str):
    req = urllib.request.Request(base + path, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=20)
    except urllib.error.HTTPError as e:
        resp = e
    body = resp.read()
    headers = {h: resp.headers.get(h) for h in KEEP_HEADERS}
    rec = {"status": resp.status if hasattr(resp, "status") else resp.code,
           "headers": headers}
    ctype = headers.get("Content-Type") or ""
    if "json" in ctype:
        try:
            rec["keys"] = sorted(_keys(json.loads(body.decode("utf-8"))))
        except ValueError:
            rec["keys"] = "INVALID_JSON"
    return rec


def capture() -> dict:
    result = {}
    for name, spec in SERVICES.items():
        port = _free_port()
        proc = subprocess.Popen(
            [sys.executable, str(spec["script"]), "--port", str(port)],
            cwd=str(REPO), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        base = f"http://127.0.0.1:{port}"
        try:
            deadline = time.time() + 15
            while time.time() < deadline:
                try:
                    urllib.request.urlopen(base + "/", timeout=1)
                    break
                except urllib.error.HTTPError:
                    break
                except OSError:
                    time.sleep(0.2)
            rows = {}
            for method, path, _ in spec["requests"]:
                rows[f"{method} {path}"] = _do(base, method, path)
            result[name] = rows
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--capture", metavar="OUT", help="采集并写入 OUT")
    g.add_argument("--check", action="store_true", help="与 tests/baseline.json 比对")
    args = ap.parse_args()

    current = capture()
    if args.capture:
        Path(args.capture).write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"已写入 {args.capture}")
        return 0

    if not BASELINE.exists():
        print("MISSING_BASELINE: 缺少 tests/baseline.json")
        return 2
    base = json.loads(BASELINE.read_text(encoding="utf-8"))
    diffs = []
    for svc, rows in base.items():
        for key, expect in rows.items():
            got = current.get(svc, {}).get(key)
            if got != expect:
                diffs.append(f"{svc} {key}\n  expect={expect}\n  got   ={got}")
    if diffs:
        print("DIFF")
        print("\n".join(diffs))
        return 1
    print("NO_DIFF")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
