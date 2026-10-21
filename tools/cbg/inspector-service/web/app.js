/* 模块四本地内核的独立网页（无构建步骤，直接由 server.py 提供）。
 * 六页对应站点：账号查询 / 速度盘点 / PVE 预览 / 式神技能 / 御魂库存 / 御魂计算器。
 */
'use strict';

const state = {
  report: null,
  meta: null,
  tab: 'overview',
  query: { ordersn: '', serverid: '', url: '' },
  speedFilter: { fourth: [], sixth: [] },
  relicQuery: { position: null, suit: '', sort: 'speed' },
  calc: { hero: '须佐之男', preset: 'attack', metric: 'damage', fullCrit: true, fourPiece: '', limit: 3 },
  pveJob: null,
  calcJob: null,
};

const $ = (sel) => document.querySelector(sel);
const view = () => $('#view');
const statusEl = () => $('#status');

const ATTRS = ['攻击加成', '攻击', '生命加成', '生命', '防御加成', '防御', '速度', '暴击', '暴击伤害', '效果命中', '效果抵抗'];
const FOUR_MAINS = ['攻击加成', '生命加成', '防御加成', '效果命中', '效果抵抗'];
const SIX_MAINS = ['攻击加成', '生命加成', '防御加成', '暴击', '暴击伤害'];
const PRESETS = { attack: '攻攻爆', health: '生生爆', speed: '纯速度' };

