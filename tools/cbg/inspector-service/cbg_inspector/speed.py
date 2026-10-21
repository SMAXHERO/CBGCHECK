"""速度盘点（对应站点 pages/app/speed chunk 与首页速度亮点）。

核心公式（与站点 66553 模块一致）：
    单件速度 = 该件「速度」副属性的强化值之和（6 星单档 3 点，最多 6 档 = 18）
    2 号位若主属性为速度，额外 +57（六星速度主属性 +15 满值）
    一速     = 六个号位各取一件后的速度之和
    满速     = 6 星 +15 且速度副属性强化满 6 档（2 号位还要求主属性为速度）
    套装一速 = 强制 4 件为指定套装时的最优六件组合
"""
from __future__ import annotations

POSITIONS = ("1", "2", "3", "4", "5", "6")
MAIN_SPEED_MAX = 57  # 六星速度主属性 +15 满值

# 站点「常用 PVP 套件速度」默认勾选的 11 个四件套
DEFAULT_PVP_SUITS = [
    "招财猫", "火灵", "蚌精", "返魂香", "魅妖", "钟灵",
    "共潜", "遗念火", "雪幽魂", "油赤子", "木魅",
]


def sub_speed(relic: dict) -> float:
    """副属性速度强化值之和。"""
    total = 0.0
    for item in (relic.get("enhancement") or {}).get("totals") or []:
        if item.get("label") == "速度":
            total += float(item.get("total") or 0)
    return total


def speed_roll_count(relic: dict) -> int:
    for item in (relic.get("enhancement") or {}).get("totals") or []:
        if item.get("label") == "速度":
            return int(item.get("count") or 0)
    return 0


def main_speed(relic: dict) -> float:
    main = relic.get("mainAttribute") or {}
    if main.get("label") != "速度":
        return 0.0
    return float(main.get("value") or 0)


def relic_speed(relic: dict) -> float:
    """单件用于「一速」的速度贡献：副属性之和 + 2 号位速度主属性 57。"""
    value = sub_speed(relic)
    if str(relic.get("position")) == "2":
        value += main_speed(relic)
    return value


def _filter_main(relics: list[dict], allowed: tuple[str, ...] | None) -> list[dict]:
    if not allowed:
        return relics
    return [r for r in relics if (r.get("mainAttribute") or {}).get("label") in allowed]


def pos2_speed_main(relics: list[dict]) -> list[dict]:
    """一速组合的 2 号位必须为速度主属性（引擎 requireSecondPositionSpeed）。"""
    return [r for r in relics if (r.get("mainAttribute") or {}).get("label") == "速度"]


def _choose_one(per_position: dict[str, list[dict]]) -> list[dict]:
    best = []
    for pos in POSITIONS:
        candidates = per_position.get(pos) or []
        if not candidates:
            return []
        best.append(max(candidates, key=relic_speed))
    return best


def _combination_value(relics: list[dict]) -> float:
    return sum(relic_speed(r) for r in relics)


def _cell(relic: dict, row_suit: str | None = None) -> dict:
    main = relic.get("mainAttribute") or {}
    labels = []
    if str(relic.get("position")) in ("2", "4", "6") and main.get("label") != "速度":
        labels.append(main.get("label") or "")
    suit_name = (relic.get("suit") or {}).get("name") or ""
    if row_suit and suit_name != row_suit:
        labels.append(suit_name)
    return {
        "position": relic.get("position"),
        "value": round(relic_speed(relic), 2),
        "subSpeed": round(sub_speed(relic), 2),
        "mainAttribute": main,
        "suitName": suit_name,
        "labels": [x for x in labels if x],
        "relic": relic,
    }


def scatter_combinations(dataset: dict, top: int = 5,
                         fourth_main: tuple[str, ...] | None = None,
                         sixth_main: tuple[str, ...] | None = None) -> list[dict]:
    """散件一速组合 TOP N（六个号位各一件，互不重复）。"""
    per_position = {
        pos: _filter_main(_filter_main(dataset["relicsByPosition"].get(pos) or [],
                                       fourth_main if pos == "4" else None),
                          sixth_main if pos == "6" else None)
        for pos in POSITIONS
    }
    per_position["2"] = pos2_speed_main(per_position["2"])
    remaining = {pos: list(per_position[pos]) for pos in POSITIONS}
    combos = []
    for rank in range(top):
        chosen = _choose_one(remaining)
        if len(chosen) != 6:
            break
        combos.append({
            "rank": rank + 1,
            "value": round(_combination_value(chosen), 2),
            "cells": [_cell(r) for r in sorted(chosen, key=lambda r: r["position"])],
        })
        for relic in chosen:
            pos = str(relic["position"])
            remaining[pos] = [r for r in remaining[pos] if r.get("relicId") != relic.get("relicId")]
    return combos


