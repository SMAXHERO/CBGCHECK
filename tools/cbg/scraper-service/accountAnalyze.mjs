/**
 * accountAnalyze.mjs — 模块二「账号评分」的服务端逻辑。
 *
 * 为什么放在伴随服务里：
 *   1. 这三个藏宝阁接口**没有 CORS 头**（实测 access-control-allow-origin 为空），
 *      浏览器不能直接从 github.io 或 127.0.0.1:5173 调用。
 *   2. 更要紧的是**风控**：这些接口虽然一度匿名可用，但请求一多就会被升级成
 *      「请登录之后继续访问」（SESSION_TIMEOUT）甚至「进行安全验证」（CAPTCHA_AUTH），
 *      而且**升级后匿名 Node fetch 就再也调不通了**。
 *      所以这里**不用 Node 裸 fetch，而是通过已登录的浏览器页面发请求**——
 *      带着真实登录态，和站点自己的行为一致，是最不容易被拦的方式。
 *
 * 三个接口：
 *
 *   GET /cgi/api/get_equip_detail?client_type=h5&serverid=<sid>&eid=<eid>
 *       → equip.equip_desc（约 1.6MB JSON 字符串）→ inventory / heroes
 *   GET /cgi/api/get_yys_heroes_matching_plan?client_type=h5&eid=<eid>&obj_serverid=<sid>
 *       → data = { heroId: { name, plans:[{ id, desc:[{label,value}] }] } }
 *   GET /cgi/api/compute_yys_heroes_plan?client_type=h5&eid=<eid>&obj_serverid=<sid>&heroId=<h>&planId=<p>
 *       → data.result.suit_vals.damage 就是页面上的「总评分」（**懒计算**，详见 computePlan）
 *
 * 两个必须记住的坑：
 *   1) 商品页地址里是 **ordersn**，接口要 **eid**，两者不同且**无法互相推导**
 *      （ordersn 查详情报「物品不存在」；HTML 不含 eid；首段差值不稳定）。
 *      好在模块一的列表接口每行都返回 eid，从列表跳过来不用操心这件事。
 *   2) 御魂速度 = attrs 里「速度」条目之和（已经是最终值，**不要**再加 rattr）：
 *      2 号位主速度御魂有两条「速度」（主属性 57.00 + 副属性 x）；
 *      副属性速度满值 18（6★ 共 6 次 roll、每次上限 3），
 *      总速度 = 副属性速度 +（2 号位主属性 57）。见 buildSpeedTable。
 */

const BASE = 'https://yys.cbg.163.com';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 通过浏览器页面发 GET 并解析 JSON。
 *
 * `pageGet(path)` 由 server.mjs 注入 —— 它在**已登录的页面上下文里** fetch，
 * 所以自带 cookie，不会像 Node 裸 fetch 那样被当作未登录请求拦下。
 */
const makeGetter = (pageGet) => async (path) => {
  const text = await pageGet(path);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`藏宝阁返回非 JSON：${String(text).slice(0, 120)}`);
  }
};

/*
 * 注意：这里**故意不留 Node 裸 fetch 的版本**。
 * 实测风控升级之后，匿名 Node 请求会被直接判为 SESSION_TIMEOUT，
 * 而同一个请求从已登录的页面上下文发出就正常。留个"方便"的匿名实现
 * 只会让以后的人再踩一次坑，所以只保留 makeGetter。
 */

/**
 * 解析用户粘贴的地址。
 * 优先认「御魂搭配」地址（带 eid），其次认商品页地址（只有 ordersn，需要用户补 eid）。
 */
export function parseAccountInput(raw) {
  const s = String(raw || '').trim();
  if (!s) throw new Error('地址为空');

  // 形如 /cgi/mweb/yuhun-collocation?eid=xxx&serverid=47&isH5=true
  const eidQ = s.match(/[?&]eid=([0-9A-Za-z-]+)/);
  const sidQ = s.match(/[?&](?:serverid|obj_serverid)=(\d+)/);
  if (eidQ && sidQ) {
    return { eid: eidQ[1], serverid: sidQ[1], source: 'yuhun-collocation', needsEid: false };
  }
  // 也可能直接粘 eid（配合 serverid 参数）
  if (/^[0-9]{10,}-\d+-[0-9A-Za-z]+$/.test(s) && sidQ) {
    return { eid: s, serverid: sidQ[1], source: 'manual', needsEid: false };
  }

  // 形如 /cgi/mweb/equip/47/202610161701616-47-C8MSKXBXH4B4E
  const m = s.match(/\/equip\/(\d+)\/([0-9]+-\d+-[0-9A-Za-z]+)/);
  if (m) {
    return { serverid: m[1], ordersn: m[2], source: 'equip', needsEid: true };
  }

  throw new Error('识别不了这个地址。需要「御魂搭配」地址（含 eid），或商品页地址 + eid');
}

