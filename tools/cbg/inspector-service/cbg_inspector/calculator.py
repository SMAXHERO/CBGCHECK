"""御魂组合搜索与面板计算（对应站点 worker 引擎 chunk 9854 导出的 QS）。

引擎关键公式（逐行对照 chunk 9854 的 pretty-engine.js）：

    单件贡献 = 主属性 + 全部副属性强化值 + (首领御魂自带属性 setBonusAttribute)
    2 件套属性 = 当某套装数量到 2 且该件没有首领属性时，按 static/relic-suits 的
                 套装属性文案（如 "攻击加成15%"）加入一次
    最终面板（eX）：
        attack   = base.attack  * (1 + attackPercent/100) + flatAttack
        health   = base.health  * (1 + healthPercent/100)  + flatHealth
        defense  = base.defense * (1 + defensePercent/100) + flatDefense
        speed    = base.speed + speed
        critRate = base.critRate  + critRate
        critDamage = base.critDamage + critDamage
        effectHit / effectResistance 同理
    评分（metric，对应 eZ）：
        damage        = attack * critDamage * 0.01      （PVE 伤害指标）
        healing       = health * critDamage * 0.01
        defenseOutput = defense * critDamage * 0.01
        其余直接取面板值

组合搜索：对六个号位各取一件（互不重复），满足套装/主属性/面板约束，
按 metric 排序返回前 N 条。搜索用「支配剪枝 + 分支限界」求精确最优，
与站点 worker 的穷举等价（站点内部也是 branch & bound）。
"""
from __future__ import annotations

import itertools

from .static import attr_key, load_static

METRICS = ("damage", "healing", "defenseOutput", "attack", "health", "defense",
           "speed", "critRate", "critDamage", "effectHit", "effectResistance", "hitResistance")

_DEFAULT_BASE = {"attack": 0, "health": 0, "defense": 0, "speed": 0, "critRate": 0,
                 "critDamage": 0, "effectHit": 0, "effectResistance": 0,
                 "attackPercent": 0, "healthPercent": 0, "defensePercent": 0}


def relic_contributions(relic: dict) -> dict[str, float]:
    """单件御魂贡献的属性（主属性 + 强化值 + 首领属性），键为引擎内部属性名。"""
    out: dict[str, float] = {}

    def add(label: str | None, value: float) -> None:
        key = attr_key(label or "")
        if key and value:
            out[key] = out.get(key, 0.0) + float(value)

    main = relic.get("mainAttribute") or {}
    add(main.get("label"), main.get("value") or 0)
    for item in (relic.get("enhancement") or {}).get("totals") or []:
        add(item.get("label"), item.get("total") or 0)
    set_bonus = relic.get("setBonusAttribute") or {}
    if set_bonus:
        add(set_bonus.get("label"), set_bonus.get("value") or 0)
    return out


def panel(base_stats: dict, relics: list[dict], suit_attributes: dict | None = None,
          extra_attributes: dict | None = None) -> dict:
    """按引擎 eX() 组装最终面板。"""
    if suit_attributes is None:
        suit_attributes = load_static()["suitAttributes"]

    base = dict(_DEFAULT_BASE)
    for key, value in (base_stats or {}).items():
        if key in base:
            try:
                base[key] = float(value or 0)
            except (TypeError, ValueError):
                base[key] = 0.0

    # 额外属性（eF）：百分比键叠加，固定值键直接加
    for key, value in (extra_attributes or {}).items():
        try:
            value = float(value or 0)
        except (TypeError, ValueError):
            continue
        if key in base:
            base[key] += value

    totals: dict[str, float] = {}
    suit_counts: dict[str, int] = {}
    for relic in relics:
        for key, value in relic_contributions(relic).items():
            totals[key] = totals.get(key, 0.0) + value
        suit = (relic.get("suit") or {}).get("name")
        if suit:
            suit_counts[suit] = suit_counts.get(suit, 0) + 1
            if suit_counts[suit] == 2 and not relic.get("setBonusAttribute"):
                attr = suit_attributes.get(suit)
                if attr and attr.get("key"):
                    totals[attr["key"]] = totals.get(attr["key"], 0.0) + float(attr["value"])

    attack_pct = base["attackPercent"] + totals.get("attackPercent", 0.0)
    health_pct = base["healthPercent"] + totals.get("healthPercent", 0.0)
    defense_pct = base["defensePercent"] + totals.get("defensePercent", 0.0)

    return {
        "attack": base["attack"] * (1 + attack_pct / 100.0) + totals.get("attack", 0.0),
        "health": base["health"] * (1 + health_pct / 100.0) + totals.get("health", 0.0),
        "defense": base["defense"] * (1 + defense_pct / 100.0) + totals.get("defense", 0.0),
        "speed": base["speed"] + totals.get("speed", 0.0),
        "critRate": base["critRate"] + totals.get("critRate", 0.0),
        "critDamage": base["critDamage"] + totals.get("critDamage", 0.0),
        "effectHit": base["effectHit"] + totals.get("effectHit", 0.0),
        "effectResistance": base["effectResistance"] + totals.get("effectResistance", 0.0),
        "attackPercent": attack_pct,
        "healthPercent": health_pct,
        "defensePercent": defense_pct,
        "flatAttack": totals.get("attack", 0.0),
        "flatHealth": totals.get("health", 0.0),
        "flatDefense": totals.get("defense", 0.0),
    }