def suit_combinations(dataset: dict, suit: str,
                      fourth_main: tuple[str, ...] | None = None,
                      sixth_main: tuple[str, ...] | None = None) -> dict | None:
    """指定四件套的一速：4 件为该套、另外 2 件任意。"""
    from itertools import combinations

    pools = {}
    for pos in POSITIONS:
        relics = dataset["relicsByPosition"].get(pos) or []
        if pos == "4":
            relics = _filter_main(relics, fourth_main)
        if pos == "6":
            relics = _filter_main(relics, sixth_main)
        if pos == "2":
            relics = pos2_speed_main(relics)
        pools[pos] = relics

    suit_pool = {pos: [r for r in pools[pos] if (r.get("suit") or {}).get("name") == suit]
                 for pos in POSITIONS}
    any_pool = pools

    best = None
    for suit_positions in combinations(POSITIONS, 4):
        chosen = []
        ok = True
        for pos in POSITIONS:
            pool = suit_pool[pos] if pos in suit_positions else any_pool[pos]
            if not pool:
                ok = False
                break
            chosen.append(max(pool, key=relic_speed))
        if not ok:
            continue
        value = _combination_value(chosen)
        if best is None or value > best[0]:
            best = (value, chosen)
    if best is None:
        return None
    value, chosen = best
    return {
        "suit": suit,
        "value": round(value, 2),
        "cells": [_cell(r, row_suit=suit) for r in sorted(chosen, key=lambda r: r["position"])],
    }


def suit_speed_table(dataset: dict, suits: list[str] | None = None,
                     fourth_main: tuple[str, ...] | None = None,
                     sixth_main: tuple[str, ...] | None = None) -> list[dict]:
    suits = suits or DEFAULT_PVP_SUITS
    rows = []
    for suit in suits:
        combo = suit_combinations(dataset, suit, fourth_main=fourth_main, sixth_main=sixth_main)
        if combo:
            rows.append(combo)
    rows.sort(key=lambda row: -row["value"])
    return rows


def full_speed(dataset: dict) -> dict:
    """满速御魂（6 星 +15，速度副属性满 6 档；2 号位需速度主属性）。"""
    relics = []
    for pos in POSITIONS:
        for relic in dataset["relicsByPosition"].get(pos) or []:
            if relic.get("quality") != 6 or relic.get("level") != 15:
                continue
            if speed_roll_count(relic) != 6:
                continue
            if pos == "2" and (relic.get("mainAttribute") or {}).get("label") != "速度":
                continue
            relics.append({
                "position": int(pos),
                "value": round(sub_speed(relic), 2),
                "suitName": (relic.get("suit") or {}).get("name"),
                "mainAttribute": relic.get("mainAttribute"),
                "relic": relic,
            })
    relics.sort(key=lambda item: (item["position"], -item["value"]))
    by_position = {pos: sum(1 for item in relics if item["position"] == int(pos)) for pos in POSITIONS}
    return {"count": len(relics), "byPosition": by_position, "relics": relics}


def speed_head_tail(dataset: dict) -> dict:
    """「头 / 尾」的本地算法（站点首页直接取 highlights 文本）。

    2 号位御魂里速度副属性满 6 档（+18）的件数：
        头 = 主属性为速度的（速度主属性 + 满速副属性）
        尾 = 主属性不是速度的
    基准账号：3 头 4 尾（与页面一致）。
    """
    heads = tails = 0
    for relic in dataset["relicsByPosition"].get("2") or []:
        if relic.get("quality") != 6 or relic.get("level") != 15:
            continue
        if speed_roll_count(relic) != 6:
            continue
        if (relic.get("mainAttribute") or {}).get("label") == "速度":
            heads += 1
        else:
            tails += 1
    return {"heads": heads, "tails": tails}


def highlights(dataset: dict) -> dict:
    """首页速度亮点（站点直接读 highlights 文本，不做二次计算）。"""
    hl = dataset.get("highlights") or {}
    return {
        "scatteredFirstSpeed": hl.get("scatteredFirstSpeed"),
        "luckyFirstSpeed": hl.get("luckyFirstSpeed"),
        "speedHeadCount": hl.get("speedHeadCount") or 0,
        "speedTailCount": hl.get("speedTailCount") or 0,
        "text": hl.get("text") or "",
    }


def summary(dataset: dict, suits: list[str] | None = None) -> dict:
    """首页「御魂速度概括」+「速度盘点」首屏。"""
    full = full_speed(dataset)
    return {
        "highlights": highlights(dataset),
        "headTail": speed_head_tail(dataset),
        "fullSpeedCount": full["count"],
        "fullSpeedByPosition": full["byPosition"],
        "scatterTop": scatter_combinations(dataset, top=5),
        "suitTable": suit_speed_table(dataset, suits),
        "fullSpeedRelics": full["relics"],
    }


def format_value(value: float) -> str:
    return f"+{value:.2f}" if value is not None else "-"
