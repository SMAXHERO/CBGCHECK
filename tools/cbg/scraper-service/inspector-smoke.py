#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
模块四（看号分析）联调冒烟测试 —— 针对伴随服务（Node 代理）的 /api/inspector/*。

用法：
    # 先启动伴随服务（不需要浏览器）
    node tools/cbg/scraper-service/server.mjs --port 8791 --no-browser
    # 再跑本脚本（加 --skip-live 跳过联网抓取）
    python tools/cbg/scraper-service/inspector-smoke.py

说明：
- 大部分用例走演示数据（ordersn=demo），不联网；
- 实时抓取用例使用一个真实藏宝阁商品链接，命盘见 ``--url``（默认基准账号）。
"""
from __future__ import annotations

import argparse
import sys
import time

import requests

DEFAULT_URL = "https://yys.cbg.163.com/cgi/mweb/equip/17/202610201501616-17-4G0RE3QTEDLIQ"

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


def wait_job(base, job_id, timeout=240):
    state = {}
    deadline = time.time() + timeout
    while time.time() < deadline:
        state = requests.get(f"{base}/api/inspector/job", params={"id": job_id}, timeout=15).json().get("job", {})
        if state.get("status") in ("done", "error"):
            return state
        time.sleep(1.0)
    return state


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8791")
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--skip-live", action="store_true", help="跳过需要联网抓取的 report 测试")
    ap.add_argument("--skip-pve", action="store_true", help="跳过 21 组 PVE 任务（约 30 秒）")
    args = ap.parse_args()
    B = args.base.rstrip("/")

    print("== 0. 伴随服务健康 ==")
    h = requests.get(B + "/api/health", timeout=10).json()
    check("service health", h.get("ok") is True, f"inspectorReady={h.get('inspectorReady')}")
    check("inspector 内核就绪", h.get("inspectorReady") is True, str(h.get("inspectorMessage") or ""))

    print("== 1. meta ==")
    m = requests.get(B + "/api/inspector/meta", timeout=20).json()
    check("heroes/suits", len(m.get("heroes", [])) >= 200 and len(m.get("suits", [])) >= 60,
          f"heroes={len(m.get('heroes', []))} suits={len(m.get('suits', []))}")
    check("面板预设", set((m.get("presets") or {}).keys()) == {"attack", "health", "speed"}, m.get("presets"))

    print("== 2. 演示数据完整报告 ==")
    t = time.time()
    demo = requests.get(B + "/api/inspector/demo", timeout=180).json()
    account = demo.get("account") or {}
    speed = demo.get("speed") or {}
    check("概览", account.get("name") == "XX菜" and speed.get("highlights", {}).get("scatteredFirstSpeed") == 158.76,
          f"name={account.get('name')} 散件一速={speed.get('highlights', {}).get('scatteredFirstSpeed')}")
    check("满速御魂", speed.get("fullSpeedCount") == 124,
          f"124? {speed.get('fullSpeedCount')} 各号位={speed.get('fullSpeedByPosition')}")
    check("PVE 评分", (demo.get("pveScores") or {}).get("normalSuits", [{}])[0].get("totalScore") == 422,
          f"狂骨={(demo.get('pveScores') or {}).get('normalSuits', [{}])[0].get('totalScore')}")
    hero_skills = demo.get("heroSkills") or {}
    deficient = hero_skills.get("deficient") or []
    collaboration = hero_skills.get("collaboration") or []
    duplicates = hero_skills.get("duplicates") or []
    check("式神技能", len(deficient) == 19 and len(collaboration) == 24 and len(duplicates) == 2,
          f"未达标={len(deficient)} 联动={len(collaboration)} 多号机={len(duplicates)}")
    print(f"  demo report {round((time.time() - t) * 1000)}ms")

    print("== 3. 速度盘点 / 御魂库存 ==")
    sp = requests.get(B + "/api/inspector/speed", params={"ordersn": "demo"}, timeout=120).json()
    check("散件 TOP5", [round(x["value"], 2) for x in (sp.get("scatterTop") or [])[:3]] == [158.76, 157.64, 156.53],
          str([x["value"] for x in (sp.get("scatterTop") or [])[:3]]))
    check("套装表 11 行", len(sp.get("suitTable") or []) == 11, f"rows={len(sp.get('suitTable') or [])}")
    rl = requests.get(B + "/api/inspector/relics", params={"ordersn": "demo", "position": 1, "limit": 5}, timeout=120).json()
    check("库存 1 号位", rl.get("matched") == 629 and len(rl.get("items") or []) == 5,
          f"matched={rl.get('matched')} total={rl.get('total')} items={len(rl.get('items') or [])}")

    print("== 4. 计算器（极速模式） ==")
    t = time.time()
    cj = requests.post(B + "/api/inspector/calc",
                       json={"ordersn": "demo", "hero": "须佐之男", "preset": "attack",
                             "fullCrit": True, "limit": 1, "fastMode": True}, timeout=60).json()
    cstate = wait_job(B, cj.get("jobId"))
    rows = (cstate.get("result") or {}).get("rows") or []
    check("calc job", cstate.get("status") == "done" and bool(rows),
          f"score={rows[0].get('score') if rows else None} {round((time.time() - t) * 1000)}ms")
    if rows:
        check("calc 面板", abs(rows[0]["score"] - 29022.48) < 500, f"score={rows[0]['score']}")

    print("== 5. PVE 21 组（异步任务，有缓存则秒回） ==")
    if args.skip_pve:
        print("  [SKIP] --skip-pve")
    else:
        t = time.time()
        pj = requests.post(B + "/api/inspector/pve", json={"ordersn": "demo"}, timeout=60).json()
        pstate = wait_job(B, pj.get("jobId"), timeout=420)
        result = pstate.get("result") or {}
        check("pve job", pstate.get("status") == "done" and len(result.get("rows") or []) == 21,
              f"rows={len(result.get('rows') or [])} cached={result.get('cached')} "
              f"{round((time.time() - t), 1)}s")
        check("pve 总平均", abs((result.get("average") or 0) - 26376.35) < 1, f"avg={result.get('average')}")

    print("== 6. 实时抓取（真实链接） ==")
    if args.skip_live:
        print("  [SKIP] --skip-live")
    else:
        t = time.time()
        live = requests.get(B + "/api/inspector/report", params={"url": args.url}, timeout=300).json()
        check("live report", (live.get("account") or {}).get("name") == "XX菜",
              f"source={live.get('source')} cached={live.get('cached')} {round((time.time() - t) * 1000)}ms")
        bad = requests.get(B + "/api/inspector/report", params={"url": "https://example.com/nope"}, timeout=30)
        check("坏链接 400", bad.status_code == 400, f"status={bad.status_code}")

    print(f"\n结果: PASS={PASS} FAIL={FAIL}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
