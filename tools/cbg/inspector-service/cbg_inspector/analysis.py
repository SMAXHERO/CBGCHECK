"""页面级分析：首页概览 / 式神技能 / PVE 评分 / 御魂库存。

对应站点六个页面里的 home、hero-skills、pve、relics 四类视图；
速度相关在 speed.py，御魂计算器在 calculator.py。
"""
from __future__ import annotations

from collections import Counter, defaultdict

from . import speed

# 站点「PVE 有效属性」三件套
PVE_ATTRS = ("攻击加成", "暴击", "暴击伤害")
# 站点普通套（PVE 评分 7 套）
PVE_NORMAL_SUITS = ["狂骨", "海月火玉", "伤魂鸟", "破势", "隐念", "镇墓兽", "片叶之苇"]
# 站点逢魔套（3 套）
PVE_OMA_SUITS = ["土蜘蛛", "荒骷髅", "鬼灵歌伎"]

# 式神技能页里被排除的材料/达摩类 heroId
HERO_EXCLUDED_IDS = {10, 11, 12, 13, 15, 16}
# 只展示这几种稀有度（6=UR 5=SP 4=SSR）
HERO_RARITIES = (6, 5, 4)
RARITY_LABEL = {6: "UR", 5: "SP", 4: "SSR", 3: "SR", 2: "R", 1: "N"}


# ---------------------------------------------------------------- 数字格式化
def format_wan(value: float) -> str:
    """站点首页的「9.6万 / 1.3亿」式短格式。"""
    if value is None:
        return "-"
    number = float(value)
    for unit, suffix in ((1e8, "亿"), (1e4, "万")):
        if number >= unit:
            # 站点用截断（9.6692 万显示为 9.6 万），不是四舍五入
            text = f"{int(number / unit * 10) / 10:.1f}".rstrip("0").rstrip(".")
            return text + suffix
    return str(int(number))


def format_number(value: float) -> str:
    if value is None:
        return "-"
    return f"{int(value):,}"


def _uncollected(value) -> str:
    """未收录徽记：null → '-'，>0 → 未使用，0 → 已使用。"""
    if value is None:
        return "-"
    return "未使用" if float(value) > 0 else "已使用"


def _speed_highlights(sp: dict) -> dict:
    """首页速度亮点：优先用站点 highlights 文本，缺失时用本地计算兜底。"""
    hl = dict(sp.get("highlights") or {})
    if hl.get("scatteredFirstSpeed") is None and sp.get("scatterTop"):
        hl["scatteredFirstSpeed"] = round(float(sp["scatterTop"][0]["value"]), 2)
    if hl.get("luckyFirstSpeed") is None:
        for row in sp.get("suitTable") or []:
            if row.get("suit") == "招财猫":
                hl["luckyFirstSpeed"] = round(float(row["value"]), 2)
                break
    head_tail = sp.get("headTail") or {}
    if not hl.get("speedHeadCount"):
        hl["speedHeadCount"] = head_tail.get("heads", 0)
    if not hl.get("speedTailCount"):
        hl["speedTailCount"] = head_tail.get("tails", 0)
    return hl


# ---------------------------------------------------------------- 首页概览
def overview(dataset: dict, static: dict | None = None) -> dict:
    """对应「账号查询」首页全部卡片。"""
    account = dataset["account"]
    sp = speed.summary(dataset)
    dex = account.get("shikigamiDex") or {}
    count_by_pos = {pos: len(items) for pos, items in dataset["relicsByPosition"].items()}
    total_relics = sum(count_by_pos.values())

    return {
        "account": {
            "name": account.get("name"),
            "serverName": account.get("serverName"),
            "level": account.get("level"),
            "fengzidu": account.get("fengzidu"),
            "pvpStage": account.get("pvpStage"),
            "pvpScore": account.get("pvpScore"),
            "stamina": {"raw": account.get("stamina"), "text": format_wan(account.get("stamina"))},
            "money": {"raw": account.get("money"), "text": format_wan(account.get("money"))},
            "soulJade": {"raw": account.get("soulJade"), "text": format_number(account.get("soulJade"))},
            "mysteryTalisman": account.get("mysteryTalisman"),
            "realityTalisman": account.get("realityTalisman"),
            "collectionSkinCount": account.get("collectionSkinCount"),
            "summonPower": account.get("summonPower"),
            "yuxingDama": account.get("yuxingDama"),
            "dex": {
                "ssr": dex.get("ssr"),
                "sp": dex.get("sp"),
                "ur": dex.get("ur"),
                # 页面渲染规则：null → '-'，>0 → 未使用，0 → 已使用
                "uncollected500Days": _uncollected(dex.get("uncollected500Days")),
                "uncollected999Days": _uncollected(dex.get("uncollected999Days")),
                "uncollectedCoupon": dex.get("uncollectedCoupon"),
            },
        },
        "speed": {
            "hl": _speed_highlights(sp),
            "fullSpeedCount": sp["fullSpeedCount"],
            "fullSpeedByPosition": sp["fullSpeedByPosition"],
            "scatterTop": [
                {"value": round(item["value"], 2), "relics": item.get("relics")}
                for item in sp["scatterTop"]
            ],
        },
        "relics": {
            "totalInBag": account.get("relicSummary"),  # 账号御魂总数（含非满级）
            "counted": total_relics,                    # 数据集里实际解析的件数
            "maxLevelCount": account.get("maxLevelRelicCount"),
            "byPosition": count_by_pos,
        },
        "pveScores": pve_scores(dataset, static),
    }


