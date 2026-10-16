#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
seed_web_data.py — 把爬虫原始 JSON 规范化为前端直接消费的数据集。

设计要点
--------
* 原始行是藏宝阁搜索接口的返回（48 个字段，含大量前端用不到的广告/协议字段）。
  本脚本只抽取前端需要的部分，并**把中文文本字段解析成可排序、可聚合的数值字段**：
  - `desc_sumup_short`  "SSR 145   六星式神 176   签到2920天"  -> ssr / six_star / sign_days
  - `highlights`        ["散件一速159.02", "4头1尾", "头速度16.93", "斗技2400", ...]
                        -> sanjian_speed / zhaocai_speed / tou_num / wei_num / tou_speed / pvp
* 输出：cbg-web/public/data/listings.json（静态站直接 fetch，零后端）。

用法
----
  python seed_web_data.py                       # 使用默认的几个原始文件
  python seed_web_data.py --extra out/new.json  # 追加新的爬取结果
  python seed_web_data.py --out ../other.json   # 自定义输出路径
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

CST = timezone(timedelta(hours=8))

# 工作区里已存在的原始爬取结果（兼容「数据不在本脚本旁边」的情况）
DEFAULT_SOURCES = [
    ("baseline", "baseline_rows.json"),
    ("planA", "planA_rows.json"),
]
DEFAULT_OUT = "cbg-web/public/data/listings.json"

RE_SSR = re.compile(r"SSR\s*(\d+)")
RE_SIX = re.compile(r"六星式神\s*(\d+)")
RE_SIGN_DAY = re.compile(r"签到\s*(\d+)\s*天")
RE_SIGN_YEAR = re.compile(r"签到\s*(\d+)\s*年")
RE_SANJIAN = re.compile(r"散件一速\s*([\d.]+)")
RE_ZHAOCAI = re.compile(r"招财一速\s*([\d.]+)")
RE_TOUWEI = re.compile(r"(\d+)\s*头\s*(\d+)\s*尾")
RE_TOUSPEED = re.compile(r"头速度\s*([\d.]+)")
RE_PVP = re.compile(r"斗技\s*(\d+)")

# highlights 里除数值外的称号类标签，原样保留给前端做标签过滤
TITLE_KEYS = ("地域·", "终极之巅", "征服世界", "日月同辉", "平安奇谭", "典藏", "头像框")


def to_int(value) -> int | None:
    """藏宝阁的数值字段有时是字符串，统一成 int。"""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    m = re.search(r"-?\d+", str(value).replace(",", ""))
    return int(m.group()) if m else None


def to_float(value) -> float | None:
    if value is None or value == "":
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", str(value))
    return float(m.group()) if m else None


def parse_highlights(highlights: list[str]) -> dict:
    """把 highlights 文本数组解析成结构化字段。"""
    out: dict = {
        "sanjian_speed": None,
        "zhaocai_speed": None,
        "tou_num": None,
        "wei_num": None,
        "tou_speed": None,
        "pvp": None,
        "titles": [],
        "raw": [],
    }
    for h in highlights or []:
        if not isinstance(h, str):
            continue
        h = h.strip()
        if not h:
            continue
        out["raw"].append(h)

        if (m := RE_SANJIAN.search(h)) and out["sanjian_speed"] is None:
            out["sanjian_speed"] = float(m.group(1))
        elif (m := RE_ZHAOCAI.search(h)) and out["zhaocai_speed"] is None:
            out["zhaocai_speed"] = float(m.group(1))
        elif (m := RE_TOUWEI.search(h)) and out["tou_num"] is None:
            out["tou_num"] = int(m.group(1))
            out["wei_num"] = int(m.group(2))
        elif (m := RE_TOUSPEED.search(h)) and out["tou_speed"] is None:
            out["tou_speed"] = float(m.group(1))
        elif (m := RE_PVP.search(h)) and out["pvp"] is None:
            out["pvp"] = int(m.group(1))
        elif any(h.startswith(k) for k in TITLE_KEYS):
            out["titles"].append(h)
    return out


def parse_desc_summary(desc: str) -> tuple[int | None, int | None, int | None]:
    """'SSR 145   六星式神 176   签到2920天' -> (145, 176, 2920)"""
    if not desc:
        return None, None, None
    ssr = int(m.group(1)) if (m := RE_SSR.search(desc)) else None
    six = int(m.group(1)) if (m := RE_SIX.search(desc)) else None
    sign = None
    if m := RE_SIGN_DAY.search(desc):
        sign = int(m.group(1))
    elif m := RE_SIGN_YEAR.search(desc):
        sign = int(m.group(1)) * 365
    return ssr, six, sign


