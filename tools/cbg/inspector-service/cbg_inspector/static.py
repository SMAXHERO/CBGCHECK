"""静态资料：式神基础面板、御魂套装属性、逢魔（首领）御魂表。

数据来源（站点静态接口，已抓取到 data/ 目录）：
    GET https://yys.maydaylands.com/yys-cbg-inspector/static/heroes       -> static-heroes.json
    GET https://yys.maydaylands.com/yys-cbg-inspector/static/relic-suits   -> static-relic-suits.json
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# 属性文案 -> 引擎内部键（与 worker chunk 9854 的 en() 一致）
_ATTR_KEYS = (
    ("速度", "speed"),
    ("暴击伤害", "critDamage"),
    ("爆伤", "critDamage"),
    ("暴击", "critRate"),
    ("攻击加成", "attackPercent"),
    ("攻击", "attack"),
    ("生命加成", "healthPercent"),
    ("生命", "health"),
    ("防御加成", "defensePercent"),
    ("防御", "defense"),
    ("效果命中", "effectHit"),
    ("效果抵抗", "effectResistance"),
)

_ATTR_RE = re.compile(
    r"^(速度|暴击伤害|暴击|攻击加成|攻击|生命加成|生命|防御加成|防御|效果命中|效果抵抗)\s*\+?\s*(\d+(?:\.\d+)?)%?$"
)


def attr_key(label: str) -> str | None:
    """把中文属性名映射为引擎内部键（en()）。"""
    for text, key in _ATTR_KEYS:
        if text in (label or ""):
            return key
    return None


def parse_attribute_text(text: str) -> dict | None:
    """"攻击加成15%" -> {"label": "攻击加成", "value": 15.0, "key": "attackPercent"}。"""
    m = _ATTR_RE.match((text or "").strip())
    if not m:
        return None
    label, value = m.group(1), float(m.group(2))
    return {"label": label, "value": value, "key": attr_key(label), "isPercent": "%" in text}


@lru_cache(maxsize=1)
def load_static() -> dict:
    """读取并缓存静态资料。"""
    heroes_doc = json.loads((DATA_DIR / "static-heroes.json").read_text(encoding="utf-8"))
    suits_doc = json.loads((DATA_DIR / "static-relic-suits.json").read_text(encoding="utf-8"))

    heroes_by_id: dict[int, dict] = {}
    for key, info in (heroes_doc.get("heroesById") or {}).items():
        try:
            heroes_by_id[int(key)] = info
        except (TypeError, ValueError):
            continue

    suit_attributes: dict[str, dict] = {}
    suit_names: list[str] = []
    suits_by_id: dict[int, str] = {}
    for row in suits_doc.get("yuhun_list") or []:
        if len(row) < 4:
            continue
        name, text = row[1], row[3]
        suit_names.append(name)
        try:
            suits_by_id[int(row[0])] = name
        except (TypeError, ValueError):
            pass
        parsed = parse_attribute_text(text)
        if parsed:
            suit_attributes[name] = parsed

    oma_suits = {int(k): v for k, v in (suits_doc.get("two_suit_yuhun") or {}).items()}

    heroes_by_name: dict[str, dict] = {}
    for info in heroes_by_id.values():
        name = info.get("name")
        if name and name not in heroes_by_name:
            heroes_by_name[name] = info

    return {
        "heroesDoc": heroes_doc,
        "suitsDoc": suits_doc,
        "heroesById": heroes_by_id,
        "heroesByName": heroes_by_name,
        "suitAttributes": suit_attributes,
        "suitNames": suit_names,
        "suitsById": suits_by_id,
        "omaSuits": oma_suits,
        "omaSuitNames": sorted(set(oma_suits.values())),
    }


def hero_base_stats(heroes_by_id: dict[int, dict], name: str) -> dict | None:
    """按式神名取基础面板（找第一个同名的）。"""
    for info in heroes_by_id.values():
        if info.get("name") == name:
            return info.get("baseStats")
    return None


def hero_info(heroes_by_id: dict[int, dict], hero_id: int) -> dict:
    return heroes_by_id.get(int(hero_id or 0)) or {}
