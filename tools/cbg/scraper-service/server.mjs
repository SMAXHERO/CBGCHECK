#!/usr/bin/env node
/**
 * server.mjs — 藏宝阁实时查询伴随服务（供网页模块调用）
 *
 * 为什么需要它：藏宝阁的搜索接口要求登录态，而浏览器的 Cookie 按域名隔离，
 * 网页（无论部署在哪）都不可能自己带着会话去请求。所以会话必须长在一个
 * 「真实浏览器」里——这个服务负责拉起浏览器、借用它的登录态发请求，
 * 再通过 HTTP 把结果交给网页。
 *
 * 与 cbg-filter-kit 的关系：浏览器驱动部分（CDP 接管、页面内 fetch、节流）
 * 沿用同一套已验证的做法；差别是这里只提供 JSON API，并带 CORS，
 * 供独立的网页前端调用。
 *
 * 用法：
 *   node tools/cbg/scraper-service/server.mjs
 *   node tools/cbg/scraper-service/server.mjs --port 8791 --cdp-port 9334 --headless
 *
 * 首次使用需在弹出的浏览器窗口里登录一次藏宝阁；登录态保存在本目录 profile/ 下。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeAccount, parseAccountInput, probeAccount, rescoreAccount } from './accountAnalyze.mjs';
import { DEFAULT_TTL_MS as ANALYSIS_TTL_MS, readAnalysisCache, writeAnalysisCache } from './analysisCache.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ 参数 ------------------------------ */

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const CONFIG = {
  port: Number(arg('port', process.env.CBG_PORT ?? 8791)),
  cdpPort: Number(arg('cdp-port', process.env.CBG_CDP_PORT ?? 9334)),
  host: arg('host', 'yys.cbg.163.com'),
  pageSize: 15, // 站点固定每页 15 条
  /**
   * 单次查询的页数上限。实测：累计约 250 条（≈17 页）后站点必定限流，
   * 先后出现过 CAPTCHA_AUTH / MOBILE_AUTH。所以默认收到 8 页（120 条），
   * 留出安全余量；想抓更多请用 --max-pages 自己承担风险。
   */
  maxPages: Number(arg('max-pages', 8)),
  /**
   * 页间间隔。1.6 秒时约 120 条就被拦；默认放宽到 4 秒，
   * 配合 8 页上限，单次查询约 28 秒。
   */
  pageDelayMs: Number(arg('delay', 4000)),
  /**
   * 模块二分析结果缓存有效期（毫秒），默认 10 分钟。
   * 页面刷新/重复打开时优先走缓存，显式传 refresh=1 才重新抓。
   */
  analysisTtlMs: Number(arg('analysis-ttl', process.env.CBG_ANALYSIS_TTL_MS ?? ANALYSIS_TTL_MS)),
  /** 自动取分（B1）单轮最多请求数，防止把接口打出风控 */
  rescoreMaxRequests: Number(arg('rescore-max', 20)),
  headless: hasFlag('headless'),
  /** 只起 HTTP 服务，不拉浏览器（调试接口 / 只用模块三御魂报告时使用） */
  noBrowser: hasFlag('no-browser'),
  browser: arg('browser', process.env.CBG_BROWSER ?? ''),
  profileDir: arg('profile', path.join(__dirname, 'profile')),

  /**
   * 模块三「御魂报告」计算内核（Python）。
   *
   * 为什么不把计算塞进 Node：评分/一速/组合搜索来自对 yys照妖镜 的逆向复刻，
   * 已在 Python 侧逐项对拍验证（calc_demo / parse_equip）；直接复用比在 Node 重写稳。
   * Node 只做两件事：拉起这个内核 + 把 /api/soul/* 反向代理过去（顺便统一 CORS）。
   */
  soulPort: Number(arg('soul-port', process.env.CBG_SOUL_PORT ?? 8792)),
  soulPython: arg('soul-python', process.env.CBG_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')),
  soulDir: arg('soul-dir', path.join(__dirname, '..', 'soul-service')),

  /**
   * 模块四「看号分析」计算内核（Python）。
   *
   * 能力来自对 yys-cbg-inspector 的蒸馏复刻（速度盘点 / PVE 预览 / 式神技能 /
   * 御魂库存 / 御魂计算器），已在 Python 侧用 97 项数字与页面逐项对拍。
   * 与模块三同样：Node 只负责拉起内核 + 代理 /api/inspector/*。
   */
  inspectorPort: Number(arg('inspector-port', process.env.CBG_INSPECTOR_PORT ?? 8793)),
  inspectorPython: arg('inspector-python', process.env.CBG_INSPECTOR_PYTHON ?? process.env.CBG_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')),
  inspectorDir: arg('inspector-dir', path.join(__dirname, '..', 'inspector-service')),
};

/**
 * 模块二分析缓存 key：eid + 式神组合 + subOnly 口径。
 * 分析（analyze）与自动取分（rescore）必须用同一个 key，否则取不到上次结果。
 */
function analysisCacheKey(eid, heroes, subOnly) {
  const heroHash = createHash('sha1')
    .update(JSON.stringify([...(heroes || [])].sort()))
    .digest('hex')
    .slice(0, 8);
  return `${eid}${subOnly ? '-sub' : ''}-${heroHash}`;
}

/* ------------------------------ 找浏览器 ------------------------------ */

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

function findBrowser() {
  if (CONFIG.browser) return CONFIG.browser;
  for (const p of CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  throw new Error('没找到 Edge/Chrome，请用 --browser <路径> 指定');
}

/* ------------------------------ 状态 ------------------------------ */

const state = {
  /** starting | need-login | need-captcha | ready | error */
  status: 'starting',
  message: '正在启动浏览器…',
  /** 最近一次成功查询的时间 */
  lastSuccessAt: null,
  /** 最近一次查询覆盖的总条数（站点口径） */
  lastTotal: null,
  /** 当前正在跑的查询任务 */
  job: null,
  /** 浏览器是否已就绪 */
  browserReady: false,
  logs: [],
};

/**
 * 可中断的等待。
 *
 * 页间节流是 4 秒——如果取消只能在「两页之间」生效，用户点了取消还要再等 4 秒才看到反应。
 * 这里把等待切成 100ms 的小片，每片检查一次取消标志，做到近乎即时响应。
 * 注：已经开始的那一次 HTTP 请求无法中断（请求由页面里的 fetch 发出），
 * 所以最坏情况是「当前这一页取完就停」，通常不到 1 秒。
 */
async function sleepInterruptible(ms, job) {
  const step = 100;
  for (let waited = 0; waited < ms; waited += step) {
    if (job && job.cancelRequested) return false;
    await sleep(Math.min(step, ms - waited));
  }
  return !(job && job.cancelRequested);
}

function log(text) {
  const line = `${new Date().toLocaleTimeString('zh-CN')}  ${text}`;
  state.logs.push(line);
  if (state.logs.length > 200) state.logs.shift();
  console.log(line);
}

/** 把失败归类成前端能给出明确指引的状态 */
function classify(code, msg) {
  if (code === 'SESSION_TIMEOUT' || code === 'e12') {
    state.status = 'need-login';
    state.message = '登录态失效，请在浏览器窗口里重新登录藏宝阁';
  } else if (code === 'CAPTCHA_AUTH' || code === 'MOBILE_AUTH') {
    // 滑块 / 手机验证与登录失效是两件事：登录页解决不了验证，指引必须分开。
    // MOBILE_AUTH 是「进行安全验证」的另一种表现（实测跑到约 250 条时出现）。
    state.status = 'need-captcha';
    state.message =
      '触发了站点的安全验证（滑块/手机验证）。这通常是短时间内查询太多导致的：' +
      '请等 2~5 分钟，然后到浏览器窗口里打开任意商品页完成验证，再回来重新查询。';
  } else if (code === 'NON_JSON') {
    state.status = 'need-captcha';
    state.message = '接口返回了非 JSON 内容，通常是安全验证。请在浏览器窗口里完成验证后重试。';
  } else {
    state.status = 'error';
    state.message = `查询失败：${code}${msg ? ` · ${msg}` : ''}`;
  }
  // 失败时清掉进度条数：否则界面会显示「已取回 15 条」这种失败前半页的残留，
  // 看着像查成功了。页数保留，用来说明「跑到第几页被拦」。
  if (state.job) {
    state.job.count = 0;
    state.job.total = null;
  }
}

/* ------------------------------ 启动浏览器 ------------------------------ */

fs.mkdirSync(CONFIG.profileDir, { recursive: true });

function browserBuildArgs() {
  return [
    ...(CONFIG.headless
      ? ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=520,1000']
      : ['--window-size=520,1000', '--window-position=80,60']),
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${CONFIG.cdpPort}`,
    `--user-data-dir=${CONFIG.profileDir}`,
    'about:blank',
  ];
}

/**
 * --no-browser：只起 HTTP 服务（含模块三内核），不拉起浏览器。
 * 用途：在没有桌面/浏览器的环境里调试接口，或只想用模块三的御魂报告。
 */
let browser = null;
if (!CONFIG.noBrowser) {
  try {
    const bp = findBrowser();
    log(`浏览器：${bp}`);
    browser = spawn(bp, browserBuildArgs(), { stdio: 'ignore' });
    /**
     * spawn 的失败是异步的：没监听 'error' 会变成未捕获异常，整个服务直接退出。
     * 没浏览器时降级为「只有模块三可用」，而不是拒绝启动。
     */
    browser.on('error', (err) => {
      state.status = 'error';
      state.browserReady = false;
      state.message = `浏览器启动失败：${err.message}。模块一/二不可用，模块三仍可用（或加 --no-browser 跳过浏览器）`;
      log(state.message);
      browser = null;
    });
  } catch (err) {
    state.status = 'error';
    state.browserReady = false;
    state.message = `没找到可用浏览器（Edge/Chrome）：${err.message}。模块一/二不可用，模块三仍可用（或加 --no-browser）`;
    log(state.message);
  }
}

async function waitForDevtools() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${CONFIG.cdpPort}/json/version`);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(400);
  }
  throw new Error(`浏览器调试端口未就绪，确认 ${CONFIG.cdpPort} 没被占用`);
}

let ws;
let msgId = 0;
const pending = new Map();

/**
 * 发送一条 CDP 命令。
 *
 * 带超时：页面里的 fetch 有可能静默挂住（网络卡住、页面被切到后台节流），
 * 不设超时的话整个查询会无限期停在这一页——这正是「查询时间太长」的一种成因。
 * 超时时把 pending 条目清掉，避免 Map 无限增长。
 */
const send = (method, params = {}, timeoutMs = 60000) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`页面响应超时（${timeoutMs}ms）：${method}`));
    }, timeoutMs);
    pending.set(id, (v) => {
      clearTimeout(timer);
      resolve(v);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });

