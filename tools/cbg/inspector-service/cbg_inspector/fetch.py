"""数据获取：两条链路都能拿到同一个 CBG 导出（结果等价）。

链路 A（站点 Server Action 重放，无登录）：
    POST https://yys.maydaylands.com/yys-cbg-inspector/home
    headers: next-action: <action id>, accept: text/x-component,
             content-type: text/plain;charset=UTF-8
    body:    [{"serverid":"17","ordersn":"202610201501616-17-4G0RE3QTEDLIQ"}]
    响应：text/x-component（RSC flight），约 3.2 MB，其中一行是
    {"data":{"status":1,"equip":{...},"status_code":"OK"}}

链路 B（直连 CBG，推荐；无限流、少一个中间人）：
    POST https://yys.cbg.163.com/cgi/api/get_equip_detail?client_type=h5
    form: serverid=17&ordersn=...
    响应：JSON，equip.equip_desc 内联完整的 4.29 MB 导出字符串。

两条链路的 equip 内容一致，本实现默认走链路 B（也可 --via action 走 A）。
"""
from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request

CBG_DETAIL_URL = "https://yys.cbg.163.com/cgi/api/get_equip_detail?client_type=h5"
INSPECTOR_HOME = "https://yys.maydaylands.com/yys-cbg-inspector/home"
# 站点 layout chunk 中的 createServerReference("7f86146e…", …, "getEquipDetailAction")
ACTION_ID = "7f86146ea431565837b3c1a8ca57bc784569cad10e"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0"
)

_CBG_RE = re.compile(r"/equip/(\d+)/([^/?#]+)")


def parse_cbg_url(url: str) -> tuple[str, str]:
    """从商品链接里取 (serverid, ordersn)，与站点 parseCbgUrl 等价。"""
    parsed = urllib.parse.urlparse(url.strip())
    if parsed.scheme not in ("http", "https"):
        raise ValueError("请输入有效的藏宝阁商品链接")
    host = (parsed.hostname or "").lower()
    if host not in ("yys.cbg.163.com", "cbg.163.com"):
        raise ValueError("仅支持阴阳师藏宝阁商品链接")
    m = _CBG_RE.search(parsed.path)
    if not m:
        raise ValueError("链接中没有找到服务器和商品编号")
    return m.group(1), m.group(2)


def fetch_cbg_detail(serverid: str, ordersn: str, referer: str | None = None,
                     timeout: float = 60.0) -> dict:
    """直连 CBG 拉取商品详情（链路 B）。"""
    referer = referer or f"https://yys.cbg.163.com/cgi/mweb/equip/{serverid}/{ordersn}"
    body = urllib.parse.urlencode({"serverid": str(serverid), "ordersn": str(ordersn)}).encode()
    req = urllib.request.Request(
        CBG_DETAIL_URL,
        data=body,
        method="POST",
        headers={
            "User-Agent": UA,
            "Referer": referer,
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if payload.get("status") != 1 or not isinstance(payload.get("equip"), dict):
        raise RuntimeError(f"CBG 返回异常: {payload.get('msg') or payload.get('status')}")
    return payload


def fetch_via_action(serverid: str, ordersn: str, timeout: float = 90.0) -> dict:
    """重放站点 Server Action（链路 A），返回 {"status":1,"equip":…} 的 data 部分。"""
    body = json.dumps([{"serverid": str(serverid), "ordersn": str(ordersn)}],
                      ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        INSPECTOR_HOME,
        data=body,
        method="POST",
        headers={
            "User-Agent": UA,
            "Accept": "text/x-component",
            "Content-Type": "text/plain;charset=UTF-8",
            "next-action": ACTION_ID,
            "Origin": "https://yys.maydaylands.com",
            "Referer": INSPECTOR_HOME,
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        text = resp.read().decode("utf-8", "replace")
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith('{"data"'):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        equip = (obj.get("data") or {}).get("equip")
        if isinstance(equip, dict):
            return {"status": 1, "equip": equip}
    raise RuntimeError("Server Action 响应中未找到 equip 数据（站点可能已更新 action id）")


def fetch(serverid: str, ordersn: str, via: str = "cbg", referer: str | None = None) -> dict:
    if via == "action":
        return fetch_via_action(serverid, ordersn)
    return fetch_cbg_detail(serverid, ordersn, referer=referer)


def fetch_url(url: str, via: str = "cbg") -> dict:
    serverid, ordersn = parse_cbg_url(url)
    return fetch(serverid, ordersn, via=via, referer=url)
