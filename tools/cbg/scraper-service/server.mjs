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
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
  headless: hasFlag('headless'),
  browser: arg('browser', process.env.CBG_BROWSER ?? ''),
  profileDir: arg('profile', path.join(__dirname, 'profile')),
};

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
const browserPath = findBrowser();
log(`浏览器：${browserPath}`);

const browserArgs = [
  ...(CONFIG.headless
    ? ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=520,1000']
    : ['--window-size=520,1000', '--window-position=80,60']),
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${CONFIG.cdpPort}`,
  `--user-data-dir=${CONFIG.profileDir}`,
  'about:blank',
];

const browser = spawn(browserPath, browserArgs, { stdio: 'ignore' });

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

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

async function evalInPage(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) {
    throw new Error('页面执行异常：' + JSON.stringify(r.exceptionDetails).slice(0, 200));
  }
  return r?.result?.value;
}

async function boot() {
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
 */
async function runSearch(values, maxPages) {
  await ensureOnHost();

  const rows = [];
  const seen = new Set();
  let total = null;
  let pages = 0;

  const limit = Math.min(Number(maxPages) || CONFIG.maxPages, CONFIG.maxPages);

  for (let p = 1; p <= limit; p += 1) {
    const params = {
      ...values,
      search_type: values.search_type || 'role',
      client_type: 'h5',
      view_loc: 'equip_list',
      page: String(p),
      count: String(CONFIG.pageSize),
    };

    const text = await evalInPage(`
      (async () => {
        const r = await fetch('/cgi/api/query', {
          method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest' },
          body: new URLSearchParams(${JSON.stringify(params)}),
        });
        return await r.text();
      })()
    `);

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
    await sleep(CONFIG.pageDelayMs);
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
      lastSuccessAt: state.lastSuccessAt,
      lastTotal: state.lastTotal,
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
      json(res, 409, { ok: false, error: 'BUSY', message: '已有查询在进行中', jobId: state.job.id });
      return;
    }

    const body = await readBody(req);
    const values = body.values && typeof body.values === 'object' ? body.values : {};
    const jobId = `job_${Date.now()}`;
    state.job = { id: jobId, running: true, pages: 0, count: 0, total: null, error: null, startedAt: Date.now() };

    log(`开始查询，条件 ${Object.keys(values).length} 项`);
    runSearch(values, body.maxPages)
      .then((result) => {
        state.job.result = result;
        state.job.running = false;
        state.job.finishedAt = Date.now();
        if (result.ok) log(`查询完成：${result.rows.length} 条 / 共 ${result.meta.total} 条`);
      })
      .catch((err) => {
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

  // 查询进度与结果
  if (p === '/api/result') {
    if (!state.job) {
      json(res, 200, { ok: true, running: false, empty: true });
      return;
    }
    const { id, running, pages, count, total, error, result } = state.job;
    json(res, 200, {
      ok: true,
      jobId: id,
      running,
      progress: { pages, count, total },
      error,
      status: state.status,
      message: state.message,
      done: !running,
      result: running ? null : result,
    });
    return;
  }

  if (p === '/api/shutdown' && req.method === 'POST') {
    json(res, 200, { ok: true });
    log('收到退出请求，关闭浏览器…');
    setTimeout(() => {
      try {
        browser.kill();
      } catch {}
      process.exit(0);
    }, 200);
    return;
  }

  json(res, 404, { ok: false, error: 'NOT_FOUND', path: p });
});

server.listen(CONFIG.port, '127.0.0.1', () => {
  console.log('');
  console.log('  藏宝阁实时查询服务已启动');
  console.log(`    接口地址   http://127.0.0.1:${CONFIG.port}/api/health`);
  console.log(`    目标站点   https://${CONFIG.host}/`);
  console.log(`    浏览器调试端口 ${CONFIG.cdpPort}`);
  console.log('');
  console.log('  首次使用：在弹出的浏览器窗口里登录藏宝阁（只需一次）。');
  console.log('  停止服务：Ctrl+C');
  console.log('');
});

boot();

process.on('SIGINT', () => {
  log('收到 Ctrl+C，关闭浏览器…');
  try {
    browser.kill();
  } catch {}
  process.exit(0);
});