async function evalInPage(expression, timeoutMs) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (r?.exceptionDetails) {
    throw new Error('页面执行异常：' + JSON.stringify(r.exceptionDetails).slice(0, 200));
  }
  return r?.result?.value;
}

async function boot() {
  if (CONFIG.noBrowser) {
    state.status = 'offline';
    state.message = '未启动浏览器（--no-browser）：模块一/二不可用，模块三「御魂报告」可用';
    log(state.message);
    return;
  }
  if (!browser) {
    // 浏览器没起来（没装 Edge/Chrome 或 spawn 失败）：不要卡在等 DevTools 端口，直接降级
    state.status = 'error';
    state.browserReady = false;
    state.message = state.message || '浏览器未启动：模块一/二不可用，模块三仍可用';
    log(state.message);
    return;
  }
  try {
    await waitForDevtools();
    const targets = await (await fetch(`http://127.0.0.1:${CONFIG.cdpPort}/json/list`)).json();
    const page = targets.find((t) => t.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('无法连接浏览器调试通道'));
    });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg.result);
        pending.delete(msg.id);
      }
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: `https://${CONFIG.host}/` });
    await sleep(3000);
    state.browserReady = true;
    // 先给「待确认」而不是「已登录」：登录态只有真查一次才知道
    state.status = 'ready';
    state.message = '浏览器已就绪。若查询提示登录失效，请在浏览器窗口里登录一次。';
    log(`浏览器就绪，已打开 https://${CONFIG.host}/`);
  } catch (err) {
    state.status = 'error';
    state.message = err.message;
    log(`启动失败：${err.message}`);
  }
}