def metric_value(panel_data: dict, metric: str) -> float:
    """eZ()：评分指标换算。"""
    if metric == "hitResistance":
        return panel_data["effectHit"] + panel_data["effectResistance"]
    if metric == "healing":
        return panel_data["health"] * panel_data["critDamage"] * 0.01
    if metric == "defenseOutput":
        return panel_data["defense"] * panel_data["critDamage"] * 0.01
    if metric == "damage":
        return panel_data["attack"] * panel_data["critDamage"] * 0.01
    return panel_data.get(metric, 0.0)


def _filter_relics(relics: list[dict], quality: int | None, level: int | None,
                   main_attributes: list[str] | None) -> list[dict]:
    out = []
    for relic in relics:
        if quality is not None and relic.get("quality") != quality:
            continue
        if level is not None and relic.get("level") != level:
            continue
        if main_attributes and (relic.get("mainAttribute") or {}).get("label") not in main_attributes:
            continue
        out.append(relic)
    return out


def _satisfies(panel_data: dict, constraints: dict | None) -> bool:
    for key, rule in (constraints or {}).items():
        if not isinstance(rule, dict):
            continue
        value = panel_data.get(key)
        if value is None:
            continue
        if rule.get("min") is not None and value < rule["min"]:
            return False
        if rule.get("max") is not None and value > rule["max"]:
            return False
    return True


def _pareto(pool: list[dict]) -> list[dict]:
    """支配剪枝：只保留 (攻击加成, 固定攻击, 暴击, 暴伤) 四维不被支配的御魂。"""
    scored = []
    for relic in pool:
        contrib = relic_contributions(relic)
        vec = (contrib.get("attackPercent", 0.0), contrib.get("attack", 0.0),
               contrib.get("critRate", 0.0), contrib.get("critDamage", 0.0))
        scored.append((relic, contrib, vec))
    scored.sort(key=lambda item: (-item[2][0], -item[2][1], -item[2][2], -item[2][3]))
    kept: list[tuple] = []
    for item in scored:
        dominated = False
        for other in kept:
            if (other[2][0] >= item[2][0] and other[2][1] >= item[2][1]
                    and other[2][2] >= item[2][2] and other[2][3] >= item[2][3]):
                dominated = True
                break
        if not dominated:
            kept.append(item)
    kept.sort(key=lambda item: -(item[2][0] * 30 + item[2][1] + item[2][3] * 5 + item[2][2] * 3))
    return kept


