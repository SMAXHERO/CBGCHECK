#!/usr/bin/env python3
"""
sync_servers.py — 从藏宝阁官方数据源同步区服列表到 cbg-web/public/data/servers.json

为什么需要它
------------
servers.json 是从 cbg-filter-kit 导出的**静态快照**。藏宝阁开新区时，
快照里没有新区服，界面就搜不到、也选不了。
藏宝阁自己的区服数据是公开的静态文件，可以直接拉取：

    https://cbg-yys.res.netease.com/js/server_list_data.js   标准通道，5 组
    https://cbg-yys.res.netease.com/js/server_list_data2.js  游戏内通道，多「中国-安卓联运」
    https://cbg-yys.res.netease.com/js/all_server_list2.js   全量（结构不同，备用）

这些地址来自站点配置 com_config.js 里的 ServerDataUrl / ServerDataUrl2 / ServerDataUrl3，
键名是 ServerDataKey: "serverid"。

文件结构（JS 变量赋值）：
    var server_data = {
      "1": [["网易-双平台", "2", "...", "wangyishuangpingtai", 1, "wyspt"],
            [[17, "网易-携手同心", "1", "wangyixieshoutongxin", "wyxstx", [1, 2]], ...]],
      ...
    }

输出结构与现有 servers.json 兼容（额外加一个 _meta 记录同步时间）：
    [{"groupId": "1", "group": "网易-双平台", "entry": [17, "网易-携手同心", ...]}, ...]

用法
----
    python tools/cbg/sync_servers.py              # 预览差异，不写文件
    python tools/cbg/sync_servers.py --write      # 写入 servers.json
    python tools/cbg/sync_servers.py --write --include-ingame   # 并入游戏内通道的额外分组
    python tools/cbg/sync_servers.py --check      # 只检查是否已过期（退出码 0=最新, 1=有差异）

约定：**只增不删**。站点下架的区服保留在文件里——
历史查询结果里可能还有它们的记录，删掉会导致旧数据无法解析出区服名。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "cbg-web" / "public" / "data" / "servers.json"

BASE = "https://cbg-yys.res.netease.com/js/"
SOURCES = {
    # 站点配置里的 ServerDataUrl：标准通道，与现有快照一致
    "standard": BASE + "server_list_data.js",
    # ServerDataUrl2：游戏内通道，多一个「中国-安卓联运」分组
    "ingame": BASE + "server_list_data2.js",
}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) cbg-panel-sync/1.0"


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def parse_server_data(text: str) -> dict[str, tuple[str, list[list]]]:
    """把 `var server_data = {...}` 解析成 {groupId: (组名, [entry, ...])}。"""
    m = re.search(r"server_data\s*=\s*(\{.*\})\s*;?\s*$", text, re.S)
    if not m:
        raise ValueError("找不到 server_data 变量赋值")
    data = json.loads(m.group(1))
    out: dict[str, tuple[str, list[list]]] = {}
    for gid, group in data.items():
        # 组结构：[组名, 平台, 混淆串, 拼音, 数字, 缩写]
        if not isinstance(group, list) or len(group) < 2:
            continue
        head, entries = group[0], group[1]
        gname = head[0] if isinstance(head, list) and head else str(head)
        if not isinstance(entries, list):
            continue
        out[str(gid)] = (str(gname), entries)
    return out


def load_current() -> list[dict]:
    if not TARGET.exists():
        return []
    return json.loads(TARGET.read_text(encoding="utf-8"))


def strip_meta(rows: list[dict]) -> list[dict]:
    return [r for r in rows if r.get("groupId") != "_meta"]


def main() -> int:
    ap = argparse.ArgumentParser(description="同步藏宝阁区服列表")
    ap.add_argument("--write", action="store_true", help="写入 servers.json（默认只预览）")
    ap.add_argument("--include-ingame", action="store_true", help="并入游戏内通道的额外分组")
    ap.add_argument("--check", action="store_true", help="只检查是否过期：0=最新 1=有差异")
    args = ap.parse_args()

    current = strip_meta(load_current())
    have: dict[int, str] = {r["entry"][0]: r["entry"][1] for r in current}
    print(f"现有快照: {len(current)} 个区服 / {len({r['groupId'] for r in current})} 个分组")

    merged: dict[str, tuple[str, list[list]]] = {}
    used: list[str] = []
    for label in ("standard", "ingame"):
        if label == "ingame" and not args.include_ingame:
            continue
        try:
            data = parse_server_data(fetch(SOURCES[label]))
        except Exception as e:  # 网络失败不该让脚本崩掉
            print(f"  [{label}] 拉取失败: {e}")
            continue
        used.append(label)
        for gid, (gname, entries) in data.items():
            if gid in merged:
                # 已有该分组：补进缺的条目（避免覆盖标准通道的顺序）
                exist = {e[0] for e in merged[gid][1] if isinstance(e, list) and e}
                merged[gid][1].extend(e for e in entries if isinstance(e, list) and e and e[0] not in exist)
            else:
                merged[gid] = (gname, [e for e in entries if isinstance(e, list) and e])
        cnt = sum(len(v[1]) for v in data.values())
        print(f"  [{label}] {SOURCES[label].split('/')[-1]} → {len(data)} 组 / {cnt} 个区服")

    if not merged:
        print("没有取到任何区服数据，未做改动。")
        return 2

    # 注意：区服 id 会重复出现在多个分组里（同一台服可同时属于「网易-双平台」和「全平台互通新区」），
    # 所以「条目数」和「去重 id 数」是两个不同的量，报告时要分开说，否则会看起来像数据丢失。
    live: dict[int, str] = {}
    for gid, (_gname, entries) in merged.items():
        for e in entries:
            live[e[0]] = e[1]
    live_entries = sum(len(entries) for _g, entries in merged.values())

    new_ids = sorted(k for k in live if k not in have)
    renamed = sorted(k for k in live if k in have and have[k] != live[k])
    only_local = sorted(k for k in have if k not in live)

    print()
    print(f"站点条目: {live_entries} 条（{len(merged)} 个分组，去重后 {len(live)} 个区服 id）")
    print(f"新增    : {len(new_ids)} 个" + ("  ← 需要同步" if new_ids else "  （已是最新）"))
    for k in new_ids:
        print(f"    + id={k:<5} {live[k]}")
    if renamed:
        print(f"改名    : {len(renamed)} 个")
        for k in renamed:
            print(f"    ~ id={k:<5} {have[k]} → {live[k]}")
    if only_local:
        print(f"仅本地有: {len(only_local)} 个（保留，不删除）")
        for k in only_local[:10]:
            print(f"    · id={k:<5} {have[k]}")

    if args.check:
        return 1 if (new_ids or renamed) else 0

    if not args.write:
        print()
        print("（预览模式，未写入。加 --write 才会写入 servers.json）")
        return 0

    # ---- 组装输出：保持现有分组顺序，新分组追加在后面 ----
    by_gid: dict[str, dict] = {}
    for r in current:
        by_gid.setdefault(r["groupId"], {"group": r["group"], "entries": []})["entries"].append(r["entry"])

    added_group = False
    for gid, (gname, entries) in merged.items():
        if gid not in by_gid:
            by_gid[gid] = {"group": gname, "entries": []}
            added_group = True
            print(f"  新分组: [{gid}] {gname}")

    # 用站点数据更新名称与条目（只增不删）
    for gid, (gname, entries) in merged.items():
        by_gid[gid]["group"] = gname
        seen = {e[0] for e in by_gid[gid]["entries"]}
        for e in entries:
            if e[0] not in seen:
                by_gid[gid]["entries"].append(e)
                seen.add(e[0])

    out: list[dict] = []
    for gid in sorted(by_gid, key=lambda x: int(x) if x.isdigit() else 999):
        g = by_gid[gid]
        for e in g["entries"]:
            out.append({"groupId": gid, "group": g["group"], "entry": e})

    now = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S %z")
    out.append({
        "groupId": "_meta",
        "group": "_meta",
        "entry": [],
        "syncedAt": now,
        "source": [SOURCES[s] for s in used],
        "serverCount": len(out) - 1,
        "note": "由 tools/cbg/sync_servers.py 生成；_meta 为元信息，不是区服",
    })

    TARGET.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print()
    print(f"已写入 {TARGET.relative_to(ROOT)}：{len(out) - 1} 个区服 / {len(by_gid)} 个分组"
          + ("（含新分组）" if added_group else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