/* ------------------------------ 查询 ------------------------------ */

const HOST_RE = () => new RegExp(`^https://${CONFIG.host.replace(/\./g, '\\.')}/`);

async function ensureOnHost() {
  const href = await evalInPage('location.href');
  if (!HOST_RE().test(String(href))) {
    log(`先回到 ${CONFIG.host} …`);
    await send('Page.navigate', { url: `https://${CONFIG.host}/` });
    await sleep(4000);
  }
}

/** 接口返回的原始行 -> 前端需要的规范字段（与抓取脚本口径保持一致） */
function mapRow(r) {
  const hl = Array.isArray(r.highlights) ? r.highlights : [];
  const pick = (re) => {
    for (const h of hl) {
      const m = String(h).match(re);
      if (m) return Number(m[1]);
    }
    return null;
  };
  const desc = r.desc_sumup_short || '';
  const num = (re) => {
    const m = desc.match(re);
    return m ? Number(m[1]) : null;
  };
  const touWei = String(hl.find((h) => /\d+头\d+尾/.test(h)) ?? '').match(/(\d+)头(\d+)尾/);

  return {
    // 商品详情页的 URL 末段必须是 game_ordersn（订单号），
    // 不是 eid —— 两者都是 "时间戳-区服-随机串" 的形状，极易搞混，
    // 用错会跳到不存在的商品页。证据：站点列表页里的真实链接是
    //   /cgi/mweb/equip/12/202610160301613-12-SDI0LBZYNXWYY
    // 而该行的 game_ordersn 正是这个串、eid 是另一个（...-17-...）。
    id: r.game_ordersn || r.eid,
    order_sn: r.game_ordersn || '',
    /** 另一个 ID，保留用于溯源排查 */
    eid: r.eid || '',
    title: r.format_equip_name || r.title || '未命名账号',
    price: Number(r.price) || null,
    collect_num: Number(r.collect_num) || 0,
    server_id: r.serverid ?? null,
    server_name: r.server_name || '',
    area_name: r.area_name || '',
    platform_type: r.platform_type ?? null,
    equip_level: r.equip_level ?? null,
    level_desc: r.level_desc || '',
    ssr: num(/SSR\s*(\d+)/),
    six_star: num(/六星式神\s*(\d+)/),
    sign_days: num(/签到\s*(\d+)\s*天/),
    sanjian_speed: pick(/散件一速\s*([\d.]+)/),
    zhaocai_speed: pick(/招财一速\s*([\d.]+)/),
    tou_num: touWei ? Number(touWei[1]) : null,
    wei_num: touWei ? Number(touWei[2]) : null,
    tou_speed: pick(/头速度\s*([\d.]+)/),
    pvp: pick(/斗技\s*(\d+)/),
    titles: hl.filter((h) => /^(地域·|终极之巅|征服世界|日月同辉)/.test(h)),
    highlights: hl,
    icon: r.icon || '',
    selling_time: r.selling_time || '',
    fair_show_end_time: r.fair_show_end_time || '',
    expire_remain_seconds: r.expire_remain_seconds ?? null,
    expire_remain_hours: r.expire_remain_seconds
      ? Math.round((r.expire_remain_seconds / 3600) * 10) / 10
      : null,
    status: r.status ?? null,
    status_label: { 1: '已下架', 2: '在售', 3: '公示期', 4: '已售出' }[r.status] ?? '未知',
    allow_bargain: Boolean(r.allow_bargain),
    is_ad: Boolean(r.is_ad),
    source_tag: 'live',
    captured_at: new Date().toISOString(),
  };
}

/**
 * 执行一次查询。逐页拉取，页间节流；每页都更新进度，前端可轮询。
 *
 * 支持取消（job.cancelRequested）：在「每页开始前」和「页间等待中」检查，
 * 命中就立刻收尾，把已取到的部分结果返回（前端会标注这是不完整的结果）。
 */
