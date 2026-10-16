#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_style_preview.py — 生成「网页样式示例」（单文件 HTML，零依赖，直接双击打开）。

目的：在动手写 React 之前，先把**视觉与交互**定下来。
它复刻 cbg-filter-kit/src/filter-panel.html 的设计令牌（深色、12px 圆角、#ff5a45 强调色），
并把你这次的新需求拼进来：

    左侧：筛选条件面板（分组折叠 + 已选角标 + 条件搜索 + 已选 chips + 底部操作条）
    右侧：查询结果展示（KPI 指标 + 价格分布/一速分段/价格×签到 三张图 + 账号明细表）

数据来自 public/data/listings.json（由 seed_web_data.py 从真实爬取结果生成）。

用法: python tools/cbg/make_style_preview.py
输出: cbg-web/style-preview.html
"""

from __future__ import annotations

import html
import json
import math
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "cbg-web" / "public" / "data" / "listings.json"
# 放在 public/design/ 下：既能在本地直接双击打开，也会被 vite 一起发布到 GitHub Pages，
# 方便以后随时回看「当初确认的样式」。
OUT_DIR = ROOT / "cbg-web" / "public" / "design"
OUT = OUT_DIR / "style-preview.html"

ACCENT = "#ff5a45"


# ----------------------------------------------------------------------------- 小工具
def esc(v) -> str:
    return html.escape("" if v is None else str(v))


def q(v) -> str:
    """价格：分 -> ¥x,xxx"""
    if v is None:
        return "-"
    return "¥" + format(round(v / 100), ",")


def n2(v) -> str:
    return "-" if v is None else f"{v:.2f}"


def quantile(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    pos = (len(sorted_vals) - 1) * p
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return sorted_vals[lo]
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def values(rows: list[dict], key: str) -> list[float]:
    return [r[key] for r in rows if isinstance(r.get(key), (int, float))]


def bars(counts: list[int], labels: list[str], tooltips: list[str]) -> str:
    """纯 CSS 柱状图：宽度按最大值归一，避免为了示例图引 ECharts。"""
    top = max(counts) if counts else 1
    cells = []
    for c, lab, tip in zip(counts, labels, tooltips):
        h = max(3, round(c / top * 100)) if top else 3
        cells.append(
            f'<div class="bar-col" title="{esc(tip)}">'
            f'<div class="bar-val">{c}</div>'
            f'<div class="bar-track"><div class="bar-fill" style="height:{h}%"></div></div>'
            f'<div class="bar-lab">{esc(lab)}</div></div>'
        )
    return f'<div class="bars">{"".join(cells)}</div>'


def hbars(items: list[tuple[str, int, str]]) -> str:
    """
    水平条：用于一速分段（标签较长，横着放更好读）。

    两个细节：
    - 计数写在**条形内部**，没有数据的档位直接降到 3% 宽度但仍显示「0」，
      一眼能看出「这个档位真的没有号」而不是渲染坏了；
    - 颜色按档位从暗到亮，158+ 用强调色收尾。
    """
    if not items:
        return '<div class="empty-tip">当前条件下没有数据</div>'
    top = max(v for _, v, _ in items) or 1
    out = []
    for label, cnt, color in items:
        w = max(3, round(cnt / top * 100))
        inside = w >= 14
        out.append(
            f'<div class="hbar-row" title="{esc(label)}：{cnt} 个账号">'
            f'<span class="hbar-lab">{esc(label)}</span>'
            f'<span class="hbar-track">'
            f'<span class="hbar-fill" style="width:{w}%;background:{color}">'
            + (f'<b class="hbar-in">{cnt}</b>' if inside else "")
            + "</span>"
            + ("" if inside else f'<b class="hbar-out">{cnt}</b>')
            + "</span></div>"
        )
    return "".join(out)


def donut(items: list[tuple[str, int]], size: int = 168) -> str:
    """SVG 环形图：stroke-dasharray 画弧，不引图表库。"""
    total = sum(v for _, v in items)
    if not total:
        return '<div class="empty-tip">当前条件下没有数据</div>'
    colors = ["#1677ff", "#34d07f", "#e5b567", "#b37feb", "#ff7875", "#36cfc9"]
    r = size / 2 - 14
    cx = cy = size / 2
    circ = 2 * math.pi * r
    segs = []
    offset = 0.0
    legend = []
    for i, (name, cnt) in enumerate(items):
        frac = cnt / total
        dash = circ * frac
        col = colors[i % len(colors)]
        segs.append(
            f'<circle cx="{cx}" cy="{cy}" r="{r:.1f}" fill="none" stroke="{col}" stroke-width="16" '
            f'stroke-dasharray="{dash:.2f} {circ - dash:.2f}" stroke-dashoffset="{-offset:.2f}" '
            f'transform="rotate(-90 {cx} {cy})" stroke-linecap="butt"/>'
        )
        offset += dash
        legend.append(
            f'<span class="lg-item"><i style="background:{col}"></i>{esc(name)}'
            f'<b>{cnt}</b><em>{frac * 100:.0f}%</em></span>'
        )
    return (
        f'<div class="donut-wrap"><svg width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
        f'{"".join(segs)}'
        f'<text x="{cx}" y="{cy - 2}" text-anchor="middle" fill="#e9ecf2" font-size="22" '
        f'font-weight="700">{total}</text>'
        f'<text x="{cx}" y="{cy + 15}" text-anchor="middle" fill="#8f99ab" font-size="10">账号</text>'
        f'</svg><div class="legend">{"".join(legend)}</div></div>'
    )


def nice_log_ticks(lo: float, hi: float) -> list[float]:
    """在 [lo, hi] 区间内生成 1-2-5 序列的对数刻度（价格轴只画 10 的幂会只剩一个标签）。"""
    ticks: list[float] = []
    exp = math.floor(math.log10(lo))
    while exp <= math.ceil(math.log10(hi)) + 1:
        for m in (1, 2, 5):
            v = m * 10**exp
            if lo <= v <= hi:
                ticks.append(v)
        exp += 1
    return sorted(set(ticks))


def scatter(rows: list[dict], w: int = 760, h: int = 215) -> str:
    """价格 × 签到年数（价格取对数）：SVG 圆点，带 hover 提示。"""
    pts = [
        (r["sign_days"] / 365, r["price"] / 100, r["title"], r.get("sanjian_speed"))
        for r in rows
        if r.get("sign_days") and r.get("price")
    ]
    if not pts:
        return '<div class="empty-tip">缺少签到天数或价格数据</div>'

    pad_l, pad_r, pad_t, pad_b = 46, 16, 14, 30
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    x_min, x_max = math.floor(min(xs)), math.ceil(max(xs))
    ly_min, ly_max = math.log10(max(100, min(ys) * 0.85)), math.log10(max(ys) * 1.1)

    def px(x: float) -> float:
        span = max(0.001, x_max - x_min)
        return pad_l + (x - x_min) / span * (w - pad_l - pad_r)

    def py(y: float) -> float:
        span = max(0.001, ly_max - ly_min)
        return h - pad_b - (math.log10(max(1, y)) - ly_min) / span * (h - pad_t - pad_b)

    grid = []
    # y 轴：1-2-5 对数刻度，保证几千到十几万都能看到若干条参考线
    for val in nice_log_ticks(10**ly_min, 10**ly_max):
        yy = py(val)
        lab = f"{val / 10000:g}万" if val >= 10000 else f"{val:,.0f}"
        grid.append(
            f'<line x1="{pad_l}" y1="{yy:.1f}" x2="{w - pad_r}" y2="{yy:.1f}" stroke="#232833"/>'
            f'<text x="{pad_l - 6}" y="{yy + 3:.1f}" text-anchor="end" fill="#626c7e" font-size="9">{lab}</text>'
        )
    # x 轴每年一条
    for yr in range(int(x_min), int(x_max) + 1):
        xx = px(yr)
        grid.append(f'<line x1="{xx:.1f}" y1="{pad_t}" x2="{xx:.1f}" y2="{h - pad_b}" stroke="#1e222b"/>')
        grid.append(
            f'<text x="{xx:.1f}" y="{h - pad_b + 13}" text-anchor="middle" fill="#626c7e" font-size="9">{yr}年</text>'
        )

    dots = []
    for x, y, title, spd in pts:
        tip = f"{title} ｜ 签到 {x * 365:.0f} 天 ｜ {q(y * 100)} ｜ 散件一速 {n2(spd)}"
        dots.append(
            f'<circle cx="{px(x):.1f}" cy="{py(y):.1f}" r="4.2" fill="{ACCENT}" fill-opacity=".62" '
            f'stroke="#0e1014" stroke-width="1"><title>{esc(tip)}</title></circle>'
        )
    axis = (
        f'<line x1="{pad_l}" y1="{h - pad_b}" x2="{w - pad_r}" y2="{h - pad_b}" stroke="#39414f"/>'
        f'<line x1="{pad_l}" y1="{pad_t}" x2="{pad_l}" y2="{h - pad_b}" stroke="#39414f"/>'
        f'<text x="{w / 2}" y="{h - 3}" text-anchor="middle" fill="#626c7e" font-size="9.5">签到年数</text>'
        f'<text x="12" y="{h / 2}" text-anchor="middle" fill="#626c7e" font-size="9.5" '
        f'transform="rotate(-90 12 {h / 2})">价格（对数）</text>'
    )
    return f'<svg class="scatter" viewBox="0 0 {w} {h}" width="100%" height="{h}">{"".join(grid)}{axis}{"".join(dots)}</svg>'


# ----------------------------------------------------------------------------- 左侧筛选面板
def opt(label: str, on: bool = False, more: bool = False) -> str:
    cls = "opt on" if on else ("opt more" if more else "opt")
    return f'<div class="{cls}">{esc(label)}</div>'


def field_number(label: str, symbol: str = "", placeholder: str = "不限", unit: str = "", meta: str = "") -> str:
    lab = ""
    if label:
        lab = f'<div class="flabel"><span class="t">{esc(label)}</span>'
        if symbol:
            lab += f'<span class="sym">{esc(symbol)}</span>'
        if meta:
            lab += f'<span class="meta">{esc(meta)}</span>'
        lab += "</div>"
    unit_html = f'<span class="unit">{esc(unit)}</span>' if unit else ""
    return f'<div class="field">{lab}<div class="row"><input class="num-in" placeholder="{esc(placeholder)}">{unit_html}</div></div>'


def field_switch(label: str, on: bool = False) -> str:
    return (
        f'<div class="field"><div class="sw-row"><div class="txt">{esc(label)}</div>'
        f'<div class="sw{" on" if on else ""}"></div></div></div>'
    )


def field_options(label: str, options: list[tuple[str, bool]], total: int | None = None, meta: str = "") -> str:
    pills = "".join(opt(t, on) for t, on in options)
    more = ""
    if total:
        more = f'<div class="row" style="margin-top:7px">{opt(f"展开 {total} 项", more=True)}</div>'
    lab = (
        f'<div class="flabel"><span class="t">{esc(label)}</span>'
        + (f'<span class="meta">{esc(meta)}</span>' if meta else "")
        + "</div>"
    )
    return f'<div class="field">{lab}<div class="row">{pills}</div>{more}</div>'


def card(label: str, fields: str, open_: bool = False, badge: int = 0) -> str:
    return (
        f'<div class="card{" open" if open_ else ""}">'
        f'<div class="card-head"><span class="chev"><svg width="13" height="13" viewBox="0 0 16 16">'
        f'<path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" '
        f'stroke-linecap="round" stroke-linejoin="round"/></svg></span>'
        f'<span class="nm">{esc(label)}</span>'
        f'<span class="badge{" show" if badge else ""}">{badge}</span></div>'
        f'<div class="card-body">{fields}</div></div>'
    )


def build_sidebar() -> str:
    """右侧面板结构照搬 filter-panel.html，内容取真实 schema 里的 6 个代表分组。"""
    srv = [
        "网易-相伴相随", "今时月", "音起时", "竹风夏意", "循光世", "春之樱(夜之月)",
        "网易-双平台", "全平台互通新区", "中国区-iOS", "夏之蝉", "秋之枫", "冬之雪",
    ]
    _ = srv  # 仅用于占位说明，实际分组在下方 srv-groups 里
    pick = {"网易-相伴相随", "今时月", "夏之蝉"}
    cards = []

    # 区服
    cards.append(
        card(
            "区服",
            '<div class="field"><div class="srv-chips">'
            + "".join(
                f'<span class="srv-chip">{esc(s)}<x>✕</x></span>' for s in sorted(pick)
            )
            + "</div>"
            '<input class="num-in" style="width:100%" placeholder="搜索服务器，例如「夏之蝉」">'
            '<div class="srv-groups show">'
            + "".join(
                f'<div class="srv-group"><div class="gt">{esc(g)} · {len(lst)}</div><div class="row">'
                + "".join(opt(s, s in pick) for s in lst)
                + "</div></div>"
                for g, lst in (
                    ("网易-双平台", ["网易-相伴相随", "网易-心意相通", "网易-双平台"]),
                    ("全平台互通新区", ["今时月", "音起时", "竹风夏意", "循光世", "鬼灭之刃"]),
                    ("中国区-iOS", ["春之樱(夜之月)", "夏之蝉", "秋之枫", "冬之雪"]),
                )
            )
            + "</div></div>",
            open_=True,
            badge=1,
        )
    )

    # 公示期
    cards.append(
        card(
            "公示期",
            field_options("公示期", [("只显示公示期", False), ("不显示公示期", True)], meta="最多1"),
            badge=1,
        )
    )

    # 价格
    cards.append(
        card(
            "价格(元)",
            '<div class="field"><div class="flabel"><span class="t">价格(元)</span>'
            '<span class="meta">×100 · 100~1000000</span></div>'
            '<div class="row"><input class="num-in" value="500" placeholder="最低"><span class="unit">~</span>'
            '<input class="num-in" value="1500" placeholder="最高"><span class="unit">元</span></div>'
            '<div class="row" style="margin-top:7px">'
            + opt("100～499") + opt("500~1999", True) + opt("2000~4999") + opt("5000以上")
            + "</div></div>",
            open_=True,
            badge=1,
        )
    )

    # 操作系统
    cards.append(
        card(
            "操作系统",
            field_options("操作系统", [("iOS（苹果手机）", False), ("Android（安卓手机）", True)]),
            badge=1,
        )
    )

    # 图鉴
    cards.append(
        card(
            "图鉴",
            field_switch("SSR全图鉴", True)
            + field_switch("SP全图鉴", True)
            + field_switch("UR全图鉴", True)
            + field_switch("联动全图鉴"),
            badge=3,
        )
    )

    # 式神
    cards.append(
        card(
            "式神",
            field_options(
                "式神",
                [("桃花妖", False), ("雪女", False), ("三尾狐", False), ("座敷童子", True), ("鲤鱼精", False), ("姑获鸟", True)],
                total=281,
                meta="可多选",
            )
            + field_switch("以上所选式神为6星")
            + field_number("6星式神数量", "≥", "不限"),
            badge=2,
        )
    )

    # 个人斗技
    cards.append(
        card(
            "个人斗技",
            field_number("段位", "≥", "不限")
            + field_number("积分", "≥", "不限")
            + '<div class="field"><div class="flabel"><span class="t">个满速御魂速度</span>'
            '<span class="meta">×100</span></div><div class="row">'
            '<input class="num-in" placeholder="个数"><span class="unit">个满速御魂 ≥</span>'
            '<input class="num-in" placeholder="速度"></div></div>'
            + field_number("散件一速", "≥", "不限", "0-162")
            + field_number("招财一速", "≥", "不限", "0-162")
            + field_number("头个数", "≥", "不限")
            + field_number("头速度", "≥", "不限", "0-17.5")
            + field_number("尾个数", "≥", "不限")
            + field_number("满速御魂数", "≥", "不限"),
            open_=True,
            badge=4,
        )
    )

    # 资产 / 皮肤 / 头像框 / 徽章 / 成就签到 —— 收起状态，只留角标
    cards.append(
        card(
            "资产",
            field_number("勾玉", "≥", "不限")
            + field_number("神秘符咒", "≥", "不限")
            + field_number("体力", "≥", "不限")
            + field_number("金币(万)", "≥", "不限", "万")
            + field_number("御行达摩", "≥", "不限")
            + field_switch("永久勾玉卡", True),
            badge=3,
        )
    )
    cards.append(
        card(
            "皮肤",
            field_number("式神皮肤总数", "", "不限")
            + field_number("典藏皮肤总数", "≥", "不限")
            + field_options("典藏皮肤", [("响魂醉曲", False), ("古桥水巷", True), ("化烟", True)], total=88)
            + field_number("风姿度", "≥", "不限"),
            badge=2,
        )
    )
    cards.append(
        card(
            "头像框",
            field_options("头像框", [("百鬼之主", False), ("大阴阳师", True), ("京都名士", False), ("战·百鬼之主", False)], total=18)
            + field_switch("京都之主(金达摩)"),
            badge=1,
        )
    )
    cards.append(card("徽章", field_options("徽章", [("秘闻·天下一", False), ("地域·天下一", True), ("馆主·博", False), ("终极之巅", True)]), badge=2))
    cards.append(
        card(
            "成就/签到",
            field_options("成就", [("征服世界", False), ("非洲·大阴阳师", False), ("阴阳师·大神", False), ("对弈竞猜·卓见", False)], total=4)
            + field_number("签到天数", "≥", "如 2000", "天")
            + field_number("等级（小于等于）", "≤", "不限"),
            badge=1,
        )
    )
    return "".join(cards)


# ----------------------------------------------------------------------------- 右侧结果区
def build_kpis(rows: list[dict]) -> str:
    prices = sorted(values(rows, "price"))
    spd = values(rows, "sanjian_speed")
    zc = values(rows, "zhaocai_speed")
    signs = values(rows, "sign_days")
    ssr = values(rows, "ssr")
    six = values(rows, "six_star")
    collects = values(rows, "collect_num")
    med = quantile(prices, 0.5)
    p25, p75 = quantile(prices, 0.25), quantile(prices, 0.75)
    fast = max(spd) if spd else None
    high = len([s for s in spd if s >= 158])

    items = [
        ("命中账号", str(len(rows)), f"累计收藏 {sum(collects)} 次"),
        ("价格中位数", q(med), f"区间 {q(prices[0])} ~ {q(prices[-1])}" if prices else ""),
        ("价格四分位", f"{q(p25)} ~ {q(p75)}", "P25 ~ P75 主流成交带"),
        ("最快散件一速", n2(fast), f"平均 {sum(spd) / len(spd):.2f} ｜ {high} 个 ≥158" if spd else ""),
        ("最快招财一速", n2(max(zc) if zc else None), f"平均 {sum(zc) / len(zc):.2f}" if zc else ""),
        ("平均签到", f"{round(sum(signs) / len(signs))} 天" if signs else "-", f"最长 {max(signs) / 365:.1f} 年" if signs else ""),
        ("SSR / 六星 均值", f"{round(sum(ssr) / len(ssr))} / {round(sum(six) / len(six))}" if ssr and six else "-", f"SSR 最高 {max(ssr) if ssr else '-'}"),
        ("高战号占比", f"{high / len(rows) * 100:.1f}%" if rows else "-", "散件一速 ≥ 158 的比例"),
    ]
    cells = "".join(
        f'<div class="kpi"><div class="k-lab">{esc(k)}</div><div class="k-val">{esc(v)}</div>'
        f'<div class="k-hint">{esc(h)}</div></div>'
        for k, v, h in items
    )
    return f'<div class="kpi-grid">{cells}</div>'


def build_table(rows: list[dict], limit: int = 26) -> str:
    head = (
        "<tr><th class='w-chk'><span class='chk'></span></th><th>账号</th><th class='num'>价格</th>"
        "<th>服务器 / 大区</th><th class='num'>散件一速</th><th class='num'>招财</th><th class='num'>头/尾</th>"
        "<th class='num'>头速度</th><th class='num'>签到</th><th class='num'>SSR</th><th class='num'>六星</th>"
        "<th class='num'>斗技</th><th class='num'>收藏</th><th>状态</th></tr>"
    )
    body = []
    for i, r in enumerate(rows[:limit]):
        checked = i in (1, 4, 7)
        fair = r.get("status") == 3
        tou = "-" if r.get("tou_num") is None else f'{r["tou_num"]}头{r.get("wei_num") or 0}尾'
        spd = r.get("sanjian_speed")
        spd_cls = "num hot" if spd is not None and spd >= 158 else "num"
        remain = r.get("expire_remain_seconds")
        remain_txt = f"{remain / 86400:.1f} 天" if remain else "-"
        url = f'https://yys.cbg.163.com/cgi/mweb/equip/{r.get("server_id")}/{r["id"]}'
        body.append(
            f'<tr class="{"sel" if checked else ""}">'
            f'<td class="w-chk"><span class="chk{" on" if checked else ""}"></span></td>'
            f'<td><a class="ttl" href="{url}" target="_blank" rel="noopener">{esc(r["title"])}'
            f'<svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">'
            f'<path d="M6 3h7v7M13 3 6 10"/></svg></a>'
            f'<span class="sn">{esc(r.get("order_sn", "")[-12:])}</span></td>'
            f'<td class="num price">{q(r.get("price"))}</td>'
            f'<td><span class="srv">{esc(r.get("server_name"))}</span><span class="area">{esc(r.get("area_name"))}</span></td>'
            f'<td class="{spd_cls}">{n2(spd)}</td>'
            f'<td class="num">{n2(r.get("zhaocai_speed"))}</td>'
            f'<td class="num">{esc(tou)}</td>'
            f'<td class="num">{n2(r.get("tou_speed"))}</td>'
            f'<td class="num">{esc(r.get("sign_days"))} 天</td>'
            f'<td class="num">{esc(r.get("ssr"))}</td>'
            f'<td class="num">{esc(r.get("six_star"))}</td>'
            f'<td class="num">{esc(r.get("pvp") or "-")}</td>'
            f'<td class="num">{esc(r.get("collect_num"))}</td>'
            f'<td><span class="tag{" fair" if fair else ""}">{esc(r.get("status_label"))}</span>'
            f'<span class="sn">剩余 {remain_txt}</span></td>'
            f"</tr>"
        )
    more = ""
    if len(rows) > limit:
        more = f'<div class="table-more">仅示例前 {limit} 条，共 {len(rows)} 条 · 完整版有分页与列排序</div>'
    return f'<table class="grid"><thead>{head}</thead><tbody>{"".join(body)}</tbody></table>{more}'


# ----------------------------------------------------------------------------- 主流程
def main() -> int:
    if not DATA.exists():
        raise SystemExit(f"找不到数据：{DATA}\n请先运行 python tools/cbg/seed_web_data.py")

    payload = json.loads(DATA.read_text(encoding="utf-8"))
    rows: list[dict] = payload["listings"]
    meta = payload.get("meta", {})
    generated = (meta.get("generated_at") or "").replace("T", " ")[:19]

    # ---- 图表数据 ----
    prices_yuan = sorted(v / 100 for v in values(rows, "price"))
    lo, hi = prices_yuan[0], prices_yuan[-1]
    bins = 8
    width = (hi - lo) / bins or 1
    counts = [0] * bins
    for p in prices_yuan:
        counts[min(bins - 1, int((p - lo) / width))] += 1
    labels, tips = [], []
    for i in range(bins):
        a, b = lo + width * i, lo + width * (i + 1)
        fmt = lambda v: f"{v / 10000:.1f}万" if v >= 10000 else f"{v:,.0f}"
        labels.append(f"{fmt(a)}~{fmt(b)}" if i < bins - 1 else f"{fmt(a)}~{fmt(hi)}")
        tips.append(f"¥{a:,.0f} ~ ¥{b:,.0f}：{counts[i]} 个账号")

    # 从暗到亮的灰阶，最后一档用强调色收尾：数据密集的档位一眼可见
    tiers = [("<150", 0, "#4a5262"), ("150~152", 0, "#5a6478"), ("152~154", 0, "#6b7488"),
             ("154~156", 0, "#7c88a0"), ("156~158", 0, "#8f9cb5"), ("158+", 0, ACCENT)]
    tier_list = [[name, 0, col] for name, _, col in tiers]
    for s in values(rows, "sanjian_speed"):
        for i in range(len(tier_list) - 1, -1, -1):
            edge = [0, 150, 152, 154, 156, 158][i]
            if s >= edge:
                tier_list[i][1] += 1
                break

    plat_map: dict[str, int] = {}
    for r in rows:
        key = {1: "iOS", 2: "安卓"}.get(r.get("platform_type"), "其他/未标注")
        plat_map[key] = plat_map.get(key, 0) + 1
    plat = sorted(plat_map.items(), key=lambda kv: -kv[1])

    # ---- 已选 chips（示例状态）----
    chips = [
        ("区服", "网易-相伴相随、今时月、夏之蝉"),
        ("公示期", "不显示公示期"),
        ("价格(元)", "500~1999"),
        ("操作系统", "Android（安卓手机）"),
        ("SSR全图鉴", ""),
        ("SP全图鉴", ""),
        ("UR全图鉴", ""),
        ("式神", "座敷童子、姑获鸟"),
        ("散件一速", "≥158"),
        ("招财一速", "≥155"),
        ("头个数", "≥4"),
        ("满速御魂数", "≥6"),
        ("永久勾玉卡", ""),
        ("典藏皮肤", "古桥水巷、化烟"),
        ("大阴阳师", ""),
        ("地域·天下一、终极之巅", ""),
    ]
    chip_html = "".join(
        f'<span class="chip"><span>{esc(k)}</span>' + (f" <b>{esc(v)}</b>" if v else "") + " <x>✕</x></span>"
        for k, v in chips
    )

    doc = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>藏宝阁数据面板 · 样式示例</title>
<style>
  :root{{
    color-scheme:dark;
    --bg:#0e1014; --surface:#161920; --surface-2:#1c2029; --surface-3:#232833;
    --border:#272c37; --border-soft:#1e222b;
    --text:#e9ecf2; --dim:#8f99ab; --faint:#626c7e;
    --accent:{ACCENT}; --accent-soft:rgba(255,90,69,.14);
    --ok:#34d07f; --warn:#e5b567; --link:#6aa9ff;
    --r:12px;
  }}
  *{{box-sizing:border-box}}
  html,body{{height:100%}}
  body{{margin:0;background:var(--bg);color:var(--text);
    font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,"Microsoft YaHei",sans-serif;
    -webkit-font-smoothing:antialiased}}
  button{{font:inherit;border:0;background:none;color:inherit;cursor:pointer}}
  input{{font:inherit}}
  a{{color:inherit}}
  ::-webkit-scrollbar{{width:9px;height:9px}}
  ::-webkit-scrollbar-thumb{{background:#2b313d;border-radius:99px}}
  ::-webkit-scrollbar-track{{background:transparent}}
  .num,.k-val,.hbar-val,.bar-val,.bar-lab{{font-variant-numeric:tabular-nums}}

  /* ---------- 顶栏 ---------- */
  header{{position:sticky;top:0;z-index:40;background:rgba(14,16,20,.93);
    backdrop-filter:saturate(140%) blur(12px);border-bottom:1px solid var(--border-soft)}}
  .head-in{{display:flex;align-items:center;gap:10px;padding:11px 16px;flex-wrap:wrap}}
  .head-in h1{{margin:0;font-size:15px;font-weight:650;letter-spacing:.2px;white-space:nowrap}}
  @media (max-width:760px){{
    .head-in{{padding:10px 14px;gap:8px}}
    .head-in h1{{font-size:14px}}
    .head-meta{{display:none}}
    .search-wrap{{order:9;flex:1 1 100%;max-width:none}}
  }}
  .pill-tag{{font-size:10px;color:var(--dim);border:1px solid var(--border);border-radius:99px;
    padding:1px 8px;line-height:16px}}
  .spacer{{flex:1}}
  .head-meta{{font-size:11.5px;color:var(--faint)}}
  .icon-btn{{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;color:var(--dim);transition:.15s}}
  .icon-btn:hover{{background:var(--surface-3);color:var(--text)}}
  .search-wrap{{position:relative;flex:1;max-width:320px}}
  .search-wrap svg{{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--faint);pointer-events:none}}
  .search-wrap input{{width:100%;padding:7px 10px 7px 30px;background:var(--surface);border:1px solid var(--border);
    border-radius:9px;color:var(--text);font-size:12.5px;transition:.15s}}
  .search-wrap input::placeholder{{color:var(--faint)}}
  .search-wrap input:focus{{outline:none;border-color:#3a4356;background:var(--surface-2)}}

  /* ---------- 已选 chips ---------- */
  .chips{{display:flex;gap:6px;overflow-x:auto;padding:0 16px 9px;scrollbar-width:none}}
  .chips::-webkit-scrollbar{{display:none}}
  .chip{{flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;padding:3px 8px 3px 10px;
    background:var(--surface-3);border:1px solid #2e3542;border-radius:99px;font-size:11.5px;white-space:nowrap}}
  .chip b{{font-weight:600;color:var(--text)}} .chip span{{color:var(--dim)}}
  .chip x{{color:var(--faint);font-style:normal;font-size:12px;line-height:1;cursor:pointer}}
  .chip x:hover{{color:var(--accent)}}

  /* ---------- 布局：左筛选 / 右数据 ---------- */
  .layout{{display:grid;grid-template-columns:364px minmax(0,1fr);gap:14px;
    padding:12px 16px 84px;max-width:2100px;margin:0 auto;align-items:start}}
  /* 左栏独立滚动并吸顶：筛选条件和结果表可以分别浏览，不用来回滚整页 */
  .side{{position:sticky;top:96px;max-height:calc(100vh - 176px);overflow:auto;
    padding-right:4px;scrollbar-width:thin}}
  .side::-webkit-scrollbar{{width:6px}}
  @media (max-width:1180px){{
    .layout{{grid-template-columns:1fr}}
    .side{{position:static;max-height:none;overflow:visible}}
  }}

  /* ---------- 面板卡片（原样复刻） ---------- */
  .card{{background:var(--surface);border:1px solid var(--border-soft);border-radius:var(--r);
    margin-bottom:8px;overflow:hidden;transition:border-color .15s}}
  .card.open{{border-color:var(--border)}}
  .card-head{{display:flex;align-items:center;gap:9px;padding:11px 13px;cursor:pointer;user-select:none}}
  .card-head:hover{{background:var(--surface-2)}}
  .chev{{color:var(--faint);transition:transform .18s;flex:0 0 auto;display:grid;place-items:center}}
  .card.open .chev{{transform:rotate(90deg);color:var(--dim)}}
  .card-head .nm{{flex:1;font-size:13px;font-weight:600;letter-spacing:.2px}}
  .badge{{min-width:18px;height:18px;padding:0 6px;border-radius:99px;background:var(--accent);color:#fff;
    font-size:10.5px;font-weight:600;line-height:18px;text-align:center;display:none}}
  .badge.show{{display:inline-block}}
  .card-body{{display:none;padding:2px 13px 13px}}
  .card.open .card-body{{display:block}}

  .field{{padding:10px 0;border-top:1px solid var(--border-soft)}}
  .field:first-child{{border-top:0}}
  .flabel{{display:flex;align-items:center;gap:7px;margin-bottom:8px}}
  .flabel .t{{font-size:12.5px;font-weight:600}}
  .flabel .sym{{color:var(--accent);font-weight:700;font-size:12px}}
  .flabel .meta{{font-size:10.5px;color:var(--faint);margin-left:auto;white-space:nowrap}}
  .row{{display:flex;flex-wrap:wrap;gap:7px;align-items:center}}
  .num-in{{width:96px;padding:7px 10px;background:var(--surface-2);border:1px solid var(--border);
    border-radius:8px;color:var(--text);font-size:12.5px;transition:.15s}}
  .num-in:focus{{outline:none;border-color:#3f4a5e;background:var(--surface-3)}}
  .num-in::placeholder{{color:var(--faint)}}
  .unit{{color:var(--faint);font-size:11.5px}}
  .opt{{padding:6px 11px;border-radius:8px;background:var(--surface-2);border:1px solid transparent;
    font-size:12px;color:#c8cfdb;transition:.13s;user-select:none;cursor:pointer}}
  .opt:hover{{border-color:#39414f;color:var(--text)}}
  .opt.on{{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}}
  .opt.more{{background:transparent;border:1px dashed #333c4b;color:var(--dim)}}
  .sw-row{{display:flex;align-items:center;gap:11px;cursor:pointer;padding:7px 10px;border-radius:9px;
    background:var(--surface-2);transition:.15s}}
  .sw-row:hover{{background:var(--surface-3)}}
  .sw-row .txt{{flex:1;font-size:12.5px}}
  .sw{{width:38px;height:21px;border-radius:99px;background:#39414f;position:relative;transition:background .18s;flex:0 0 auto}}
  .sw::after{{content:"";position:absolute;top:2px;left:2px;width:17px;height:17px;border-radius:50%;
    background:#fff;transition:left .18s}}
  .sw.on{{background:var(--ok)}} .sw.on::after{{left:19px}}
  .srv-chips{{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}}
  .srv-chip{{display:inline-flex;align-items:center;gap:6px;background:var(--surface-3);
    border:1px solid #2e3542;border-radius:8px;padding:4px 8px;font-size:11.5px}}
  .srv-chip x{{color:var(--faint);font-style:normal;cursor:pointer}}
  .srv-chip x:hover{{color:var(--accent)}}
  .srv-groups{{display:none;margin-top:9px;max-height:250px;overflow:auto}}
  .srv-groups.show{{display:block}}
  .srv-group{{margin-bottom:9px}}
  .srv-group .gt{{font-size:10.5px;color:var(--faint);letter-spacing:.4px;margin:0 0 6px 2px}}

  /* ---------- 右侧：数据区 ---------- */
  .panel{{background:var(--surface);border:1px solid var(--border-soft);border-radius:var(--r);
    margin-bottom:10px;overflow:hidden}}
  .panel-head{{display:flex;align-items:center;gap:9px;padding:11px 13px;border-bottom:1px solid var(--border-soft)}}
  .panel-head .t{{font-size:13px;font-weight:600}}
  .panel-head .s{{font-size:11px;color:var(--faint)}}
  .panel-body{{padding:12px 13px}}

  .kpi-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px}}
  .kpi{{background:var(--surface-2);border:1px solid var(--border-soft);border-radius:10px;padding:9px 11px}}
  .k-lab{{font-size:11px;color:var(--dim)}}
  .k-val{{font-size:19px;font-weight:700;letter-spacing:-.3px;margin-top:1px;color:#fff}}
  .k-hint{{font-size:10.5px;color:var(--faint);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}

  .charts{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}}
  .charts .full{{grid-column:1 / -1}}
  @media (max-width:900px){{.charts{{grid-template-columns:1fr}}}}
  .cbox{{background:var(--surface-2);border:1px solid var(--border-soft);border-radius:10px;padding:10px 12px}}
  .cbox h4{{margin:0 0 10px;font-size:12px;font-weight:600;color:#c8cfdb;display:flex;align-items:center;gap:6px}}
  .cbox h4 span{{font-size:10.5px;color:var(--faint);font-weight:400}}
  .empty-tip{{color:var(--faint);font-size:12px;padding:24px 0;text-align:center}}

  .bars{{display:flex;align-items:flex-end;gap:8px;height:170px}}
  .bar-col{{flex:1;display:flex;flex-direction:column;align-items:center;height:100%;gap:4px;cursor:default}}
  .bar-val{{font-size:10.5px;color:var(--dim)}}
  .bar-track{{flex:1;width:100%;display:flex;align-items:flex-end}}
  .bar-fill{{width:100%;background:linear-gradient(180deg,{ACCENT},#c53f2d);border-radius:4px 4px 0 0;transition:.2s}}
  .bar-col:hover .bar-fill{{filter:brightness(1.15)}}
  .bar-lab{{font-size:9.5px;color:var(--faint);white-space:nowrap;transform:scale(.94)}}

  .hbar-row{{display:flex;align-items:center;gap:9px;padding:5px 0}}
  .hbar-lab{{width:58px;font-size:11px;color:var(--dim);text-align:right;flex:0 0 auto}}
  .hbar-track{{flex:1;height:18px;background:#191d26;border-radius:5px;overflow:hidden;position:relative}}
  .hbar-fill{{display:block;height:100%;border-radius:5px;min-width:3px}}
  .hbar-in{{position:absolute;left:7px;top:0;line-height:18px;font-size:10.5px;color:#fff;font-weight:600}}
  .hbar-out{{position:absolute;left:7px;top:0;line-height:18px;font-size:10.5px;color:var(--faint);font-weight:600}}

  .donut-wrap{{display:flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:center}}
  .legend{{display:flex;flex-direction:column;gap:6px;font-size:11.5px}}
  .lg-item{{display:flex;align-items:center;gap:6px;color:var(--dim)}}
  .lg-item i{{width:8px;height:8px;border-radius:2px;display:inline-block}}
  .lg-item b{{color:var(--text);font-weight:600}}
  .lg-item em{{color:var(--faint);font-style:normal;font-size:10.5px}}

  /* ---------- 结果表 ---------- */
  .grid{{width:100%;border-collapse:collapse;font-size:12px}}
  .grid th{{position:sticky;top:0;background:#191d26;color:var(--dim);font-weight:600;font-size:11px;
    text-align:left;padding:8px 9px;border-bottom:1px solid var(--border);white-space:nowrap;z-index:1}}
  .grid td{{padding:8px 9px;border-bottom:1px solid var(--border-soft);vertical-align:middle;white-space:nowrap}}
  .grid tbody tr{{transition:background .12s}}
  .grid tbody tr:hover{{background:#1a1e27}}
  .grid tbody tr.sel{{background:rgba(255,90,69,.07)}}
  .grid .num{{text-align:right}}
  .grid .price{{color:#ff8b74;font-weight:700;font-size:13px}}
  .grid .hot{{color:var(--accent);font-weight:700}}
  .w-chk{{width:30px}}
  .chk{{display:inline-grid;place-items:center;width:14px;height:14px;border-radius:4px;
    border:1px solid #3b4352;background:var(--surface-2);cursor:pointer}}
  .chk.on{{background:var(--accent);border-color:var(--accent)}}
  .chk.on::after{{content:"";width:7px;height:4px;border-left:2px solid #fff;border-bottom:2px solid #fff;
    transform:rotate(-45deg) translate(1px,-1px)}}
  .ttl{{color:#e9ecf2;text-decoration:none;font-weight:600;display:inline-flex;align-items:center;gap:4px}}
  .ttl:hover{{color:var(--accent)}}
  .sn{{display:block;font-size:10.5px;color:var(--faint)}}
  .srv{{display:block;color:#d5dbe6}}
  .area{{display:block;font-size:10.5px;color:var(--faint)}}
  .tag{{font-size:10px;padding:2px 7px;border-radius:99px;background:var(--surface-3);color:var(--dim)}}
  .tag.fair{{background:rgba(229,181,103,.15);color:var(--warn)}}
  .table-more{{padding:9px 12px;font-size:11.5px;color:var(--faint);text-align:center}}

  /* 说明条：放在右侧内容流里，不再用浮层挡图表 */
  .callout{{display:flex;gap:9px;align-items:flex-start;background:var(--surface);
    border:1px solid var(--border-soft);border-left:3px solid var(--warn);border-radius:10px;
    padding:10px 13px;font-size:11.5px;color:var(--dim);line-height:1.7;margin-bottom:10px}}
  .callout b{{color:var(--warn)}}

  /* ---------- 底栏（原样复刻） ---------- */
  footer{{position:fixed;left:0;right:0;bottom:0;z-index:30;background:rgba(14,16,20,.94);
    backdrop-filter:blur(12px);border-top:1px solid var(--border);padding:10px 14px;
    display:flex;align-items:center;gap:8px}}
  .cnt{{font-size:12px;color:var(--dim);flex:1}}
  .cnt b{{color:var(--text);font-size:14px;font-weight:650}}
  .btn{{padding:9px 14px;border-radius:9px;font-size:12.5px;font-weight:600;transition:.15s;white-space:nowrap}}
  .btn-ghost{{background:var(--surface-2);color:var(--dim);border:1px solid var(--border)}}
  .btn-ghost:hover{{color:var(--text);border-color:#39414f}}
  .btn-primary{{background:var(--accent);color:#fff;box-shadow:0 2px 12px rgba(255,90,69,.22)}}
  .btn-primary:hover{{background:#ff6d5a}}
</style>
</head>
<body>

<header>
  <div class="head-in">
    <h1>藏宝阁数据面板</h1>
    <span class="pill-tag">阴阳师 · 角色</span>
    <div class="search-wrap">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
        <circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/>
      </svg>
      <input placeholder="搜索条件，例如「一速」「图鉴」「皮肤」">
    </div>
    <span class="spacer"></span>
    <span class="head-meta">共 {len(rows)} 条记录 ｜ 数据生成 {esc(generated)}</span>
    <button class="icon-btn" title="展开 / 收起全部分组">
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <path d="M3 6h10M3 10h10"/>
      </svg>
    </button>
  </div>
  <div class="chips">{chip_html}</div>
</header>

<div class="layout">
  <!-- ============ 左：筛选条件 ============ -->
  <div class="side">{build_sidebar()}</div>

  <!-- ============ 右：查询结果 ============ -->
  <div class="main">
    <div class="callout">
      <span>💡</span>
      <div><b>这是样式示例，不是最终版。</b>静态单文件、零依赖，数据取自已抓到的 {len(rows)} 条真实记录，
      图表为 CSS/SVG 手绘（正式版用 ECharts，支持点击联动筛选、缩放、导出图片）。
      样式对齐 <code>cbg-filter-kit</code> 的深色设计令牌（#ff5a45 强调色 / 12px 圆角 / 13px 正文）。
      确认后我按这套视觉实现 React + Vite + TypeScript 版本：真实排序分页、列筛选、对比清单、导出 Excel / CSV / 打印 PDF。</div>
    </div>

    {build_kpis(rows)}

    <div class="panel" style="margin-top:10px">
      <div class="panel-head">
        <span class="t">数据总览</span>
        <span class="s">价格分布 · 一速分段 · 平台占比 · 价格 × 签到</span>
      </div>
      <div class="panel-body">
        <div class="charts">
          <div class="cbox">
            <h4>价格分布 <span>共 {len(rows)} 条</span></h4>
            {bars(counts, labels, tips)}
          </div>
          <div class="cbox">
            <h4>散件一速分段 <span>≥158 有 {tier_list[-1][1]} 个</span></h4>
            {hbars([(t[0], t[1], t[2]) for t in tier_list])}
          </div>
          <div class="cbox">
            <h4>平台占比 <span>按操作系统</span></h4>
            {donut(plat, size=158)}
          </div>
          <div class="cbox full">
            <h4>价格 × 签到年数 <span>纵轴对数刻度 · 悬停看详情</span></h4>
            {scatter(rows)}
          </div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <span class="t">账号明细</span>
        <span class="s">命中 {len(rows)} 条 ｜ 点击行加入对比清单 ｜ 点标题跳藏宝阁</span>
      </div>
      <div style="overflow:auto;max-height:560px">
        {build_table(rows)}
      </div>
    </div>
  </div>
</div>

<footer>
  <div class="cnt">已选 <b>16</b> 项 ｜ 命中 <b>{len(rows)}</b> 条</div>
  <button class="btn btn-ghost">清空</button>
  <button class="btn btn-ghost">导出 Excel</button>
  <button class="btn btn-ghost">导出 CSV</button>
  <button class="btn btn-ghost">打印 / PDF</button>
  <button class="btn btn-primary">查询</button>
</footer>

<script>
  // 折叠交互：示例里保留真实手感（展开分组、勾选条件、开关）
  document.querySelectorAll('.card-head').forEach(h => h.onclick = () => h.parentElement.classList.toggle('open'));
  document.querySelectorAll('.opt').forEach(o => o.onclick = e => {{ e.stopPropagation(); o.classList.toggle('on'); }});
  document.querySelectorAll('.sw-row').forEach(s => s.onclick = () => s.querySelector('.sw').classList.toggle('on'));
  document.querySelectorAll('.chk').forEach(c => c.onclick = e => {{
    e.stopPropagation(); c.classList.toggle('on'); c.closest('tr').classList.toggle('sel');
  }});
  document.querySelectorAll('.chip x, .srv-chip x').forEach(x => x.onclick = e => {{
    e.stopPropagation(); x.closest('.chip, .srv-chip').remove();
  }});
</script>
</body>
</html>
"""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(doc, encoding="utf-8")
    # 同时留一份在工作区根目录，方便不进项目目录直接双击
    legacy = ROOT / "cbg-web" / "style-preview.html"
    legacy.write_text(doc, encoding="utf-8")
    print(f"[输出] {OUT}  ({len(doc) / 1024:.0f} KB, {len(rows)} 条记录)")
    print(f"[输出] {legacy}  (副本，便于直接打开)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
