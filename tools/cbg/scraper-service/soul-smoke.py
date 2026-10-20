#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
模块三（御魂报告）联调冒烟测试 —— 针对伴随服务（Node 代理）的 /api/soul/*。

用法：
    # 先启动伴随服务（不需要浏览器）
    node tools/cbg/scraper-service/server.mjs --port 8791 --no-browser
    # 再跑本脚本
    python tools/cbg/scraper-service/soul-smoke.py
"""
from __future__ import annotations

import argparse
import os
import sys
import time

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
_CANDIDATES = [
    os.path.join(REPO, "..", "..", "zyj", "yyx_simpl.json"),
    os.path.join(REPO, "..", "zyj", "yyx_simpl.json"),
    os.path.join(REPO, "tools", "cbg", "soul-service", "data", "demo_yyx.json"),
]
DEFAULT_YYX = next((p for p in _CANDIDATES if os.path.exists(p)), _CANDIDATES[0])
ORDERSN = "202606282101616-16-MIG62AAVVL10A"

PASS = FAIL = 0


def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name} {extra}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {extra}")
    return cond


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8791")
    ap.add_argument("--yyx", default=DEFAULT_YYX)
    ap.add_argument("--skip-live", action="store_true", help="跳过需要联网抓取的 report 测试")
    args = ap.parse_args()
    B = args.base.rstrip("/")

    print("== 0. 伴随服务健康 ==")
    h = requests.get(B + "/api/health", timeout=10).json()
    check("service health", h.get("ok") is True, f"soulReady={h.get('soulReady')}")
    check("soul 内核就绪", h.get("soulReady") is True, h.get("soulMessage", ""))

    print("== 1. meta ==")
    m = requests.get(B + "/api/soul/meta", timeout=15).json()
    check("heroes/suits", len(m.get("heroes", [])) > 40 and len(m.get("suits", [])) > 50,
          f"heroes={len(m.get('heroes', []))} suits={len(m.get('suits', []))}")

    print("== 2. demo 报告 ==")
    t = time.time()
    d = requests.get(B + "/api/soul/demo", timeout=180).json()
    check("demo", d.get("overview", {}).get("souls_total", 0) > 4000,
          f"souls={d.get('overview', {}).get('souls_total')} {round((time.time()-t)*1000)}ms")

    print("== 3. 上传 yyx ==")
    up_key = None
    if os.path.exists(args.yyx):
        with open(args.yyx, "rb") as f:
            up = requests.post(B + "/api/soul/report/upload",
                               files={"file": ("yyx_simpl.json", f, "application/json")}, timeout=180).json()
        up_key = up.get("upload_key")
        check("upload", up.get("overview", {}).get("souls_total", 0) > 4000, f"key={up_key}")
    else:
        print(f"  [SKIP] 找不到 {args.yyx}")

    print("== 4. 组合搜索（异步任务） ==")
    if up_key:
        j = requests.post(B + "/api/soul/search",
                          json={"upload_key": up_key, "hero": "天照", "target": "Speed", "top": 3},
                          timeout=30).json()
        job_id = j.get("job_id")
        check("submit", bool(job_id), j)
        st = {}
        for _ in range(80):
            time.sleep(0.4)
            st = requests.get(B + f"/api/soul/job?id={job_id}", timeout=10).json()
            if st.get("status") in ("done", "error"):
                break
        check("job done", st.get("status") == "done",
              f"top1={(st.get('result') or [{}])[0].get('value')}")

    print("== 5. 精确指标（CBG equip_desc） ==")
    p = requests.get(B + "/api/soul/precise", params={"ordersn": ORDERSN}, timeout=180).json()
    check("precise", p.get("ok") is True,
          f"head={p.get('head', {}).get('count')} 17速={p.get('zhen17Count')}")

    print("== 6. 报告（实时抓取 / 缓存） ==")
    if args.skip_live:
        print("  [SKIP] --skip-live")
    else:
        t = time.time()
        r = requests.get(B + "/api/soul/report", params={"ordersn": ORDERSN, "serverid": "16"}, timeout=300).json()
        check("report", r.get("overview", {}).get("souls_total", 0) > 1000,
              f"souls={r.get('overview', {}).get('souls_total')} cached={r.get('cached')} "
              f"speed1={r.get('speeds', {}).get('loose', [{}])[0].get('value')} {round((time.time()-t)*1000)}ms")

    print(f"\n结果: PASS={PASS} FAIL={FAIL}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