async function runSearch(values, maxPages) {
  const job = state.job;
  await ensureOnHost();

  // 取消后用户可能立刻发起新查询。此时上一个 runSearch 还在收尾
  // （它得等当前这一页的请求返回），如果它稍后把结果写回 state.job，
  // 就会覆盖掉新任务的状态。所以这里先等它让位，超时则直接报错。
  for (let i = 0; i < 50 && state.job !== job; i += 1) {
    await sleep(200);
  }
  if (state.job !== job) {
    return { ok: false, error: 'SUPERSEDED', msg: '已被更新的查询取代', rows: [] };
  }

  const rows = [];
  const seen = new Set();
  let total = null;
  let pages = 0;

  const limit = Math.min(Number(maxPages) || CONFIG.maxPages, CONFIG.maxPages);

  for (let p = 1; p <= limit; p += 1) {
    // 上一页与当前页之间可能隔了 4 秒节流，取消请求多半在这期间到达
    if (job?.cancelRequested) {
      log(`已取消：第 ${p} 页开始前停止，保留已取到的 ${rows.length} 条`);
      state.status = 'ready';
      state.message = '就绪';
      return { ok: true, cancelled: true, rows, meta: { total, pages, count: rows.length } };
    }

    const params = {
      ...values,
      search_type: values.search_type || 'role',
      client_type: 'h5',
      view_loc: 'equip_list',
      page: String(p),
      count: String(CONFIG.pageSize),
    };

    const text = await evalInPage(
      `
      (async () => {
        const r = await fetch('/cgi/api/query', {
          method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest' },
          body: new URLSearchParams(${JSON.stringify(params)}),
        });
        return await r.text();
      })()
    `,
      // 单页请求正常在几秒内返回；20 秒还没回来基本是挂住了，
      // 与其让用户干等，不如报错让他重试或取消
      20000,
    );

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      state.job.error = 'NON_JSON';
      classify('NON_JSON');
      return { ok: false, error: 'NON_JSON', raw: String(text).slice(0, 200), rows };
    }

    if (json.status !== 1) {
      state.job.error = json.status_code || 'ERROR';
      classify(json.status_code, json.msg);
      return { ok: false, error: json.status_code || 'ERROR', msg: json.msg, rows };
    }

    if (p === 1) {
      total = json.total_num ?? 0;
      state.lastTotal = total;
    }

    const batch = json.result || [];
    for (const r of batch) {
      const row = mapRow(r);
      if (row.id && !seen.has(row.id)) {
        seen.add(row.id);
        rows.push(row);
      }
    }
    pages = p;

    // 进度写进任务状态，前端轮询即可看到
    state.job.pages = p;
    state.job.count = rows.length;
    state.job.total = total;
    log(`第 ${p} 页：累计 ${rows.length} 条（站点共 ${total} 条）`);

    if (batch.length < CONFIG.pageSize || json.paging?.is_last_page) break;

    // 页间节流（可中断）：用户点取消时立刻返回，不用干等满 4 秒
    const waited = await sleepInterruptible(CONFIG.pageDelayMs, job);
    if (!waited) {
      log(`已取消：取到第 ${p} 页共 ${rows.length} 条后停止`);
      state.status = 'ready';
      state.message = '就绪';
      return { ok: true, cancelled: true, rows, meta: { total, pages, count: rows.length } };
    }
  }

  state.status = 'ready';
  state.message = '就绪';
  state.lastSuccessAt = new Date().toISOString();
  return { ok: true, rows, meta: { total, pages, count: rows.length } };
}

/* ------------------------------ HTTP ------------------------------ */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '600',
};

function json(res, code, payload) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS });
  res.end(JSON.stringify(payload));
}

/* ------------------------------ 模块三：御魂报告内核 ------------------------------ */

/**
 * 模块三 = Node 代理 + Python 内核（tools/cbg/soul-service）。
 *
 * 前端只认一个地址（SCRAPER_BASE），所以 /api/soul/* 由本服务代理到内核，
 * 这样：
 *   - 浏览器不用再关心第二个端口，也不会踩跨源问题；
 *   - 内核没起来时能返回结构化错误，而不是让前端 fetch 直接 reject；
 *   - 上传（multipart）按原始字节转发，不经过 JSON 解析，2~3 MB 的 yyx 不会被破坏。
 */
const soul = {
  proc: null,
  ready: false,
  message: '未启动',
  port: CONFIG.soulPort,
};

function startSoulService() {
  const script = path.join(CONFIG.soulDir, 'server.py');
  if (!fs.existsSync(script)) {
    soul.message = `找不到内核脚本：${script}`;
    log(`[soul] ${soul.message}`);
    return;
  }

  /**
   * 内核日志写文件而不是接管道。
   * 原因：管道 stdio 在部分受限环境（沙箱/无桌面 CI）会 EPERM；文件句柄则到处都能用，
   * 而且日志能留档（soul-service.log 已被 .gitignore 忽略）。
   */
  let outFd = 'ignore';
  const soulLog = path.join(__dirname, 'soul-service.log');
  try {
    outFd = fs.openSync(soulLog, 'a');
  } catch {
    /* 打不开就丢弃日志，不影响功能 */
  }

  try {
    soul.proc = spawn(
      CONFIG.soulPython,
      [script, '--host', '127.0.0.1', '--port', String(CONFIG.soulPort), '--data-dir', path.join(CONFIG.soulDir, 'data')],
      { cwd: CONFIG.soulDir, stdio: ['ignore', outFd, outFd] },
    );
  } catch (err) {
    soul.message = `启动失败：${err.message}（可用 --no-browser 单独调试）`;
    log(`[soul] ${soul.message}`);
    return;
  }
  soul.proc.on('error', (err) => {
    soul.ready = false;
    soul.message = `内核无法启动：${err.message}（检查 Python 与 requests）`;
    log(`[soul] ${soul.message}`);
  });
  soul.proc.on('exit', (code) => {
    soul.ready = false;
    soul.message = `内核已退出（code ${code}）`;
    log(`[soul] ${soul.message}`);
  });
  log(`[soul] 正在启动内核（python=${CONFIG.soulPython}，日志 ${soulLog}）`);

  // 轮询就绪（最多 ~20 秒）
  (async () => {
    for (let i = 0; i < 40; i += 1) {
      try {
        const r = await fetch(`http://127.0.0.1:${CONFIG.soulPort}/api/soul/health`);
        if (r.ok) {
          soul.ready = true;
          soul.message = '就绪';
          log(`[soul] 御魂报告内核已就绪（端口 ${CONFIG.soulPort}）`);
          return;
        }
      } catch {}
      await sleep(500);
    }
    soul.message = '启动超时（检查 Python/requests 是否可用）';
    log(`[soul] ${soul.message}`);
  })();
}

function stopSoulService() {
  try {
    soul.proc?.kill();
  } catch {}
}

function readRaw(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function proxySoul(req, res, url) {
  const target = `http://127.0.0.1:${CONFIG.soulPort}${url.pathname}${url.search}`;
  const headers = {};
  const ct = req.headers['content-type'];
  if (ct) headers['content-type'] = ct;

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      body = await readRaw(req);
    } catch (err) {
      json(res, 413, { ok: false, error: 'BODY_TOO_LARGE', message: err.message });
      return;
    }
  }

  try {
    const r = await fetch(target, { method: req.method, headers, body });
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, {
      'content-type': r.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS,
    });
    res.end(buf);
  } catch (err) {
    json(res, 503, {
      ok: false,
      error: 'SOUL_SERVICE_UNAVAILABLE',
      message: `御魂报告内核未就绪（${soul.message}）：${err.message}`,
    });
  }
}

