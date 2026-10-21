# 伴生服务安全配置（可选加固）

> 适用对象：`tools/cbg/scraper-service/server.mjs`（127.0.0.1:8791）。
> 本文只讲「怎么开、开了之后行为是什么」；默认行为与旧版一致。

## 0. 默认行为：不设变量 = 鉴权与 CORS 和以前完全一样

不设置任何安全环境变量时：

- CORS 仍回显 `Access-Control-Allow-Origin: *`，任意来源网页都能调用；
- 除 `/api/health` 外没有访问口令；
- 启动时打印两行 `[!]` 告警，明确提示当前是宽松模式；
- 常规请求的接口路径与响应字段未改动（本轮已用 git HEAD 版本逐字节对比默认响应，见第 6 节）。

注意：第 3、4 节的安全校验（URL 白名单、请求体超限 413）**对所有模式生效**，
这是本轮唯一有意的输入侧行为变化；两个合法场景（正常藏宝阁链接、小于 1 MB 的 JSON）
不受影响。

加固是**逐项可选**的：只设令牌、只设白名单、两个都设，都支持。

## 1. 访问令牌：`CBG_PANEL_TOKEN`

```bat
set CBG_PANEL_TOKEN=换成你的随机口令
node tools\cbg\scraper-service\server.mjs
```

等价写法：`--token <口令>`。环境变量与 CLI 同时存在时 CLI 优先；空字符串视为未设置。

| 项目 | 行为 |
|---|---|
| 校验范围 | 除 `/api/health` 外的**所有**接口，含 `/api/soul/*`、`/api/inspector/*`、`/api/shutdown` |
| 凭证位置 | 请求头 `X-Panel-Token`，或 query 参数 `?token=...`（二选一） |
| 失败响应 | HTTP 401 + JSON `{"ok":false,"error":"UNAUTHORIZED",...}` |
| 比较方式 | 两侧先各做 SHA-256，再用 `crypto.timingSafeEqual`：耗时与令牌内容、长度无关 |
| 预检 | `OPTIONS` 不校验令牌（浏览器预检不会带自定义头），否则白名单里的页面也无法发请求 |
| 启动日志 | `访问令牌   已启用（请求头 X-Panel-Token 或 query token）` |

> 注意：内置网页面板目前**没有令牌输入框**。开启令牌后，面板的请求会收到 401；
> 纯浏览器使用建议只开启第 2 节的来源白名单。令牌主要面向脚本、自建代理或自行接入的客户端。

## 2. CORS 来源白名单：`CBG_ALLOWED_ORIGINS`

```bat
set CBG_ALLOWED_ORIGINS=https://smaxhero.github.io,http://127.0.0.1:5173
node tools\cbg\scraper-service\server.mjs
```

等价写法：`--allowed-origins <逗号分隔列表>`。

| 项目 | 行为 |
|---|---|
| 未设置 | 保持 `Access-Control-Allow-Origin: *`，启动打印 `[!]` 告警（旧行为） |
| 已设置 | 仅当请求 `Origin` 在白名单内时回显该 Origin，否则不返回 ACAO（浏览器读不到响应） |
| 缓存 | 白名单模式下所有响应都带 `Vary: Origin`，避免代理/CDN 按 URL 缓存串源 |
| 预检 | `OPTIONS` 仍返回 204，并带上 `Allow-Methods` / `Allow-Headers` / `Max-Age` |
| `null` | 支持：`file://` 页面发出的 `Origin` 字面量就是 `null`，按需加入 |
| 大小写/末尾斜杠 | 比较前统一小写并去掉末尾 `/`，手误不影响匹配 |

说明：白名单外的请求仍会被服务处理（只是浏览器拿不到 ACAO）。这是 CORS 的语义，
不是 403；真正的访问控制靠第 1 节的令牌。列表里不要写 `*`——那会变成一条永远匹配不上的
字面量来源；想恢复宽松模式就不设置该变量。

## 3. `url` 参数白名单（防 SSRF）

