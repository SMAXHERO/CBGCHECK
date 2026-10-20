#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Soul Report Service —— 照妖镜功能的嵌入式实现（零依赖）
=====================================================

启动：
    python server.py --port 8790

接口：
    GET  /                              前端报告页
    GET  /api/soul/health               健康检查
    GET  /api/soul/report?ordersn=&serverid=&refresh=   报告（缓存优先）
    GET  /api/soul/report?cbg_url=...                   同上（传链接）
    POST /api/soul/report/upload        multipart file=yyx.json（上传报告）
    GET  /api/soul/precise?ordersn=     F3 精确头/尾/17速（CBG equip_desc）
    POST /api/soul/search               {ordersn|upload_key, hero, target, filters, settings}
    GET  /api/soul/job/{id}             查询异步搜索结果
    GET  /api/soul/demo                 用内置示例数据出报告（无需抓取）
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from service import Service, ServiceError  # noqa: E402

WEB_DIR = os.path.join(HERE, "web")
DATA_DIR = os.path.join(HERE, "data")
DEMO_YYX = os.path.join(DATA_DIR, "demo_yyx.json")

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


def parse_multipart(body: bytes, content_type: str) -> dict:
    """极简 multipart/form-data 解析（只取文件字段）。"""
    import re
    m = re.search(r"boundary=([^;]+)", content_type)
    if not m:
        raise ValueError("缺少 multipart boundary")
    boundary = ("--" + m.group(1).strip('"')).encode()
    parts = body.split(boundary)
    for part in parts:
        if b"\r\n\r\n" not in part:
            continue
        head, data = part.split(b"\r\n\r\n", 1)
        if b"\r\n--" in data:
            data = data.split(b"\r\n--", 1)[0]
        head_txt = head.decode("utf-8", "replace")
        if 'name="file"' in head_txt or 'name="raw_file"' in head_txt:
            import re as _re
            fn = _re.search(r'filename="([^"]*)"', head_txt)
            return {"filename": fn.group(1) if fn else "upload.json", "data": data}
    raise ValueError("表单中缺少 file 字段")


class Handler(BaseHTTPRequestHandler):
    service: Service = None        # type: ignore
    allow_origin = "*"

    # ------------------------------------------------------------ 响应
    def _json(self, code: int, obj: Any):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", self.allow_origin)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path: str):
        if not os.path.isfile(path):
            return self._json(404, {"ok": False, "msg": "Not Found"})
        ext = os.path.splitext(path)[1].lower()
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def _body(self) -> bytes:
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def do_OPTIONS(self):                       # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.allow_origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    # ------------------------------------------------------------ 路由
    def do_GET(self):                           # noqa: N802
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        path = u.path

        try:
            if path in ("/", "/index.html"):
                return self._file(os.path.join(WEB_DIR, "index.html"))
            if path.startswith("/web/"):
                rel = path[len("/web/"):]
                if ".." in rel:
                    return self._json(400, {"ok": False, "msg": "bad path"})
                return self._file(os.path.join(WEB_DIR, rel))

            if path == "/api/soul/health":
                return self._json(200, {"ok": True, "stats": self.service.stats})
            if path == "/api/soul/report":
                ordersn = (q.get("ordersn") or [""])[0].strip()
                serverid = (q.get("serverid") or [""])[0].strip()
                cbg_url = (q.get("cbg_url") or [""])[0].strip()
                refresh = (q.get("refresh") or ["0"])[0] in ("1", "true")
                return self._json(200, self.service.report(ordersn, serverid, cbg_url, refresh))
            if path == "/api/soul/precise":
                ordersn = (q.get("ordersn") or [""])[0].strip()
                refresh = (q.get("refresh") or ["0"])[0] in ("1", "true")
                return self._json(200, self.service.precise(ordersn, refresh))
            if path == "/api/soul/job":
                job_id = (q.get("id") or [""])[0].strip()
                return self._json(200, self.service.job(job_id))
            if path == "/api/soul/meta":
                return self._json(200, self.service.meta())
            if path == "/api/soul/demo":
                if not os.path.exists(DEMO_YYX):
                    return self._json(404, {"ok": False, "msg": "缺少 data/demo_yyx.json"})
                with open(DEMO_YYX, encoding="utf-8") as f:
                    yyx = json.load(f)
                return self._json(200, self.service.load_local(yyx))
            return self._json(404, {"ok": False, "msg": "Not Found"})
        except ServiceError as e:
            return self._json(e.status, {"ok": False, "code": e.code, "msg": e.msg})
        except Exception as e:                   # noqa: BLE001
            traceback.print_exc()
            return self._json(500, {"ok": False, "code": "INTERNAL", "msg": str(e)})

    def do_POST(self):                          # noqa: N802
        u = urllib.parse.urlparse(self.path)
        path = u.path
        try:
            if path == "/api/soul/report/upload":
                ct = self.headers.get("Content-Type") or ""
                if "multipart/form-data" not in ct:
                    return self._json(400, {"ok": False, "msg": "需要 multipart/form-data"})
                body = self._body()
                form = parse_multipart(body, ct)
                return self._json(200, self.service.report_from_upload(form["data"], form["filename"]))

            if path == "/api/soul/search":
                body = self._body()
                try:
                    payload = json.loads(body or b"{}")
                except ValueError:
                    return self._json(400, {"ok": False, "msg": "请求体不是合法 JSON"})
                job_id = self.service.submit_search(
                    ordersn=str(payload.get("ordersn") or ""),
                    upload_key=str(payload.get("upload_key") or ""),
                    hero=str(payload.get("hero") or "天照"),
                    target=str(payload.get("target") or "Damage"),
                    filters=payload.get("filters") or None,
                    settings=payload.get("settings") or None,
                    top=int(payload.get("top") or 5),
                    search_payload=payload,
                )
                return self._json(202, {"ok": True, "job_id": job_id})

            return self._json(404, {"ok": False, "msg": "Not Found"})
        except ServiceError as e:
            return self._json(e.status, {"ok": False, "code": e.code, "msg": e.msg})
        except Exception as e:                   # noqa: BLE001
            traceback.print_exc()
            return self._json(500, {"ok": False, "code": "INTERNAL", "msg": str(e)})

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (__import__("time").strftime("%H:%M:%S"), fmt % args))


def main():
    ap = argparse.ArgumentParser(description="Soul Report Service")
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--data-dir", default=DATA_DIR)
    ap.add_argument("--allow-origin", default="*", help="生产建议改成你的域名")
    ap.add_argument("--min-gap", type=float, default=6.0, help="两次抓取最小间隔（秒）")
    ap.add_argument("--ttl", type=int, default=24 * 3600)
    args = ap.parse_args()

    Handler.service = Service(args.data_dir, ttl=args.ttl, min_gap=args.min_gap)
    Handler.allow_origin = args.allow_origin
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Soul Report Service: http://{args.host}:{args.port}/")
    print(f"API:  /api/soul/report?ordersn=...  |  /api/soul/demo  |  /api/soul/precise?ordersn=...")
    print(f"缓存目录: {args.data_dir}  TTL={args.ttl}s  抓取最小间隔={args.min_gap}s")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