# ---------------------------------------------------------------- PVE 评分
def _effective_count(relic: dict) -> int | None:
    """对应站点 R0()：返回有效词条数，不合格返回 None。"""
    if relic.get("quality") != 6 or relic.get("level") != 15:
        return None
    main_label = (relic.get("mainAttribute") or {}).get("label")
    pos = relic.get("position")
    if pos in (2, 4) and main_label != "攻击加成":
        return None
    if pos == 6 and main_label not in ("暴击", "暴击伤害"):
        return None
    totals = (relic.get("enhancement") or {}).get("totals") or []
    count = sum(int(item.get("count") or 0) for item in totals if item.get("label") in PVE_ATTRS)
    bonus_attr = relic.get("setBonusAttribute") or {}
    bonus = 3 if bonus_attr.get("label") in PVE_ATTRS else 0
    return count + bonus


def pve_scores(dataset: dict, static: dict | None = None) -> dict:
    """PVE 页「普通御魂总评分 / 逢魔御魂总评分」。"""
    normal = list(PVE_NORMAL_SUITS)
    oma = list(PVE_OMA_SUITS)
    present = {
        (item.get("suit") or {}).get("name")
        for items in dataset["relicsByPosition"].values()
        for item in items
        if (item.get("suit") or {}).get("name") and not item.get("setBonusAttribute")
        and not (item.get("suit") or {}).get("isTwoPieceSet")
    }
    normal_final = [suit for suit in normal if suit in present] or list(normal)[:7]
    wanted = set(normal_final) | set(oma)

    grouped: dict[str, dict] = {}
    by_position: dict[int, list[dict]] = defaultdict(list)
    for pos_str, items in dataset["relicsByPosition"].items():
        for relic in items:
            name = (relic.get("suit") or {}).get("name") or ""
            if name not in wanted:
                continue
            effective = _effective_count(relic)
            if not effective or effective < 5:
                continue
            entry = grouped.setdefault(name, {"suitName": name, "totalScore": 0, "relicCount": 0})
            entry["totalScore"] += effective
            entry["relicCount"] += 1
            # 「PVE 输出御魂」按号位只统计 7 个普通套（逢魔套单独成表）
            if name in oma:
                continue
            by_position[int(pos_str)].append({
                "relicId": relic.get("relicId") or relic.get("id"),
                "effectiveCount": effective,
                "position": int(pos_str),
                "setBonusCount": bool(relic.get("setBonusAttribute")),
            })
    order = normal_final + oma
    scores = [grouped[name] for name in order if name in grouped]
    return {
        "normalSuits": [entry for entry in scores if entry["suitName"] in normal_final],
        "omaSuits": [entry for entry in scores if entry["suitName"] in oma],
        "highScoreByPosition": {
            pos: sorted(items, key=lambda item: (-item["effectiveCount"], item["relicId"] or ""))
            for pos, items in sorted(by_position.items())
        },
    }


# ---------------------------------------------------------------- 式神技能
def _skill_target_met(hero: dict, lowest_rank) -> bool:
    """对应站点 v()：技能等级逐位 >= lowestRank 的三位数字。"""
    rank = str(max(0, int(lowest_rank if lowest_rank is not None else 155))).rjust(3, "0")[:3]
    levels = [max(0, int(level)) for level in (hero.get("skillLevels") or [])[:3]]
    if len(levels) != 3:
        return False
    return all(level >= int(rank[index]) for index, level in enumerate(levels))


def _skill_sum(hero: dict) -> int:
    return sum(int(level) for level in (hero.get("skillLevels") or [])[:3])


