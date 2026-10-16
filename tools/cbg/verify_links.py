#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_links.py — 核对商品详情页链接拼得对不对。

背景：接口返回两个长得极像的 ID
    gamesn / game_ordersn : 202610160301613-12-SDI0LBZYNXWYY   <- 详情页 URL 用这个
    eid                   : 202610170301613-17-XXXXXXXXXXXX   <- 不是这个
两者都是「时间戳-区服-随机串」，拿错就会跳到不存在的商品页。

本脚本从 Site 列表页 HTML 里抽出真实链接，再和原始数据行对照，确认用的是哪个字段。
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "baseline_rows.json"
HTML_CANDIDATES = [
    ROOT / "list_page.html",
    ROOT / "home_dom.html",
    ROOT / "cbg_page.html",
    ROOT / "home.html",
]

LINK_RE = re.compile(r"/cgi/mweb/equip/(\d+)/([0-9A-Za-z\-]+)")

print("=== 1. 从抓下来的页面 HTML 里找真实商品链接 ===")
site_links: list[tuple[str, str]] = []
for f in HTML_CANDIDATES:
    if not f.exists():
        continue
    text = f.read_text(encoding="utf-8", errors="ignore")
    hits = LINK_RE.findall(text)
    if hits:
        print(f"  {f.name}: {len(hits)} 条")
        site_links.extend(hits)
if not site_links:
    print("  （工作区里的 HTML 没有内联链接，站点是 JS 渲染的）")
else:
    for sid, sn in site_links[:3]:
        print(f"    serverid={sid}  末段={sn}")

print()
print("=== 2. 原始数据行里两个 ID 的对照 ===")
data = json.loads(RAW.read_text(encoding="utf-8"))
rows = data["rows"]
for r in rows[:3]:
    print(f"  serverid      = {r.get('serverid')}")
    print(f"  game_ordersn  = {r.get('game_ordersn')}")
    print(f"  eid           = {r.get('eid')}")
    print(f"  -> 正确链接 = https://yys.cbg.163.com/cgi/mweb/equip/{r.get('serverid')}/{r.get('game_ordersn')}")
    print()

print("=== 3. 全量检查：game_ordersn 与 eid 是否总是不同 ===")
same = 0
for r in rows:
    if r.get("game_ordersn") == r.get("eid"):
        same += 1
print(f"  {len(rows)} 行中，两者相同的：{same} 行"
      f"{'（说明确实必须区分）' if same == 0 else ''}")

print()
print("=== 4. 当前快照里生成的链接（应全部落在 game_ordersn 上）===")
snap = ROOT / "cbg-web" / "public" / "data" / "listings.json"
if snap.exists():
    listings = json.loads(snap.read_text(encoding="utf-8"))["listings"]
    raw_by_order = {r.get("game_ordersn"): r for r in rows}
    ok, bad = 0, []
    for item in listings:
        raw = raw_by_order.get(item["id"])
        if raw:
            ok += 1
        else:
            bad.append(item["id"])
    print(f"  快照 {len(listings)} 条，其中 id 命中 game_ordersn 的：{ok} 条")
    if bad:
        print(f"  ✗ 对不上的：{len(bad)} 条，例如 {bad[:3]}")
    print(f"  示例链接：https://yys.cbg.163.com/cgi/mweb/equip/"
          f"{listings[0].get('server_id')}/{listings[0]['id']}")
