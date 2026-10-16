import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * probe-public-pna.mjs — 用「你日常那个 Edge 配置」实测：
 * 公网页面（GitHub Pages）能不能请求本机的伴随服务？
 *
 * 为什么要专门测：Playwright 的浏览器和你日常浏览器可能策略不同。
 * 这个脚本用与伴随服务相同的 user-data-dir 起一个 Edge（复用你的登录态与设置），
 * 通过 CDP 打开公网地址，读取控制台报错与页面状态，然后自行退出。
 *
 * 用法: node tools/cbg/probe-public-pna.mjs
 */

const CDP_PORT = 9411;
const TARGET = process.argv[2] ?? 'https://smaxhero.github.io/CBGCHECK/';
const PROFILE = path.join(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  'scraper-service',
  'profile',
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const exe = CANDIDATES.find((p) => fs.existsSync(p));
if (!exe) {
  console.error('没找到 Edge');
  process.exit(1);
}

console.log(`浏览器: ${exe}`);
console.log(`用户目录: ${PROFILE}`);
console.log(`目标: ${TARGET}\n`);

const browser = spawn(
  exe,
  [
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function waitForCdp() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (r.ok) return true;
    } catch {}
    await sleep(400);
  }
  return false;
}

const cleanup = () => {
  try {
    browser.kill();
  } catch {}
};

try {
  if (!(await waitForCdp())) throw new Error('调试端口未就绪');
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  let id = 0;
  const pending = new Map();
  const logs = [];
  const netFail = [];

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const i = ++id;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      logs.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    }
    if (m.method === 'Network.loadingFailed') {
      netFail.push(`${m.params.errorText} (type=${m.params.type})`);
    }
  };

  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: TARGET });
  await sleep(12000);

  const evalIn = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
  };

  const state = await evalIn(`JSON.stringify({
    url: location.href,
    isGuide: !!document.querySelector('.guide'),
    guideTitle: document.querySelector('.guide h2')?.textContent ?? null,
    statusPill: document.querySelector('.status-pill')?.textContent ?? null,
    hasTable: !!document.querySelector('.ant-table-tbody'),
    hit: document.querySelector('.kpi .k-val')?.textContent ?? null,
    footer: document.querySelector('.cnt')?.textContent?.replace(/\\s+/g,' ') ?? null
  })`);

  // 直接再打一次 fetch，看是否被拦
  const direct = await evalIn(`
    fetch('http://127.0.0.1:8791/api/health')
      .then(r => r.json()).then(j => 'OK: ' + JSON.stringify(j).slice(0,120))
      .catch(e => 'BLOCKED: ' + e.message)
  `);

  console.log('=== 页面状态 ===');
  console.log(JSON.stringify(JSON.parse(state), null, 1));
  console.log('\n=== 页面内直接 fetch 本地服务 ===');
  console.log(direct);
  console.log('\n=== 控制台错误 ===');
  console.log(logs.length ? logs.slice(0, 5).join('\n') : '（无）');
  console.log('\n=== 失败的请求 ===');
  console.log(netFail.length ? netFail.slice(0, 5).join('\n') : '（无）');
} catch (err) {
  console.error('探测失败:', err.message);
} finally {
  cleanup();
  await sleep(500);
}
