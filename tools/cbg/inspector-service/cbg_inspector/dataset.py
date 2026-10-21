"""原始导出 -> schemaVersion 11 数据集（对应站点 chunk js/9032-*.js）。

站点在浏览器里把 CBG 的 `equip_desc`（4.29 MB JSON 字符串）解析后重排为
schemaVersion 11 的结构，之后所有页面（速度盘点 / PVE / 式神技能 / 库存 /
计算器）都只读这个结构。本模块逐行对照该 chunk 重新实现，字段与公式一致。
"""
from __future__ import annotations

import json
import re
import uuid

from .static import attr_key, hero_info, load_static

# ---------------------------------------------------------------- 常量（9032）

# 六星御魂单档副属性成长值：r
MAX_ROLL = {
    "speedAdditionVal": 3,
    "critRateAdditionVal": 3,
    "critPowerAdditionVal": 4,
    "attackAdditionRate": 3,
    "attackAdditionVal": 27,
    "maxHpAdditionRate": 3,
    "maxHpAdditionVal": 114,
    "defenseAdditionRate": 3,
    "defenseAdditionVal": 5,
    "debuffEnhance": 4,
    "debuffResist": 4,
}

# 英文键 -> 中文名：n
LABELS = {
    "speedAdditionVal": "速度",
    "critRateAdditionVal": "暴击",
    "critPowerAdditionVal": "暴击伤害",
    "attackAdditionRate": "攻击加成",
    "attackAdditionVal": "攻击",
    "maxHpAdditionRate": "生命加成",
    "maxHpAdditionVal": "生命",
    "defenseAdditionRate": "防御加成",
    "defenseAdditionVal": "防御",
    "debuffEnhance": "效果命中",
    "debuffResist": "效果抵抗",
}

# 六星主属性成长区间（l）：label -> (初始值, +15 满值)
MAIN_GROWTH = {
    "攻击": (65, 486),
    "防御": (14, 104),
    "生命": (274, 2052),
    "速度": (12, 57),
    "攻击加成": (10, 55),
    "防御加成": (10, 55),
    "生命加成": (10, 55),
    "暴击": (10, 55),
    "效果命中": (10, 55),
    "效果抵抗": (10, 55),
    "暴击伤害": (14, 89),
}

# 副属性排序权重（o）：index 越小越靠前
ATTR_ORDER = ["速度", "暴击", "暴击伤害", "效果命中", "效果抵抗", "生命加成",
              "攻击加成", "防御加成", "攻击", "生命", "防御"]


def _attr_sort_key(item) -> tuple[int, str]:
    label = item.get("label") if isinstance(item, dict) else str(item)
    try:
        return ATTR_ORDER.index(label), ""
    except ValueError:
        return len(ATTR_ORDER), str(label)


def attr_from_pair(pair) -> dict | None:
    """["攻击加成", "55.00%"] -> {"label","value","isPercent"}（9032 的 g()）。"""
    if not isinstance(pair, (list, tuple)) or len(pair) < 2:
        return None
    label = str(pair[0])
    raw = str(pair[1])
    try:
        value = float(raw.replace("%", ""))
    except ValueError:
        value = 0.0
    return {"label": label, "value": value, "isPercent": "%" in raw}


