#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""「照妖镜/看号工具」模块四本地内核（零第三方依赖）。

对外 HTTP 接口（全部 JSON，CORS 开放）：
    GET  /api/inspector/health
    GET  /api/inspector/meta
    GET  /api/inspector/demo
    GET  /api/inspector/report?ordersn=&serverid=&url=&refresh=1&via=cbg|mayday
    GET  /api/inspector/speed?ordersn=&serverid=&fourth=攻击加成&sixth=暴击
    GET  /api/inspector/relics?ordersn=&serverid=&position=1&suits=狂骨,破势&...
    POST /api/inspector/pve      {"ordersn":"","serverid":"","url":""}
    POST /api/inspector/calc     {"ordersn":"","hero":"须佐之男","metric":"damage",...}
    GET  /api/inspector/job?id=
    POST /api/shutdown

静态网页：同目录 web/ 下的 index.html / app.js / style.css
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import signal
import sys
import threading
import time
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from service import Service, ServiceError  # noqa: E402

WEB_DIR = HERE / "web"

_json_types = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


class App:
    def __init__(self, service: Service):
        self.service = service
        self.started = time.time()
        self.stopping = threading.Event()


class Handler(BaseHTTPRequestHandler):
    server_version = "CBGInspector/0.1"
    app: App

    # ------------------------------------------------------------ 基础
    def log_message(self, fmt, *args):                        # noqa: A003
        sys.stderr.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status, code, message):
        self.send_json({"ok": False, "error": {"code": code, "message": message}}, status)

    # ------------------------------------------------------------ 静态文件
    def serve_static(self, path: str) -> bool:
        rel = path.lstrip("/") or "index.html"
        if rel.endswith("/"):
            rel += "index.html"
        target = (WEB_DIR / rel).resolve()
        if WEB_DIR.resolve() not in target.parents and target != WEB_DIR.resolve():
            return False
        if not target.is_file():
            return False
        body = target.read_bytes()
        ctype = _json_types.get(target.suffix.lower()) or mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)
        return True

    # ------------------------------------------------------------ 路由
    def do_OPTIONS(self):                                     # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):                                         # noqa: N802
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        if path.startswith("/api/"):
            try:
                self.handle_api(path, dict(urllib.parse.parse_qsl(parsed.query)))
            except ServiceError as exc:
                self.send_error_json(exc.status, exc.code, exc.msg)
            except Exception as exc:                          # noqa: BLE001
                traceback.print_exc()
                self.send_error_json(500, "INTERNAL", f"内部错误：{exc}")
            return
        if path in ("/", "/index.html") or "." in path.rsplit("/", 1)[-1]:
            if self.serve_static(path):
                return
        if self.serve_static("/index.html"):
            return
        self.send_error_json(404, "NOT_FOUND", "页面不存在")

    def do_POST(self):                                        # noqa: N802
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw.decode("utf-8")) if raw.strip() else {}
            if not isinstance(body, dict):
                raise ValueError("请求体必须是 JSON 对象")
        except ValueError as exc:
            self.send_error_json(400, "BAD_JSON", f"请求体不是合法 JSON：{exc}")
            return

        try:
            if path == "/api/shutdown":
                self.send_json({"ok": True, "message": "正在关闭内核…"})
                threading.Thread(target=self._shutdown_later, daemon=True).start()
                return
            if path == "/api/inspector/pve":
                payload = self._ordersn_args(body)
                job_id = self.server.app.service.pve_combos(
                    payload["ordersn"], payload["serverid"], cbg_url=payload["url"],
                    refresh=bool(body.get("refresh")))
                self.send_json({"ok": True, "jobId": job_id})
                return
            if path == "/api/inspector/calc":
                job_id = self.server.app.service.calc(body)
                self.send_json({"ok": True, "jobId": job_id})
                return
            self.send_error_json(404, "NOT_FOUND", "接口不存在")
        except ServiceError as exc:
            self.send_error_json(exc.status, exc.code, exc.msg)
        except Exception as exc:                              # noqa: BLE001
            traceback.print_exc()
            self.send_error_json(500, "INTERNAL", f"内部错误：{exc}")

    def _shutdown_later(self):
        time.sleep(0.2)
        self.server.app.stopping.set()
        threading.Thread(target=self.server.shutdown, daemon=True).start()

    # ------------------------------------------------------------ API
    @staticmethod
    def _ordersn_args(data: dict) -> dict:
        url = str(data.get("url") or data.get("cbgUrl") or data.get("cbg_url") or "").strip()
        return {
            "ordersn": str(data.get("ordersn") or "").strip(),
            "serverid": str(data.get("serverid") or "").strip(),
            "url": url,
        }

    def _load_args(self, query: dict) -> dict:
        url = str(query.get("url") or "").strip()
        return {
            "ordersn": str(query.get("ordersn") or "").strip(),
            "serverid": str(query.get("serverid") or "").strip(),
            "cbg_url": url,
            "refresh": str(query.get("refresh") or "") in ("1", "true", "yes"),
            "via": str(query.get("via") or "cbg"),
        }

    def handle_api(self, path: str, query: dict) -> None:
        svc = self.server.app.service
        if path == "/api/inspector/health":
            self.send_json({
                "ok": True, "ready": True, "version": "0.1.0",
                "service": "inspector", "uptime": int(time.time() - self.server.app.started),
                "stats": svc.stats, "cacheDir": str(svc.cache_dir),
            })
            return
        if path == "/api/inspector/meta":
            self.send_json(svc.meta())
            return
        if path == "/api/inspector/demo":
            self.send_json(svc.demo_report())
            return
        if path == "/api/inspector/report":
            args = self._load_args(query)
            self.send_json(svc.report(**args))
            return
        if path == "/api/inspector/speed":
            args = self._load_args(query)
            fourth = [x for x in (query.get("fourth") or "").split(",") if x]
            sixth = [x for x in (query.get("sixth") or "").split(",") if x]
            data = svc.speed_combos(args["ordersn"], args["serverid"],
                                    fourth_main=fourth or None, sixth_main=sixth or None,
                                    cbg_url=args["cbg_url"])
            self.send_json(data)
            return
        if path == "/api/inspector/relics":
            args = self._load_args(query)
            position = query.get("position")
            data = svc.relics(
                args["ordersn"], args["serverid"],
                position=int(position) if position else None,
                suits=[x for x in (query.get("suits") or "").split(",") if x] or None,
                mains=[x for x in (query.get("mains") or "").split(",") if x] or None,
                subs=[x for x in (query.get("subs") or "").split(",") if x] or None,
                sort_by=str(query.get("sort") or "speed"),
                limit=int(query.get("limit") or 200),
            )
            self.send_json(data)
            return
        if path == "/api/inspector/job":
            job_id = str(query.get("id") or "").strip()
            if not job_id:
                raise ServiceError(400, "BAD_ARGS", "缺少任务 id")
            self.send_json({"ok": True, "job": svc.job(job_id)})
            return
        raise ServiceError(404, "NOT_FOUND", "接口不存在")