/** 6★ 御魂副属性速度的理论满值：初始 1 次 + 强化 5 次，共 6 次 roll，每次上限 3 */
const SPEED_SUB_MAX = 18;
/** 2 号位主属性速度满级固定值 */
const SPEED_MAIN_MAX = 57;

/**
 * 拆出一件御魂的速度（游戏口径）。
 *
 * 藏宝阁 inventory 的 `attrs` 里「速度」条目**已经是最终值**：
 *   - 普通御魂只有副属性一条「速度」；
 *   - 2 号位主速度御魂有两条：「速度 57.00」（主属性）+「速度 x」（副属性）。
 * 副属性速度不可能超过 18，所以 2 号位出现的 >18 的「速度」只能是主属性。
 *
 * ⚠️ `rattr` 里的 speedAdditionVal 是**每次随机 roll 的归一化比例**（0~1，×3 为数值），
 * 全部加起来 ×3 恰好等于 attrs 里的副属性速度——两者是同一份数据，**不能相加**。
 * 旧实现把它们相加，导致单件速度翻倍、非 2 号位出现 >18 的「最快速」。
 */
const soulSpeed = (v, pos) => {
  const vals = (v.attrs || [])
    .filter(([k]) => k === '速度')
    .map(([, x]) => parseFloat(x))
    .filter((x) => Number.isFinite(x) && x > 0);

  const hasMain = pos === 2 && vals.some((x) => x > SPEED_SUB_MAX);
  const main = hasMain ? SPEED_MAIN_MAX : 0;
  const sub = Math.max(0, vals.reduce((a, b) => a + b, 0) - main);
  const round2 = (x) => Math.round(x * 100) / 100;
  return { sub: round2(sub), main, total: round2(sub + main) };
};

/**
 * 每种御魂在 6 个位置的**最快速**。
 *
 * 两种口径：
 *   - subOnly = false：总速度。2 号位 = 主属性 57 + 副属性速度（最高约 75），
 *     其余位置就是副属性速度（≤18）。
 *   - subOnly = true：仅副属性速度。2 号位只去掉 57 主属性，仍比较副属性（≤18），
 *     这样既排除了固定的主属性，又保留了区分度。
 *
 * 修正后，非 2 号位的单件速度不可能超过 18（6★ 副属性速度满值）。
 */
export function buildSpeedTable(inventory, subOnly = false) {
  const best = {};
  let total = 0;
  let mainSpeedCount = 0;

  for (const v of Object.values(inventory || {})) {
    if (!v || typeof v !== 'object' || !v.attrs) continue;
    const pos = v.pos;
    if (!pos) continue;
    total += 1;

    const { sub, main, total: totalSpeed } = soulSpeed(v, pos);
    if (main) mainSpeedCount += 1;
    if (!totalSpeed) continue;

    const value = subOnly ? sub : totalSpeed;
    if (!value) continue;

    const name = v.name || '?';
    best[name] = best[name] || {};
    if (!best[name][pos] || value > best[name][pos]) best[name][pos] = value;
  }

  const rows = Object.entries(best)
    .map(([name, byPos]) => {
      const pos = {};
      for (let p = 1; p <= 6; p += 1) pos[p] = byPos[p] ?? null;
      const vals = Object.values(pos).filter((x) => x !== null);
      return {
        name,
        p1: pos[1], p2: pos[2], p3: pos[3], p4: pos[4], p5: pos[5], p6: pos[6],
        max: vals.length ? Math.max(...vals) : 0,
        sum: Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100,
        coverage: vals.length,
      };
    })
    .sort((a, b) => b.max - a.max || b.sum - a.sum);

  return { total, mainSpeedCount, rows };
}