def search(relics_by_position: dict, base_stats: dict, *,
           metric: str = "damage",
           filters: dict | None = None,
           extra_attributes: dict | None = None,
           result_limit: int = 5,
           beam_width: int = 1200,
           max_candidates_per_slot: int = 14,
           suit_attributes: dict | None = None) -> list[dict]:
    """组合搜索，返回按 metric 降序的组合列表。

    filters 支持：
        quality, level, mainAttributes: {"2": [..], "4": [..], "6": [..]},
        requiredFourPiece: "狂骨", requiredTwoPieceNames: {"土蜘蛛"},
        panelConstraints: {"critRate": {"min": 100}}, fastMode
    beam_width / max_candidates_per_slot 为兼容参数，精确模式下不使用。
    """
    filters = filters or {}
    if suit_attributes is None:
        suit_attributes = load_static()["suitAttributes"]

    quality = filters.get("quality")
    level = filters.get("level")
    main_attrs = filters.get("mainAttributes") or {}
    required_four = filters.get("requiredFourPiece")
    required_two = set(filters.get("requiredTwoPieceNames") or [])
    constraints = filters.get("panelConstraints") or {}

    def pool_for(pos: int, suit: str | None) -> list[dict]:
        relics = _filter_relics(relics_by_position.get(str(pos)) or [],
                                quality, level, main_attrs.get(str(pos)))
        if suit is not None:
            relics = [r for r in relics if (r.get("suit") or {}).get("name") == suit]
        return relics

    assignments: list = [None]
    if required_four or required_two:
        two_name = next(iter(required_two)) if required_two else None
        assignments = [(four_positions, two_name)
                       for four_positions in itertools.combinations((1, 2, 3, 4, 5, 6), 4)]

    # 2 件套属性常量（四件套凑齐 4 件后固定加一次）
    extra_bonus: dict[str, float] = {}
    if required_four:
        attr = suit_attributes.get(required_four)
        if attr and attr.get("key"):
            extra_bonus = {attr["key"]: float(attr["value"])}

    base = dict(_DEFAULT_BASE)
    for key, value in (base_stats or {}).items():
        if key in base:
            try:
                base[key] = float(value or 0)
            except (TypeError, ValueError):
                base[key] = 0.0
    for key, value in (extra_attributes or {}).items():
        if key in base:
            base[key] += float(value or 0)
    # 目标函数用的基准面板：把「四件套的 2 件套属性」作为常量并入（与 panel() 一致）
    base_obj = dict(base)
    for key, value in extra_bonus.items():
        base_obj[key] = base_obj.get(key, 0.0) + value

    crit_min = ((constraints or {}).get("critRate") or {}).get("min")
    # 快速路径：伤害指标 + 仅暴击率约束时，用标量累加代替整面板构造
    fast_path = metric == "damage" and not [k for k in (constraints or {}) if k != "critRate"]
    base_attack = base_obj["attack"]
    base_attack_percent = base_obj.get("attackPercent", 0.0)
    base_flat = base_obj.get("flatAttack", 0.0)
    base_cd = base_obj["critDamage"]
    base_crit = base_obj["critRate"]

    def objective(ap: float, flat: float, crit_rate: float, crit_dmg: float,
                  cr_speed: float = 0.0) -> float:
        if fast_path:
            attack = base_attack * (1 + (ap + base_attack_percent) / 100.0) + base_flat + flat
            return attack * (base_cd + crit_dmg) / 100.0
        p = {
            "attack": base_obj["attack"] * (1 + (ap + base_obj["attackPercent"]) / 100.0)
            + base_obj.get("flatAttack", 0.0) + flat,
            "critRate": base_obj["critRate"] + crit_rate + cr_speed,
            "critDamage": base_obj["critDamage"] + crit_dmg,
            "health": base_obj["health"] * (1 + base_obj["healthPercent"] / 100.0) + base_obj.get("flatHealth", 0.0),
            "defense": base_obj["defense"] * (1 + base_obj["defensePercent"] / 100.0) + base_obj.get("flatDefense", 0.0),
            "speed": base_obj["speed"] + cr_speed,
            "effectHit": base_obj["effectHit"], "effectResistance": base_obj["effectResistance"],
        }
        return metric_value(p, metric)

    best: list[tuple[float, list[str], list[dict]]] = []
    seen: set[tuple[str, ...]] = set()

    def consider(relics: list[dict], value: float, crit_rate: float | None = None) -> None:
        if fast_path:
            # 只做必要的约束判断，面板留到入选后再构造
            if crit_min is not None and (base_crit + (crit_rate or 0.0)) < crit_min:
                return
            if len(best) >= result_limit and value <= best[min(len(best), result_limit) - 1][0]:
                return
        key = tuple(sorted(str(r.get("relicId")) for r in relics))
        if key in seen:
            return
        if not fast_path and not _satisfies(panel(base, relics, suit_attributes, extra_attributes), constraints):
            return
        seen.add(key)
        best.append((value, key, relics))
        best.sort(key=lambda item: -item[0])
        del best[result_limit * 4:]

    for assignment in assignments:
        if assignment is None:
            pools = {pos: _pareto(pool_for(pos, None)) for pos in range(1, 7)}
        else:
            four_positions, two_name = assignment
            pools = {}
            for pos in range(1, 7):
                suit = required_four if pos in four_positions else two_name
                pools[pos] = _pareto(pool_for(pos, suit))
        if not all(pools.values()):
            continue

        positions = [pos for pos in range(1, 7) if pools[pos]]
        positions.sort(key=lambda pos: len(pools[pos]))
        contribs = {pos: [c for _r, c, _v in pools[pos]] for pos in positions}
        relic_list = {pos: [r for r, _c, _v in pools[pos]] for pos in positions}

        # 后缀最大贡献（用于分支限界）
        suffix_max = {}
        acc = {"attackPercent": 0.0, "attack": 0.0, "critRate": 0.0, "critDamage": 0.0}
        for pos in reversed(positions):
            acc = {key: acc[key] + max(c.get(key, 0.0) for c in contribs[pos]) for key in acc}
            suffix_max[pos] = dict(acc)

        def dfs(index: int, ap: float, flat: float, crit_rate: float, crit_dmg: float,
                speed: float, chosen: list[str], chosen_relics: list[dict]) -> None:
            # 界：剩余号位全取最大值
            ub = 0.0
            feasible = crit_min is None or (base_obj["critRate"] + crit_rate
                                            + (suffix_max[positions[index]].get("critRate", 0.0)
                                               if index < len(positions) else 0.0)) >= crit_min
            if index < len(positions):
                rest = suffix_max[positions[index]]
                ub = objective(ap + rest.get("attackPercent", 0.0), flat + rest.get("attack", 0.0),
                               crit_rate + rest.get("critRate", 0.0),
                               crit_dmg + rest.get("critDamage", 0.0),
                               speed + rest.get("speed", 0.0))
            else:
                ub = objective(ap, flat, crit_rate, crit_dmg, speed)
            if index == len(positions):
                if feasible:
                    consider(chosen_relics, ub, crit_rate)
                return
            if not feasible and crit_min is not None:
                return
            if best and ub <= best[min(len(best), result_limit * 4) - 1][0] and len(best) >= result_limit:
                return
            pos = positions[index]
            for relic, contrib in zip(relic_list[pos], contribs[pos]):
                dfs(index + 1,
                    ap + contrib.get("attackPercent", 0.0),
                    flat + contrib.get("attack", 0.0),
                    crit_rate + contrib.get("critRate", 0.0),
                    crit_dmg + contrib.get("critDamage", 0.0),
                    speed + contrib.get("speed", 0.0),
                    chosen + [str(relic.get("relicId"))],
                    chosen_relics + [relic])

        dfs(0, 0.0, 0.0, 0.0, 0.0, 0.0, [], [])

    results = []
    for value, _key, relics in best[:result_limit]:
        panel_data = panel(base, relics, suit_attributes, extra_attributes)
        results.append({
            "score": metric_value(panel_data, metric),
            "panel": panel_data,
            "relics": relics,
            "suits": sorted({(r.get("suit") or {}).get("name") for r in relics}),
        })
    results.sort(key=lambda item: -item["score"])
    return results


