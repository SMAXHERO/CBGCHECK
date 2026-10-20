#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
equip_desc 离线解析器（纯本地，不需要登录）
=========================================

复刻站点前端 `up()` / `Kn()` / `WC()` 等函数的算法，从 CBG 原始档案
(equip_desc) 直接算出「散件一速/招财一速/头/尾/17速」等指标，
用于在没有账号 token 的情况下自行评估账号。

已用服务端 /api/warehouse/account/{ordersn} 的实测值校验（见 validate.py）。

数据来源（均公开）:
  - GET https://www.xn--w0tzf028e.com/api/cdn-desc?ordersn={ordersn}
  - https://cbg-other-desc.res.netease.com/yys/static/equipdesc/{ordersn}.json

关键结论（来自 bundle @361236 起）:
  - 御魂速度 = (2 号位主属性速度 ? Rr(主属性) : 0) + round(sum(speedAdditionVal)*3*1000)
    其中 rattr 里 speedAdditionVal 是归一化 0~1 的随机属性，×3 即实际速度值
  - Rr("57") = 57000 → 以 1/1000 为单位，最终 /1000 得数值
  - 散件 N 速 = 每个位置取第 N 好的御魂速度求和
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from typing import Any, Dict, List, Optional

SPEED_ATTR = "速度"
SPEED_RATTR = "speedAdditionVal"


# ------------------------------------------------------------------ 基础工具
def Rr(value: Any) -> int:
    """前端 Rr(): 字符串数值 -> 千分之一整数，'17.155' -> 17155。"""
    t = str(value).strip()
    if "." not in t:
        try:
            return int(t) * 1000
        except ValueError:
            return 0
    whole, frac = t.split(".", 1)
    frac = (frac + "000")[:3]
    try:
        return int(whole) * 1000 + int(frac)
    except ValueError:
        return 0


