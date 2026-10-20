#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""文件缓存 + 任务队列（零依赖，单机可用；多实例可换 Redis/S3）"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import threading
import time
from typing import Any, Dict, Optional


class Cache:
    def __init__(self, root: str, ttl: int = 24 * 3600):
        self.root = os.path.abspath(root)
        self.ttl = ttl
        os.makedirs(os.path.join(self.root, "reports"), exist_ok=True)
        os.makedirs(os.path.join(self.root, "yyx"), exist_ok=True)
        os.makedirs(os.path.join(self.root, "precise"), exist_ok=True)
        self._locks: Dict[str, threading.Event] = {}
        self._guard = threading.Lock()

    # ---------------------------------------------------------- 基础
    def _path(self, kind: str, key: str, ext: str = ".json") -> str:
        safe = "".join(c if (c.isalnum() or c in "-_") else "_" for c in key)[:120]
        return os.path.join(self.root, kind, safe + ext)

    def _read(self, kind: str, key: str, max_age: Optional[float] = None) -> Optional[Any]:
        for p in (self._path(kind, key, ".json.gz"), self._path(kind, key, ".json")):
            if not os.path.exists(p):
                continue
            try:
                if max_age is not None and time.time() - os.path.getmtime(p) > max_age:
                    return None
                with open(p, "rb") as f:
                    raw = f.read()
                if p.endswith(".gz"):
                    raw = gzip.decompress(raw)
                return json.loads(raw.decode("utf-8"))
            except (OSError, ValueError):
                return None
        return None

    def _write(self, kind: str, key: str, obj: Any, gz: bool = False):
        p = self._path(kind, key, ".json.gz" if gz else ".json")
        tmp = p + ".tmp"
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        if gz:
            data = gzip.compress(data, compresslevel=6)
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, p)

    # ---------------------------------------------------------- 报告 / 原始数据
    def get_report(self, key: str, max_age: Optional[float] = -1) -> Optional[dict]:
        age = self.ttl if max_age == -1 else max_age
        return self._read("reports", key, age)

    def put_report(self, key: str, report: dict):
        self._write("reports", key, report)

    def get_yyx(self, key: str) -> Optional[dict]:
        return self._read("yyx", key, self.ttl)

    def put_yyx(self, key: str, yyx: dict):
        self._write("yyx", key, yyx, gz=True)

    def get_precise(self, key: str) -> Optional[dict]:
        return self._read("precise", key, self.ttl)

    def put_precise(self, key: str, data: dict):
        self._write("precise", key, data)

    # ---------------------------------------------------------- 单飞锁
    def acquire(self, key: str) -> Optional[threading.Event]:
        """返回 None 表示自己拿到锁；否则返回需等待的 Event。"""
        with self._guard:
            if key in self._locks:
                return self._locks[key]
            self._locks[key] = threading.Event()
            return None

    def release(self, key: str):
        with self._guard:
            ev = self._locks.pop(key, None)
        if ev:
            ev.set()

    # ---------------------------------------------------------- 工具
    @staticmethod
    def key_for_ordersn(ordersn: str) -> str:
        return "o_" + ordersn

    @staticmethod
    def key_for_upload(raw: bytes) -> str:
        return "u_" + hashlib.sha256(raw).hexdigest()[:24]


class JobQueue:
    """极简内存任务队列（单进程）；用于组合搜索/一键配装等异步任务。"""

    def __init__(self, workers: int = 2, max_keep: int = 200):
        import queue
        self.q = queue.Queue()
        self.jobs: Dict[str, dict] = {}
        self.max_keep = max_keep
        self._guard = threading.Lock()
        for i in range(workers):
            threading.Thread(target=self._worker, name=f"soul-worker-{i}", daemon=True).start()

    def submit(self, fn, *args, **kwargs) -> str:
        import uuid
        job_id = uuid.uuid4().hex[:16]
        self.jobs[job_id] = {"id": job_id, "status": "queued", "created": time.time()}
        self.q.put((job_id, fn, args, kwargs))
        self._trim()
        return job_id

    def get(self, job_id: str) -> Optional[dict]:
        return self.jobs.get(job_id)

    def _trim(self):
        if len(self.jobs) <= self.max_keep:
            return
        for jid in sorted(self.jobs, key=lambda j: self.jobs[j]["created"])[: len(self.jobs) - self.max_keep]:
            self.jobs.pop(jid, None)

    def _worker(self):
        while True:
            job_id, fn, args, kwargs = self.q.get()
            job = self.jobs.get(job_id)
            if job is None:
                continue
            job.update(status="running", started=time.time())
            try:
                res = fn(*args, **kwargs)
                job.update(status="done", result=res, elapsed_ms=int((time.time() - job["started"]) * 1000))
            except Exception as e:                      # noqa: BLE001
                job.update(status="error", error=str(e),
                           elapsed_ms=int((time.time() - job["started"]) * 1000))
            finally:
                self.q.task_done()
