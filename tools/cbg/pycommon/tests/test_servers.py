# -*- coding: utf-8 -*-
"""两服务改造后的 unittest：在临时端口各自独立启动，断言 health 与业务路由。

只访问本机回环临时端口，不触网；业务路由限定为不抓取的端点（demo / meta）。
运行（仓库根）：
    python -m unittest discover -s tools/cbg/pycommon/tests -t tools/cbg -v
"""
from __future__ import annotations

import json
import socket
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
CBG = HERE.parents[1]
SOUL = CBG / "soul-service" / "server.py"
INSPECTOR = CBG / "inspector-service" / "server.py"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _fetch(url: str, method: str = "GET"):
    req = urllib.request.Request(url, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=20)
    except urllib.error.HTTPError as e:
        resp = e
    body = resp.read()
    data = None
    if body and "json" in (resp.headers.get("Content-Type") or ""):
        data = json.loads(body.decode("utf-8"))
    return resp.status, resp.headers, data


class _ServerCase(unittest.TestCase):
    script: Path = None  # type: ignore

    def setUp(self):
        self.port = _free_port()
        self.base = f"http://127.0.0.1:{self.port}"
        self.proc = subprocess.Popen(
            [sys.executable, str(self.script), "--port", str(self.port)],
            cwd=str(REPO), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self._wait_ready()

    def tearDown(self):
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(timeout=5)

    def _wait_ready(self, timeout: float = 15.0):
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            if self.proc.poll() is not None:
                self.fail(f"服务提前退出 code={self.proc.returncode}")
            try:
                urllib.request.urlopen(self.base + "/", timeout=1)
                return
            except urllib.error.HTTPError:
                return          # 任何 HTTP 响应都说明已在监听
            except OSError as e:
                last = e
                time.sleep(0.2)
        self.fail(f"服务 {timeout}s 内未就绪: {last}")


class TestSoulService(_ServerCase):
    script = SOUL

    def test_health(self):
        status, headers, data = _fetch(self.base + "/api/soul/health")
        self.assertEqual(status, 200)
        self.assertIs(data["ok"], True)
        self.assertIn("stats", data)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_business_route_demo(self):
        status, _, data = _fetch(self.base + "/api/soul/demo")
        self.assertEqual(status, 200)
        self.assertIsInstance(data, dict)

    def test_unknown_route_uses_soul_envelope(self):
        status, _, data = _fetch(self.base + "/api/soul/no-such-route")
        self.assertEqual(status, 404)
        self.assertIs(data["ok"], False)
        self.assertIn("msg", data)

    def test_options_cors(self):
        status, headers, _ = _fetch(self.base + "/api/soul/health", method="OPTIONS")
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        self.assertEqual(headers["Access-Control-Allow-Methods"], "GET, POST, OPTIONS")


class TestInspectorService(_ServerCase):
    script = INSPECTOR

    def test_health(self):
        status, headers, data = _fetch(self.base + "/api/inspector/health")
        self.assertEqual(status, 200)
        self.assertIs(data["ok"], True)
        self.assertEqual(data["service"], "inspector")
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_business_route_meta(self):
        status, _, data = _fetch(self.base + "/api/inspector/meta")
        self.assertEqual(status, 200)
        self.assertIn("ok", data)

    def test_unknown_api_uses_inspector_envelope(self):
        status, headers, data = _fetch(self.base + "/api/inspector/no-such-route")
        self.assertEqual(status, 404)
        self.assertEqual(data["error"]["code"], "NOT_FOUND")
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(headers["Access-Control-Allow-Origin"], "*")


class TestStandaloneStart(unittest.TestCase):
    """C3：两服务各自独立启动后 health 均为 200 且 ok==true。"""

    def test_both_start_independently(self):
        for script, health in ((SOUL, "/api/soul/health"), (INSPECTOR, "/api/inspector/health")):
            port = _free_port()
            proc = subprocess.Popen(
                [sys.executable, str(script), "--port", str(port)],
                cwd=str(REPO), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                deadline = time.time() + 15
                status, data = None, None
                while time.time() < deadline:
                    try:
                        status, _, data = _fetch(f"http://127.0.0.1:{port}{health}")
                        break
                    except OSError:
                        time.sleep(0.2)
                self.assertEqual(status, 200, script.name)
                self.assertIs(data["ok"], True, script.name)
            finally:
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
        print("OK")


if __name__ == "__main__":
    unittest.main()