/* ------------------------------ 模块四：看号分析内核 ------------------------------ */

/**
 * 模块四 = Node 代理 + Python 内核（tools/cbg/inspector-service）。
 *
 * 和模块三同一套做法：前端只认 SCRAPER_BASE，/api/inspector/* 在这里转发。
 * 计算器/PVE 是异步任务（POST 拿 jobId，再轮询 GET /job?id=），代理保持原样。
 */
const inspector = {
  proc: null,
  ready: false,
  message: '未启动',
  port: CONFIG.inspectorPort,
};

function startInspectorService() {
  const script = path.join(CONFIG.inspectorDir, 'server.py');
  if (!fs.existsSync(script)) {
    inspector.message = `找不到内核脚本：${script}`;
    log(`[inspector] ${inspector.message}`);
    return;
  }

  let outFd = 'ignore';
  const inspLog = path.join(__dirname, 'inspector-service.log');
  try {
    outFd = fs.openSync(inspLog, 'a');
  } catch {
    /* 打不开就丢弃日志 */
  }

  try {
    inspector.proc = spawn(
      CONFIG.inspectorPython,
      [
        script,
        '--host', '127.0.0.1',
        '--port', String(CONFIG.inspectorPort),
        '--data-dir', path.join(CONFIG.inspectorDir, 'data'),
      ],
      { cwd: CONFIG.inspectorDir, stdio: ['ignore', outFd, outFd] },
    );
  } catch (err) {
    inspector.message = `启动失败：${err.message}`;
    log(`[inspector] ${inspector.message}`);
    return;
  }
  inspector.proc.on('error', (err) => {
    inspector.ready = false;
    inspector.message = `内核无法启动：${err.message}（检查 Python）`;
    log(`[inspector] ${inspector.message}`);
  });
  inspector.proc.on('exit', (code) => {
    inspector.ready = false;
    inspector.message = `内核已退出（code ${code}）`;
    log(`[inspector] ${inspector.message}`);
  });
  log(`[inspector] 正在启动内核（python=${CONFIG.inspectorPython}，日志 ${inspLog}）`);

  (async () => {
    for (let i = 0; i < 40; i += 1) {
      try {
        const r = await fetch(`http://127.0.0.1:${CONFIG.inspectorPort}/api/inspector/health`);
        if (r.ok) {
          inspector.ready = true;
          inspector.message = '就绪';
          log(`[inspector] 看号分析内核已就绪（端口 ${CONFIG.inspectorPort}）`);
          return;
        }
      } catch {}
      await sleep(500);
    }
    inspector.message = '启动超时（检查 Python 是否可用）';
    log(`[inspector] ${inspector.message}`);
  })();
}

function stopInspectorService() {
  try {
    inspector.proc?.kill();
  } catch {}
}

async function proxyInspector(req, res, url) {
  const target = `http://127.0.0.1:${CONFIG.inspectorPort}${url.pathname}${url.search}`;
  const headers = {};
  const ct = req.headers['content-type'];
  if (ct) headers['content-type'] = ct;

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      body = await readRaw(req);
    } catch (err) {
      json(res, 413, { ok: false, error: 'BODY_TOO_LARGE', message: err.message });
      return;
    }
  }

  try {
    const r = await fetch(target, { method: req.method, headers, body });
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, {
      'content-type': r.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS,
    });
    res.end(buf);
  } catch (err) {
    json(res, 503, {
      ok: false,
      error: 'INSPECTOR_SERVICE_UNAVAILABLE',
      message: `看号分析内核未就绪（${inspector.message}）：${err.message}`,
    });
  }
}

/**
 * 记录请求来源。
 *
 * 用途：分辨「请求到底来自哪个页面」——本机 dev(http://127.0.0.1:5173)、
 * 本机预览(4173)、还是公网那版(https://user.github.io/...)。
 * 排查「公网版能不能连到本地服务」这类问题时，这是唯一一锤定音的证据。
 * 顺便也说明：只要服务收到的 origin 是 github.io，就证明浏览器没拦住——
 * 反之，如果公网页面里显示有数据、而这里始终没有 github.io 的 origin，
 * 那说明那个页面上显示的数据不是这个服务给的。
 */