def main() -> int:
    parser = argparse.ArgumentParser(description="CBGCHECK 模块四：藏宝阁看号工具本地内核")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8793)
    parser.add_argument("--data-dir", default=str(HERE / "data"))
    parser.add_argument("--ttl", type=int, default=int(os.environ.get("INSPECTOR_TTL") or 86400))
    parser.add_argument("--min-gap", type=float, default=3.0)
    parser.add_argument("--via", default="cbg", choices=["cbg", "mayday"])
    args = parser.parse_args()

    service = Service(args.data_dir, ttl=args.ttl, min_gap=args.min_gap)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.app = App(service)
    server.daemon_threads = True
    server.app.via = args.via

    def _bye(signum, frame):                                  # noqa: ARG001
        print("收到退出信号，正在关闭…", flush=True)
        server.app.stopping.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    try:
        signal.signal(signal.SIGINT, _bye)
        signal.signal(signal.SIGTERM, _bye)
    except (ValueError, OSError):
        pass

    print("=" * 62)
    print(" CBGCHECK 模块四 · 藏宝阁看号工具本地内核")
    print(f"   接口: http://{args.host}:{args.port}/api/inspector/health")
    print(f"   网页: http://{args.host}:{args.port}/")
    print(f"   缓存: {service.cache_dir}")
    print("=" * 62, flush=True)
    try:
        server.serve_forever(poll_interval=0.3)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("内核已停止。", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
