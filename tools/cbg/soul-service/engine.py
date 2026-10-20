#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Soul Report Engine —— 照妖镜能力的自研复刻（供 Soul Report Service 调用）

能力：
  F1 御魂总览/评分分布        report()
  F2 一速（散件/命中/抵抗/套装） speeds()
  F3 头/尾/17速精确统计        precise_metrics()（走 CBG equip_desc）
  F4 组合搜索                 search()

依赖 vendor/ 下四个模块（均为本仓库逆向产物，已对拍验证）：
  calc_demo.py     组合搜索/面板/一速/跑分
  yyx_client.py    抓取（照妖镜链 A/B、CBG 直连）
  parse_equip.py   CBG equip_desc 精确指标
  yyx_parser.py    yyx 格式解析/校验（上传入口）
"""
from __future__ import annotations

import json
import os
import re
import time
from typing import Any, Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
try:                                    # 作为包引用
    from .vendor import calc_demo as C
    from .vendor import parse_equip as P
    from .vendor.yyx_client import YyshubClient
except ImportError:                      # 直接运行/扁平部署
    import sys
    sys.path.insert(0, os.path.join(HERE, "vendor"))
    import calc_demo as C                # type: ignore
    import parse_equip as P              # type: ignore
    from yyx_client import YyshubClient  # type: ignore

SPEED = "Speed"
CBG_CDN = "https://cbg-other-desc.res.netease.com/yys/static/equipdesc/{ordersn}.json"
CBG_LINK_RE = re.compile(r"/equip/(\d+)/([0-9][0-9A-Za-z]*-[0-9A-Za-z]+-[0-9A-Za-z]+)")


# ---------------------------------------------------------------- 基础工具
def parse_cbg_link(text: str) -> Optional[Dict[str, str]]:
    """从链接/裸订单号解析 (serverid, ordersn)。"""
    text = (text or "").strip()
    m = CBG_LINK_RE.search(text)
    if m:
        return {"serverid": m.group(1), "ordersn": m.group(2)}
    m = re.search(r"/equip/(\d+)/([A-Za-z0-9\-_]+)", text)
    if m:
        return {"serverid": m.group(1), "ordersn": m.group(2)}
    if re.match(r"^[0-9]{8,}-[0-9]+-[0-9A-Za-z]+$", text):
        return {"serverid": text.split("-")[1], "ordersn": text}
    return None


def pos1(e: dict) -> int:
    """yyx 的 pos 是 0 基，展示/统计用 1 基。"""
    return int(e.get("pos") or 0) + 1


def soul_speed(e: dict) -> float:
    v = sum(float(a.get("value") or 0) for a in (e.get("random_attrs") or [])
            if a.get("type") == SPEED)
    base = e.get("base_attr") or {}
    if int(e.get("pos") or 0) == 1 and base.get("type") == SPEED:
        v += float(base.get("value") or 0)
    return v


def extract_equips(yyx: dict) -> List[dict]:
    data = yyx.get("data") if isinstance(yyx.get("data"), dict) else yyx
    return (data or {}).get("hero_equips") or []


# ---------------------------------------------------------------- 报告
def build_report(yyx: dict, extra_meta: Optional[dict] = None) -> dict:
    equips = extract_equips(yyx)
    player = ((yyx.get("data") or {}).get("player") if isinstance(yyx.get("data"), dict) else {}) or {}
    t0 = time.time()

    six = [e for e in equips if int(e.get("quality") or 0) == 6]
    pos_cnt: Dict[int, int] = {}
    for e in equips:
        pos_cnt[pos1(e)] = pos_cnt.get(pos1(e), 0) + 1

    scores = [int(e["score"]) for e in six if e.get("score") is not None]
    zscores = [float(e["zscore"]) for e in six if e.get("zscore") is not None]
    hist: Dict[int, int] = {}
    for v in scores:
        hist[v] = hist.get(v, 0) + 1

    overview = {
        "player": player,
        "souls_total": len(equips),
        "souls_six_star": len(six),
        "position_counts": dict(sorted(pos_cnt.items())),
        "score": {
            "avg": round(sum(scores) / len(scores), 2) if scores else None,
            "max": max(scores) if scores else None,
            "ge6": sum(1 for v in scores if v >= 6),
            "hist": dict(sorted(hist.items())),
        },
        "zscore": {
            "avg": round(sum(zscores) / len(zscores), 2) if zscores else None,
            "max": round(max(zscores), 1) if zscores else None,
            "ge8": sum(1 for v in zscores if v >= 8),
        },
        "version": yyx.get("version"),
        "timestamp": yyx.get("timestamp"),
    }

    # F2 一速（全量 24 组搜索，实测 ~0.24s）
    sp = C.speed_preview(equips, quick=False)

    def slim(rows):
        out = []
        for r in rows:
            suits = sorted({C.suit_name(e["suit_id"]) for e in (r.get("suit") or [])})
            out.append({"kind": r["kind"], "value": round(r["value"], 3), "suits": suits})
        return out

    speeds = {
        "loose": slim(sp["loose"]),
        "hit": slim(sp["hit"]),
        "resist": slim(sp["resist"]),
        "suits": slim(sp["suits"]),
    }

    # F1 评分分布（ECharts 可直接消费）
    score_dist = C.score_distribution(equips)

    # TOP 御魂（按速度）
    rows = []
    for e in equips:
        base = e.get("base_attr") or {}
        rows.append({
            "kind": e.get("kind"),
            "pos": pos1(e),
            "main": base.get("type"),
            "speed": round(soul_speed(e), 3),
            "score": e.get("score"),
            "zscore": e.get("zscore"),
        })
    rows.sort(key=lambda r: r["speed"], reverse=True)

    out = {
        "ok": True,
        "overview": overview,
        "speeds": speeds,
        "score_distribution": score_dist,
        "top_souls": rows[:20],
        "meta": extra_meta or {},
        "elapsed_ms": int((time.time() - t0) * 1000),
    }
    return out


# ---------------------------------------------------------------- F3 精确指标（CBG equip_desc）
def fetch_equip_desc(ordersn: str, timeout: int = 120) -> Optional[dict]:
    """公开 CDN 拉取 CBG 御魂档案（无需登录）。"""
    import urllib.request
    url = CBG_CDN.format(ordersn=ordersn)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = json.loads(r.read().decode("utf-8"))
    except Exception:
        return None
    if isinstance(raw, dict) and "equip_desc" in raw:
        d = raw["equip_desc"]
        return json.loads(d) if isinstance(d, str) else d
    return raw


def precise_metrics(ordersn: str) -> dict:
    """F3：从 CBG equip_desc 精确计算头/尾/17速/散件速度（含逐条副属性）。"""
    desc = fetch_equip_desc(ordersn)
    if not desc:
        return {"ok": False, "msg": "无法获取 CBG 御魂档案（订单可能已下架）"}
    s = P.summarize(P.load_desc(desc))
    return {
        "ok": True,
        "ordersn": ordersn,
        "source": "cbg-equip-desc",
        "speeds": {
            "scatter1": s.get("scatterSpeed1"),
            "scatter2": s.get("scatterSpeed2"),
            "scatter3": s.get("scatterSpeed3"),
            "scatter4": s.get("scatterSpeed4"),
            "scatter5": s.get("scatterSpeed5"),
        },
        "head": {
            "count": s.get("headCount"),
            "topSpeed": s.get("headTopSpeed"),
            "details": (s.get("headDetails") or [])[:5],
        },
        "hitTail": {
            "count": s.get("hitTailCount"),
            "topSpeed": s.get("hitTailTopSpeed"),
            "details": (s.get("hitTailDetails") or [])[:5],
        },
        "resistTail": {
            "count": s.get("resistTailCount"),
            "topSpeed": s.get("resistTailTopSpeed"),
            "details": (s.get("resistTailDetails") or [])[:5],
        },
        "maxSpeedCount": s.get("maxSpeedCount"),
        "zhen17Count": s.get("zhen17Count"),
        "zhen17Details": (s.get("details") or [])[:10],
        "resources": s.get("resource"),
    }


# ---------------------------------------------------------------- F4 组合搜索
def search(equips: List[dict], hero: str, target: str = "Damage",
           filters: Optional[dict] = None, settings: Optional[dict] = None,
           top: int = 5) -> List[dict]:
    res = C.pt(equips, hero, target, filters or {}, settings or {"fastMode": True})
    out = []
    for r in (res or [])[:top]:
        suit = r.get("suit") or []
        out.append({
            "value": round(r["value"], 3),
            "yuhunGain": {k: round(v, 4) for k, v in (r.get("yuhunGain") or {}).items()},
            "suits": sorted({C.suit_name(e["suit_id"]) for e in suit}),
            "equips": [{"kind": e.get("kind"), "pos": pos1(e), "score": e.get("score")} for e in suit],
        })
    return out


def panel(hero: str, suits: List[dict]) -> dict:
    return C.panel_from_equips(hero, suits)


# ---------------------------------------------------------------- 元数据（供前端下拉/面板）
TARGETS = [
    {"key": "Damage", "name": "伤害"},
    {"key": "Speed", "name": "速度"},
    {"key": "CritRate", "name": "暴击"},
    {"key": "CritPower", "name": "暴击伤害"},
    {"key": "Attack", "name": "攻击"},
    {"key": "Hp", "name": "生命"},
    {"key": "Defense", "name": "防御"},
]


def meta() -> dict:
    heroes = sorted(getattr(C, "HEROES", {}).keys())
    suits = [{"id": sid, "name": s.get("name"), "type": s.get("type")}
             for sid, s in getattr(C, "SUITS", {}).items() if int(sid) >= 100]
    suits.sort(key=lambda s: s["name"] or "")
    return {"heroes": heroes, "suits": suits, "targets": TARGETS,
            "positions": [1, 2, 3, 4, 5, 6]}


def build_filters(payload: dict) -> dict:
    """把前端友好的搜索参数转成 calc_demo 的 filters。

    支持：min_crit_rate(%) / min_speed / min_crit_power(%) / min_attack /
          suit_name + suit_count / main_pos + main_attr
    """
    props: Dict[str, dict] = {}
    if payload.get("min_crit_rate") not in (None, "", 0):
        props["CritRate"] = {"min": float(payload["min_crit_rate"])}
    if payload.get("min_crit_power") not in (None, "", 0):
        props["CritPower"] = {"min": float(payload["min_crit_power"])}
    if payload.get("min_speed") not in (None, "", 0):
        props["Speed"] = {"min": float(payload["min_speed"])}
    if payload.get("min_attack") not in (None, "", 0):
        props["Attack"] = {"min": float(payload["min_attack"])}

    filters: Dict[str, Any] = {}
    if props:
        filters["propsLimit"] = props
    if payload.get("suit_name"):
        try:
            sid = C._sid(str(payload["suit_name"]))
        except KeyError:
            raise ValueError("未知套装: " + str(payload["suit_name"]))
        filters["suitCombos"] = [{"id": sid, "count": int(payload.get("suit_count") or 4)}]
    pos = payload.get("main_pos")
    attr = payload.get("main_attr")
    if pos and attr:
        filters["mainAttrsLimit"] = {int(pos): [str(attr)]}
    return filters


# ---------------------------------------------------------------- 抓取
def fetch_yyx(cbg_url: str, mode: str = "auto") -> tuple[dict, dict]:
    """返回 (yyx, meta)。mode: auto|api|cbg。"""
    t0 = time.time()
    ds = YyshubClient(interval=0).dataset(cbg_url, mode=mode)
    meta = {"source": ds.get("via"), "fetch_ms": int((time.time() - t0) * 1000)}
    return ds["full"], meta
