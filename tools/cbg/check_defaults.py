#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
check_defaults.py — 核对默认条件：字段定位、倍率、最终接口参数。

默认条件从 src/config/defaults.ts **直接解析**，不在这里再抄一份。
（抄一份的老做法会过期：代码里改了默认条件，这个脚本还报旧值，等于白核对。）

用法：
    python tools/cbg/check_defaults.py

它能发现这些问题：
    · 分组名 / 条件名写错（filters.json 里找不到）
    · 倍率没按 valueMultiply 换算（价格、一速这类 ×100 的字段）
    · 落到错误的字段上（打印出实际命中的分组下标 + 字段下标 + 接口字段名）
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # tools/cbg/ 往上两层才是工作区根
SCHEMA = ROOT / "cbg-web" / "public" / "data" / "filters.json"
DEFAULTS_TS = ROOT / "cbg-web" / "src" / "config" / "defaults.ts"
LISTINGS = ROOT / "cbg-web" / "public" / "data" / "listings.json"


def parse_defaults_ts(path: Path) -> list[dict]:
    """从 defaults.ts 里把 DEFAULT_CONDITIONS 数组解析出来。

    只做「够用」的解析：找 section / label / value 三个字段。
    value 可能是字符串、数组或对象字面量。
    """
    text = path.read_text(encoding="utf-8")
    start = text.index("export const DEFAULT_CONDITIONS")
    body = text[start:]
    end = body.index("];")
    body = body[:end]

    items = []
    for block in re.findall(r"\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}", body):
        sec = re.search(r"section:\s*'((?:[^'\\]|\\.)*)'", block)
        lab = re.search(r"label:\s*'((?:[^'\\]|\\.)*)'", block)
        val = re.search(r"value:\s*(.+?),\s*\n\s*note:", block, re.S)
        if not (sec and lab and val):
            continue
        raw = val.group(1).strip()
        # 字符串字面量
        m_str = re.fullmatch(r"'((?:[^'\\]|\\.)*)'", raw)
        if m_str:
            value = m_str.group(1)
        else:
            # 对象/数组字面量：TS 里键名不带引号，先补上引号再当 JSON 解析
            normalized = raw.replace("'", '"')
            normalized = re.sub(r"([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', normalized)
            try:
                value = json.loads(normalized)
            except Exception:
                value = raw  # 解析不了就原样留着，报告里会显示出来
        items.append({"section": sec.group(1), "label": lab.group(1), "value": value})
    return items


def main() -> int:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    secs = schema["sections"]
    defaults = parse_defaults_ts(DEFAULTS_TS)

    print(f"schema   : {len(secs)} 组 / {sum(len(x['fields']) for x in secs)} 字段")
    print(f"默认条件 : {len(defaults)} 条（解析自 {DEFAULTS_TS.relative_to(ROOT)}）\n")

    params: dict[str, str] = {"search_type": "role"}
    missing: list[str] = []
    local_keys: list[str] = []

    # 本地有判定函数的参数（见 src/utils/predicate.ts 的 PREDICATES）
    LOCAL = {
        "price", "price_min", "price_max",
        "max_sanjian_speed", "max_zhaocai_speed", "tou_speed",
        "wei_speed", "tou_counts", "wei_counts", "six_star_num", "sign_days",
        "pvp_score", "pvp_stage", "collect_num", "equip_level", "serverid", "platform_type",
    }

    for d in defaults:
        sec, lab, value = d["section"], d["label"], d["value"]
        si = next((i for i, x in enumerate(secs) if x["label"] == sec), -1)
        if si < 0:
            print(f"  ✗ 找不到分组「{sec}」")
            missing.append(f"{sec}（分组不存在）")
            continue
        fi = next((i for i, f in enumerate(secs[si]["fields"])
                   if (f.get("label") or f.get("key")) == lab), -1)
        if fi < 0:
            names = "、".join((f.get("label") or f.get("key") or "?") for f in secs[si]["fields"])
            print(f"  ✗ 分组「{sec}」里找不到条件「{lab}」；该分组实际有：{names}")
            missing.append(f"{sec} · {lab}（字段不存在）")
            continue

        f = secs[si]["fields"][fi]
        mult = f.get("valueMultiply") or 1
        key = f.get("key") or ""
        kind = f.get("type")
        mark = "✓"
        print(f"  {mark} {sec} · {lab}")
        print(f"      定位 分组[{si}] 字段[{fi}] id={si}_{fi}   接口字段 {key} ({kind}) 倍率 {mult}")

        # 复现 buildParams 的换算
        if isinstance(value, dict):
            for k in ("min", "max"):
                v = value.get(k)
                if v not in (None, ""):
                    params[f"{key}_{k}"] = str(int(float(v) * mult))
        elif isinstance(value, list):
            params[key] = ",".join(str(x) for x in value)
        else:
            if kind in ("checkbox", "check_box"):
                params[key] = str(f.get("checkboxValue") or value or "1")
            else:
                try:
                    params[key] = str(int(float(value) * mult))
                except (TypeError, ValueError):
                    params[key] = str(value)

        for pk in (f"{key}_min", f"{key}_max", key):
            if pk in params and pk in LOCAL:
                local_keys.append(pk)
        print()

    print("最终提交给藏宝阁的接口参数：")
    print(json.dumps(params, ensure_ascii=False, indent=2))

    unsupported = [k for k in params if k != "search_type" and k not in LOCAL]
    print()
    print("本地可核对的参数（表格里有该字段，能排序/复筛）：")
    print("  " + ("、".join(sorted(set(local_keys))) or "（无）"))
    print()
    print("服务端筛选但本地无字段的参数（站点会据此筛，但列表接口不返回该值）：")
    print("  " + ("、".join(sorted(unsupported)) or "（无）"))

    # 快照对照（快照不是主数据源，仅用于确认换算对不对）
    if LISTINGS.exists():
        rows = json.loads(LISTINGS.read_text(encoding="utf-8"))["listings"]
        lo = int(params.get("price_min", 0)) / 100
        hi = int(params.get("price_max", 10 ** 9)) / 100
        speed = int(params.get("max_sanjian_speed", 0)) / 100
        hit_price = [r for r in rows if r.get("price") and lo <= r["price"] / 100 <= hi]
        hit_speed = [r for r in hit_price if (r.get("sanjian_speed") or 0) >= speed]
        print()
        print(f"快照对照（{len(rows)} 条，仅用于确认换算对不对）：")
        print(f"  价格 {lo:g}~{hi:g} 元        -> {len(hit_price)} 条")
        print(f"  再加 散件一速 >= {speed:g}   -> {len(hit_speed)} 条")
        print("  其余条件依赖列表接口不返回的字段，快照里无法核对（属正常）")

    if missing:
        print()
        print(f"⚠ {len(missing)} 条默认条件有问题：")
        for m in missing:
            print("   - " + m)
        return 1
    print()
    print(f"全部 {len(defaults)} 条默认条件都能对上字段。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
