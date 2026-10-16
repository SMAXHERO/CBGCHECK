#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_cbg.py — 数据管道入口：抓取藏宝阁数据 -> 规范化 -> 写入站点快照。

三种运行模式
------------
1. dry-run（默认，零依赖、不联网）
   直接复用工作区里已有的原始爬取结果，走一遍规范化流程，用来验证管道与前端。
       python tools/cbg/fetch_cbg.py --dry-run

2. live：借用已登录的浏览器查询（推荐，和 cbg-filter-kit 同一套机制）
   需要先在本机跑起 cbg-filter-kit 的本地服务（它负责用你的登录态发请求）：
       node cbg-filter-kit/src/server.mjs
   然后：
       python tools/cbg/fetch_cbg.py --live --params baseline_values.json

3. from-file：把一次手工查询的结果文件并入快照
       python tools/cbg/fetch_cbg.py --from-file out/query_result.json

合规提醒：仅抓取公开列表页的聚合信息，控制频率（间隔 ≥1.6s），不要用于商业用途或二次分发。

设计说明：本脚本只做「取数据」，不做「解析」——解析统一在 seed_web_data.py 里，
两条路径（dry-run / live）产出同一种结构，前端只认最终快照。
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

CST = timezone(timedelta(hours=8))
ROOT = Path(__file__).resolve().parents[2]
SEED = Path(__file__).resolve().parent / "seed_web_data.py"
OUT_DIR = ROOT / "cbg-web" / "public" / "data"
RAW_DIR = ROOT / "tools" / "cbg" / "raw"


def log(msg: str) -> None:
    print(f"[{datetime.now(CST).strftime('%H:%M:%S')}] {msg}", flush=True)


def run_seed(extra: list[str], label: str) -> int:
    """调用 seed_web_data.py 把原始数据规范化成站点快照。"""
    cmd = [sys.executable, str(SEED), "--root", str(ROOT)]
    for f in extra:
        cmd += ["--extra", f]
    log(f"规范化 {label}: {' '.join(extra) if extra else '(默认原始文件)'}")
    proc = subprocess.run(cmd, cwd=str(ROOT), check=False)
    return proc.returncode


def mode_dry_run() -> int:
    """不联网：用工作区已有原始数据跑通管道（CI 与首次部署用这个）。"""
    log("dry-run：使用工作区现有原始爬取结果，不发起任何网络请求")
    return run_seed([], "现有数据")


def mode_from_file(files: list[str]) -> int:
    """把手工查询产出的 JSON 并入快照。"""
    ok: list[str] = []
    for f in files:
        p = Path(f)
        if not p.is_absolute():
            p = ROOT / f
        if not p.exists():
            log(f"跳过：找不到 {p}")
            continue
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(CST).strftime("%Y%m%d-%H%M%S")
        dst = RAW_DIR / f"{p.stem}-{stamp}.json"
        dst.write_text(p.read_text(encoding="utf-8"), encoding="utf-8")
        # 存一份带时间戳的原始副本，便于回溯「这条数据是哪次抓的」
        ok.append(str(dst.relative_to(ROOT)))
        log(f"归档原始数据 -> {dst.relative_to(ROOT)}")
    if not ok:
        log("没有任何可用的输入文件")
        return 1
    return run_seed(ok, f"{len(ok)} 个文件")


def mode_live(params_file: str | None, panel: str, max_pages: int) -> int:
    """
    借用 cbg-filter-kit 的本地服务查询。

    为什么不在这个脚本里直接抓：列表接口要求登录态 + 请求签名，
    只有「页面自己发请求」才带得齐。所以这里只负责驱动本地服务。
    """
    values: dict = {"search_type": "role"}
    if params_file:
        p = Path(params_file)
        if not p.is_absolute():
            p = ROOT / p
        if p.exists():
            values = json.loads(p.read_text(encoding="utf-8"))
            log(f"载入查询条件：{p.name}（{len(values)} 个参数）")
        else:
            log(f"找不到条件文件 {p}，将使用默认条件")
    else:
        log("未指定条件文件，使用默认条件（search_type=role）")

    url = f"{panel.rstrip('/')}/api/search"
    log(f"POST {url}")
    try:
        # 用标准库发请求，不引入第三方依赖
        import urllib.request

        body = json.dumps({"values": values, "maxPages": max_pages}).encode("utf-8")
        req = urllib.request.Request(
            url, data=body, headers={"content-type": "application/json"}, method="POST"
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - 网络/服务未启动都归到这里
        log(f"查询失败：{exc}")
        log("请确认 cbg-filter-kit 已在运行：node cbg-filter-kit/src/server.mjs")
        log("并且已在它弹出的浏览器窗口里登录过藏宝阁。")
        return 2

    if not payload.get("ok"):
        err = payload.get("error")
        log(f"接口返回失败：{err} {payload.get('msg') or ''}")
        if err == "SESSION_TIMEOUT":
            log("→ 登录态失效，请在 cbg-filter-kit 的浏览器窗口里重新登录。")
        elif err == "CAPTCHA_AUTH":
            log("→ 触发安全验证，在那个窗口里打开一个商品页完成滑块后重试。")
        return 3

    rows = payload.get("rows") or []
    total = (payload.get("meta") or {}).get("total")
    log(f"取回 {len(rows)} 条（站点显示共 {total} 条）")
    if not rows:
        log("没有数据，跳过写快照")
        return 4

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(CST).strftime("%Y%m%d-%H%M%S")
    raw_path = RAW_DIR / f"live-{stamp}.json"
    raw_path.write_text(
        json.dumps({"meta": {"total_num": total}, "values": values, "rows": rows}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    log(f"原始结果 -> {raw_path.relative_to(ROOT)}")

    rc = run_seed([str(raw_path.relative_to(ROOT))], "live 结果")
    if rc == 0:
        log(f"完成。可在浏览器里预览：{OUT_DIR / 'listings.json'}")
    # 抓完歇一下，避免连续触发风控
    time.sleep(1.6)
    return rc


def main() -> int:
    ap = argparse.ArgumentParser(description="藏宝阁数据管道：抓取 -> 规范化 -> 站点快照")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="不联网，用现有原始数据跑通管道（默认）")
    mode.add_argument("--live", action="store_true", help="通过 cbg-filter-kit 本地服务实时查询")
    mode.add_argument("--from-file", nargs="+", metavar="JSON", help="把已有的查询结果文件并入快照")
    ap.add_argument("--params", help="live 模式的查询条件 JSON（如 baseline_values.json）")
    ap.add_argument("--panel", default="http://127.0.0.1:8791", help="cbg-filter-kit 服务地址")
    ap.add_argument("--max-pages", type=int, default=20, help="live 模式最多取几页（每页 15 条）")
    args = ap.parse_args()

    if args.from_file:
        return mode_from_file(args.from_file)
    if args.live:
        return mode_live(args.params, args.panel, args.max_pages)
    return mode_dry_run()


if __name__ == "__main__":
    raise SystemExit(main())
