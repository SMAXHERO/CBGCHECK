#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""业务层：报告生成、上传解析、精确指标、组合搜索任务"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from typing import Any, Dict, Optional

import engine
from store import Cache, JobQueue

_ORDERSN_RE = re.compile(r"^\d{8,}-\d+-[0-9A-Za-z]+$")


class ServiceError(Exception):
    def __init__(self, msg: str, status: int = 400, code: str = "BAD_REQUEST"):
        super().__init__(msg)
        self.status = status
        self.code = code
        self.msg = msg


class Service:
    def __init__(self, data_dir: str, ttl: int = 24 * 3600, min_gap: float = 6.0,
                 workers: int = 2):
        self.cache = Cache(data_dir, ttl)
        self.jobs = JobQueue(workers=workers)
        self.min_gap = min_gap
        self._fetch_lock = threading.Lock()
        self._last_fetch = 0.0
        self.stats = {"reports": 0, "fetches": 0, "uploads": 0, "searches": 0, "errors": 0}

    # ------------------------------------------------------------ F1/F2 报告
    def report(self, ordersn: str = "", serverid: str = "", cbg_url: str = "",
               refresh: bool = False) -> dict:
        if not ordersn:
            p = engine.parse_cbg_link(cbg_url)
            if not p:
                raise ServiceError("无法识别 CBG 链接/订单号")
            ordersn, serverid = p["ordersn"], p["serverid"]
        if not _ORDERSN_RE.match(ordersn):
            raise ServiceError("ordersn 不合法（应形如 202606282101616-16-XXXXXXXX）", 400, "BAD_ORDERSN")
        if not serverid and "-" in ordersn:
            serverid = ordersn.split("-")[1]
        key = Cache.key_for_ordersn(ordersn)

        if not refresh:
            cached = self.cache.get_report(key)
            if cached is not None:
                return {**cached, "cached": True}

        ev = self.cache.acquire(key)
        if ev is not None:                       # 有人正在抓，等它
            if ev.wait(timeout=180):
                got = self.cache.get_report(key)
                if got is not None:
                    return {**got, "cached": True}
            raise ServiceError("分析超时，请稍后重试", 504, "TIMEOUT")

        try:
            url = cbg_url or f"https://yys.cbg.163.com/cgi/mweb/equip/{serverid}/{ordersn}"
            with self._fetch_lock:
                gap = time.time() - self._last_fetch
                if gap < self.min_gap:
                    time.sleep(self.min_gap - gap)
                self._last_fetch = time.time()
            yyx, meta = engine.fetch_yyx(url, mode="auto")   # 限流自动切 CBG 直连
            self.stats["fetches"] += 1
            report = engine.build_report(yyx, meta)
            report.update({"ordersn": ordersn, "serverid": str(serverid), "cached": False})
            self.cache.put_report(key, report)
            self.cache.put_yyx(key, yyx)
            self.stats["reports"] += 1
            return report
        except ServiceError:
            raise
        except Exception as e:                   # noqa: BLE001
            self.stats["errors"] += 1
            msg = str(e)
            # 上游明确"不存在/链接错误" → 404；其余按上游故障 502
            if any(k in msg for k in ("物品不存在", "链接错误", "藏宝阁详情链接错误", "数据抓取失败")):
                raise ServiceError(f"订单不存在或已下架: {msg}", 404, "NOT_FOUND")
            raise ServiceError(f"抓取/解析失败: {msg}", 502, "UPSTREAM_ERROR")
        finally:
            self.cache.release(key)

    # ------------------------------------------------------------ 上传 yyx
    def report_from_upload(self, raw: bytes, filename: str = "") -> dict:
        try:
            if raw[:2] == b"\x1f\x8b":
                import gzip
                raw = gzip.decompress(raw)
            text = raw.decode("utf-8-sig")
            yyx = json.loads(text)
        except (UnicodeDecodeError, ValueError) as e:
            raise ServiceError(f"文件不是合法 JSON: {e}")
        equips = engine.extract_equips(yyx) if isinstance(yyx, dict) else []
        if not equips:
            raise ServiceError("未找到 hero_equips：请上传 yyx / 痒痒熊导出文件")
        self.stats["uploads"] += 1
        key = Cache.key_for_upload(raw)
        report = engine.build_report(yyx, {"source": "upload", "filename": filename})
        report.update({"ordersn": "", "serverid": "", "cached": False, "upload_key": key})
        self.cache.put_report(key, report)
        self.cache.put_yyx(key, yyx)
        return report

    # ------------------------------------------------------------ F3 精确指标
    def precise(self, ordersn: str, refresh: bool = False) -> dict:
        if not ordersn:
            raise ServiceError("缺少 ordersn")
        key = "p_" + ordersn
        if not refresh:
            cached = self.cache.get_precise(key)
            if cached is not None:
                return {**cached, "cached": True}
        data = engine.precise_metrics(ordersn)
        if not data.get("ok"):
            raise ServiceError(data.get("msg") or "无法获取 CBG 御魂档案", 404, "NOT_FOUND")
        self.cache.put_precise(key, data)
        return {**data, "cached": False}

    # ------------------------------------------------------------ F4 搜索
    def _equips_for(self, ordersn: str = "", upload_key: str = "") -> list:
        key = Cache.key_for_ordersn(ordersn) if ordersn else upload_key
        if not key:
            raise ServiceError("缺少 ordersn/upload_key")
        yyx = self.cache.get_yyx(key)
        if yyx is None:
            if not ordersn:
                raise ServiceError("上传数据已过期，请重新上传", 404, "EXPIRED")
            self.report(ordersn=ordersn)          # 触发抓取
            yyx = self.cache.get_yyx(key)
        if yyx is None:
            raise ServiceError("数据不可用", 500, "NO_DATA")
        return engine.extract_equips(yyx)

    def submit_search(self, ordersn: str = "", upload_key: str = "", hero: str = "天照",
                      target: str = "Damage", filters: Optional[dict] = None,
                      settings: Optional[dict] = None, top: int = 5,
                      search_payload: Optional[dict] = None) -> str:
        if not hero:
            raise ServiceError("缺少 hero（式神名）")
        if not ordersn and not upload_key:
            raise ServiceError("缺少数据源：请先分析订单或上传 yyx（ordersn / upload_key 二选一）", 400)
        if search_payload:
            try:
                filters = engine.build_filters(search_payload)
            except ValueError as e:
                raise ServiceError(str(e))
        if hero not in getattr(engine.C, "HEROES", {}):
            raise ServiceError(f"未知式神: {hero}（可选值见 /api/soul/meta）", 400, "UNKNOWN_HERO")

        def work():
            equips = self._equips_for(ordersn, upload_key)
            return engine.search(equips, hero, target, filters or {},
                                 settings or {"fastMode": True}, top)

        self.stats["searches"] += 1
        return self.jobs.submit(work)

    def meta(self) -> dict:
        return {"ok": True, **engine.meta()}

    def job(self, job_id: str) -> dict:
        j = self.jobs.get(job_id)
        if not j:
            raise ServiceError("任务不存在或已过期", 404, "NOT_FOUND")
        return j

    # ------------------------------------------------------------ 预热/演示
    def load_local(self, yyx_info: dict) -> dict:
        """把一份本地 yyx 直接变成报告（演示用，不抓取）。"""
        raw = json.dumps(yyx_info, ensure_ascii=False).encode("utf-8")
        return self.report_from_upload(raw, "local-demo.json")