const METRIC_KEYS = [
  ['score', 'damage', '总评分'],
  ['attack', 'attackAdditionVal', '攻击'],
  ['hp', 'maxHpAdditionVal', '生命'],
  ['defense', 'defenseAdditionVal', '防御'],
  ['speed', 'speedAdditionVal', '速度'],
  ['critRate', 'critRateAdditionVal', '暴击'],
  ['critPower', 'critPowerAdditionVal', '暴击伤害'],
  ['hit', 'debuffEnhance', '效果命中'],
  ['resist', 'debuffResist', '效果抵抗'],
];

/**
 * 算一套方案的评分。
 *
 * 站点的评分是**懒计算**的，响应有几种形态，必须区别对待：
 *
 *   { "computing": true, "msg": "该式神御魂搭配方式正在计算中！" }
 *        → 还在算，可以再等一次（只等一次，别无限轮）
 *
 *   { "status": 3, "status_code": "CAPTCHA_AUTH", "msg": "进行安全验证" }
 *   { "status": 2, "status_code": "SESSION_TIMEOUT", "msg": "请登录之后继续访问" }
 *        → 触发了风控，**重试只会更糟**。
 *          实测教训：一次 16 套方案 × 12 次重试 = 192 个请求，
 *          直接把接口打成 CAPTCHA_AUTH，随后连列表查询都要求验证，
 *          浏览器页面里发同样的请求也被拒（说明不是请求头问题，是账号/IP 级的风控）。
 *
 * 所以：最多 2 次请求；一旦碰到风控就返回 blocked，调用方立刻停止后续所有方案。
 */
async function computePlan(get, eid, serverid, heroId, planId, { tries = 2, gapMs = 2500 } = {}) {
  const url =
    `/cgi/api/compute_yys_heroes_plan?client_type=h5&eid=${encodeURIComponent(eid)}` +
    `&obj_serverid=${serverid}&heroId=${heroId}&planId=${planId}`;

  let last = null;
  for (let i = 0; i < tries; i += 1) {
    const c = await get(url);
    last = c;
    const sv = c?.data?.result?.suit_vals;
    if (sv) return { sv, computing: false, blocked: false };

    // 风控：立即放弃，重试没有意义且有害
    const code = String(c?.status_code ?? '');
    if (code === 'CAPTCHA_AUTH' || code === 'MOBILE_AUTH' || code === 'SESSION_TIMEOUT' || c?.status === 3) {
      return { sv: null, computing: false, blocked: true, error: c?.msg || code || '触发风控' };
    }
    // 还在算
    if (c?.computing) {
      if (i < tries - 1) await sleep(gapMs);
      continue;
    }
    return { sv: null, computing: false, blocked: false, error: c?.msg || code || '未知错误' };
  }
  return {
    sv: null,
    computing: Boolean(last?.computing),
    blocked: false,
    error: last?.msg || '未返回评分',
  };
}