def search_with_suits(dataset: dict, base_stats: dict, *,
                      four_piece: str | None = None,
                      oma_suit: str | None = None,
                      main_attrs: dict | None = None,
                      metric: str = "damage",
                      result_limit: int = 1,
                      suit_attributes: dict | None = None) -> dict | None:
    """PVE 便捷入口：固定 4 件套 + 2 件逢魔套，满暴约束，返回最优组合。

    站点 PVE 页请求里 ``suitTwoPieceAttributes`` 是空 Map（页面不启用两件套属性），
    因此这里默认也用空表，才能与页面面板数字对齐（如 狂骨 攻 11,078）。
    """
    filters = {
        "quality": 6,
        "level": 15,
        "mainAttributes": main_attrs or {},
        "panelConstraints": {"critRate": {"min": 100}},
        "fastMode": True,
    }
    if four_piece:
        filters["requiredFourPiece"] = four_piece
    if oma_suit:
        filters["requiredTwoPieceNames"] = {oma_suit}
    hits = search(dataset["relicsByPosition"], base_stats, metric=metric,
                  filters=filters, result_limit=result_limit,
                  suit_attributes=suit_attributes)
    return hits[0] if hits else None


def search_fast(relics_by_position: dict, base_stats: dict, *,
                metric: str = "damage",
                filters: dict | None = None,
                extra_attributes: dict | None = None,
                result_limit: int = 1,
                rounds: int = 30,
                branch: int = 18,
                suit_attributes: dict | None = None) -> list[dict]:
    """极速模式：贪心初始化 + 局部爬山 + 暴击修复 + 成对换装。

    对应站点计算器的「极速模式」。精确 DFS 在无套装约束时是 NP 组合问题，
    真实账号上要跑几分钟；这里用局部搜索在 0.1 秒级给出高质量近似解。
    """
    filters = filters or {}
    if suit_attributes is None:
        suit_attributes = load_static()["suitAttributes"]
    quality = filters.get("quality")
    level = filters.get("level")
    main_attrs = filters.get("mainAttributes") or {}
    required_four = filters.get("requiredFourPiece")
    required_two = set(filters.get("requiredTwoPieceNames") or [])
    constraints = filters.get("panelConstraints") or {}

    base = dict(_DEFAULT_BASE)
    for key, value in (base_stats or {}).items():
        if key in base:
            try:
                base[key] = float(value or 0)
            except (TypeError, ValueError):
                base[key] = 0.0
    for key, value in (extra_attributes or {}).items():
        if key in base:
            try:
                base[key] += float(value or 0)
            except (TypeError, ValueError):
                pass

    def pool_for(pos: int, suit: str | None) -> list[dict]:
        relics = _filter_relics(relics_by_position.get(str(pos)) or [],
                                quality, level, main_attrs.get(str(pos)))
        if suit is not None:
            relics = [r for r in relics if (r.get("suit") or {}).get("name") == suit]
        return relics

    def score(relics: list[dict]) -> tuple[int, float]:
        data = panel(base, relics, suit_attributes, extra_attributes)
        ok = 1 if _satisfies(data, constraints) else 0
        value = metric_value(data, metric) if ok else data.get("critRate", 0.0)
        return ok, value

    contribs: dict[str, dict] = {}

    def contrib_of(relic: dict) -> dict:
        key = str(relic.get("relicId"))
        data = contribs.get(key)
        if data is None:
            data = relic_contributions(relic)
            contribs[key] = data
        return data

    attack0 = base["attack"]
    crit_dmg0 = base["critDamage"]

    def proxy(relic: dict) -> float:
        c = contrib_of(relic)
        if metric == "damage":
            attack = attack0 * (1 + (base["attackPercent"] + c.get("attackPercent", 0.0)) / 100.0) + c.get("attack", 0.0)
            return attack * (crit_dmg0 + c.get("critDamage", 0.0))
        if metric == "healing":
            health = base["health"] * (1 + (base["healthPercent"] + c.get("healthPercent", 0.0)) / 100.0) + c.get("health", 0.0)
            return health * (crit_dmg0 + c.get("critDamage", 0.0))
        if metric == "defenseOutput":
            defense = base["defense"] * (1 + (base["defensePercent"] + c.get("defensePercent", 0.0)) / 100.0) + c.get("defense", 0.0)
            return defense * (crit_dmg0 + c.get("critDamage", 0.0))
        return metric_value(panel(base, [relic], suit_attributes, extra_attributes), metric)

    assignments = [None]
    if required_four or required_two:
        two_name = next(iter(required_two)) if required_two else None
        assignments = [(four_positions, two_name)
                       for four_positions in itertools.combinations((1, 2, 3, 4, 5, 6), 4)]

    results: list[tuple[float, tuple[str, ...], list[dict]]] = []
    seen: set[tuple[str, ...]] = set()

    for assignment in assignments:
        pools: dict[int, list[dict]] = {}
        if assignment is None:
            for pos in range(1, 7):
                pools[pos] = sorted(pool_for(pos, None), key=proxy, reverse=True)
        else:
            four_positions, two_name = assignment
            for pos in range(1, 7):
                suit = required_four if pos in four_positions else two_name
                pools[pos] = sorted(pool_for(pos, suit), key=proxy, reverse=True)
        if not all(pools.values()):
            continue

        cands = {pos: pool[:140] for pos, pool in pools.items()}
        crit_cands = {
            pos: sorted(pool, key=lambda r: contrib_of(r).get("critRate", 0.0), reverse=True)[:24]
            for pos, pool in pools.items()
        }
        natural_order = sorted(pools, key=lambda pos: len(cands[pos]))

        def climb(start: dict[int, dict], candidates: dict[int, list[dict]],
                  order: list[int]) -> tuple[dict[int, dict], tuple[int, float]]:
            current = dict(start)
            current_score = score(list(current.values()))
            for _ in range(rounds):
                improved = False
                for pos in order:
                    rest = [r for key, r in current.items() if key != pos]
                    local_best = current[pos]
                    local_state = current_score
                    for relic in candidates[pos][:branch]:
                        if relic is current[pos]:
                            continue
                        state = score(rest + [relic])
                        if state > local_state:
                            local_state, local_best = state, relic
                    if local_best is not current[pos]:
                        current[pos] = local_best
                        current_score = local_state
                        improved = True
                if not improved:
                    break
            return current, current_score

        def solve(order: list[int]) -> tuple[dict[int, dict], tuple[int, float]]:
            greedy: dict[int, dict] = {}
            state = (-1, -1.0)
            for pos in order:
                best_relic = None
                for relic in cands[pos]:
                    trial_state = score(list(greedy.values()) + [relic])
                    if trial_state > state:
                        state, best_relic = trial_state, relic
                greedy[pos] = best_relic
            chosen, chosen_score = climb(greedy, cands, order)
            data = panel(base, list(chosen.values()), suit_attributes, extra_attributes)
            if constraints and not _satisfies(data, constraints):
                for _ in range(14):
                    data = panel(base, list(chosen.values()), suit_attributes, extra_attributes)
                    if _satisfies(data, constraints):
                        break
                    improved = False
                    for pos in order:
                        rest = [r for key, r in chosen.items() if key != pos]
                        local_best = chosen[pos]
                        local_state = score(rest + [chosen[pos]])
                        for relic in crit_cands[pos]:
                            if relic is chosen[pos]:
                                continue
                            trial_state = score(rest + [relic])
                            if trial_state > local_state:
                                local_state, local_best = trial_state, relic
                        if local_best is not chosen[pos]:
                            chosen[pos] = local_best
                            improved = True
                    if not improved:
                        break
                chosen, chosen_score = climb(chosen, cands, order)
            return chosen, chosen_score

        best: tuple[dict[int, dict], tuple[int, float]] | None = None
        for order in (natural_order, list(reversed(natural_order)), sorted(pools)):
            candidate_chosen, candidate_score = solve(order)
            data = panel(base, list(candidate_chosen.values()), suit_attributes, extra_attributes)
            if not _satisfies(data, constraints):
                continue
            if best is None or candidate_score > best[1]:
                best = (candidate_chosen, candidate_score)
        if best is None:
            continue

        chosen = dict(best[0])
        current_score = best[1]
        for _ in range(3):
            improved = False
            for pos_a, pos_b in itertools.combinations(sorted(chosen), 2):
                rest = [r for key, r in chosen.items() if key not in (pos_a, pos_b)]
                local_state = current_score
                local_pair = (chosen[pos_a], chosen[pos_b])
                for relic_a in cands[pos_a][:24]:
                    for relic_b in cands[pos_b][:24]:
                        if relic_a is local_pair[0] and relic_b is local_pair[1]:
                            continue
                        trial_state = score(rest + [relic_a, relic_b])
                        if trial_state > local_state:
                            local_state, local_pair = trial_state, (relic_a, relic_b)
                if local_pair[0] is not chosen[pos_a]:
                    chosen[pos_a], chosen[pos_b] = local_pair
                    current_score = local_state
                    improved = True
            if not improved:
                break

        relics = [chosen[pos] for pos in sorted(chosen)]
        data = panel(base, relics, suit_attributes, extra_attributes)
        if not _satisfies(data, constraints):
            continue
        key = tuple(sorted(str(r.get("relicId")) for r in relics))
        if key in seen:
            continue
        seen.add(key)
        results.append((metric_value(data, metric), key, relics))

    results.sort(key=lambda item: -item[0])
    out = []
    for value, _key, relics in results[:result_limit]:
        data = panel(base, relics, suit_attributes, extra_attributes)
        out.append({
            "score": metric_value(data, metric),
            "panel": data,
            "relics": relics,
            "suits": sorted({(r.get("suit") or {}).get("name") for r in relics}),
        })
    return out
