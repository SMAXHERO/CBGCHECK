#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_defaults.py — 核对默认条件：字段定位、倍率、最终接口参数。

一次性排查脚本，用来确认 src/config/defaults.ts 里的默认条件真的落到了
预期的字段上（而不是因为 schema 顺序变化套错了地方）。
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # tools/cbg/ 往上两层才是工作区根
SCHEMA = ROOT / "cbg-web" / "public" / "data" / "filters.json"

# 与 src/config/defaults.ts 保持一致
DEFAULTS = [
    ("价格(元)", "价格(元)", {"min": "500", "max": "1500"}),
    ("资产", "勾玉", "100000"),
    ("个人斗技", "散件一速", "158"),
]

s = json.loads(SCHEMA.read_text(encoding="utf-8"))
secs = s["sections"]

print(f"schema: {len(secs)} 组 / {sum(len(x['fields']) for x in secs)} 字段\n")

params = {"search_type": "role"}
for want_sec, want_label, value in DEFAULTS:
    si = next((i for i, x in enumerate(secs) if x["label"] == want_sec), -1)
    if si < 0:
        print(f"[缺失] 找不到分组「{want_sec}」")
        continue
    fi = next((i for i, f in enumerate(secs[si]["fields"]) if f.get("label") == want_label), -1)
    if fi < 0:
        print(f"[缺失] 分组「{want_sec}」里找不到条件「{want_label}」")
        continue
    f = secs[si]["fields"][fi]
    mult = f.get("valueMultiply") or 1
    print(f"默认条件「{want_sec} · {want_label}」")
    print(f"  定位      : 分组[{si}] 字段[{fi}]  id={si}_{fi}")
    print(f"  接口字段名: {f.get('key')}   类型={f.get('type')}   倍率={mult}")

    # 复现 buildParams 的换算
    if isinstance(value, dict):
        for k, v in (("min", value.get("min")), ("max", value.get("max"))):
            if v not in (None, ""):
                params[f"{f['key']}_{k}"] = str(int(float(v) * mult))
    else:
        params[f["key"]] = str(int(float(value) * mult))
    print()

print("最终提交给藏宝阁的接口参数：")
print(json.dumps(params, ensure_ascii=False, indent=2))

# 顺手统计快照里这三条能命中多少（快照不再是主数据源，仅作对照）
LISTINGS = ROOT / "cbg-web" / "public" / "data" / "listings.json"
if LISTINGS.exists():
    rows = json.loads(LISTINGS.read_text(encoding="utf-8"))["listings"]
    lo, hi = int(params.get("price_min", 0)) / 100, int(params.get("price_max", 10**9)) / 100
    speed = int(params.get("max_sanjian_speed", 0)) / 100
    hit_price = [r for r in rows if r.get("price") and lo <= r["price"] / 100 <= hi]
    hit_speed = [r for r in hit_price if (r.get("sanjian_speed") or 0) >= speed]
    print(f"\n快照对照（{len(rows)} 条，仅用于确认换算对不对）：")
    print(f"  价格 {lo:g}~{hi:g} 元        -> {len(hit_price)} 条")
    print(f"  再加 散件一速 >= {speed:g}   -> {len(hit_speed)} 条")
    print(f"  勾玉 >= 100000              -> "
          f"{len([r for r in rows if (r.get('goyu') or 0) >= 100000])} 条"
          f"（快照里 goyu 有值的：{len([r for r in rows if r.get('goyu') is not None])} 条）")
