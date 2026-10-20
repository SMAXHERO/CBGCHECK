#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
痒痒鼠魔方 / yys照妖镜 调用链客户端
====================================

逆向自 http://91zhaoyaojing.com（前端）与 http://api.yyshub.top（后端）。
核心结论：匿名即可用 CBG 链接换取整号「痒痒熊(yyx) 2.0.1」数据集。

用法：
    from yyx_client import YyshubClient
    c = YyshubClient()
    meta = c.fetch_by_url("https://yys.cbg.163.com/cgi/mweb/equip/16/2026...")
    full = c.download(meta["yyxDownload"])            # 3.3 MB 完整版
    simp = c.download(meta["yyxSimplifyDownload"])    # 2 MB 简化版（含 score/zscore）

CLI:
    python yyx_client.py chain "<cbg_url>" --out ./out
    python yyx_client.py upload <yyx.json>
    python yyx_client.py summarize <yyx.json>
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import Counter, defaultdict
from typing import Any, Dict, List, Optional

import requests

API = "http://api.yyshub.top"
WEB = "http://91zhaoyaojing.com"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)

# 业务码
CODE_OK = 10200
CODE_CBG_LINK = 10500        # 藏宝阁详情链接错误
CODE_UPLOAD = 10501          # 上传文件解析失败（推断，见 api/errors.md）

# 御魂套装 suit_id → 名称（常用套装，完整表见 format/dicts 或 yyx kind 字段）
SUIT_IDS = {
    300010: "招财猫", 300019: "火灵", 300012: "轮入道", 300034: "蚌精",
    300079: "遗念火", 300080: "共潜", 300057: "油赤子", 300032: "珍珠",
    300029: "伤魂鸟", 300030: "破势", 300031: "镇墓兽", 300048: "狂骨",
    300083: "海月火玉", 300086: "隐念", 300055: "片叶之苇",
}


class YyshubError(RuntimeError):
    def __init__(self, code: int, msg: str, body: Any = None):
        super().__init__(f"[{code}] {msg}")
        self.code = code
        self.msg = msg
        self.body = body


class RateLimited(YyshubError):
    """`POST /s/fetch-by-url` 的限流（实测约 12 次/分钟，冷却 ≥9 分钟）。

    应对：改用 `chain_via_cbg()`（直连 CBG 详情 + /s/up-to-std 上传），该路径未观察到限流。
    """