def _number(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


# ------------------------------------------------------- 主属性 / 成长明细（A）


def main_growth_value(main_attr: dict | None, quality: int, level: int,
                      orig_level: int) -> dict | None:
    """y()：给定强化等级下的主属性推算值；非六星或等级不符时返回原值/None。"""
    if not main_attr:
        return None
    label = main_attr.get("label") or ""
    if quality != 6 or label not in MAIN_GROWTH:
        return main_attr if level == orig_level else None
    initial, maximum = MAIN_GROWTH[label]
    lv = max(0, min(15, level))
    return {
        "label": label,
        "value": round(initial + (maximum - initial) * lv / 15.0, 4),
        "isPercent": main_attr.get("isPercent", False),
    }


def enhancement_detail(growth_rolls: list, level: int, main_attr: dict | None,
                       quality: int) -> dict:
    """A()：强化明细（强化次数 / 初始词条数 / 0~15 级逐段主属性）。"""
    enhancement_count = int(_number(level) // 3)
    initial_roll_count = max(0, len(growth_rolls) - enhancement_count)
    stages = []
    for stage in range(6):  # 0,3,6,9,12,15
        stage_level = stage * 3
        stages.append({
            "level": stage_level,
            "mainAttribute": main_growth_value(main_attr, quality, stage_level, level),
            "isNew": stage > 0,
        })
    return {
        "enhancementCount": enhancement_count,
        "initialRollCount": initial_roll_count,
        "stages": stages,
        "growthRolls": growth_rolls,
    }


# ---------------------------------------------------------------- 御魂（relic）


def build_relic(raw: dict, static: dict) -> dict | None:
    """单件御魂：库存条目 -> 数据集 relic。"""
    if not isinstance(raw, dict):
        return None
    suit_id = int(_number(raw.get("suitid")))
    suit_name = static["suitsById"].get(suit_id) or str(raw.get("suitname") or "")
    if not suit_name:
        return None

    quality = int(_number(raw.get("qua")) or 6)
    level = int(_number(raw.get("level")))
    position = int(_number(raw.get("pos")))

    growth_rolls: list[dict] = []
    totals_map: dict[str, dict] = {}
    for pair in raw.get("rattr") or []:
        if not isinstance(pair, (list, tuple)) or len(pair) < 2:
            continue
        key = str(pair[0])
        label = LABELS.get(key)
        if not label:
            continue
        coeff = _number(pair[1])
        max_growth = MAX_ROLL.get(key, 0)
        increase = max_growth * coeff
        growth_rolls.append({
            "key": key, "label": label, "maxGrowth": max_growth,
            "coefficient": coeff, "increase": increase,
        })
        total = totals_map.setdefault(key, {
            "key": key, "label": label, "count": 0, "total": 0.0, "values": [],
        })
        total["count"] += 1
        total["total"] += increase
        total["values"].append(increase)

    growth_rolls.sort(key=_attr_sort_key)
    totals = sorted(totals_map.values(), key=_attr_sort_key)

    attrs = [attr_from_pair(p) for p in (raw.get("attrs") or [])]
    attrs = [a for a in attrs if a]
    main_attr = attrs[0] if attrs else None
    sub_attrs = sorted(attrs[1:], key=_attr_sort_key)

    set_bonus_attr = attr_from_pair(raw["single_attr"]) if raw.get("single_attr") else None

    return {
        "relicId": str(raw.get("uuid") or raw.get("itemId") or ""),
        "detail": growth_rolls,
        "level": level,
        "quality": quality,
        "position": position,
        "mainAttribute": main_attr,
        "subAttributes": sub_attrs,
        "setBonusAttribute": set_bonus_attr,
        "enhancement": {
            "totals": totals,
            "detail": enhancement_detail(growth_rolls, level, main_attr, quality),
        },
        "suit": {
            "id": suit_id,
            "name": suit_name,
            "isTwoPieceSet": suit_id in static["omaSuits"],
            "twoPieceConfig": static["omaSuits"].get(suit_id),
        },
        "isTwoPieceSet": suit_id in static["omaSuits"],
    }


# ---------------------------------------------------------------- 数据组装


def _skill_levels(raw_hero: dict) -> list[int]:
    skinfo = {}
    for pair in raw_hero.get("skinfo") or []:
        if isinstance(pair, (list, tuple)) and len(pair) >= 2:
            try:
                skinfo[int(pair[0])] = int(pair[1])
            except (TypeError, ValueError):
                continue
    levels = [skinfo.get(int(skill), 0) for skill in (raw_hero.get("selectSkills") or [])]
    levels = [v for v in levels if v > 0]
    if not levels:
        levels = [v for v in skinfo.values() if v > 0]
    return levels[:3]


def build_hero(raw_hero: dict) -> dict | None:
    if not isinstance(raw_hero, dict):
        return None
    hero_id = int(_number(raw_hero.get("heroId")))
    if hero_id <= 0:
        return None
    level = int(_number(
        raw_hero.get("level") or raw_hero.get("lv")
        or raw_hero.get("heroLevel") or raw_hero.get("hero_level")
    ))
    return {
        "instanceId": str(raw_hero.get("heroUid") or raw_hero.get("uid") or uuid.uuid4().hex),
        "heroId": hero_id,
        "name": raw_hero.get("name"),
        "rarity": raw_hero.get("rarity"),
        "level": level,
        "skillLevels": _skill_levels(raw_hero),
    }


def _sum_daruma(damo_count_dict: dict | None) -> int:
    total = 0
    for value in (damo_count_dict or {}).values():
        if isinstance(value, dict):
            try:
                total += int(_number(value.get("411")))
            except (TypeError, ValueError):
                continue
    return total


def _dex_entry(hero_history: dict, key: str) -> dict:
    entry = hero_history.get(key)
    if not isinstance(entry, dict):
        return {"owned": 0, "total": 0}
    return {"owned": int(_number(entry.get("got"))), "total": int(_number(entry.get("all")))}


_HIGHLIGHT_HEAD_RE = re.compile(r"(\d+)\s*头\s*(\d+)\s*尾")
_NUMBER_AFTER_RE = re.compile(r"([0-9]+(?:\.[0-9]+)?)")


def _highlight_number(text: str, label: str) -> float | None:
    idx = text.find(label)
    if idx < 0:
        return None
    m = _NUMBER_AFTER_RE.search(text[idx + len(label): idx + len(label) + 24])
    return float(m.group(1)) if m else None


def parse_highlights(equip: dict, desc: dict) -> dict:
    """S()：从 equip.highlights（或导出里的 highlights）解析速度亮点。"""
    raw = equip.get("highlights") or desc.get("highlights") or []
    if isinstance(raw, str):
        text = raw
    else:
        text = " ".join(str(item) for item in raw)
    m = _HIGHLIGHT_HEAD_RE.search(text)
    return {
        "raw": list(raw) if isinstance(raw, (list, tuple)) else [str(raw)],
        "text": text,
        "scatteredFirstSpeed": _highlight_number(text, "散件一速"),
        "luckyFirstSpeed": _highlight_number(text, "招财一速"),
        "speedHeadCount": int(m.group(1)) if m else 0,
        "speedTailCount": int(m.group(2)) if m else 0,
    }


def build_dataset(equip_body: dict, static: dict | None = None) -> dict:
    """equip_body: {"equip": {...}} 或直接 equip dict。"""
    static = static or load_static()
    equip = equip_body.get("equip") if isinstance(equip_body, dict) and "equip" in equip_body else equip_body
    desc = equip.get("equip_desc")
    if desc is None:
        desc = (equip.get("equip_data") or {}).get("equip_desc")
    if isinstance(desc, str):
        s = json.loads(desc)
    elif isinstance(desc, dict):
        s = desc
    else:
        raise ValueError("响应里没有 equip_desc")

    # 御魂
    inventory = s.get("inventory")
    relics_by_position: dict[str, list[dict]] = {str(i): [] for i in range(1, 7)}
    if isinstance(inventory, dict):
        for raw in inventory.values():
            relic = build_relic(raw, static)
            if relic and 1 <= relic["position"] <= 6:
                relics_by_position[str(relic["position"])].append(relic)

    # 式神
    heroes = []
    for raw in (s.get("heroes") or {}).values():
        hero = build_hero(raw)
        if hero:
            heroes.append(hero)

    jade = _number(s.get("goyu") if s.get("goyu") is not None else s.get("soul_jade"))
    mystery = int(_number(s.get("gameble_card")))
    reality = int(_number(s.get("ar_gamble_card")))
    summon_power = int(11 * (jade // 1000) + ((jade % 1000) // 100) + mystery + reality)

    hero_history = s.get("hero_history") or {}
    highlights = parse_highlights(equip, s)
    collect_num = equip.get("collect_num")

    account = {
        "title": equip.get("equip_name") or s.get("format_equip_name") or s.get("name"),
        "name": s.get("name"),
        "serverName": equip.get("server_name") or s.get("origin_server_name"),
        "level": int(_number(s.get("lv"))),
        "fengzidu": int(_number(s.get("fengzidu"))),
        "pvpStage": s.get("pvp_stage"),
        "pvpScore": int(_number(s.get("pvp_score"))),
        "heroSummary": int(_number(s.get("hero_summary"))),
        "relicSummary": int(_number(s.get("equips_summary"))),
        "collectionSkinCount": int(_number(collect_num)) if collect_num is not None else 0,
        "yuxingDama": _sum_daruma(s.get("damo_count_dict")),
        "money": int(_number(s.get("money"))),
        "stamina": int(_number(s.get("strength") if s.get("strength") is not None
                            else s.get("currency_900273"))),
        "maxLevelRelicCount": int(_number(s.get("level_15"))),
        "soulJade": jade,
        "mysteryTalisman": mystery,
        "realityTalisman": reality,
        "summonPower": summon_power,
        "shikigamiDex": {
            "ssr": _dex_entry(hero_history, "ssr"),
            "sp": _dex_entry(hero_history, "sp"),
            "ur": _dex_entry(hero_history, "ur"),
            "uncollected500Days": s.get("ssr_coin"),
            "uncollected999Days": s.get("sp_coin"),
            "uncollectedCoupon": s.get("currency_490017"),
        },
    }

    return {
        "schemaVersion": 11,
        "account": account,
        "heroes": heroes,
        "relicsByPosition": relics_by_position,
        "highlights": highlights,
        "source": {
            "serverid": str(equip.get("serverid") or ""),
            "ordersn": str(equip.get("ordersn") or equip.get("game_ordersn") or ""),
            "serverName": equip.get("server_name") or s.get("origin_server_name"),
        },
    }


def dataset_stats(dataset: dict) -> dict:
    """数据集规模摘要（用于自检）。"""
    counts = {pos: len(items) for pos, items in dataset["relicsByPosition"].items()}
    total = sum(counts.values())
    max_level = sum(1 for items in dataset["relicsByPosition"].values()
                    for relic in items if relic["quality"] == 6 and relic["level"] == 15)
    return {"relics": total, "maxLevelRelics": max_level, "byPosition": counts,
            "heroes": len(dataset["heroes"])}
