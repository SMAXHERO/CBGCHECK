#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
parser.py —— 痒痒熊 (yyx) 2.0.1 数据格式解析器 / 校验器 / 统计器
================================================================

支持:
  * 完整版 yyx  (yyxDownload)       —— hero_equips[] 含 born/equip_id/lock/garbage/attrs/random_attr_rates
  * 简化版 yyx  (yyxSimplifyDownload) —— 只有 id/born/suit_id/kind/pos/quality/level/base_attr/
                                          random_attrs/single_attrs/score/zscore
  * 可选: 与 CBG raw equip_desc ({ordersn}.json，equip_desc 字段为嵌套 JSON 字符串) 逐件对照

核心还原结论 (详见 yyx-format.md / score-zscore.md / crosscheck.md):
  御魂副属性 value = MAX_ROLL[type] * Σ(该属性每次强化的"强化程度" rate)
  六星 MAX_ROLL: 攻击27 / 生命114 / 防御5 / 速度3 / 攻·生·防加成3% / 暴击3% /
                 暴击伤害4% / 效果命中4% / 效果抵抗4%    (rate ∈ [0.8, 1.0])
  => 可以由 value 反推出"该属性被强化了几次": rolls = round(value / MAX_ROLL)
  另: born = 御魂 id (24位 MongoDB ObjectId) 前 8 位十六进制 = Unix 秒

用法:
  python parser.py <yyx.json> [--json] [--cbg <equipdesc.json>] [--schema schema.json]