class YyshubClient:
    def __init__(self, api: str = API, timeout: int = 180, interval: float = 1.0):
        self.api = api.rstrip("/")
        self.timeout = timeout
        self.interval = interval
        self.s = requests.Session()
        self.s.headers.update(
            {
                "User-Agent": UA,
                "Origin": WEB,
                "Referer": WEB + "/",
                "Accept": "application/json, text/plain, */*",
            }
        )
        self._last = 0.0
        self.log: List[tuple] = []

    # ------------------------------------------------------------ 底层
    def _throttle(self):
        gap = time.time() - self._last
        if gap < self.interval:
            time.sleep(self.interval - gap)
        self._last = time.time()

    def _post_json(self, path: str, payload: dict) -> dict:
        self._throttle()
        r = self.s.post(self.api + path, json=payload, timeout=self.timeout)
        self.log.append(("POST", path, r.status_code, len(r.content)))
        return self._unwrap(r, path)

    def _unwrap(self, r: requests.Response, path: str) -> dict:
        try:
            body = r.json()
        except ValueError:
            raise YyshubError(r.status_code, f"非 JSON 响应: {r.text[:200]}")
        if r.status_code != 200:
            raise YyshubError(body.get("c", r.status_code), body.get("m", f"HTTP {r.status_code}"), body)
        c = body.get("c")
        if c != CODE_OK:
            msg = body.get("m") or "未知错误"
            if "频率" in str(msg) or "rate" in str(msg).lower():
                raise RateLimited(c, msg, body)
            raise YyshubError(c, msg, body)
        return body.get("d") or {}

    # ------------------------------------------------------------ 接口
    def fetch_by_url(self, cbg_url: str) -> Dict[str, str]:
        """POST /s/fetch-by-url  {"cbgUrl": "<CBG 链接>"}

        服务端用自家 CBG 抓取能力拉取该订单的完整账号数据，转换成 yyx 2.0.1 写盘，
        返回两个可匿名下载的路径：
            yyxDownload           /tmp/yyshub/out/yyx-<时间>-<随机>.json
            yyxSimplifyDownload   /tmp/yyshub/out/yyx-simplify-<时间>-<随机>.json

        错误：{"c":10500,"m":"藏宝阁详情链接错误"}；
        限流：{"c":10500,"m":"访问频率超过限制，请使用本地抓包的方式"}（→ RateLimited）
        """
        return self._post_json("/s/fetch-by-url", {"cbgUrl": cbg_url})

    def download_url(self, path_or_url: str) -> str:
        if path_or_url.startswith("http"):
            return path_or_url
        return self.api + path_or_url

    def download(self, path_or_url: str) -> dict:
        """GET 服务端生成的 yyx 文件（匿名，无需任何凭据）。"""
        self._throttle()
        url = self.download_url(path_or_url)
        r = self.s.get(url, timeout=self.timeout)
        self.log.append(("GET", path_or_url, r.status_code, len(r.content)))
        if r.status_code != 200:
            raise YyshubError(r.status_code, f"文件下载失败 HTTP {r.status_code}")
        return r.json()

    def upload(self, file_path: str) -> Dict[str, str]:
        """POST /s/up-to-std  multipart 字段名 raw_file

        前端 el-upload 的 action：把「官方渠道导出的文件」（yyx/痒痒熊格式）
        上传后由服务端转成标准 yyx，返回同 fetch_by_url 的下载路径。
        """
        self._throttle()
        name = os.path.basename(file_path)
        with open(file_path, "rb") as f:
            files = {"raw_file": (name, f, "application/json")}
            r = self.s.post(self.api + "/s/up-to-std", files=files, timeout=self.timeout)
        self.log.append(("POST", "/s/up-to-std", r.status_code, len(r.content)))
        try:
            body = r.json()
        except ValueError:
            raise YyshubError(r.status_code, f"非 JSON 响应: {r.text[:200]}")
        c = body.get("c")
        if c != CODE_OK:
            raise YyshubError(c if c is not None else r.status_code, body.get("m") or f"HTTP {r.status_code}", body)
        return body.get("d") or {}

    # ------------------------------------------------------------ 替代链路（绕过 fetch 限流）
    @staticmethod
    def parse_cbg_link(url: str):
        """从 CBG 链接提取 (serverid, ordersn)。与官方 .sh 脚本同款正则。"""
        import re as _re
        m = _re.search(r"/cgi/mweb/equip/(\d+)/([0-9]+-[0-9]+-[A-Za-z0-9]+)", url)
        if not m:
            m = _re.search(r"/equip/(\d+)/([0-9]+-[0-9]+-[A-Za-z0-9]+)", url)
        if not m:
            raise YyshubError(CODE_CBG_LINK, "藏宝阁链接格式错误（需 /cgi/mweb/equip/<serverid>/<ordersn>）")
        return m.group(1), m.group(2)

    def fetch_cbg_detail(self, serverid: str, ordersn: str, referer: Optional[str] = None) -> dict:
        """直连 CBG 官方详情接口（**匿名可读**，无需 Cookie/登录）。

        POST https://yys.cbg.163.com/cgi/api/get_equip_detail?client_type=h5
        form: serverid, ordersn；带 Referer 指向原链接。
        返回 ~4.8 MB JSON，`equip.equip_desc` 内联（4.29 MB 字符串）。
        这也是站点 `/static/scripts/yys魔方-藏宝阁数据导出.sh` 的做法。
        """
        self._throttle()
        url = "https://yys.cbg.163.com/cgi/api/get_equip_detail?client_type=h5"
        h = {
            "User-Agent": UA,
            "Referer": referer or f"https://yys.cbg.163.com/cgi/mweb/equip/{serverid}/{ordersn}",
            "Content-Type": "application/x-www-form-urlencoded",
        }
        r = self.s.post(url, data={"serverid": str(serverid), "ordersn": str(ordersn)},
                        headers=h, timeout=self.timeout)
        self.log.append(("POST", "cbg:get_equip_detail", r.status_code, len(r.content)))
        if r.status_code != 200:
            raise YyshubError(r.status_code, f"CBG 详情请求失败 HTTP {r.status_code}")
        body = r.json()
        if body.get("status") != 1 or not isinstance(body.get("equip"), dict):
            raise YyshubError(10501, f"CBG 返回异常: {body.get('msg') or body.get('status')}")
        return body

    def upload_json(self, obj: Any, name: str = "yys_cbg.json") -> Dict[str, str]:
        """把任意 CBG 原始导出 JSON 走 multipart 上传到 /s/up-to-std。"""
        import tempfile
        fd, path = tempfile.mkstemp(suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(obj, f, ensure_ascii=False)
            return self.upload(path)
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass

    def chain_via_cbg(self, cbg_url: str, want_simplify: bool = True) -> Dict[str, Any]:
        """替代链路：直连 CBG 详情 → /s/up-to-std 上传 → 下载 yyx。

        实测与 `fetch_by_url` 输出**完全一致**（同一账号 3,357,127 字节，指标逐位相同），
        且不触发 `/s/fetch-by-url` 的「约 12 次/分钟」限流。
        """
        sid, osn = self.parse_cbg_link(cbg_url)
        detail = self.fetch_cbg_detail(sid, osn, referer=cbg_url)
        meta = self.upload_json(detail)
        out = {"meta": meta, "full": None, "simplify": None, "via": "cbg+up-to-std"}
        out["full"] = self.download(meta["yyxDownload"])
        if want_simplify and meta.get("yyxSimplifyDownload"):
            out["simplify"] = self.download(meta["yyxSimplifyDownload"])
        return out

    # ------------------------------------------------------------ 高层
    def dataset(self, cbg_url: str, want_simplify: bool = True, mode: str = "auto"):
        """一条链接拿齐：{meta, full, simplify}

        mode: "api" 只走 /s/fetch-by-url；"cbg" 走 CBG 直连 + up-to-std；
              "auto"（默认）先试 api，命中限流则自动切 cbg 链路。
        """
        if mode == "cbg":
            return self.chain_via_cbg(cbg_url, want_simplify)
        try:
            meta = self.fetch_by_url(cbg_url)
            out = {"meta": meta, "full": None, "simplify": None, "via": "fetch-by-url"}
            out["full"] = self.download(meta["yyxDownload"])
            if want_simplify and meta.get("yyxSimplifyDownload"):
                out["simplify"] = self.download(meta["yyxSimplifyDownload"])
            return out
        except RateLimited:
            if mode == "api":
                raise
            return self.chain_via_cbg(cbg_url, want_simplify)


# ---------------------------------------------------------------- 解析/统计
SPEED = "Speed"


def is_six_star(soul: dict) -> bool:
    return int(soul.get("quality") or 0) == 6


def pos1(soul: dict) -> int:
    """yyx 的 pos 是 **0 基**（0=一号位 … 5=六号位），转成 1 基。"""
    return int(soul.get("pos") or 0) + 1


def soul_speed_milli(soul: dict) -> int:
    """单件御魂速度（千分之一）。yyx 的 random_attrs 已是绝对值。"""
    v = 0.0
    for a in soul.get("random_attrs") or []:
        if a.get("type") == SPEED:
            v += float(a.get("value") or 0)
    base = soul.get("base_attr") or {}
    if pos1(soul) == 2 and base.get("type") == SPEED:
        v += float(base.get("value") or 0)
    return int(round(v * 1000))


def speed_sub_count(soul: dict) -> int:
    return sum(1 for a in (soul.get("random_attrs") or []) if a.get("type") == SPEED)


def scatter_speeds(souls: List[dict]) -> Dict[str, Any]:
    by_pos: Dict[int, List[int]] = defaultdict(list)
    for s in souls:
        pos = pos1(s)
        if 1 <= pos <= 6:
            by_pos[pos].append(soul_speed_milli(s))
    for p in by_pos:
        by_pos[p].sort(reverse=True)
    res = {}
    for tier in range(1, 6):
        total = 0
        ok = True
        for pos in range(1, 7):
            lst = by_pos.get(pos, [])
            if len(lst) >= tier:
                total += lst[tier - 1]
            else:
                ok = False
        res[f"scatterSpeed{tier}"] = round(total / 1000, 3) if ok else None
    return res


def head_tail(souls: List[dict]) -> Dict[str, Any]:
    """头/尾/脚 —— ⚠️ yyx 无法精确判定。

    原因：yyx 的 `random_attrs` 会把同类型副属性**合并成一条**（例如 6 次速度强化合并为
    `{"type":"Speed","value":16.077}`），丢失了「速度副属性条数」。
    而「头」的判定条件是「2 号位速度主属性 + 6 条速度副属性」——这需要原始 CBG
    `equip_desc`（其 rattr 保留逐条 [type, rate] 记录）。

    因此这里只按「速度值 ≥ 16」给出**近似**参考，精确值请走 equip_desc 路径
    （见上一份报告 reverse/tools/parse_equip.py 的 head_stats）。
    """
    approx = []
    for s in souls:
        base = s.get("base_attr") or {}
        pos = pos1(s)
        if pos == 2 and base.get("type") == SPEED:
            sub = sum(float(a.get("value") or 0) for a in (s.get("random_attrs") or [])
                      if a.get("type") == SPEED)
            if sub >= 16:
                approx.append({"kind": s.get("kind"), "subSpeed": round(sub, 3)})
    approx.sort(key=lambda x: x["subSpeed"], reverse=True)
    return {
        "headCount": None,
        "headTopSpeed": None,
        "hitTailCount": None,
        "headCountApprox_ge16": len(approx),
        "headApprox": approx[:5],
        "note": "yyx 合并副属性，无法精确判定头/尾；需用 CBG equip_desc 的 rattr 逐条记录",
    }


def suit_speeds(souls: List[dict]) -> Dict[str, float]:
    """各套装一速：对每个套装，按位置取该套装中最好的御魂速度求和（≥4 个位置才算）。"""
    by_suit: Dict[int, Dict[int, int]] = defaultdict(dict)
    for s in souls:
        sid = int(s.get("suit_id") or 0)
        pos = pos1(s)
        if not (1 <= pos <= 6):
            continue
        milli = soul_speed_milli(s)
        if pos not in by_suit[sid] or milli > by_suit[sid][pos]:
            by_suit[sid][pos] = milli
    out = {}
    for sid, posmap in by_suit.items():
        if len(posmap) < 4:
            continue
        name = SUIT_IDS.get(sid) or f"suit_{sid}"
        out[name] = round(sum(posmap.values()) / 1000, 3)
    return dict(sorted(out.items(), key=lambda kv: kv[1], reverse=True)[:12])


def summarize(yyx: dict) -> Dict[str, Any]:
    data = yyx.get("data") or {}
    souls = data.get("hero_equips") or []
    six = [s for s in souls if is_six_star(s)]
    pos_counts = Counter(pos1(s) for s in souls)
    scores = [int(s.get("score") or 0) for s in six if s.get("score") is not None]
    zscores = [float(s.get("zscore") or 0) for s in six if s.get("zscore") is not None]
    player = data.get("player") or {}
    out = {
        "version": yyx.get("version"),
        "timestamp": yyx.get("timestamp"),
        "souls_total": len(souls),
        "souls_six_star": len(six),
        "position_counts": dict(sorted(pos_counts.items())),
        "player": player,
        "heroes": len(data.get("heroes") or []),
        "score_hist": dict(sorted(Counter(scores).items())) if scores else None,
        "zscore_hist": dict(sorted(Counter(round(z) for z in zscores).items())) if zscores else None,
        "zscore_avg": round(sum(zscores) / len(zscores), 2) if zscores else None,
        "zscore_max": round(max(zscores), 2) if zscores else None,
        "score_avg": round(sum(scores) / len(scores), 2) if scores else None,
        "score_ge6": sum(1 for x in scores if x >= 6),
        "zscore_ge8": sum(1 for x in zscores if x >= 8),
    }
    out.update(scatter_speeds(six))
    out.update(head_tail(six))
    out["suit_speeds"] = suit_speeds(six)
    return out


# ---------------------------------------------------------------- CLI
def _load(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="痒痒鼠魔方/照妖镜 调用链客户端")
    sub = ap.add_subparsers(dest="cmd", required=True)

    ch = sub.add_parser("chain", help="CBG 链接 → 下载 yyx 数据集并统计")
    ch.add_argument("url")
    ch.add_argument("--out", default="out")
    ch.add_argument("--via", choices=["auto", "api", "cbg"], default="auto",
                    help="auto=先 fetch-by-url，限流则改走 CBG 直连+上传；api=只用 fetch；cbg=绕过限流链路")

    up = sub.add_parser("upload", help="上传 yyx/官方导出文件 → 转换结果")
    up.add_argument("file")

    su = sub.add_parser("summarize", help="统计本地 yyx 文件")
    su.add_argument("file")

    args = ap.parse_args(argv)
    if args.cmd == "summarize":
        print(json.dumps(summarize(_load(args.file)), ensure_ascii=False, indent=2))
        return 0
    if args.cmd == "upload":
        c = YyshubClient()
        print(json.dumps(c.upload(args.file), ensure_ascii=False, indent=2))
        return 0
    if args.cmd == "chain":
        c = YyshubClient()
        ds = c.dataset(args.url, mode=args.via)
        os.makedirs(args.out, exist_ok=True)
        for key, fn in (("full", "yyx_full.json"), ("simplify", "yyx_simplify.json")):
            if ds.get(key):
                with open(os.path.join(args.out, fn), "w", encoding="utf-8") as f:
                    json.dump(ds[key], f, ensure_ascii=False)
        summary = summarize(ds["full"])
        print(json.dumps({"meta": ds["meta"], "via": ds.get("via"), "summary": summary},
                         ensure_ascii=False, indent=2))
        print(f"\n已保存 -> {args.out}/yyx_full.json, yyx_simplify.json")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