`/api/account/analyze` 与 `/api/inspector/*` 接受用户粘贴的藏宝阁链接。现在入口会做校验：

- 完整 URL 必须是 **https**，且主机名以 `.163.com` 结尾（`yys.cbg.163.com`、`cbg.163.com` 等）；
- 不满足返回 400 `{"ok":false,"error":"BAD_URL",...}`，不会转发给内核；
- 相对路径（`/cgi/mweb/...`）与裸 `eid` 不按 URL 处理，保持旧行为；
- `/api/inspector/pve`、`/api/inspector/calc` 的 url 在 POST body 里，也在 Node 层校验一次
  （Python 内核本身已有同样白名单）。

现状补充：当前实现并不会把用户 `url` 原样拿去做网络请求——账号分析只从中正则提取
`eid` / `ordersn`，看号分析由 Python 内核解析。这一层是纵深防御：以后若有人改成「按 url 直连」，
不会顺势多出一个 SSRF 面。

## 4. 请求体大小上限

| 接口 | 上限 | 超限响应 |
|---|---|---|
| JSON 接口（`/api/account/*`、`/api/search` 等） | 1 MB | 413 `BODY_TOO_LARGE` |
| 上传与内核代理（`/api/soul/report/upload` 等） | 32 MB（原有 `readRaw` 限制，未改） | 413 `BODY_TOO_LARGE` |

超限时先写完 413 再关闭连接（`Connection: close`），避免 keep-alive 串包。
页面响应超时沿用原有 CDP 超时（单条命令 60 秒、页间节流 4 秒），本次未改动。

## 5. 启动日志示例

宽松模式（默认）：

```
    [!] 未设置 CBG_PANEL_TOKEN：本机任意网页都可调用该服务（默认行为，未加口令）
    [!] 未设置 CBG_ALLOWED_ORIGINS：CORS 允许任意来源（Access-Control-Allow-Origin: *）
```

加固模式：

```
    访问令牌   已启用（请求头 X-Panel-Token 或 query token；/api/health 除外）
    CORS 白名单 https://smaxhero.github.io, http://127.0.0.1:5173
```

## 6. 自助验证

```bash
# 语法
node --check tools/cbg/scraper-service/server.mjs

# 默认（不设变量）：200 + ACAO: *
node tools/cbg/scraper-service/server.mjs --no-browser &
curl -i http://127.0.0.1:8791/api/health | grep -i access-control

# 设令牌：health 免令牌，其余 401/200
curl -i http://127.0.0.1:8791/api/health
curl -i http://127.0.0.1:8791/api/result
curl -i -H "X-Panel-Token: 你的口令" http://127.0.0.1:8791/api/result

# 来源白名单：只回显配置过的 Origin
curl -i -H "Origin: https://evil.example" http://127.0.0.1:8791/api/health
```

「默认行为未变」的验证方式：把 `git show HEAD:tools/cbg/scraper-service/server.mjs`
输出到同目录的临时文件（相对 import 才能解析），换一个端口启动旧版，再对比
`/api/health`、`/api/result`、`OPTIONS`、404 的响应头与响应体即可。
本轮对比结果：除启动横幅新增两行安全提示外，API 响应完全一致。

测完记得停掉服务（`Ctrl+C` 或删掉启动的进程）。Windows 下用 `start.bat` 时，
环境变量需要用 `setx` 设置后才对它生效（见 [self-host.md](self-host.md)）。

## 7. 边界与注意事项

- 服务始终只监听 `127.0.0.1`；不要为了远程访问改成 `0.0.0.0`，那会让令牌/白名单以外的风险成倍增加。
- 令牌放 query 里会被本机日志（`server.out.log`）记录，敏感环境请优先用请求头。
- 令牌只保护「谁能调用」，不保护「调用后能查什么」：登录态仍在本地浏览器 profile 里。
- 本文件描述的是伴生服务；仓库根目录的 `SECURITY.md` 讲的是密钥与提交卫生，两者互补。