依赖: 仅标准库 (jsonschema 可选, 用于 --schema)
"""

import argparse
import collections
import json
import math
import os
import re
import sys

try:
    from jsonschema import Draft7Validator  # optional
    HAVE_JSONSCHEMA = True
except Exception:  # pragma: no cover
    HAVE_JSONSCHEMA = False

VERSION_PREFIX = "2.0."

# ---------------------------------------------------------------- constants
#: 六星御魂单次强化(1 roll)的满值 (rate=1 时的 value)。
#: 实测: value = MAX_ROLL[type] * Σ rate, rate ∈ [0.8, 1.0]，均值 0.9
MAX_ROLL = {
    "Attack": 27.0,
    "Hp": 114.0,
    "Defense": 5.0,
    "Speed": 3.0,
    "AttackRate": 0.03,
    "HpRate": 0.03,
    "DefenseRate": 0.03,
    "CritRate": 0.03,
    "CritPower": 0.04,
    "EffectHitRate": 0.04,
    "EffectResistRate": 0.04,
}
FLAT_ATTRS = ("Attack", "Hp", "Defense")

ATTR_LABEL = {  # yyx 英文 type -> 游戏内中文名
    "Attack": "攻击", "AttackRate": "攻击加成", "CritRate": "暴击", "CritPower": "暴击伤害",
    "Speed": "速度", "Hp": "生命", "HpRate": "生命加成", "Defense": "防御",
    "DefenseRate": "防御加成", "EffectHitRate": "效果命中", "EffectResistRate": "效果抵抗",
}
LABEL_ATTR = {v: k for k, v in ATTR_LABEL.items()}

#: CBG equip_desc 中 rattr 的属性 key -> yyx type
CBG_KEY2TYPE = {
    "attackAdditionVal": "Attack", "attackAdditionRate": "AttackRate",
    "maxHpAdditionVal": "Hp", "maxHpAdditionRate": "HpRate",
    "defenseAdditionVal": "Defense", "defenseAdditionRate": "DefenseRate",
    "speedAdditionVal": "Speed", "critRateAdditionVal": "CritRate",
    "critPowerAdditionVal": "CritPower", "debuffEnhance": "EffectHitRate",
    "debuffResist": "EffectResistRate",
}

#: 御魂套装 id -> 2件套属性类型 (来源: yuhuninfo chunk; 这里收录真实数据中出现的)
SUIT_TYPE = {
    300002: "防御加成", 300003: "生命加成", 300004: "攻击加成", 300006: "生命加成",
    300007: "暴击", 300008: "效果抵抗", 300009: "生命加成", 300010: "防御加成",
    300011: "防御加成", 300012: "攻击加成", 300013: "防御加成", 300014: "生命加成",
    300015: "生命加成", 300018: "攻击加成", 300019: "效果命中", 300020: "攻击加成",
    300021: "生命加成", 300022: "攻击加成", 300023: "防御加成", 300024: "生命加成",
    300026: "暴击", 300027: "攻击加成", 300029: "暴击", 300030: "暴击",
    300031: "暴击", 300032: "防御加成", 300033: "效果抵抗", 300034: "效果命中",
    300035: "防御加成", 300036: "暴击", 300039: "效果抵抗", 300048: "攻击加成",
    300049: "效果抵抗", 300050: "首领御魂", 300051: "首领御魂", 300052: "首领御魂",
    300053: "首领御魂", 300054: "首领御魂", 300055: "暴击", 300056: "攻击加成",
    300057: "效果命中", 300058: "生命加成", 300059: "效果抵抗", 300060: "防御加成",
    300073: "效果命中", 300074: "攻击加成", 300075: "暴击", 300076: "生命加成",
    300077: "首领御魂", 300079: "效果命中", 300080: "效果抵抗", 300081: "生命加成",
    300082: "攻击加成", 300083: "暴击", 300084: "防御加成", 300085: "防御加成",
    300086: "攻击加成", 300087: "生命加成", 300088: "暴击", 300089: "效果命中",
    300090: "效果抵抗", 300091: "首领御魂", 300092: "暴击伤害", 300093: "防御加成",
    300094: "星痕御魂", 300095: "星痕御魂", 300096: "星痕御魂", 300097: "星痕御魂",
    300098: "星痕御魂", 300099: "星痕御魂",
}
BOSS_SUIT_IDS = {300050, 300051, 300052, 300053, 300054, 300077, 300091}

POS_NAME = {0: "1号位", 1: "2号位", 2: "3号位", 3: "4号位", 4: "5号位", 5: "6号位"}

#: oneKeyCalcTeam chunk 中给出的"满收益"参考分
MAX_SCORE_NORMAL = 9   # 4条副属性 + 5次强化, 全部命中有效属性
MAX_SCORE_BOSS = 12    # 首领御魂(固有属性) +3

#: server-30aaffa2.js 中的"指标"公式 (客户端计算, indicator 字段)
#: value 单位与公式里的 2.7 / 3.6 对应: 速度2.7, 百分比2.7(即0.027), 暴伤/命中/抵抗3.6
INDICATOR_FORMULA = {
    "damage": "(Speed/2.7 + CritRate*100/2.7 + AttackRate*100/2.7 + CritPower*100/3.6)*100/9",
    "damageKq": "(Speed/2.7 + CritRate*100/2.7 + (AttackRate+EffectHitRate)*100/2.7 + CritPower*100/3.6)*100/9",
    "damageJ0": "(Speed/2.7 + AttackRate*100/2.7 + CritPower*100/3.6)*100/9",
    "speed": "Speed/2.7*100/6",
    "bra": "(Speed/2.7 + CritRate*100/2.7 + HpRate*100/2.7 + CritPower*100/3.6)*100/9",
    "fxxk": "(Speed/2.7 + EffectHitRate*100/3.6)*100/7",
    "defenseBra": "(Speed/2.7 + CritRate*100/2.7 + DefenseRate*100/2.7 + CritPower*100/3.6)*100/9",
}
#: 7 个指标各自对应的"有效属性集"
INDICATOR_SETS = {
    "damage": {"Speed", "CritRate", "AttackRate", "CritPower"},
    "damageKq": {"Speed", "CritRate", "AttackRate", "EffectHitRate", "CritPower"},
    "damageJ0": {"Speed", "AttackRate", "CritPower"},
    "speed": {"Speed"},
    "bra": {"Speed", "CritRate", "HpRate", "CritPower"},
    "fxxk": {"Speed", "EffectHitRate"},
    "defenseBra": {"Speed", "CritRate", "DefenseRate", "CritPower"},
}


# ---------------------------------------------------------------- helpers
def id_to_born(equip_id):
    """24 hex MongoDB ObjectId -> 前 4 字节时间戳 (Unix 秒)。"""
    try:
        return int(str(equip_id)[:8], 16)
    except Exception:
        return None


def display_value(attr_type, value):
    """按游戏内习惯格式化属性数值 (百分比保留 2 位, 固定值保留 2 位)。"""
    if value is None:
        return None
    if attr_type in ("AttackRate", "HpRate", "DefenseRate", "CritRate", "CritPower",
                     "EffectHitRate", "EffectResistRate"):
        return f"{value * 100:.2f}%"
    return f"{value:.2f}"


def est_rolls(value, attr_type):
    """由属性数值反推强化次数。

    推导: value = MAX_ROLL * Σrate,  rate ∈ [0.8,1.0] (均值 0.9)
      => 强化次数 n ≈ round(Σrate) ≈ round(value / (MAX_ROLL * 0.9))
    精确值应使用 CBG rattr 的条目数；本函数用于只有 yyx 文件时的估算
    (误差 ±1，n 越大越容易偏低/偏高)。
    """
    m = MAX_ROLL.get(attr_type)
    if not m or value is None:
        return None
    return max(1, int(round(value / (m * 0.9))))


def indicator_values(equip):
    """按 server chunk 的公式计算 7 个 'indicator' (0~100 的百分比)。"""
    val = {a["type"]: a["value"] for a in equip["random_attrs"]}
    def g(t):
        return val.get(t, 0.0)
    v = {
        "damage": (g("Speed") / 2.7 + g("CritRate") * 100 / 2.7 + g("AttackRate") * 100 / 2.7
                   + g("CritPower") * 100 / 3.6) * 100 / 9,
        "damageKq": (g("Speed") / 2.7 + g("CritRate") * 100 / 2.7
                     + (g("AttackRate") + g("EffectHitRate")) * 100 / 2.7
                     + g("CritPower") * 100 / 3.6) * 100 / 9,
        "damageJ0": (g("Speed") / 2.7 + g("AttackRate") * 100 / 2.7 + g("CritPower") * 100 / 3.6) * 100 / 9,
        "speed": g("Speed") / 2.7 * 100 / 6,
        "bra": (g("Speed") / 2.7 + g("CritRate") * 100 / 2.7 + g("HpRate") * 100 / 2.7
                + g("CritPower") * 100 / 3.6) * 100 / 9,
        "fxxk": (g("Speed") / 2.7 + g("EffectHitRate") * 100 / 3.6) * 100 / 7,
        "defenseBra": (g("Speed") / 2.7 + g("CritRate") * 100 / 2.7 + g("DefenseRate") * 100 / 2.7
                       + g("CritPower") * 100 / 3.6) * 100 / 9,
    }
    return {k: round(x, 4) for k, x in v.items()}


# ---------------------------------------------------------------- loader
class YyxParser:
    """加载 yyx 2.0.1 (完整版或简化版) 并归一化为统一结构。"""

    FULL_ONLY_FIELDS = ("equip_id", "lock", "garbage", "attrs", "random_attr_rates")

    def __init__(self, path, cbg_equip_desc=None):
        self.path = path
        self.warnings = []
        self.raw = self._load_json(path)
        self.cbg = self._load_cbg(cbg_equip_desc) if cbg_equip_desc else None
        self.meta = self._parse_meta()
        self.equips = [self._normalise(e) for e in self.raw.get("data", {}).get("hero_equips", [])]

    # -- io -----------------------------------------------------------
    @staticmethod
    def _load_json(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def _load_cbg(path):
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        ed = raw.get("equip_desc")
        if isinstance(ed, str):
            ed = json.loads(ed)
        return ed

    # -- structure ----------------------------------------------------
    def _parse_meta(self):
        d = self.raw
        meta = {"version": d.get("version"), "timestamp": d.get("timestamp"),
                "is_simpl": None, "data_keys": sorted(d.get("data", {}).keys())}
        if not str(meta["version"]).startswith(VERSION_PREFIX):
            self.warnings.append(f"version={meta['version']!r} 不是 2.0.x，解析结果可能不完整")
        eq = d.get("data", {}).get("hero_equips") or []
        present = set()
        for e in eq:
            present.update(e.keys())
        if not present:
            self.warnings.append("hero_equips 为空")
        meta["is_simpl"] = not (set(self.FULL_ONLY_FIELDS) & present)
        meta["attack_equip_fields"] = sorted(present & set(self.FULL_ONLY_FIELDS))
        for k in ("heroes", "realm_cards", "story_tasks", "hero_book_shards", "hero_equip_presets"):
            if not d.get("data", {}).get(k):
                meta.setdefault("empty_sections", []).append(k)
        return meta

    def _normalise(self, e):
        """原始 yyx 御魂 -> 统一结构 (含中文、展示值、强化次数估计)。"""
        base = e.get("base_attr") or {}
        random_attrs = []
        for a in e.get("random_attrs") or []:
            t = a.get("type")
            v = a.get("value", 0.0)
            random_attrs.append({
                "type": t,
                "label": ATTR_LABEL.get(t, t),
                "value": v,
                "display": display_value(t, v),
                "rolls_est": est_rolls(v, t),
            })
        single_attrs = []
        for a in e.get("single_attrs") or []:
            t = a.get("type")
            v = a.get("value", 0.0)
            single_attrs.append({"type": t, "label": ATTR_LABEL.get(t, t), "value": v,
                                 "display": display_value(t, v)})
        pos = e.get("pos")
        equip_id = e.get("id")
        out = {
            "id": equip_id,
            "born": e.get("born", id_to_born(equip_id)),
            "suit_id": e.get("suit_id"),
            "kind": e.get("kind"),
            "suit_type": SUIT_TYPE.get(e.get("suit_id"), "未知"),
            "is_boss_suit": e.get("suit_id") in BOSS_SUIT_IDS,
            "pos": pos,
            "pos_name": POS_NAME.get(pos, "?"),
            "quality": e.get("quality"),
            "level": e.get("level"),
            "base_attr": {
                "type": base.get("type"), "label": ATTR_LABEL.get(base.get("type"), base.get("type")),
                "value": base.get("value"), "display": display_value(base.get("type"), base.get("value")),
            },
            "random_attrs": random_attrs,
            "single_attrs": single_attrs,
            "score": e.get("score"),
            "zscore": e.get("zscore"),
            "rolls_total_est": sum(x["rolls_est"] or 0 for x in random_attrs),
            "indi": indicator_values(e) if random_attrs else {},
        }
        if self.meta.get("is_simpl") is False:
            out["equip_id"] = e.get("equip_id")
            out["lock"] = e.get("lock")
            out["garbage"] = e.get("garbage")
            out["random_attr_rates"] = e.get("random_attr_rates")
        # 若提供了 CBG 原始数据, 用 rattr 精确还原强化次数
        if self.cbg is not None:
            item = self.cbg.get("inventory", {}).get(equip_id)
            if item:
                rolls = collections.Counter()
                rate = collections.defaultdict(float)
                for k, r in item.get("rattr", []):
                    t = CBG_KEY2TYPE.get(k, k)
                    rolls[t] += 1
                    rate[t] += r
                out["rolls_exact"] = dict(rolls)
                out["roll_rate_sum"] = {k: round(v, 6) for k, v in rate.items()}
                out["cbg"] = {
                    "uuid": item.get("uuid"),
                    "itemId": item.get("itemId"),
                    "pos_1based": item.get("pos"),
                    "qua": item.get("qua"),
                    "suitid": item.get("suitid"),
                    "name": item.get("name"),
                    "level": item.get("level"),
                    "lock": item.get("lock"),
                    "single_attr": item.get("single_attr"),
                    "rattr_rolls": len(item.get("rattr", [])),
                }
        return out

    # -- export -------------------------------------------------------
    def to_dict(self):
        return {"meta": self.meta, "warnings": self.warnings,
                "equips": self.equips,
                "n": len(self.equips),
                "stats": self.stats()}

    # -- statistics ---------------------------------------------------
    def stats(self):
        eq = self.equips
        if not eq:
            return {}
        def d(vals, order=None):
            c = collections.Counter(vals)
            keys = order if order is not None else sorted(c, key=lambda x: (x is None, x))
            return {("None" if k is None else k): c[k] for k in keys if c.get(k)}

        score_dist = d([e["score"] for e in eq if e["score"] is not None])
        zscore_dist = d([round(e["zscore"], 1) for e in eq if e["zscore"] is not None])
        boss = [e for e in eq if e["single_attrs"]]
        return {
            "total": len(eq),
            "six_star": sum(1 for e in eq if e["quality"] == 6),
            "level15": sum(1 for e in eq if e["level"] == 15),
            "six_star_level15": sum(1 for e in eq if e["quality"] == 6 and e["level"] == 15),
            "quality_dist": d([e["quality"] for e in eq]),
            "level_dist": d([e["level"] for e in eq]),
            "pos_dist": d([e["pos_name"] for e in eq], order=[POS_NAME[i] for i in range(6)]),
            "suit_type_dist": d([e["suit_type"] for e in eq]),
            "top_kinds": collections.Counter(e["kind"] for e in eq).most_common(10),
            "boss_souls": len(boss),
            "score_dist": score_dist,
            "score_range": [min(score_dist, key=lambda k: int(k)) if score_dist else None,
                            max(score_dist, key=lambda k: int(k)) if score_dist else None],
            "score_neg1": sum(1 for e in eq if e["score"] == -1),
            "score_max": max((e["score"] for e in eq if e["score"] is not None), default=None),
            "zscore_dist": zscore_dist,
            "zscore_ge_score": sum(1 for e in eq if e["zscore"] is not None and e["score"] is not None
                                   and e["zscore"] >= e["score"]),
            "zscore_eq_score": sum(1 for e in eq if e["zscore"] is not None and e["score"] is not None
                                   and abs(e["zscore"] - e["score"]) < 1e-9),
            "base_attr_dist": d([e["base_attr"]["label"] for e in eq]),
            "random_attr_counts": collections.Counter(
                a["label"] for e in eq for a in e["random_attrs"]).most_common(),
            "avg_rolls_est": round(sum(e["rolls_total_est"] for e in eq) / len(eq), 3),
            "rolls_est_hist": d([e["rolls_total_est"] for e in eq]),
        }

    # -- validation ---------------------------------------------------
    def validate_schema(self, schema_path):
        if not HAVE_JSONSCHEMA:
            return {"ok": False, "error": "未安装 jsonschema (pip install jsonschema)"}
        with open(schema_path, "r", encoding="utf-8") as f:
            schema = json.load(f)
        v = Draft7Validator(schema)
        errors = []
        for err in v.iter_errors(self.raw):
            errors.append({"path": "/".join(str(p) for p in err.path), "message": err.message})
            if len(errors) >= 20:
                break
        return {"ok": not errors, "errors": errors}


# ---------------------------------------------------------------- printing
def print_report(parser):
    s = parser.stats()
    m = parser.meta
    print("=" * 78)
    print("痒痒熊 yyx 2.0.1 解析报告")
    print("=" * 78)
    print(f"文件        : {parser.path}")
    print(f"version     : {m['version']}   timestamp: {m['timestamp']}")
    print(f"格式        : {'简化版 (simplify)' if m['is_simpl'] else '完整版 (full)'}")
    print(f"data 字段   : {', '.join(m['data_keys'])}")
    for w in parser.warnings:
        print(f"[warning]   : {w}")
    if not s:
        print("没有御魂数据。")
        return
    print("-" * 78)
    print(f"御魂总数           : {s['total']}")
    print(f"六星 / 满级15      : {s['six_star']} / {s['level15']}  (六星满级 {s['six_star_level15']})")
    print(f"星级分布           : {s['quality_dist']}")
    print(f"等级分布           : {s['level_dist']}")
    print(f"位置分布           : {s['pos_dist']}")
    print(f"套装2件套类型      : {s['suit_type_dist']}")
    print(f"数量 Top 套装      : " + ", ".join(f"{k}×{v}" for k, v in s["top_kinds"]))
    print(f"首领御魂(固有属性) : {s['boss_souls']}")
    print(f"主属性类型分布     : {s['base_attr_dist']}")
    print("-" * 78)
    print(f"score 分布 (-1 表示未评定): {s['score_dist']}")
    print(f"score 范围 : {s['score_range']}   max={s['score_max']}   -1 数量={s['score_neg1']}")
    print("  [参考] 非首领御魂满分 9；首领御魂(含固有属性)满分 12；score = 有效属性成长次数")
    print(f"zscore 分布: {s['zscore_dist']}")
    print(f"zscore >= score : {s['zscore_ge_score']} / {s['total']}    zscore == score : {s['zscore_eq_score']}")
    print("-" * 78)
    print("副属性出现次数 Top: " + ", ".join(f"{k}×{v}" for k, v in s["random_attr_counts"][:12]))
    print(f"平均强化次数(由数值反推): {s['avg_rolls_est']}  (真实值: 4条属性=9, 3条=8, 2条=7)")
    print(f"反推强化次数分布        : {s['rolls_est_hist']}")
    # 分位置 score 均值
    bypos = collections.defaultdict(list)
    for e in parser.equips:
        if e["score"] is not None and e["score"] >= 0:
            bypos[e["pos_name"]].append(e["score"])
    print("各位置 score 均值: " + ", ".join(
        f"{k}={sum(v)/len(v):.2f}(n={len(v)})" for k, v in sorted(bypos.items())))
    # 示例
    print("-" * 78)
    print("御魂示例 (前 2 件):")
    for e in parser.equips[:2]:
        print(json.dumps(e, ensure_ascii=False, indent=1))


# ---------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser(description="痒痒熊 yyx 2.0.1 解析器")
    ap.add_argument("yyx", help="yyx json 文件 (完整版或简化版)")
    ap.add_argument("--json", action="store_true", help="输出归一化后的 JSON 而不是统计报告")
    ap.add_argument("--out", help="把 --json 的结果写入文件")
    ap.add_argument("--cbg", help="CBG raw equip_desc json (https://cbg-other-desc.res.netease.com/yys/static/equipdesc/{ordersn}.json)")
    ap.add_argument("--schema", help="用 schema.json 校验输入文件")
    args = ap.parse_args(argv)

    if not os.path.exists(args.yyx):
        print(f"文件不存在: {args.yyx}", file=sys.stderr)
        return 2
    parser = YyxParser(args.yyx, args.cbg)

    if args.schema:
        res = parser.validate_schema(args.schema)
        print("schema 校验:", "PASS" if res.get("ok") else "FAIL")
        if not res.get("ok"):
            print(json.dumps(res, ensure_ascii=False, indent=1)[:4000])

    if args.json:
        text = json.dumps(parser.to_dict(), ensure_ascii=False, indent=1)
        if args.out:
            with open(args.out, "w", encoding="utf-8") as f:
                f.write(text)
            print(f"wrote {args.out}  ({len(parser.equips)} equips)")
        else:
            print(text)
    else:
        print_report(parser)
        if args.out:
            with open(args.out, "w", encoding="utf-8") as f:
                json.dump(parser.to_dict(), f, ensure_ascii=False, indent=1)
            print(f"\n(归一化 JSON 已写入 {args.out})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