function logOrigin(req, p) {
  const origin = req.headers.origin || '(无 Origin 头)';
  const ua = String(req.headers['user-agent'] || '').slice(0, 40);
  log(`← ${req.method} ${p}  origin=${origin}  ua=${ua}`);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  /**
   * 模块三：御魂报告 —— 全部转发给 Python 内核（tools/cbg/soul-service）。
   *
   * 前端只认本服务一个地址，所以这里做透明代理：
   *   GET  /api/soul/health | meta | demo | report | precise
   *   POST /api/soul/report/upload | search
   * 上传请求按原始字节转发（multipart 不能被 JSON 解析）。
   */
  if (p.startsWith('/api/soul/')) {
    await proxySoul(req, res, url);
    return;
  }

  /**
   * 模块四：看号分析 —— 全部转发给 Python 内核（tools/cbg/inspector-service）。
   *
   *   GET  /api/inspector/health | meta | demo | report | relics
   *   POST /api/inspector/pve | calc        → { jobId }
   *   GET  /api/inspector/job?id=…          → { job }
   */
  if (p.startsWith('/api/inspector/')) {
    await proxyInspector(req, res, url);
    return;
  }

  /**
   * 模块二：账号评分。
   *
   * POST /api/account/analyze  body: { url?, eid?, serverid?, heroes?: string[], subOnly?: boolean, refresh?: boolean }
   * GET  /api/account/analyze?eid=..&serverid=..&heroes=须佐之男,阿修罗&subOnly=1&refresh=1
   *
   * refresh 不传时优先返回 analysisCache 里的结果（默认 10 分钟，见 --analysis-ttl）；
   * 页面上的「刷新/重新分析」会显式传 refresh=1 强制重新抓取。
   *
   * 为什么必须由服务端代理：藏宝阁这三个接口**没有 CORS 头**，浏览器直连会被拦。
   * 而且必须走**已登录的页面上下文**——匿名 Node 请求在风控升级后会被判 SESSION_TIMEOUT。
   */

  /**
   * 轻量探测：只返回「御魂数量」与「每个式神第一套方案能否算出分」。
   *
   * GET /api/account/probe?eid=..&serverid=..
   *
   * 固定 4 个请求/账号（详情 + 方案清单 + 每式神 1 次），
   * 专门用于「御魂数 → 出分率」这类抽样统计，不适合做完整分析。
   */
  if (p === '/api/account/probe') {
    const eid = url.searchParams.get('eid') || '';
    const serverid = url.searchParams.get('serverid') || '';
    const heroes = url.searchParams.get('heroes')
      ? url.searchParams.get('heroes').split(',').filter(Boolean)
      : ['须佐之男', '阿修罗'];
    if (!eid || !serverid) {
      json(res, 400, { ok: false, error: 'BAD_ARGS', message: '需要 eid 与 serverid' });
      return;
    }
    try {
      await ensureOnHost();
      const result = await probeAccount({
        eid,
        serverid,
        heroes,
        pageGet: async (path) =>
          evalInPage(
            `(async () => {
               const r = await fetch(${JSON.stringify(path)}, {
                 credentials: 'include',
                 headers: { 'x-requested-with': 'XMLHttpRequest' }
               });
               return await r.text();
             })()`,
            60000,
          ),
        // 给 probe 用的「在页面里解析、只回传数字」通道（详情有 2.6MB，不能整个搬回来）
        pageEval: (expression) => evalInPage(expression, 60000),
      });
      json(res, 200, result);
    } catch (err) {
      log(`账号探测失败：${err.message}`);
      json(res, 500, { ok: false, error: 'PROBE_FAILED', message: err.message });
    }
    return;
  }

  /**
   * B1：冷计算账号自动取分。
   *
   * POST /api/account/rescore  body: { eid, serverid, heroes?: string[], subOnly?: boolean }
   *
   * 只重试上一次分析结果里「还在排队计算」的方案：
   *   - 不重新拉详情、不重新拉方案清单（省请求，也避免重复触发风控）；
   *   - 从分析缓存读取上次结果（允许已过 TTL），把新分数合并回缓存；
   *   - 单轮最多 CONFIG.rescoreMaxRequests 个请求，触发风控立即停止。
   */
  if (p === '/api/account/rescore') {
    let args;
    if (req.method === 'POST') {
      const body = await readBody(req);
      args = {
        eid: body.eid,
        serverid: body.serverid,
        heroes: Array.isArray(body.heroes) ? body.heroes : undefined,
        subOnly: Boolean(body.subOnly),
      };
    } else {
      args = {
        eid: url.searchParams.get('eid') || undefined,
        serverid: url.searchParams.get('serverid') || undefined,
        heroes: url.searchParams.get('heroes') ? url.searchParams.get('heroes').split(',').filter(Boolean) : undefined,
        subOnly: url.searchParams.get('subOnly') === '1',
      };
    }

    try {
      if (!args.eid || !args.serverid) {
        json(res, 400, { ok: false, error: 'BAD_ARGS', message: '需要 eid 与 serverid' });
        return;
      }
      const heroesWanted = args.heroes && args.heroes.length ? args.heroes : ['须佐之男', '阿修罗'];
      const cacheKeyEid = analysisCacheKey(args.eid, heroesWanted, args.subOnly);
      const cached = readAnalysisCache(cacheKeyEid, { allowExpired: true });
      if (!cached) {
        json(res, 409, {
          ok: false,
          error: 'NO_CACHE',
          message: '还没有这个账号的分析结果，请先点「开始分析」，再使用自动取分。',
        });
        return;
      }

      logOrigin(req, p);
      log(`自动取分：eid=${args.eid} 上次分析 ${Math.round(cached.ageMs / 1000)} 秒前`);
      await ensureOnHost();
      const out = await rescoreAccount({
        eid: cached.data.eid || args.eid,
        serverid: args.serverid,
        previous: cached.data,
        maxRequests:
          Number.isFinite(CONFIG.rescoreMaxRequests) && CONFIG.rescoreMaxRequests > 0
            ? CONFIG.rescoreMaxRequests
            : 20,
        pageGet: async (path) =>
          evalInPage(
            `(async () => {
               const r = await fetch(${JSON.stringify(path)}, {
                 credentials: 'include',
                 headers: { 'x-requested-with': 'XMLHttpRequest' }
               });
               return await r.text();
             })()`,
            60000,
          ),
      });

      // 把本轮取到的分数合并回缓存，下次「刷新」前都能看到最新分
      const merged = {
        ...cached.data,
        heroes: out.heroes,
        meta: {
          ...(cached.data.meta || {}),
          requestCount: (cached.data.meta?.requestCount ?? 0) + out.meta.requestCount,
          durationMs: (cached.data.meta?.durationMs ?? 0) + out.meta.durationMs,
          lastRetry: out.meta,
        },
        errorCode: out.errorCode ?? cached.data.errorCode ?? null,
      };
      const saved = writeAnalysisCache(cacheKeyEid, merged);
      log(
        `自动取分完成：本轮请求 ${out.meta.requestCount} 个，仍缺 ${out.meta.stillPending} 套` +
          (out.blocked ? `（触发风控 ${out.errorCode}）` : ''),
      );
      json(res, 200, {
        ok: true,
        heroes: out.heroes,
        meta: out.meta,
        blocked: out.blocked,
        errorCode: out.errorCode,
        cachedAt: saved?.generatedAt ?? null,
      });
    } catch (err) {
      log(`自动取分失败：${err.message}`);
      json(res, 500, { ok: false, error: err.code || 'RESCORE_FAILED', message: err.message });
    }
    return;
  }

  if (p === '/api/account/analyze') {
    let args;
    if (req.method === 'POST') {
      const body = await readBody(req);
      args = {
        url: body.url,
        eid: body.eid,
        serverid: body.serverid,
        heroes: Array.isArray(body.heroes) ? body.heroes : undefined,
        subOnly: Boolean(body.subOnly),
        refresh: Boolean(body.refresh),
      };
    } else {
      args = {
        eid: url.searchParams.get('eid') || undefined,
        serverid: url.searchParams.get('serverid') || undefined,
        url: url.searchParams.get('url') || undefined,
        heroes: url.searchParams.get('heroes') ? url.searchParams.get('heroes').split(',').filter(Boolean) : undefined,
        subOnly: url.searchParams.get('subOnly') === '1',
        refresh: url.searchParams.get('refresh') === '1',
      };
    }

    try {
      // 允许用户只粘一个地址，服务端自己拆 eid / serverid
      if (args.url) {
        const parsed = parseAccountInput(args.url);
        if (parsed.needsEid) {
          json(res, 400, {
            ok: false,
            error: 'NEED_EID',
            message:
              '这个地址里只有 ordersn，接口需要 eid。请改粘「御魂搭配」地址（含 eid=…），' +
              '或另外提供 eid。获取办法：页面打开「御魂搭配」弹窗，复制弹窗 iframe 的地址。',
            parsed,
          });
          return;
        }
        args.eid = args.eid || parsed.eid;
        args.serverid = args.serverid || parsed.serverid;
      }
      if (!args.eid || !args.serverid) {
        json(res, 400, { ok: false, error: 'BAD_ARGS', message: '需要 eid 与 serverid（或一个含 eid 的地址）' });
        return;
      }

      logOrigin(req, p);
      log(`账号评分：eid=${args.eid} serverid=${args.serverid}`);

      const ttlMs =
        Number.isFinite(CONFIG.analysisTtlMs) && CONFIG.analysisTtlMs > 0 ? CONFIG.analysisTtlMs : ANALYSIS_TTL_MS;
      const heroesWanted = args.heroes && args.heroes.length ? args.heroes : ['须佐之男', '阿修罗'];
      // 缓存 key 带上 heroes / subOnly 口径：不同式神组合不能命中同一份结果
      const cacheKeyEid = analysisCacheKey(args.eid, heroesWanted, args.subOnly);

      // A5：优先返回未过期的分析缓存，避免重复分析反复请求藏宝阁
      if (!args.refresh) {
        const cached = readAnalysisCache(cacheKeyEid, { ttlMs });
        if (cached) {
          log(`账号评分命中缓存：eid=${args.eid}（${Math.round(cached.ageMs / 1000)} 秒前）`);
          json(res, 200, {
            ...cached.data,
            cached: true,
            cachedAt: cached.generatedAt,
            cacheAgeMs: cached.ageMs,
            cacheTtlMs: ttlMs,
          });
          return;
        }
      }

      // 必须走已登录的页面发请求：匿名 Node fetch 在风控升级后会被判 SESSION_TIMEOUT
      await ensureOnHost();
      const result = await analyzeAccount({
        eid: args.eid,
        serverid: args.serverid,
        heroes: heroesWanted,
        subOnly: args.subOnly,
        pageGet: async (path) =>
          evalInPage(
            `(async () => {
               const r = await fetch(${JSON.stringify(path)}, {
                 credentials: 'include',
                 headers: { 'x-requested-with': 'XMLHttpRequest' }
               });
               return await r.text();
             })()`,
            60000,
          ),
      });

      // 写入缓存；失败不影响本次返回
      const saved = writeAnalysisCache(cacheKeyEid, result);
      if (!saved) log('账号评分缓存写入失败（不影响本次结果）');

      log(
        `账号评分完成：${result.heroes.map((h) => `${h.name}=${h.best?.score ?? '—'}`).join(' ')}` +
          `  御魂 ${result.account.soulCount} 件`,
      );
      json(res, 200, {
        ...result,
        cached: false,
        cachedAt: saved?.generatedAt ?? null,
        cacheAgeMs: 0,
        cacheTtlMs: ttlMs,
      });
    } catch (err) {
      log(`账号评分失败：${err.message}`);
      // B3：把归类后的 code 交给前端，便于分别提示「下架 / 登录失效 / 滑块 / 计算中」
      json(res, 500, { ok: false, error: err.code || 'ANALYZE_FAILED', message: err.message });
    }
    return;
  }

  // 健康检查：前端用它判断伴随服务在不在
  if (p === '/api/health') {
    json(res, 200, {
      ok: true,
      service: 'cbg-scraper',
      version: 1,
      status: state.status,
      message: state.message,
      browserReady: state.browserReady,
      host: CONFIG.host,
      cdpPort: CONFIG.cdpPort,
      /** 模块二分析缓存有效期（毫秒），页面据此提示缓存是否还有效 */
      analysisTtlMs: CONFIG.analysisTtlMs,
      lastSuccessAt: state.lastSuccessAt,
      lastTotal: state.lastTotal,
      /** 模块三「御魂报告」内核状态（前端用它决定是否禁用入口/提示） */
      soulReady: soul.ready,
      soulPort: soul.port,
      soulMessage: soul.message,
      /** 模块四「看号分析」内核状态 */
      inspectorReady: inspector.ready,
      inspectorPort: inspector.port,
      inspectorMessage: inspector.message,
      busy: Boolean(state.job && state.job.running),
    });
    return;
  }

  if (p === '/api/logs') {
    json(res, 200, { ok: true, logs: state.logs.slice(-60) });
    return;
  }

  // 发起查询（异步）：立即返回 jobId，前端轮询 /api/result
  if (p === '/api/search' && req.method === 'POST') {
    if (!state.browserReady) {
      json(res, 503, { ok: false, error: 'BROWSER_NOT_READY', message: state.message });
      return;
    }
    if (state.job?.running) {
      /**
       * 上一个任务正在取消但还没收尾（它在等当前这一页的请求返回，最长 20 秒）。
       * 用户的心理预期是「点了取消就能立刻重查」，此时直接回 409 会让他莫名其妙。
       * 所以这里短暂等一下；等到了就正常开工，等不到才报忙。
       */
      if (state.job.cancelRequested) {
        const deadline = Date.now() + 6000;
        while (state.job?.running && Date.now() < deadline) {
          await sleep(100);
        }
      }
      if (state.job?.running) {
        json(res, 409, { ok: false, error: 'BUSY', message: '已有查询在进行中', jobId: state.job.id });
        return;
      }
    }

    const body = await readBody(req);
    const values = body.values && typeof body.values === 'object' ? body.values : {};
    const jobId = `job_${Date.now()}`;
    state.job = { id: jobId, running: true, pages: 0, count: 0, total: null, error: null, startedAt: Date.now(), origin: req.headers.origin || null };

    // 发起查询时记录来源，这是判断「谁在查」的关键证据
    logOrigin(req, p);
    log(`开始查询，条件 ${Object.keys(values).length} 项：${JSON.stringify(values).slice(0, 160)}`);
    runSearch(values, body.maxPages)
      .then((result) => {
        // 只在任务没有被新查询取代时写回，避免覆盖新任务的状态
        if (state.job?.id !== jobId) return;
        state.job.result = result;
        state.job.running = false;
        state.job.finishedAt = Date.now();
        if (result.ok && result.cancelled) {
          log(`查询已取消：保留 ${result.rows.length} 条（第 ${result.meta.pages} 页）`);
        } else if (result.ok) {
          log(`查询完成：${result.rows.length} 条 / 共 ${result.meta.total} 条`);
        }
      })
      .catch((err) => {
        if (state.job?.id !== jobId) return;
        state.job.running = false;
        state.job.error = 'EXCEPTION';
        state.status = 'error';
        state.message = err.message;
        state.job.result = { ok: false, error: 'EXCEPTION', msg: err.message, rows: [] };
        log(`查询异常：${err.message}`);
      });

    json(res, 202, { ok: true, jobId, message: '查询已开始，请轮询 /api/result' });
    return;
  }

  // 取消当前查询：设置标志，查询循环会在「每页开始前」或「页间等待中」收尾
  if (p === '/api/cancel' && req.method === 'POST') {
    if (!state.job?.running) {
      json(res, 200, { ok: true, cancelled: false, message: '当前没有正在进行的查询' });
      return;
    }
    state.job.cancelRequested = true;
    logOrigin(req, p);
    log('收到取消请求，正在停止…');
    json(res, 202, { ok: true, cancelled: true, jobId: state.job.id, message: '取消请求已受理' });
    return;
  }

  // 查询进度与结果
  if (p === '/api/result') {
    if (!state.job) {
      json(res, 200, { ok: true, running: false, empty: true });
      return;
    }
    const { id, running, pages, count, total, error, result, cancelRequested } = state.job;
    json(res, 200, {
      ok: true,
      jobId: id,
      running,
      progress: { pages, count, total },
      error,
      status: state.status,
      message: state.message,
      /** 取消请求已受理但循环还在收尾（当前这一页要等它返回） */
      cancelling: Boolean(cancelRequested && running),
      /** 本次结果是否因为取消而不完整 */
      cancelled: Boolean(result?.cancelled),
      done: !running,
      result: running ? null : result,
    });
    return;
  }

  if (p === '/api/shutdown' && req.method === 'POST') {
    json(res, 200, { ok: true });
    log('收到退出请求，关闭浏览器与内核…');
    setTimeout(() => {
      try {
        browser?.kill();
      } catch {}
      stopSoulService();
      stopInspectorService();
      process.exit(0);
    }, 200);
    return;
  }

  json(res, 404, { ok: false, error: 'NOT_FOUND', path: p });
});