/** 拉指定式神的全部方案并逐个算分 */
async function scoreHeroes(get, eid, serverid, heroNames, onProgress) {
  const list = await get(
    `/cgi/api/get_yys_heroes_matching_plan?client_type=h5&eid=${encodeURIComponent(eid)}&obj_serverid=${serverid}`,
  );
  if (list.status !== 1 || !list.data) throw new Error('方案清单接口失败：' + (list.msg || list.status_code || ''));

  const all = Object.entries(list.data).map(([heroId, v]) => ({ heroId, name: v.name, plans: v.plans || [] }));
  const out = [];

  for (const want of heroNames) {
    const h = all.find((x) => x.name === want) || all.find((x) => (x.name || '').includes(want));
    if (!h) {
      out.push({ name: want, missing: true, plans: [] });
      continue;
    }
    const rows = [];
    let pending = 0;
    let blocked = false;
    let lastError = null;
    /**
     * 该账号是「冷计算」状态吗？
     *
     * 站点对**从没算过**的账号，第一套方案会返回 computing=true，
     * 这时每套都等两轮只会让一次分析拖到 60 秒以上（实测 62 秒）。
     * 所以一旦确认是冷计算，后续方案只发**一次**请求把它排进队列，
     * 由用户稍后点「重新分析」来取结果 —— 界面上会明确说明。
     */
    let coldAccount = false;

    for (let idx = 0; idx < h.plans.length; idx += 1) {
      const p = h.plans[idx];
      const desc = Object.fromEntries((p.desc || []).map((d) => [d.label, d.value]));
      const base = { planId: p.id, suit: desc['御魂套装'] || '', slots: desc['246号位选择'] || '', limit: desc['属性限制'] || '' };

      // 一旦触发风控就别继续打了 —— 打下去只会让风控更久
      if (blocked) {
        rows.push({ ...base, ...Object.fromEntries(METRIC_KEYS.map(([alias]) => [alias, null])) });
        pending += 1;
        continue;
      }

      const r = await computePlan(get, eid, serverid, h.heroId, p.id, coldAccount ? { tries: 1 } : undefined);
      if (r.blocked) blocked = true;
      if (!r.sv) {
        if (r.computing) {
          pending += 1;
          // 第一套就要等 → 整个账号都是冷的，后面的别再等第二轮
          if (idx === 0) coldAccount = true;
        } else if (r.error) lastError = r.error;
      }
      rows.push({ ...base, ...Object.fromEntries(METRIC_KEYS.map(([alias, key]) => [alias, r.sv?.[key] ?? null])) });
      if (onProgress) onProgress(h.name, rows.length, h.plans.length);
      await sleep(coldAccount ? 500 : 900);
    }
    rows.sort((a, b) => (b.score || 0) - (a.score || 0));
    const scored = rows.filter((r) => r.score !== null);
    out.push({
      name: h.name,
      heroId: h.heroId,
      planCount: rows.length,
      scoredCount: scored.length,
      /** 有多少套还在「计算中」没拿到分 —— 前端要如实告诉用户，不能显示成「—」装没事 */
      computing: pending,
      /** 触发了风控（验证/登录态）：需要用户去浏览器里过一次验证，或等冷却 */
      blocked,
      error: lastError,
      best: scored[0] || null,
      worst: scored[scored.length - 1] || null,
      plans: rows,
    });
  }
  return out;
}

/**
 * 主入口：给 eid + serverid，返回前端要的全部数据。
 * 注意只返回**提炼后的字段**——原始详情有 2.6MB，绝不能整体塞给浏览器。
 */
export async function analyzeAccount({ eid, serverid, heroes, subOnly = false, pageGet }) {
  if (typeof pageGet !== 'function') throw new Error('analyzeAccount 需要 pageGet（在页面上下文里发请求）');
  const get = makeGetter(pageGet);
  const detail = await get(
    `/cgi/api/get_equip_detail?client_type=h5&serverid=${serverid}&eid=${encodeURIComponent(eid)}`,
  );
  if (detail.status !== 1 || !detail.equip) {
    throw new Error(`详情接口失败：${detail.status_code ?? ''} ${detail.msg ?? ''}`);
  }
  const equip = detail.equip;
  const realEid = equip.eid || eid;

  let desc = {};
  try {
    desc = JSON.parse(equip.equip_desc || '{}');
  } catch {
    /* 解析失败时下面的数据就是空的，交给前端显示"无数据" */
  }
  const inventory = desc.inventory || {};

  const [speedAll, speedSub, heroScores] = await Promise.all([
    Promise.resolve(buildSpeedTable(inventory, false)),
    Promise.resolve(buildSpeedTable(inventory, true)),
    scoreHeroes(get, realEid, serverid, heroes),
  ]);

  // 账号概览（列表接口不返回、只有详情里有的那些）
  return {
    ok: true,
    eid: realEid,
    serverid,
    account: {
      ordersn: equip.game_ordersn,
      serverName: equip.server_name,
      areaName: equip.area_name,
      status: equip.status,
      statusDesc: equip.status_desc,
      price: equip.price,
      level: equip.level_desc || equip.subtitle || null,
      collectNum: equip.collect_num,
      createTime: equip.create_time,
      sellingTime: equip.selling_time,
      detailUrl: equip.equip_detail_url,
      // 详情独有的资产字段
      goyu: desc.goyu ?? null,
      signDays: desc.sign_days ?? null,
      fengzidu: desc.fengzidu ?? null,
      soulCount: speedAll.total,
      mainSpeedSouls: speedAll.mainSpeedCount,
    },
    speed: {
      all: speedAll.rows,
      subOnly: speedSub.rows,
    },
    heroes: heroScores,
  };
}