def _num(v, default=0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def load_desc(path_or_obj) -> dict:
    """接受 equip_desc.json 路径 / 已解析 dict / 含 equip_desc 字符串的响应。"""
    if isinstance(path_or_obj, dict):
        if "equip_desc" in path_or_obj:
            inner = path_or_obj["equip_desc"]
            return json.loads(inner) if isinstance(inner, str) else inner
        return path_or_obj
    with open(path_or_obj, encoding="utf-8") as f:
        return load_desc(json.load(f))


# ------------------------------------------------------------------ 御魂
def iter_souls(desc: dict):
    """遍历账号内全部御魂，产出归一化结构。"""
    inv = desc.get("inventory") or {}
    if not isinstance(inv, dict):
        return
    for uid, raw in inv.items():
        if not isinstance(raw, dict):
            continue
        pos = int(_num(raw.get("pos")))
        if pos < 1 or pos > 6:
            continue
        attrs = raw.get("attrs") or []
        if not isinstance(attrs, list):
            attrs = []
        main = attrs[0] if attrs and isinstance(attrs[0], list) else []
        main_name = str(main[0]) if main else ""
        main_val = str(main[1]) if len(main) > 1 else "0"

        # 2 号位速度主属性
        base_milli = Rr(main_val) if (pos == 2 and main_name == SPEED_ATTR) else 0

        # 副属性速度: rattr 中 speedAdditionVal 求和 ×3  → 千分之一
        rattr = raw.get("rattr") or []
        sub_sum = 0.0
        for r in rattr:
            if isinstance(r, list) and r and r[0] == SPEED_RATTR:
                sub_sum += _num(r[1])
        sub_milli = int(round(sub_sum * 3 * 1000))
        speed_milli = base_milli + sub_milli

        # 副属性里的速度字符串（用于展示）
        speed_str = "0"
        for a in attrs[1:]:
            if isinstance(a, list) and a and a[0] == SPEED_ATTR:
                speed_str = str(a[1])
                break

        yield {
            "uid": uid,
            "pos": pos,
            "name": str(raw.get("name") or "未知"),
            "suitid": int(_num(raw.get("suitid"))),
            "qua": int(_num(raw.get("qua"))),
            "level": int(_num(raw.get("level"))),
            "speed_milli": speed_milli,
            "speed": round(speed_milli / 1000, 3),
            "speed_str": speed_str,
            "main_name": main_name,
            "main_val": main_val,
            "attrs": attrs,
            "rattr": rattr,
        }


def scatter_speeds(desc: dict) -> Dict[str, Any]:
    """前端 up(): 散件一速~五速 + 分位明细。

    返回 {scatterSpeed1..5, tierData:[{tier,total,positions:[...]}]}
    """
    by_pos: Dict[int, List[dict]] = defaultdict(list)
    for soul in iter_souls(desc):
        by_pos[soul["pos"]].append(soul)
    for pos in by_pos:
        by_pos[pos].sort(key=lambda s: s["speed_milli"], reverse=True)

    out: Dict[str, Any] = {f"scatterSpeed{i}": None for i in range(1, 6)}
    tiers = []
    for tier in range(1, 6):                      # 第 tier 好的一套
        total = 0
        ok = True
        positions = []
        for pos in range(1, 7):
            lst = by_pos.get(pos, [])
            if len(lst) >= tier:
                s = lst[tier - 1]
                total += s["speed_milli"]
                positions.append(
                    {"pos": pos, "set": s["name"], "speed": s["speed"], "main": s["main_name"]}
                )
            else:
                ok = False
                positions.append({"pos": pos, "set": "—", "speed": None})
        out[f"scatterSpeed{tier}"] = round(total / 1000, 3) if ok else None
        tiers.append({"tier": tier, "total": round(total / 1000, 3) if ok else None,
                      "positions": positions})
    out["tierData"] = tiers
    return out


def head_stats(desc: dict) -> Dict[str, Any]:
    """头/尾统计 —— 复刻前端 QC()（@363xxx 附近）。

    规则（关键，和直觉不同）:
        - 只统计「6 条速度副属性」的满速御魂（rattr 中 speedAdditionVal == 6 条）
        - 头 = 2 号位、主属性 速度
        - 尾(命中) = 4 号位、主属性 效果命中
        - 尾(抵抗) = 4 号位、主属性 效果抵抗
        - 头速度/尾速度 = 副属性速度字符串（不含 2 号位主属性的 57）
    对应站点字段: headCount / headTopSpeed / hitTailCount / hitTailTopSpeed /
                  resistTailCount / resistTailTopSpeed
    """
    heads, hit_tails, resist_tails = [], [], []
    for s in iter_souls(desc):
        n_speed = sum(1 for r in s["rattr"] if isinstance(r, list) and r and r[0] == SPEED_RATTR)
        if n_speed < 6:                       # 必须满速副属性
            continue
        sub = _num(s["speed_str"])
        rec = {"name": s["name"], "speed": round(sub, 3), "pos": s["pos"]}
        if s["pos"] == 2 and s["main_name"] == SPEED_ATTR:
            heads.append(rec)
        elif s["pos"] == 4 and s["main_name"] == "效果命中":
            hit_tails.append(rec)
        elif s["pos"] == 4 and s["main_name"] == "效果抵抗":
            resist_tails.append(rec)

    def top(lst):
        return round(max((x["speed"] for x in lst), default=0), 3) or None

    for lst in (heads, hit_tails, resist_tails):
        lst.sort(key=lambda x: x["speed"], reverse=True)
    return {
        "headCount": len(heads),
        "headTopSpeed": top(heads),
        "hitTailCount": len(hit_tails),
        "hitTailTopSpeed": top(hit_tails),
        "resistTailCount": len(resist_tails),
        "resistTailTopSpeed": top(resist_tails),
        "headDetails": heads,
        "hitTailDetails": hit_tails,
        "resistTailDetails": resist_tails,
    }


def speed17(desc: dict) -> Dict[str, Any]:
    """前端 WC(): 满速(6 条速度副属性) 与 17 速统计。"""
    max_speed = 0
    seventeen = 0
    details = []
    for s in iter_souls(desc):
        n_speed_subs = sum(
            1 for r in s["rattr"] if isinstance(r, list) and r and r[0] == SPEED_RATTR
        )
        if n_speed_subs >= 6:
            max_speed += 1
            if _num(s["speed_str"]) >= 17:
                seventeen += 1
                details.append({"set": s["name"], "pos": s["pos"], "speed": s["speed_str"]})
    details.sort(key=lambda d: _num(d["speed"]), reverse=True)
    return {"maxSpeedCount": max_speed, "zhen17Count": seventeen, "details": details}


def resource_summary(desc: dict) -> Dict[str, Any]:
    """资源/图鉴/皮肤计数（对应站点同名 167 字段中的一部分）。"""
    hh = desc.get("hero_history") or {}
    got = {}
    for tier, label in (("ur", "UR"), ("sp", "SP"), ("ssr", "SSR"), ("x", "联动"),
                        ("sr", "SR"), ("r", "R"), ("gua", "呱")):
        d = hh.get(tier) or {}
        g = d.get("got")
        a = d.get("all")
        got[label] = {"got": g if g is not None else 0, "all": a if a is not None else 0}
    skin = desc.get("skin") or {}
    def n(key):
        v = skin.get(key)
        return len(v) if isinstance(v, list) else 0
    return {
        "name": desc.get("name"),
        "lv": desc.get("lv"),
        "sign_days": desc.get("sign_days"),
        "server": desc.get("origin_server_name"),
        "goyu": desc.get("goyu"),
        "hunyu": desc.get("hunyu"),
        "strength": desc.get("strength"),
        "money": desc.get("money"),
        "soul_jade": desc.get("soul_jade"),
        "redheart": desc.get("redheart"),
        "fengzidu": desc.get("fengzidu"),
        "hero_history": got,
        "heroes_total": len(desc.get("heroes") or {}),
        "souls_total": len(desc.get("inventory") or {}),
        "level_15": desc.get("level_15"),
        "skins": {
            "collection(典藏?)": n("ss"),
            "yard": n("yard"),
            "head": n("head"),
            "secret": n("secret"),
        },
        "gameble_card": desc.get("gameble_card"),
        "honor_score": desc.get("honor_score"),
    }


def summarize(desc: dict) -> Dict[str, Any]:
    out = {"resource": resource_summary(desc)}
    out.update(scatter_speeds(desc))
    out.update(head_stats(desc))
    out.update(speed17(desc))
    return out


if __name__ == "__main__":
    import sys
    p = sys.argv[1] if len(sys.argv) > 1 else "equip_desc.json"
    print(json.dumps(summarize(load_desc(p)), ensure_ascii=False, indent=2))