function setStatus(text, isErr = false) {
  statusEl().textContent = text;
  statusEl().className = 'status' + (isErr ? ' err' : '');
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

function num(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function pct(value) {
  if (value === null || value === undefined) return '-';
  return num(value, 2) + '%';
}

function attrText(attr) {
  if (!attr) return '-';
  const value = Number(attr.value ?? 0);
  return `${esc(attr.label || '')}+${attr.isPercent ? num(value, 2) + '%' : num(value, 2)}`;
}

function panelText(panel) {
  if (!panel) return '-';
  return `攻 ${num(panel.attack, 0)} · 暴 ${pct(panel.critRate)} · 爆 ${pct(panel.critDamage)}`;
}

async function api(path, options = {}) {
  const resp = await fetch(path, {
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options,
  });
  let data = null;
  try {
    data = await resp.json();
  } catch (err) {
    throw new Error(`服务返回了非 JSON（HTTP ${resp.status}）`);
  }
  if (!resp.ok || data.ok === false) {
    const message = (data.error && data.error.message) || `HTTP ${resp.status}`;
    throw new Error(message);
  }
  return data;
}

function queryString() {
  const params = new URLSearchParams();
  if (state.query.url) params.set('url', state.query.url);
  else {
    if (state.query.ordersn) params.set('ordersn', state.query.ordersn);
    if (state.query.serverid) params.set('serverid', state.query.serverid);
  }
  return params.toString();
}

function parseInput(text) {
  const value = (text || '').trim();
  if (!value) throw new Error('请先粘贴藏宝阁商品链接或订单号');
  if (/^https?:\/\//i.test(value)) {
    const match = value.match(/\/equip\/(\d+)\/([^/?#]+)/i);
    if (!match) throw new Error('链接中没有找到服务器和商品编号');
    return { url: value, serverid: match[1], ordersn: match[2] };
  }
  const parts = value.split('-');
  return { url: '', ordersn: value, serverid: parts.length >= 2 ? parts[1] : '' };
}

/* ------------------------------------------------------------ 加载入口 */
async function load(kind) {
  const btn = kind === 'demo' ? $('#btn-demo') : $('#btn-read');
  btn.disabled = true;
  view().innerHTML = '<div class="loading">正在读取数据…（首次抓取约 3~6 秒）</div>';
  setStatus(kind === 'demo' ? '加载演示数据…' : '正在抓取藏宝阁数据…');
  try {
    let report;
    if (kind === 'demo') {
      report = await api('/api/inspector/demo');
      state.query = { ordersn: 'demo', serverid: '', url: '' };
    } else {
      const parsed = parseInput($('#cbg-url').value);
      state.query = parsed;
      const params = new URLSearchParams();
      if (parsed.url) params.set('url', parsed.url);
      else { params.set('ordersn', parsed.ordersn); params.set('serverid', parsed.serverid); }
      report = await api('/api/inspector/report?' + params.toString());
    }
    state.report = report;
    const account = report.account || {};
    setStatus(`${account.name || ''} · ${account.serverName || ''} · 数据来源 ${report.source || '-'} · 解析 ${report.elapsed_ms}ms`);
    render();
  } catch (err) {
    setStatus(err.message, true);
    view().innerHTML = `<div class="error-box">读取失败：${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

async function ensureMeta() {
  if (state.meta) return state.meta;
  state.meta = await api('/api/inspector/meta');
  return state.meta;
}

/* ------------------------------------------------------------ 渲染调度 */
function render() {
  const report = state.report;
  if (!report) return;
  const tabs = ['overview', 'speed', 'pve', 'hero', 'relics', 'calc'];
  document.querySelectorAll('#tabs button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === state.tab);
  });
  if (!tabs.includes(state.tab)) state.tab = 'overview';
  if (state.tab === 'overview') renderOverview(report);
  else if (state.tab === 'speed') renderSpeed(report);
  else if (state.tab === 'pve') renderPve(report);
  else if (state.tab === 'hero') renderHero(report);
  else if (state.tab === 'relics') renderRelics(report);
  else if (state.tab === 'calc') renderCalc(report);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ------------------------------------------------------------ 账号查询 */
function renderOverview(report) {
  const account = report.account || {};
  const speed = report.speed || {};
  const relics = report.relics || {};
  const pve = report.pveScores || {};
  const hl = speed.highlights || {};
  const dex = account.dex || {};
  const byPos = relics.byPosition || {};

  const cards = [
    ['等级', account.level, '级'],
    ['散件一速', hl.scatteredFirstSpeed !== null && hl.scatteredFirstSpeed !== undefined ? '+' + num(hl.scatteredFirstSpeed) : '-', ''],
    ['招财一速', hl.luckyFirstSpeed !== null && hl.luckyFirstSpeed !== undefined ? '+' + num(hl.luckyFirstSpeed) : '-', ''],
    ['头 / 尾', `${hl.speedHeadCount ?? 0} 头 ${hl.speedTailCount ?? 0} 尾`, ''],
    ['满速御魂', speed.fullSpeedCount ?? '-', '件'],
    ['全部御魂', relics.totalInBag ?? '-', '件'],
    ['6 星满级', relics.maxLevelCount ?? '-', '件'],
    ['体力', account.stamina ? account.stamina.text : '-', ''],
    ['金币', num(account.money, 0), ''],
    ['勾玉', num(account.soulJade, 0), ''],
    ['神秘符咒', num(account.mysteryTalisman, 0), ''],
    ['现世符咒', num(account.realityTalisman, 0), ''],
    ['抽卡能力', num(account.summonPower, 0), '抽'],
    ['风姿度', num(account.fengzidu, 0), ''],
    ['斗技', `${account.pvpStage ?? '-'} 段 ${num(account.pvpScore, 0)} 分`, ''],
    ['典藏皮肤', num(account.collectionSkinCount, 0), ''],
    ['御行达摩', num(account.yuxingDama, 0), ''],
  ];

  const dexItems = [
    ['SSR', dex.ssr, ''],
    ['SP', dex.sp, ''],
    ['UR', dex.ur, ''],
    ['500 天未收录', dex.uncollected500Days, ''],
    ['999 天未收录', dex.uncollected999Days, ''],
    ['未收录券', dex.uncollectedCoupon, ''],
  ];

  const posCells = Object.keys(byPos).map((pos) => `
    <div class="cell">${pos} 号位<small>${byPos[pos]} 件</small></div>`).join('');

  const suitRows = (pve.normalSuits || []).map((item) => `
    <tr><td>${esc(item.suitName)}</td><td class="num">${num(item.relicCount, 0)}</td>
        <td class="num">${num(item.totalScore, 0)}</td></tr>`).join('');
  const omaRows = (pve.omaSuits || []).map((item) => `
    <tr><td>${esc(item.suitName)}</td><td class="num">${num(item.relicCount, 0)}</td>
        <td class="num">${num(item.totalScore, 0)}</td></tr>`).join('');

  view().innerHTML = `
    <div class="grid cols-2">
      <section class="card">
        <h3>${esc(account.name || '未知账号')} <span class="sub">${esc(account.serverName || '')}</span></h3>
        <div class="metrics">
          ${cards.map(([label, value, unit]) => `<div class="metric"><b>${esc(value)}</b><span>${esc(label)}${unit ? ' / ' + unit : ''}</span></div>`).join('')}
        </div>
        <h4>图鉴</h4>
        <div class="hl">
          ${dexItems.map(([label, value]) => {
            let text = '-';
            if (value && typeof value === 'object') text = `${value.owned}/${value.total}`;
            else if (value !== null && value !== undefined) text = String(value);
            return `<span class="pill gray">${esc(label)} ${esc(text)}</span>`;
          }).join('')}
        </div>
        <h4>各号位御魂</h4>
        <div class="cells">${posCells}</div>
      </section>

      <section class="card">
        <h3>PVE 御魂评分</h3>
        <table class="compact">
          <thead><tr><th>四件套</th><th class="num">件数</th><th class="num">总评分</th></tr></thead>
          <tbody>${suitRows}</tbody>
        </table>
        <h4>逢魔御魂</h4>
        <table class="compact">
          <thead><tr><th>套装</th><th class="num">件数</th><th class="num">总评分</th></tr></thead>
          <tbody>${omaRows}</tbody>
        </table>
        <p class="sub">评分规则与站点一致：2/4 号位攻击加成、6 号位暴击或暴击伤害各计 1 条有效词条；普通御魂上限 8 条，逢魔一件套额外 +3（上限 11）；仅统计 ≥5 条。</p>
      </section>
    </div>`;
}

/* ------------------------------------------------------------ 速度盘点 */
function cellsHtml(cells) {
  return (cells || []).map((cell) => {
    const labels = [cell.mainAttribute && cell.mainAttribute.label, cell.suitName].filter(Boolean);
    return `<div class="cell">${num(cell.value)}<small>${esc(labels.join(' · '))}</small></div>`;
  }).join('');
}

function toggleIn(list, value) {
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
  else list.push(value);
}

async function renderSpeed(report) {
  const speed = report.speed || {};
  const filter = state.speedFilter;
  const options = (values, name) => values.map((value) => `
    <label style="font-size:12px;margin-right:8px;white-space:nowrap">
      <input type="checkbox" data-speed-filter="${name}" value="${esc(value)}"
        ${filter[name].includes(value) ? 'checked' : ''}/> ${esc(value)}</label>`).join('');

  view().innerHTML = `
    <div class="grid cols-2">
      <section class="card" style="grid-column:1/-1">
        <h3>速件总览</h3>
        <div class="metrics">
          <div class="metric"><b>${speed.fullSpeedCount ?? '-'}</b><span>满速御魂</span></div>
          ${Object.keys(speed.fullSpeedByPosition || {}).map((pos) => `
            <div class="metric"><b>${speed.fullSpeedByPosition[pos]}</b><span>${pos} 号位满速</span></div>`).join('')}
        </div>
        <h4>筛选（4 / 6 号位主属性）</h4>
        <div class="row-flex">
          <span class="sub">4 号位：</span>${options(FOUR_MAINS, 'fourth')}
        </div>
        <div class="row-flex">
          <span class="sub">6 号位：</span>${options(SIX_MAINS, 'sixth')}
        </div>
      </section>

      <section class="card" id="scatter-card">
        <h3>散件一速 TOP5</h3>
        <table class="compact"><thead><tr><th>名次</th><th class="num">速度</th><th>各号位</th></tr></thead>
        <tbody>${(speed.scatterTop || []).map((item) => `
          <tr><td>${item.rank}</td><td class="num">${num(item.value)}</td><td><div class="cells">${cellsHtml(item.cells)}</div></td></tr>`).join('')}
        </tbody></table>
      </section>

      <section class="card" id="suit-card">
        <h3>常用 PVP 套件速度</h3>
        <table class="compact"><thead><tr><th>套装</th><th class="num">一速</th><th>各号位</th></tr></thead>
        <tbody>${(speed.suitTable || []).map((item) => `
          <tr><td>${esc(item.suit)}</td><td class="num">${num(item.value)}</td><td><div class="cells">${cellsHtml(item.cells)}</div></td></tr>`).join('')}
        </tbody></table>
      </section>
    </div>`;

  view().querySelectorAll('input[data-speed-filter]').forEach((input) => {
    input.addEventListener('change', async () => {
      toggleIn(filter[input.dataset.speedFilter], input.value);
      await refreshSpeed();
    });
  });
}

async function refreshSpeed() {
  const params = new URLSearchParams(queryString());
  if (state.speedFilter.fourth.length) params.set('fourth', state.speedFilter.fourth.join(','));
  if (state.speedFilter.sixth.length) params.set('sixth', state.speedFilter.sixth.join(','));
  setStatus('正在按新筛选重算速度…');
  try {
    const data = await api('/api/inspector/speed?' + params.toString());
    const report = state.report;
    report.speed.scatterTop = data.scatterTop;
    report.speed.suitTable = data.suitTable;
    renderSpeed(report);
    setStatus('速度盘点已更新');
  } catch (err) {
    setStatus(err.message, true);
  }
}

/* ------------------------------------------------------------ PVE 预览 */
function renderPve(report) {
  const scores = report.pveScores || {};
  const job = state.pveJob;
  view().innerHTML = `
    <div class="grid cols-2">
      <section class="card">
        <h3>须佐之男面板 · 21 组最优组合</h3>
        <p class="sub">固定比较土蜘蛛、荒骷髅、鬼灵歌伎三种逢魔套；仅用账号内六星 +15 御魂；仅保留满暴方案；伤害指标 = 最终攻击 × 最终暴击伤害。</p>
        <div class="row-flex">
          <button class="primary" id="btn-pve-run" ${job && job.status === 'running' ? 'disabled' : ''}>
            ${job && job.status === 'running' ? '正在计算…' : '开始计算 21 组'}</button>
          <span class="sub" id="pve-progress">${job ? esc(job.progress || '') : ''}</span>
        </div>
        <div id="pve-result"></div>
      </section>
      <section class="card">
        <h3>PVE 御魂评分</h3>
        <table class="compact"><thead><tr><th>套装</th><th class="num">件数</th><th class="num">总评分</th></tr></thead>
        <tbody>${(scores.normalSuits || []).map((item) => `
          <tr><td>${esc(item.suitName)}</td><td class="num">${num(item.relicCount, 0)}</td><td class="num">${num(item.totalScore, 0)}</td></tr>`).join('')}
        </tbody></table>
        <h4>逢魔御魂</h4>
        <table class="compact"><thead><tr><th>套装</th><th class="num">件数</th><th class="num">总评分</th></tr></thead>
        <tbody>${(scores.omaSuits || []).map((item) => `
          <tr><td>${esc(item.suitName)}</td><td class="num">${num(item.relicCount, 0)}</td><td class="num">${num(item.totalScore, 0)}</td></tr>`).join('')}
        </tbody></table>
      </section>
    </div>`;
  $('#btn-pve-run').addEventListener('click', runPve);
  if (job && job.status === 'done' && job.result) renderPveResult(job.result);
}

async function runPve() {
  if (!state.query.ordersn) { setStatus('先读取账号数据', true); return; }
  setStatus('已提交 PVE 计算任务（约 20 秒）…');
  try {
    const payload = { ordersn: state.query.ordersn, serverid: state.query.serverid, url: state.query.url };
    const data = await api('/api/inspector/pve', { method: 'POST', body: JSON.stringify(payload) });
    state.pveJob = { id: data.jobId, status: 'running', progress: '排队中' };
    renderPve(state.report);
    pollJob(data.jobId, 'pve');
  } catch (err) {
    setStatus(err.message, true);
  }
}

function renderPveResult(result) {
  const box = $('#pve-result');
  if (!box) return;
  if (!result || !result.rows || !result.rows.length) {
    box.innerHTML = '<div class="error-box">没有算出可用组合</div>';
    return;
  }
  box.innerHTML = `
    <div class="metrics" style="margin:10px 0">
      <div class="metric"><b>${num(result.average, 0)}</b><span>总平均值（21 组）</span></div>
    </div>
    <table class="compact">
      <thead><tr><th>四件套</th><th>逢魔</th><th class="num">伤害</th><th>面板</th></tr></thead>
      <tbody>${result.rows.map((row) => `
        <tr><td>${esc(row.suit)}</td><td>${esc(row.omaSuit)}</td>
            <td class="num">${num(row.damage, 0)}</td><td>${esc(panelText(row.panel))}</td></tr>`).join('')}
      </tbody></table>`;
}

/* ------------------------------------------------------------ 式神技能 */
function heroRow(hero) {
  return `<tr><td>${esc(hero.name)}</td><td class="num">${esc(hero.level)}</td>
    <td>${esc((hero.skillLevels || []).join(''))}</td></tr>`;
}

function renderHero(report) {
  const data = report.heroSkills || {};
  const counts = data.counts || {};
  const groups = data.groups || [];
  view().innerHTML = `
    <div class="grid cols-2">
      <section class="card">
        <h3>技能概览</h3>
        <div class="metrics">
          <div class="metric"><b>${counts.duplicates ?? 0}</b><span>多号机式神</span></div>
          <div class="metric"><b>${counts.deficient ?? 0}</b><span>技能未达标</span></div>
          <div class="metric"><b>${counts.collaboration ?? 0}</b><span>联动式神</span></div>
          <div class="metric"><b>${data.yuxingDama ?? 0}</b><span>御行达摩</span></div>
        </div>
        <h4>技能未达标（同名无一只达标）</h4>
        <table class="compact"><thead><tr><th>式神</th><th class="num">等级</th><th>技能</th></tr></thead>
        <tbody>${(data.deficient || []).map(heroRow).join('')}</tbody></table>
        <h4>多号机（同名 ≥2 只技能达标）</h4>
        <table class="compact"><thead><tr><th>式神</th><th class="num">等级</th><th>技能</th></tr></thead>
        <tbody>${(data.duplicates || []).map(heroRow).join('')}</tbody></table>
      </section>
      <section class="card">
        <h3>式神技能等级</h3>
        ${groups.map((group) => `
          <h4>${esc(group.rarity)}（${group.heroes.length}）</h4>
          <table class="compact">
            <tbody>${group.heroes.map((hero) => `
              <tr><td>${esc(hero.name)}</td><td class="num">${esc(hero.level)}</td>
                  <td>${esc((hero.skillLevels || []).join(''))}</td></tr>`).join('')}
            </tbody></table>`).join('')}
      </section>
    </div>`;
}

/* ------------------------------------------------------------ 御魂库存 */
function relicCard(item) {
  return `<div class="relic-card">
    <b>${esc(item.suitName)} +${esc(item.level)}</b>
    <div class="main">${attrText(item.mainAttribute)}<span class="tag">${item.position} 号位</span></div>
    <ul>${(item.subAttributes || []).map((sub) => `
      <li>${esc(sub.label)} +${num(sub.total)}${sub.count ? `<span class="tag">${sub.count} 次</span>` : ''}</li>`).join('')}</ul>
  </div>`;
}

async function renderRelics(report) {
  const data = report.relics || {};
  const meta = await ensureMeta();
  const query = state.relicQuery;
  const positions = [null, 1, 2, 3, 4, 5, 6];
  view().innerHTML = `
    <section class="card">
      <h3>御魂库存 <span class="sub">共 ${data.totalInBag ?? '-'} 件（6 星满级 ${data.maxLevelCount ?? '-'}）</span></h3>
      <div class="row-flex">
        ${positions.map((pos) => `<button data-relic-pos="${pos ?? ''}" class="${query.position === pos ? 'primary' : ''}">
          ${pos === null ? '全部' : pos + ' 号位'}</button>`).join('')}
        <select id="relic-suit">
          <option value="">全部套装</option>
          ${(meta.suits || []).map((suit) => `<option value="${esc(suit)}" ${query.suit === suit ? 'selected' : ''}>${esc(suit)}</option>`).join('')}
        </select>
        <select id="relic-sort">
          <option value="speed" ${query.sort === 'speed' ? 'selected' : ''}>速度降序</option>
          <option value="sub" ${query.sort === 'sub' ? 'selected' : ''}>副属性条数</option>
        </select>
        <span class="sub" id="relic-count"></span>
      </div>
      <div class="grid cols-3" id="relic-list"><div class="loading">加载中…</div></div>
    </section>`;

  view().querySelectorAll('button[data-relic-pos]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const value = btn.dataset.relicPos;
      query.position = value ? Number(value) : null;
      renderRelics(state.report);
    });
  });
  $('#relic-suit').addEventListener('change', (event) => { query.suit = event.target.value; renderRelics(state.report); });
  $('#relic-sort').addEventListener('change', (event) => { query.sort = event.target.value; renderRelics(state.report); });

  const params = new URLSearchParams(queryString());
  if (query.position) params.set('position', String(query.position));
  if (query.suit) params.set('suits', query.suit);
  params.set('sort', query.sort);
  params.set('limit', '60');
  try {
    const list = await api('/api/inspector/relics?' + params.toString());
    $('#relic-count').textContent = `匹配 ${list.matched} 件 / 共 ${list.total}`;
    $('#relic-list').innerHTML = (list.items || []).length
      ? list.items.map(relicCard).join('')
      : '<div class="loading">没有符合条件的御魂</div>';
  } catch (err) {
    $('#relic-list').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

/* ------------------------------------------------------------ 御魂计算器 */
function calcRow(hit) {
  const relicCells = (hit.relics || []).map((relic) => `
    <li>${relic.position} 号位 ${esc(relic.suitName || '')} ${esc(attrText(relic.mainAttribute))}
      ${(relic.subAttributes || []).filter((sub) => sub.label === '速度')
        .map((sub) => `<span class="tag hot">速度+${num(sub.total)}</span>`).join('')}</li>`).join('');
  return `<tr>
    <td class="num">${num(hit.score, 0)}</td>
    <td>${esc(panelText(hit.panel))}</td>
    <td>${esc((hit.suits || []).join(' / '))}</td>
    <td><ul style="margin:0;padding-left:16px;font-size:12px">${relicCells}</ul></td>
  </tr>`;
}

async function renderCalc(report) {
  const meta = await ensureMeta();
  const calc = state.calc;
  const job = state.calcJob;
  view().innerHTML = `
    <div class="grid cols-2">
      <section class="card">
        <h3>御魂计算器 <span class="sub">本地组合搜索</span></h3>
        <div class="row-flex">
          <span class="sub">式神</span>
          <select id="calc-hero">
            ${(meta.heroes || []).map((hero) => `<option value="${esc(hero.name)}" ${calc.hero === hero.name ? 'selected' : ''}>${esc(hero.name)}（${esc(hero.level)}）</option>`).join('')}
          </select>
        </div>
        <div class="row-flex">
          <span class="sub">面板预设</span>
          ${Object.keys(PRESETS).map((key) => `<button data-preset="${key}" class="${calc.preset === key ? 'primary' : ''}">${PRESETS[key]}</button>`).join('')}
        </div>
        <div class="row-flex">
          <span class="sub">指标</span>
          <select id="calc-metric">
            ${(meta.metrics || []).map((metric) => `<option value="${metric}" ${calc.metric === metric ? 'selected' : ''}>${metric}</option>`).join('')}
          </select>
          <label style="font-size:12px"><input type="checkbox" id="calc-full-crit" ${calc.fullCrit ? 'checked' : ''}/> 只保留满暴</label>
        </div>
        <div class="row-flex">
          <span class="sub">四件套</span>
          <select id="calc-four">
            <option value="">不限</option>
            ${(meta.suits || []).map((suit) => `<option value="${esc(suit)}" ${calc.fourPiece === suit ? 'selected' : ''}>${esc(suit)}</option>`).join('')}
          </select>
          <span class="sub">返回</span>
          <select id="calc-limit">
            ${[1, 3, 5, 10].map((value) => `<option value="${value}" ${calc.limit === value ? 'selected' : ''}>${value} 套</option>`).join('')}
          </select>
        </div>
        <div class="row-flex">
          <button class="primary" id="btn-calc-run" ${job && job.status === 'running' ? 'disabled' : ''}>
            ${job && job.status === 'running' ? '计算中…' : '开始计算'}</button>
          <span class="sub" id="calc-progress">${job ? esc(job.progress || '') : ''}</span>
        </div>
        <p class="sub">算法与站点一致：逐号位组合 + 分支限界，2/4 号位主属性按预设，6 号位按预设；不含式神技能。</p>
      </section>
      <section class="card" style="grid-column:1/-1">
        <h3>计算结果</h3>
        <div id="calc-result"><div class="loading">还没有结果，点「开始计算」。</div></div>
      </section>
    </div>`;

  view().querySelectorAll('button[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => { calc.preset = btn.dataset.preset; renderCalc(state.report); });
  });
  $('#calc-hero').addEventListener('change', (event) => { calc.hero = event.target.value; });
  $('#calc-metric').addEventListener('change', (event) => { calc.metric = event.target.value; });
  $('#calc-full-crit').addEventListener('change', (event) => { calc.fullCrit = event.target.checked; });
  $('#calc-four').addEventListener('change', (event) => { calc.fourPiece = event.target.value; });
  $('#calc-limit').addEventListener('change', (event) => { calc.limit = Number(event.target.value); });
  $('#btn-calc-run').addEventListener('click', runCalc);
  if (job && job.status === 'done' && job.result) renderCalcResult(job.result);
}

async function runCalc() {
  if (!state.query.ordersn) { setStatus('先读取账号数据', true); return; }
  const calc = state.calc;
  setStatus('已提交计算任务…');
  try {
    const payload = {
      ordersn: state.query.ordersn,
      serverid: state.query.serverid,
      url: state.query.url,
      hero: calc.hero,
      metric: calc.metric,
      preset: calc.preset,
      fullCrit: calc.fullCrit,
      fourPiece: calc.fourPiece || null,
      limit: calc.limit,
    };
    const data = await api('/api/inspector/calc', { method: 'POST', body: JSON.stringify(payload) });
    state.calcJob = { id: data.jobId, status: 'running', progress: '排队中' };
    renderCalc(state.report);
    pollJob(data.jobId, 'calc');
  } catch (err) {
    setStatus(err.message, true);
  }
}

function renderCalcResult(result) {
  const box = $('#calc-result');
  if (!box) return;
  if (!result || !result.rows || !result.rows.length) {
    box.innerHTML = '<div class="error-box">没有符合条件的组合（可以放宽满暴或主属性限制）。</div>';
    return;
  }
  box.innerHTML = `
    <table class="compact">
      <thead><tr><th class="num">指标</th><th>面板</th><th>套装</th><th>御魂</th></tr></thead>
      <tbody>${result.rows.map(calcRow).join('')}</tbody>
    </table>`;
}

/* ------------------------------------------------------------ 任务轮询 */
function pollJob(jobId, kind) {
  const started = Date.now();
  const tick = async () => {
    try {
      const data = await api('/api/inspector/job?id=' + encodeURIComponent(jobId));
      const job = data.job;
      if (kind === 'pve') {
        state.pveJob = job;
        const progress = document.getElementById('pve-progress');
        if (progress) progress.textContent = job.progress || job.status;
        if (job.status === 'done') { renderPve(state.report); setStatus('PVE 计算完成'); return; }
        if (job.status === 'error') { setStatus('PVE 计算失败：' + (job.error || ''), true); return; }
      } else {
        state.calcJob = job;
        const progress = document.getElementById('calc-progress');
        if (progress) progress.textContent = job.progress || job.status;
        if (job.status === 'done') { renderCalc(state.report); setStatus('计算完成'); return; }
        if (job.status === 'error') { setStatus('计算失败：' + (job.error || ''), true); return; }
      }
      if (Date.now() - started > 300000) { setStatus('任务超时', true); return; }
      setTimeout(tick, 1200);
    } catch (err) {
      setStatus(err.message, true);
    }
  };
  setTimeout(tick, 800);
}

/* ------------------------------------------------------------ 启动 */
function boot() {
  $('#btn-read').addEventListener('click', () => load());
  $('#btn-demo').addEventListener('click', () => load('demo'));
  $('#cbg-url').addEventListener('keydown', (event) => { if (event.key === 'Enter') load(); });
  $('#tabs').addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-tab]');
    if (!btn) return;
    state.tab = btn.dataset.tab;
    render();
  });
  api('/api/inspector/health')
    .then(() => setStatus('本地内核已就绪，粘贴链接开始。'))
    .catch((err) => setStatus('本地内核不可用：' + err.message, true));
}

boot();