/**
 * 端口被占用时给一条能看懂的提示，而不是抛未捕获异常。
 * 背景：start.bat 用最小化窗口起服务，进程一崩窗口就消失，用户只看到「服务启动不了」。
 */
server.on('error', (err) => {
  const port = CONFIG.port;
  console.error('');
  if (err.code === 'EADDRINUSE') {
    console.error(`  [X] 端口 ${port} 已被占用。`);
    console.error(`      可能已经有一个服务在跑：先看 http://127.0.0.1:${port}/api/health`);
    console.error(`      如果确认要再起一个，请换端口：--port ${port + 1}`);
  } else {
    console.error(`  [X] 服务启动失败：${err.message}`);
  }
  console.error('');
  stopSoulService();
  stopInspectorService();
  process.exit(1);
});

server.listen(CONFIG.port, '127.0.0.1', () => {
  console.log('');
  console.log('  藏宝阁实时查询服务已启动');
  console.log(`    接口地址   http://127.0.0.1:${CONFIG.port}/api/health`);
  console.log(`    目标站点   https://${CONFIG.host}/`);
  console.log(`    浏览器调试端口 ${CONFIG.cdpPort}`);
  console.log(`    御魂报告内核端口 ${CONFIG.soulPort}（/api/soul/*）`);
  console.log(`    看号分析内核端口 ${CONFIG.inspectorPort}（/api/inspector/*）`);
  console.log('');
  console.log('  首次使用：在弹出的浏览器窗口里登录藏宝阁（只需一次）。');
  console.log('  停止服务：Ctrl+C');
  console.log('');
});

// 模块三/四内核与浏览器并行启动（内核没起来只影响对应模块，不影响前两个模块）
startSoulService();
startInspectorService();
boot();

process.on('SIGINT', () => {
  log('收到 Ctrl+C，关闭浏览器与内核…');
  try {
    browser?.kill();
  } catch {}
  stopSoulService();
  stopInspectorService();
  process.exit(0);
});