def hero_skills(dataset: dict, static: dict | None = None) -> dict:
    """对应「式神技能」页：多号机 / 技能未达标 / 联动 / 全部式神分组。"""
    static = static or {}
    heroes_by_id = {int(key): value for key, value in (static.get("heroesById") or {}).items()}

    def info(hero: dict) -> dict:
        return heroes_by_id.get(int(hero["heroId"])) or {}

    def base_filter(hero: dict) -> bool:
        return (
            int(hero.get("rarity") or 0) in HERO_RARITIES
            and int(hero.get("heroId") or 0) < 900
            and int(hero.get("heroId") or 0) not in HERO_EXCLUDED_IDS
        )

    pool = [hero for hero in dataset.get("heroes") or [] if base_filter(hero)]
    non_collab = [hero for hero in pool if not info(hero).get("isCollaboration")]
    collab = [hero for hero in pool if info(hero).get("isCollaboration")]

    def sort_key(hero: dict):
        # 站点排序：等级降序，同级按 heroId 降序
        return (-int(hero.get("level") or 0), -int(hero.get("heroId") or 0))

    # 技能未达标：同名式神里没有任何一只能把技能练满
    by_name: dict[str, list[dict]] = defaultdict(list)
    for hero in non_collab:
        by_name[hero.get("name") or ""].append(hero)
    deficient = []
    for name, group in by_name.items():
        if any(_skill_target_met(hero, info(hero).get("lowestRank")) for hero in group):
            continue
        best = sorted(group, key=lambda hero: (-_skill_sum(hero),) + sort_key(hero))[0]
        deficient.append(best)
    deficient.sort(key=sort_key)

    # 多号机：同名式神里有 >=2 只技能达标
    duplicates = []
    for group in by_name.values():
        met = [hero for hero in group if _skill_target_met(hero, info(hero).get("lowestRank"))]
        if len(met) >= 2:
            duplicates.extend(sorted(met, key=sort_key))
    duplicates.sort(key=sort_key)

    groups = []
    for rarity in HERO_RARITIES:
        items = sorted((hero for hero in non_collab if int(hero.get("rarity") or 0) == rarity), key=sort_key)
        if items:
            groups.append({"rarity": RARITY_LABEL.get(rarity, str(rarity)), "heroes": items})

    return {
        "yuxingDama": (dataset.get("account") or {}).get("yuxingDama"),
        "duplicates": duplicates,
        "deficient": deficient,
        "collaboration": sorted(collab, key=sort_key),
        "groups": groups,
        "counts": {
            "duplicates": len(duplicates),
            "deficient": len(deficient),
            "collaboration": len(collab),
            "groups": {RARITY_LABEL.get(rarity, str(rarity)): sum(
                1 for hero in non_collab if int(hero.get("rarity") or 0) == rarity) for rarity in HERO_RARITIES},
        },
    }


# ---------------------------------------------------------------- 御魂库存
def relic_sub_rolls(relic: dict) -> list[dict]:
    """副属性 + 强化次数（站点库存卡片显示的数字）。"""
    totals = (relic.get("enhancement") or {}).get("totals") or []
    result = []
    for index, item in enumerate(totals):
        if item.get("label") == (relic.get("mainAttribute") or {}).get("label"):
            continue
        result.append({
            "label": item.get("label"),
            "total": round(float(item.get("total") or 0), 2),
            "count": int(item.get("count") or 0),
        })
    result.sort(key=lambda item: -item["count"])
    return result


def relics_inventory(dataset: dict, *, position: int | None = None,
                     suit_names: list[str] | None = None,
                     main_attrs: list[str] | None = None,
                     sub_attrs: list[str] | None = None,
                     sort_by: str = "speed") -> dict:
    """对应「御魂库存」页的筛选 + 排序。"""
    items = []
    for pos_str, relics in dataset["relicsByPosition"].items():
        for relic in relics:
            if position is not None and int(pos_str) != int(position):
                continue
            if suit_names and (relic.get("suit") or {}).get("name") not in suit_names:
                continue
            if main_attrs and (relic.get("mainAttribute") or {}).get("label") not in main_attrs:
                continue
            if sub_attrs:
                labels = {item.get("label") for item in relic_sub_rolls(relic)}
                if not all(label in labels for label in sub_attrs):
                    continue
            items.append({
                "position": int(pos_str),
                "suitName": (relic.get("suit") or {}).get("name"),
                "mainAttribute": relic.get("mainAttribute"),
                "subAttributes": relic_sub_rolls(relic),
                "quality": relic.get("quality"),
                "level": relic.get("level"),
                "relicId": relic.get("relicId") or relic.get("id"),
            })

    def sort_key(item: dict):
        if sort_by == "speed":
            for sub in item["subAttributes"]:
                if sub["label"] == "速度":
                    return (-sub["total"], -sub["count"], item["relicId"] or "")
            return (1e9, 1e9, item["relicId"] or "")
        return (-len(item["subAttributes"]), item["relicId"] or "")

    items.sort(key=sort_key)
    by_position = Counter(int(item["position"]) for item in items)
    return {
        "total": sum(len(relics) for relics in dataset["relicsByPosition"].values()),
        "matched": len(items),
        "byPosition": {str(pos): by_position.get(pos, 0) for pos in range(1, 7)},
        "items": items,
    }