/**
 * 轻量探测：只回答两个问题——
 *   1) 这个账号有多少御魂
 *   2) 每个目标式神**第一套方案**能不能算出分
 *
 * 用途：做「御魂数 → 出分率」的抽样统计。
 * 为什么要单独做：完整分析最多要
 *   1 次详情 + 1 次方案清单 + Σ(每套方案 2 次) ≈ 30+ 请求，
 * 拿它去跑几十个账号必然触发风控。探测模式固定 **4 个请求/账号**
 * （详情 + 清单 + 每个式神 1 次），既能判断「算不算得出来」，又足够轻。
 */
export async function probeAccount({ eid, serverid, heroes, pageGet, pageEval }) {
  const get = makeGetter(pageGet);
  if (typeof pageEval !== 'function') throw new Error('probeAccount 需要 pageEval');

  /**
   * 详情接口一次返回约 2.6 MB，而探测只需要「御魂数量 / 勾玉 / 签到天数」三个数。
   *
   * 如果照旧把整份 JSON 通过 `Runtime.evaluate` 的 returnByValue 传回 Node，
   * CDP 要序列化 2.6 MB 的字符串 —— 实测跑十几个账号后页面就会
   * `页面响应超时（60000ms）：Runtime.evaluate` 而彻底卡死（踩过）。
   *
   * 所以这里**在页面里就把 equip_desc 解析掉**，只回传要用的字段，
   * 传输量从 2.6 MB 降到几百字节。
   */
  const detail = await pageEval(`
    (async () => {
      const r = await fetch('/cgi/api/get_equip_detail?client_type=h5&serverid=${serverid}&eid=${encodeURIComponent(eid)}', {
        credentials: 'include', headers: { 'x-requested-with': 'XMLHttpRequest' }
      });
      const j = await r.json();
      if (j.status !== 1 || !j.equip) {
        return { status: j.status, status_code: j.status_code, msg: j.msg };
      }
      let d = {};
      try { d = JSON.parse(j.equip.equip_desc || '{}'); } catch (e) {}
      const inv = d.inventory || {};
      let soulCount = 0;
      for (const k in inv) {
        const v = inv[k];
        if (v && typeof v === 'object' && v.attrs) soulCount += 1;
      }
      return {
        status: 1,
        eid: j.equip.eid,
        price: j.equip.price,
        server_name: j.equip.server_name,
        soulCount: soulCount,
        goyu: d.goyu === undefined ? null : d.goyu,
        signDays: d.sign_days === undefined ? null : d.sign_days
      };
    })()
  `);

  if (!detail || detail.status !== 1) {
    const code = String(detail?.status_code ?? '');
    return {
      ok: false,
      blocked: code === 'CAPTCHA_AUTH' || code === 'MOBILE_AUTH' || code === 'SESSION_TIMEOUT',
      error: `${code} ${detail?.msg ?? '详情接口无返回'}`.trim(),
    };
  }
  const realEid = detail.eid || eid;
  const soulCount = detail.soulCount;

  const list = await get(
    `/cgi/api/get_yys_heroes_matching_plan?client_type=h5&eid=${encodeURIComponent(realEid)}&obj_serverid=${serverid}`,
  );
  const all = list?.status === 1 && list.data
    ? Object.entries(list.data).map(([heroId, v]) => ({ heroId, name: v.name, plans: v.plans || [] }))
    : [];

  const heroResults = [];
  for (const want of heroes) {
    const h = all.find((x) => x.name === want) || all.find((x) => (x.name || '').includes(want));
    if (!h) {
      heroResults.push({ name: want, hasPlans: false, planCount: 0, scored: false, score: null });
      continue;
    }
    const first = h.plans[0];
    if (!first) {
      heroResults.push({ name: h.name, hasPlans: false, planCount: 0, scored: false, score: null });
      continue;
    }
    // tries: 1 —— 探测只要一个「能不能」的信号，不重试
    const r = await computePlan(get, realEid, serverid, h.heroId, first.id, { tries: 1 });
    heroResults.push({
      name: h.name,
      hasPlans: true,
      planCount: h.plans.length,
      scored: Boolean(r.sv),
      score: r.sv?.damage ?? null,
      computing: Boolean(r.computing),
      blocked: Boolean(r.blocked),
    });
    await sleep(700);
  }

  return {
    ok: true,
    eid: realEid,
    serverid,
    price: detail.price,
    serverName: detail.server_name,
    soulCount,
    goyu: detail.goyu,
    signDays: detail.signDays,
    heroes: heroResults,
    blocked: heroResults.some((h) => h.blocked),
  };
}