def normalize_run(rows: list[dict], tag: str, captured_at: str) -> list[dict]:
    """把一轮接口返回的 rows 规范化为前端 Listing 数组。"""
    out: list[dict] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        # id 用订单号 game_ordersn：它同时是详情页 URL 的末段。
        # eid 形状与它几乎一样（都是「时间戳-区服-随机串」），极易拿错，
        # 拿错会跳到不存在的商品页，所以这里显式优先取 game_ordersn。
        eid = r.get("game_ordersn") or r.get("eid")
        if not eid:
            continue

        ssr, six_star, sign_days = parse_desc_summary(r.get("desc_sumup_short") or "")
        hl = parse_highlights(r.get("highlights") or [])

        # 剩余有效时间：接口给的是秒数，换算成小时便于前端展示
        remain = to_int(r.get("expire_remain_seconds"))
        status = to_int(r.get("status"))
        # 藏宝阁状态码：2=在售，3=公示期（以实际接口语义为准，前端仅做展示与筛选）
        status_label = {1: "已下架", 2: "在售", 3: "公示期", 4: "已售出"}.get(status, "未知")

        price = to_int(r.get("price"))
        bare_price = to_int(
            ((r.get("price_explanation") or {}).get("choice_list") or [{}])[0].get("price")
        )

        # 勾玉等资产类字段藏在 other_info 里；列表接口通常不返回，能拿到就带上
        other = r.get("other_info") or {}
        goyu = to_int(other.get("goyu") if isinstance(other, dict) else None)
        if goyu is None:
            # 有些返回会把资产平铺在顶层
            goyu = to_int(r.get("goyu"))

        out.append(
            {
                "id": str(eid),
                "order_sn": r.get("game_ordersn") or "",
                "title": (r.get("format_equip_name") or "").strip() or "未命名账号",
                "price": price,
                "bare_price": bare_price,
                "collect_num": to_int(r.get("collect_num")) or 0,
                # 服务器 / 大区
                "server_id": to_int(r.get("serverid")),
                "server_name": (r.get("server_name") or "").strip(),
                "area_name": (r.get("area_name") or "").strip(),
                "platform_type": to_int(r.get("platform_type")),
                "game_channel": r.get("game_channel") or "",
                # 等级
                "equip_level": to_int(r.get("equip_level")),
                "level_desc": r.get("level_desc") or "",
                # 解析出来的数值维度（前端排序/图表主力字段）
                "ssr": ssr,
                "six_star": six_star,
                "sign_days": sign_days,
                "sanjian_speed": hl["sanjian_speed"],
                "zhaocai_speed": hl["zhaocai_speed"],
                "tou_num": hl["tou_num"],
                "wei_num": hl["wei_num"],
                "tou_speed": hl["tou_speed"],
                "pvp": hl["pvp"],
                "goyu": goyu,
                # 原始标签
                "titles": hl["titles"],
                "highlights": hl["raw"],
                "icon": r.get("icon") or "",
                # 时间与状态
                "selling_time": r.get("selling_time") or "",
                "fair_show_end_time": r.get("fair_show_end_time") or "",
                "expire_remain_seconds": remain,
                "expire_remain_hours": round(remain / 3600, 1) if remain is not None else None,
                "status": status,
                "status_label": status_label,
                "allow_bargain": bool(r.get("allow_bargain")),
                "is_ad": bool(r.get("is_ad")),
                # 溯源
                "source_tag": tag,
                "captured_at": captured_at,
            }
        )
    return out


def load_source(path: Path) -> tuple[list[dict], dict]:
    """读取一个原始文件，返回 (rows, meta)。"""
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        return data.get("rows") or [], data.get("meta") or {}
    if isinstance(data, list):
        return data, {}
    return [], {}


def main() -> int:
    ap = argparse.ArgumentParser(description="规范化藏宝阁爬取数据为前端数据集")
    ap.add_argument("--root", default=".", help="原始数据所在目录（默认当前目录）")
    ap.add_argument("--out", default=DEFAULT_OUT, help="输出 JSON 路径")
    ap.add_argument("--extra", nargs="*", default=[], help="追加的原始 JSON 文件")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    captured_at = datetime.now(CST).isoformat(timespec="seconds")

    sources = list(DEFAULT_SOURCES) + [(Path(f).stem, f) for f in args.extra]
    merged: dict[str, dict] = {}
    used: list[dict] = []

    for tag, rel in sources:
        p = (root / rel)
        if not p.exists():
            p = (Path(__file__).resolve().parent / rel)
        if not p.exists():
            print(f"[跳过] 找不到 {rel}", file=sys.stderr)
            continue
        rows, meta = load_source(p)
        normalized = normalize_run(rows, tag, captured_at)
        used.append({"tag": tag, "file": p.name, "rows": len(rows), "total_num": meta.get("total_num")})
        print(f"[读取] {p.name}: {len(rows)} 行 -> 规范化 {len(normalized)} 条")
        for item in normalized:
            # 同一 eid 可能在多轮筛选里重复出现，保留最新捕获的那份
            merged[item["id"]] = item

    listings = sorted(
        merged.values(),
        key=lambda x: (x.get("selling_time") or ""),
        reverse=True,
    )

    payload = {
        "meta": {
            "generated_at": captured_at,
            "count": len(listings),
            "sources": used,
            "note": "由 tools/cbg/seed_web_data.py 从爬虫原始数据生成，仅供公开聚合信息展示",
        },
        "listings": listings,
    }

    out_path = Path(args.out)
    if not out_path.is_absolute():
        out_path = Path(__file__).resolve().parents[2] / out_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    size_kb = out_path.stat().st_size / 1024
    print(f"[输出] {out_path}  ({len(listings)} 条, {size_kb:.1f} KB)")

    # 打印字段完整度，便于判断哪些维度可以上图表
    if listings:
        fields = [
            "price", "collect_num", "ssr", "six_star", "sign_days",
            "sanjian_speed", "zhaocai_speed", "tou_num", "tou_speed", "pvp",
        ]
        print("[字段完整度]")
        for f in fields:
            ok = sum(1 for x in listings if x.get(f) is not None)
            print(f"  {f:<16} {ok}/{len(listings)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
