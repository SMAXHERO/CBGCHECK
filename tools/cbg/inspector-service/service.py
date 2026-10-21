#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Inspector 服务核心：抓取 → 数据集 → 六个页面的分析结果。

所有算法来自 cbg_inspector（对 yys.maydaylands.com/yys-cbg-inspector 的蒸馏复刻），
已用基准账号 97 项校验对齐站点页面。本模块只负责：缓存、并发、把结果整理成
JSON（并剥掉体积很大的御魂原始对象）。
"""
from __future__ import annotations

import gzip
import json
import multiprocessing
import os
import threading
import time
import traceback
import urllib.parse
import uuid
from pathlib import Path

from cbg_inspector import analysis, calculator, dataset as ds_mod, fetch, speed, static

DEFAULT_TTL = 24 * 3600

# PVE 21 组彼此独立，串行一组约 20 秒（合计 7 分钟），按 CPU 并行到 2 分钟内。
# 组数远多于核数，用 spawn 上下文（Windows 默认）也只在每个 worker 里各反序列化一次数据集。
PVE_WORKERS = int(os.environ.get("CBG_INSPECTOR_PVE_WORKERS") or max(1, min(6, (os.cpu_count() or 4) - 2)))

_PVE_CTX: dict = {}


def _pve_init(base_stats: dict, dataset: dict) -> None:
    """worker 初始化：把只读数据放进全局，避免每个任务重复传递。"""
    _PVE_CTX["base_stats"] = base_stats
    _PVE_CTX["dataset"] = dataset


def _pve_task(task: tuple[str, str]) -> tuple[str, str, dict | None]:
    """一个 (四件套, 逢魔套) 组合的最优面板搜索，返回可 JSON 化的行。"""
    suit, oma = task
    hit = calculator.search_with_suits(
        _PVE_CTX["dataset"], _PVE_CTX["base_stats"],
        four_piece=suit, oma_suit=oma, metric="damage", result_limit=1,
    )
    if not hit:
        return suit, oma, None
    row = {
        "suit": suit,
        "omaSuit": oma,
        "damage": round(float(hit["score"]), 2),
        "panel": {key: round(float(value), 2) for key, value in hit["panel"].items()},
        "relics": [_relic_brief(relic) for relic in hit["relics"]],
    }
    return suit, oma, row


class ServiceError(Exception):
    def __init__(self, status: int, code: str, msg: str):
        super().__init__(msg)
        self.status = status
        self.code = code
        self.msg = msg


def _parse_cbg_url(url: str) -> tuple[str, str]:
    try:
        return fetch.parse_cbg_url(url)
    except ValueError as exc:
        raise ServiceError(400, "BAD_URL", str(exc)) from exc


def _cell_strip(cell: dict) -> dict:
    """speed._cell() 里带整件御魂对象，返回给前端前要剥掉。"""
    return {
        "position": cell.get("position"),
        "value": cell.get("value"),
        "subSpeed": cell.get("subSpeed"),
        "mainAttribute": cell.get("mainAttribute"),
        "suitName": cell.get("suitName"),
        "labels": cell.get("labels") or [],
    }


def _combo_strip(combo: dict) -> dict:
    return {
        "rank": combo.get("rank"),
        "suit": combo.get("suit"),
        "value": combo.get("value"),
        "cells": [_cell_strip(c) for c in combo.get("cells") or []],
    }


def _relic_brief(relic: dict) -> dict:
    return {
        "position": relic.get("position"),
        "suitName": (relic.get("suit") or {}).get("name"),
        "mainAttribute": relic.get("mainAttribute"),
        "subAttributes": analysis.relic_sub_rolls(relic),
        "quality": relic.get("quality"),
        "level": relic.get("level"),
        "relicId": relic.get("id"),
    }


class Service:
    def __init__(self, data_dir: str | Path, ttl: int = DEFAULT_TTL,
                 min_gap: float = 3.0, demo_path: str | None = None):
        self.data_dir = Path(data_dir)
        self.cache_dir = self.data_dir / "cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.ttl = int(ttl)
        self.min_gap = float(min_gap)
        self.demo_path = Path(demo_path) if demo_path else self.data_dir / "demo_equip_desc.json"

        self._mem: dict[str, tuple[float, dict]] = {}
        self._lock = threading.Lock()
        self._inflight: dict[str, threading.Event] = {}
        self._last_fetch = 0.0
        self._jobs: dict[str, dict] = {}
        self._jobs_lock = threading.Lock()
        self.stats = {"datasets": 0, "fetches": 0, "hits": 0, "pveJobs": 0, "calcJobs": 0}

    # ------------------------------------------------------------ 数据集
    @staticmethod
    def _key(serverid: str, ordersn: str) -> str:
        return f"{serverid}_{ordersn}"

    def _cache_file(self, key: str) -> Path:
        return self.cache_dir / f"{key}.json.gz"

    def _read_disk(self, key: str) -> tuple[float, dict] | None:
        path = self._cache_file(key)
        if not path.is_file():
            return None
        try:
            with gzip.open(path, "rt", encoding="utf-8") as fh:
                payload = json.load(fh)
            return float(payload["ts"]), payload["dataset"]
        except Exception:                                    # noqa: BLE001
            traceback.print_exc()
            return None

    def _write_disk(self, key: str, dataset: dict) -> None:
        path = self._cache_file(key)
        tmp = path.with_suffix(".tmp")
        try:
            with gzip.open(tmp, "wt", encoding="utf-8") as fh:
                json.dump({"ts": time.time(), "dataset": dataset}, fh, ensure_ascii=False)
            tmp.replace(path)
        except Exception:                                    # noqa: BLE001
            traceback.print_exc()
            try:
                tmp.unlink(missing_ok=True)
            except Exception:                                # noqa: BLE001
                pass

    def load(self, ordersn: str = "", serverid: str = "", cbg_url: str = "",
             refresh: bool = False, via: str = "cbg") -> tuple[dict, dict]:
        """取数据集（内存 → 磁盘 → 现抓）。返回 (dataset, meta)。"""
        if cbg_url:
            serverid, ordersn = _parse_cbg_url(cbg_url)
        ordersn = (ordersn or "").strip()
        serverid = (serverid or "").strip()
        if not ordersn:
            raise ServiceError(400, "BAD_ARGS", "缺少订单号 ordersn（或传 cbg_url）")
        if not serverid:
            # 订单号形如 202610201501616-17-XXXX，中间段就是 serverid
            parts = ordersn.split("-")
            if len(parts) >= 2 and parts[1].isdigit():
                serverid = parts[1]
            else:
                raise ServiceError(400, "BAD_ARGS", "缺少 serverid")

        key = self._key(serverid, ordersn)
        now = time.time()

        with self._lock:
            hit = self._mem.get(key)
            if hit and not refresh and now - hit[0] < self.ttl:
                self.stats["hits"] += 1
                return hit[1], {"source": "memory", "cached": True, "fetch_ms": 0}

            event = self._inflight.get(key)
            owner = event is None
            if owner:
                event = threading.Event()
                self._inflight[key] = event

        if not owner:
            # 同一个账号正在抓：等它抓完再读缓存，避免并发打上游
            event.wait(timeout=180)
            return self.load(ordersn, serverid, refresh=False, via=via)

        try:
            if not refresh:
                disk = self._read_disk(key)
                if disk and now - disk[0] < self.ttl:
                    ds, ts = disk[1], disk[0]
                    with self._lock:
                        self._mem[key] = (ts, ds)
                    self.stats["hits"] += 1
                    return ds, {"source": "disk", "cached": True, "fetch_ms": 0}

            with self._lock:
                gap = time.time() - self._last_fetch
                if gap < self.min_gap:
                    time.sleep(self.min_gap - gap)
                self._last_fetch = time.time()
                self.stats["fetches"] += 1

            t0 = time.time()
            try:
                raw = fetch.fetch(serverid, ordersn, via=via)
                source = "cbg"
            except Exception:                                # noqa: BLE001
                traceback.print_exc()
                raw = fetch.fetch(serverid, ordersn, via="action")
                source = "action"
            fetch_ms = int((time.time() - t0) * 1000)

            t1 = time.time()
            dataset = ds_mod.build_dataset(raw)
            build_ms = int((time.time() - t1) * 1000)
            with self._lock:
                self._mem[key] = (time.time(), dataset)
                self.stats["datasets"] += 1
            self._write_disk(key, dataset)
            return dataset, {
                "source": source, "cached": False,
                "fetch_ms": fetch_ms, "build_ms": build_ms,
            }
        finally:
            with self._lock:
                self._inflight.pop(key, None)
            event.set()

    def demo_dataset(self) -> dict:
        """演示数据：优先 data/demo_equip_desc.json，其次同名的 .json.gz。"""
        raw = None
        if self.demo_path.is_file():
            raw = json.loads(self.demo_path.read_text(encoding="utf-8"))
        else:
            gz = self.demo_path.with_name(self.demo_path.name + ".gz")
            if gz.is_file():
                with gzip.open(gz, "rt", encoding="utf-8") as fh:
                    raw = json.load(fh)
        if raw is None:
            raise ServiceError(404, "NO_DEMO", "缺少演示数据 data/demo_equip_desc.json(.gz)")
        return ds_mod.build_dataset({"equip": {"equip_desc": raw}})

    def dataset_for(self, ordersn: str = "", serverid: str = "",
                    cbg_url: str = "") -> dict:
        """报告之外的接口统一入口：ordersn=demo / 无参数且无链接 → 演示数据。"""
        ordersn = (ordersn or "").strip()
        serverid = (serverid or "").strip()
        if cbg_url or (ordersn and ordersn.lower() != "demo") or serverid:
            return self.load(ordersn, serverid, cbg_url=cbg_url)[0]
        return self.demo_dataset()

    # ------------------------------------------------------------ 页面数据
    def _report_from(self, dataset: dict, meta: dict) -> dict:
        t0 = time.time()
        st = static.load_static()
        ov = analysis.overview(dataset, st)
        heroes = analysis.hero_skills(dataset, st)
        sp = speed.summary(dataset)

        payload = {
            "ok": True,
            "account": ov["account"],
            "relics": ov["relics"],
            "speed": {
                "highlights": ov["speed"]["hl"],
                "headTail": sp["headTail"],
                "fullSpeedCount": sp["fullSpeedCount"],
                "fullSpeedByPosition": sp["fullSpeedByPosition"],
                "scatterTop": [
                    {"rank": item.get("rank"), "value": item.get("value"),
                     "cells": [_cell_strip(c) for c in item.get("cells") or []]}
                    for item in sp["scatterTop"]
                ],
                "suitTable": [
                    {"suit": item.get("suit"), "value": item.get("value"),
                     "cells": [_cell_strip(c) for c in item.get("cells") or []]}
                    for item in sp["suitTable"]
                ],
                "fullSpeedRelics": [
                    {"position": item["position"], "value": item["value"],
                     "suitName": item.get("suitName"), "mainAttribute": item.get("mainAttribute")}
                    for item in sp["fullSpeedRelics"]
                ],
            },
            "pveScores": ov["pveScores"],
            "heroSkills": heroes,
        }
        payload.update(meta)
        payload["elapsed_ms"] = int((time.time() - t0) * 1000)
        return payload

    def report(self, ordersn: str = "", serverid: str = "", cbg_url: str = "",
               refresh: bool = False, via: str = "cbg") -> dict:
        dataset, meta = self.load(ordersn, serverid, cbg_url, refresh=refresh, via=via)
        payload = self._report_from(dataset, meta)
        payload["ordersn"] = ordersn or (dataset.get("source") or {}).get("ordersn")
        payload["serverid"] = serverid or (dataset.get("source") or {}).get("serverid")
        payload["via"] = via
        return payload

    def demo_report(self) -> dict:
        payload = self._report_from(self.demo_dataset(),
                                    {"source": "demo", "cached": False, "fetch_ms": 0})
        payload["ordersn"] = "demo"
        payload["serverid"] = ""
        return payload

    def speed_combos(self, ordersn: str, serverid: str,
                     fourth_main: list[str] | None = None,
                     sixth_main: list[str] | None = None,
                     cbg_url: str = "") -> dict:
        dataset = self.dataset_for(ordersn, serverid, cbg_url)
        fourth = tuple(fourth_main) if fourth_main else None
        sixth = tuple(sixth_main) if sixth_main else None
        scatter = speed.scatter_combinations(dataset, top=5, fourth_main=fourth, sixth_main=sixth)
        table = speed.suit_speed_table(dataset, fourth_main=fourth, sixth_main=sixth)
        return {
            "ok": True,
            "scatterTop": [_combo_strip(c) for c in scatter],
            "suitTable": [_combo_strip(c) for c in table],
        }

    def relics(self, ordersn: str, serverid: str, *, position: int | None = None,
               suits: list[str] | None = None, mains: list[str] | None = None,
               subs: list[str] | None = None, sort_by: str = "speed",
               limit: int = 200) -> dict:
        dataset = self.dataset_for(ordersn, serverid)
        try:
            limit = max(1, min(int(limit or 200), 1000))
        except (TypeError, ValueError):
            limit = 200
        result = analysis.relics_inventory(
            dataset, position=position, suit_names=suits,
            main_attrs=mains, sub_attrs=subs, sort_by=sort_by,
        )
        result["items"] = result["items"][:limit]
        result["limit"] = limit
        result["ok"] = True
        return result

    def meta(self) -> dict:
        st = static.load_static()
        heroes = [
            {"name": info.get("name"), "level": info.get("level"),
             "baseStats": info.get("baseStats")}
            for info in st["heroesById"].values()
            if info.get("name") and info.get("baseStats")
        ]
        heroes.sort(key=lambda item: item["name"])
        return {
            "ok": True,
            "heroes": heroes,
            "suits": st["suitNames"],
            "pveNormalSuits": list(analysis.PVE_NORMAL_SUITS),
            "pveOmaSuits": list(analysis.PVE_OMA_SUITS),
            "attributes": ["攻击加成", "攻击", "生命加成", "生命", "防御加成", "防御",
                           "速度", "暴击", "暴击伤害", "效果命中", "效果抵抗"],
            "presets": {
                "attack": {"2": ["攻击加成"], "4": ["攻击加成"], "6": ["暴击"]},
                "health": {"2": ["生命加成"], "4": ["生命加成"], "6": ["暴击"]},
                "speed": {"2": ["速度"], "4": [], "6": []},
            },
            "metrics": list(calculator.METRICS),
        }

    # ------------------------------------------------------------ 异步任务
    def _new_job(self, kind: str) -> str:
        job_id = uuid.uuid4().hex[:12]
        with self._jobs_lock:
            self._jobs[job_id] = {
                "id": job_id, "kind": kind, "status": "queued",
                "created": time.time(), "started": None, "finished": None,
                "progress": "", "result": None, "error": None,
            }
        return job_id

    def _update(self, job_id: str, **fields) -> None:
        with self._jobs_lock:
            job = self._jobs.get(job_id)
            if job:
                job.update(fields)

    def job(self, job_id: str) -> dict:
        with self._jobs_lock:
            job = self._jobs.get(job_id)
        if not job:
            raise ServiceError(404, "NO_JOB", "任务不存在或已过期")
        return job

    def _spawn(self, job_id: str, fn) -> None:
        def runner():
            self._update(job_id, status="running", started=time.time())
            try:
                result = fn()
                self._update(job_id, status="done", result=result, finished=time.time())
            except ServiceError as exc:
                self._update(job_id, status="error", error=exc.msg, finished=time.time())
            except Exception as exc:                         # noqa: BLE001
                traceback.print_exc()
                self._update(job_id, status="error", error=str(exc), finished=time.time())
        threading.Thread(target=runner, daemon=True).start()

    def _pve_cache_file(self, ordersn: str, serverid: str):
        if not ordersn:
            return self.cache_dir / "pve_demo.json"
        return self.cache_dir / f"pve_{self._key(serverid, ordersn)}.json"

    def _read_pve_cache(self, path, refresh: bool) -> dict | None:
        if refresh or not path.exists():
            return None
        try:
            if path.stat().st_mtime < time.time() - self.ttl:
                return None
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if not isinstance(payload, dict) or not payload.get("rows"):
            return None
        payload["cached"] = True
        return payload

    def _write_pve_cache(self, path, result: dict) -> None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        except OSError:
            pass

    def pve_combos(self, ordersn: str, serverid: str, cbg_url: str = "",
                   refresh: bool = False) -> str:
        dataset = self.dataset_for(ordersn, serverid, cbg_url)
        base_stats = static.load_static()["heroesByName"].get("须佐之男", {}).get("baseStats") or {}
        job_id = self._new_job("pve")
        self.stats["pveJobs"] += 1
        combos = [(suit, oma) for suit in analysis.PVE_NORMAL_SUITS for oma in analysis.PVE_OMA_SUITS]
        cache_path = self._pve_cache_file(ordersn, serverid)

        def work() -> dict:
            cached = self._read_pve_cache(cache_path, refresh)
            if cached is not None:
                self._update(job_id, progress="读取本地缓存")
                return cached
            rows_by_key: dict[tuple[str, str], dict] = {}
            total = len(combos)
            if PVE_WORKERS > 1:
                ctx = multiprocessing.get_context("spawn")
                with ctx.Pool(processes=PVE_WORKERS, initializer=_pve_init,
                              initargs=(base_stats, dataset)) as pool:
                    done = 0
                    for suit, oma, row in pool.imap_unordered(_pve_task, combos):
                        done += 1
                        self._update(job_id, progress=f"{suit}+{oma}（{done}/{total}）")
                        if row:
                            rows_by_key[(suit, oma)] = row
            else:
                for index, (suit, oma) in enumerate(combos):
                    self._update(job_id, progress=f"{suit}+{oma}（{index + 1}/{total}）")
                    _, _, row = _pve_task((suit, oma))
                    if row:
                        rows_by_key[(suit, oma)] = row
            rows = [rows_by_key[key] for key in combos if key in rows_by_key]
            average = round(sum(row["damage"] for row in rows) / len(rows), 2) if rows else None
            result = {"rows": rows, "average": average, "hero": "须佐之男", "cached": False}
            self._write_pve_cache(cache_path, result)
            return result

        self._spawn(job_id, work)
        return job_id

    def calc(self, payload: dict) -> str:
        ordersn = str(payload.get("ordersn") or "")
        serverid = str(payload.get("serverid") or "")
        cbg_url = str(payload.get("url") or "")
        dataset = self.dataset_for(ordersn, serverid, cbg_url)
        st = static.load_static()
        hero_name = str(payload.get("hero") or "须佐之男")
        base_stats = (st["heroesByName"].get(hero_name) or {}).get("baseStats")
        if not base_stats:
            raise ServiceError(400, "BAD_HERO", f"静态资料里没有式神「{hero_name}」")

        preset = payload.get("preset")
        main_attrs = payload.get("mainAttributes")
        if not main_attrs and preset in ("attack", "health", "speed"):
            main_attrs = self.meta()["presets"][preset]
        metric = str(payload.get("metric") or "damage")
        if metric not in calculator.METRICS:
            raise ServiceError(400, "BAD_METRIC", f"不支持的指标：{metric}")

        filters: dict = {"quality": 6, "level": 15, "mainAttributes": main_attrs or {}}
        if payload.get("fourPiece"):
            filters["requiredFourPiece"] = str(payload["fourPiece"])
        constraints: dict = {}
        if payload.get("fullCrit"):
            constraints["critRate"] = {"min": float(payload.get("minCritRate") or 100)}
        if constraints:
            filters["panelConstraints"] = constraints
        try:
            result_limit = max(1, min(int(payload.get("limit") or 3), 10))
        except (TypeError, ValueError):
            result_limit = 3

        fast_mode = payload.get("fastMode", True)
        if isinstance(fast_mode, str):
            fast_mode = fast_mode.strip().lower() not in ("0", "false", "no", "off")

        job_id = self._new_job("calc")
        self.stats["calcJobs"] += 1

        def work() -> dict:
            self._update(job_id, progress=f"搜索 {hero_name} 最优组合…")
            if fast_mode:
                hits = calculator.search_fast(
                    dataset["relicsByPosition"], base_stats,
                    metric=metric, filters=filters, result_limit=result_limit,
                )
            else:
                hits = calculator.search(
                    dataset["relicsByPosition"], base_stats,
                    metric=metric, filters=filters, result_limit=result_limit,
                )
            return {
                "hero": hero_name, "metric": metric, "fastMode": fast_mode,
                "rows": [
                    {
                        "score": round(float(hit["score"]), 2),
                        "panel": {key: round(float(value), 2) for key, value in hit["panel"].items()},
                        "suits": hit["suits"],
                        "relics": [_relic_brief(relic) for relic in hit["relics"]],
                    }
                    for hit in hits
                ],
            }

        self._spawn(job_id, work)
        return job_id
