/**
 * account_score.mjs — 模块二核心逻辑：输入藏宝阁账号地址，输出
 *   ① 指定式神的御魂搭配方案评分（须佐之男 / 阿修罗，可配）
 *   ② 每种御魂在 6 个位置上的最快速
 *
 * 接口全部**匿名可用**（实测 Node 直接请求即可，不需要登录、不需要浏览器）：
 *
 *   GET /cgi/api/get_equip_detail?client_type=h5&serverid=<sid>&eid=<eid>
 *       → equip.equip_desc 里有 inventory（御魂仓库）与 heroes
 *   GET /cgi/api/get_yys_heroes_matching_plan?client_type=h5&eid=<eid>&obj_serverid=<sid>
 *       → data = { heroId: { name, plans:[{ id, desc:[{label,value}] }] } }
 *   GET /cgi/api/compute_yys_heroes_plan?client_type=h5&eid=<eid>&obj_serverid=<sid>&heroId=<h>&planId=<p>
 *       → data.result.suit_vals.damage 就是页面上的「总评分」
 *
 * 两个必须知道的坑：
 *   1. 地址里的 `202610161701616-47-C8MSKXBXH4B4E` 是 **ordersn**，
 *      而这三个接口要的是 **eid**（`202610161701613-47-SMSV5P0UFDMEW`），两者不同！
 *      但 `get_equip_detail` 传 ordersn 也能查通，且响应里带 eid —— 所以用 ordersn 探一次即可。
 *   2. 御魂速度直接取 attrs 里的「速度」条目（已经是最终值；2 号位主速度御魂
 *      会同时有主属性 57.00 和副属性 x）。旧的「attrs + Σ rattr×3」把同一份
 *      速度算了两遍，导致非 2 号位出现 >18 的单件速度，已修正。
 *
 * 用法：
 *   node tools/cbg/account_score.mjs --url "https://yys.cbg.163.com/cgi/mweb/equip/47/202610161701616-47-C8MSKXBXH4B4E"
 *   node tools/cbg/account_score.mjs --url "..." --hero 须佐之男 --hero 阿修罗 --json
 */

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const argAll = (name) => {
  const out = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
};

const URL_ARG = arg('url', '');
const EID_ARG = arg('eid', '');
const HEROES = argAll('hero').length ? argAll('hero') : ['须佐之男', '阿修罗'];
const AS_JSON = process.argv.includes('--json');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0';
const BASE = 'https://yys.cbg.163.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const req = async (path) => {
  const res = await fetch(BASE + path, {
    headers: {
      'user-agent': UA,
      'x-requested-with': 'XMLHttpRequest',
      accept: 'application/json, text/plain, */*',
      referer: BASE + '/cgi/mweb/pl?search_type=role',
    },
  });
  const t = await res.text();
  let j = null;
  try {
    j = JSON.parse(t);
  } catch {
    throw new Error(`返回非 JSON（${res.status}）：${t.slice(0, 120)}`);
  }
  return j;
};

/**
 * 从商品页地址里取出 serverid 与 ordersn。
 *
 * ⚠️ 注意 ordersn ≠ eid：接口要的是 eid，而地址里只有 ordersn。
 * 实测**无法从 ordersn 推导出 eid**：
 *   - 详情接口传 ordersn 一律报「物品不存在」（各种 Referer 都试过）
 *   - 商品页 HTML 里不含 eid
 *   - 两个 id 的首段差值是 3 或 -99997 等，没有稳定规律
 * 所以本脚本必须同时拿到 eid（用 --eid，或让调用方在浏览器里抓一次）。
 *
 * 拿 eid 的两个办法：
 *   a) 浏览器打开商品页 → F12 → Network → 找 get_equip_detail 的请求 → URL 里的 eid
 *   b) 从「御魂搭配」弹窗的 iframe 地址里读：
 *      /cgi/mweb/yuhun-collocation?eid=<eid>&serverid=<sid>&isH5=true
 */
export function parseAccountUrl(u) {
  const m = String(u).match(/\/equip\/(\d+)\/([0-9]+-\d+-[A-Za-z0-9]+)/);
  if (!m) throw new Error('地址里解析不出 serverid / ordersn，应形如 /cgi/mweb/equip/<服务器id>/<ordersn>');
  return { serverid: m[1], ordersn: m[2] };
}

/** 用 ordersn 探一次详情，拿到真正的 eid（以及顺手拿到 equip_desc） */
export async function resolveEid(serverid, ordersn) {
  const j = await req(`/cgi/api/get_equip_detail?client_type=h5&serverid=${serverid}&eid=${encodeURIComponent(ordersn)}`);
  if (j.status !== 1 || !j.equip) throw new Error(`详情接口失败：${j.status_code ?? ''} ${j.msg ?? ''}`);
  return { eid: j.equip.eid, equip: j.equip };
}

/**
 * 御魂速度：副属性速度 + 2 号位主属性速度 57（见文件头注释的坑 2）。
 *
 * attrs 里的「速度」是最终值，2 号位主速度御魂有两条：
 * 主属性 57.00 + 副属性 x。副属性不可能 >18，所以 >18 的那条必是主属性。
 */
const SPEED_SUB_MAX = 18; // 6★ 副属性速度理论满值：6 次 roll × 每次上限 3
const SPEED_MAIN_MAX = 57; // 2 号位主属性速度满级

export function soulSpeed(soul) {
  const vals = (soul.attrs || [])
    .filter(([k]) => k === '速度')
    .map(([, x]) => parseFloat(x))
    .filter((x) => Number.isFinite(x) && x > 0);

  const hasMain = soul.pos === 2 && vals.some((x) => x > SPEED_SUB_MAX);
  const main = hasMain ? SPEED_MAIN_MAX : 0;
  const sub = Math.max(0, vals.reduce((a, b) => a + b, 0) - main);
  const round2 = (x) => Math.round(x * 100) / 100;
  return { sub: round2(sub), main, total: round2(sub + main) };
}

/** 每种御魂 × 6 个位置的最快速（总速度：2 号位 = 57 + 副属性） */
export function speedBySuit(inventory) {
  const best = {};
  let total = 0;
  for (const v of Object.values(inventory || {})) {
    if (!v || typeof v !== 'object' || !v.attrs) continue;
    const pos = v.pos;
    if (!pos) continue;
    total += 1;
    const s = soulSpeed(v);
    if (!s.total) continue;
    const name = v.name || '?';
    best[name] = best[name] || {};
    if (!best[name][pos] || s.total > best[name][pos].total) best[name][pos] = { ...s, uuid: v.uuid, level: v.level, star: v.qua };
  }
  const rows = Object.entries(best)
    .map(([name, byPos]) => {
      const pos = {};
      for (let p = 1; p <= 6; p += 1) pos[p] = byPos[p] ? byPos[p].total : null;
      const vals = Object.values(pos).filter((x) => x !== null);
      return { name, pos, max: vals.length ? Math.max(...vals) : 0, suitTotal: vals.reduce((a, b) => a + b, 0) };
    })
    .sort((a, b) => b.max - a.max);
  return { total, rows };
}

/** 拉指定式神的全部方案并逐个算分 */
export async function scoreHeroes(eid, serverid, heroNames, onProgress) {
  const list = await req(`/cgi/api/get_yys_heroes_matching_plan?client_type=h5&eid=${eid}&obj_serverid=${serverid}`);
  if (list.status !== 1 || !list.data) throw new Error('方案清单失败：' + (list.msg || ''));
  const all = Object.entries(list.data).map(([heroId, v]) => ({ heroId, name: v.name, plans: v.plans || [] }));

  const out = [];
  for (const name of heroNames) {
    const h = all.find((x) => x.name === name) || all.find((x) => (x.name || '').includes(name));
    if (!h) continue;
    const rows = [];
    for (const p of h.plans) {
      const c = await req(
        `/cgi/api/compute_yys_heroes_plan?client_type=h5&eid=${eid}&obj_serverid=${serverid}&heroId=${h.heroId}&planId=${p.id}`,
      );
      const sv = c?.data?.result?.suit_vals || {};
      const desc = Object.fromEntries((p.desc || []).map((d) => [d.label, d.value]));
      rows.push({
        planId: p.id,
        suit: desc['御魂套装'] || '',
        slots: desc['246号位选择'] || '',
        limit: desc['属性限制'] || '',
        score: sv.damage ?? null,
        攻击: sv.attackAdditionVal ?? null,
        生命: sv.maxHpAdditionVal ?? null,
        防御: sv.defenseAdditionVal ?? null,
        速度: sv.speedAdditionVal ?? null,
        暴击: sv.critRateAdditionVal ?? null,
        暴击伤害: sv.critPowerAdditionVal ?? null,
        命中: sv.debuffEnhance ?? null,
        抵抗: sv.debuffResist ?? null,
      });
      if (onProgress) onProgress(name, rows.length, h.plans.length, rows[rows.length - 1]);
      await sleep(700);
    }
    rows.sort((a, b) => (b.score || 0) - (a.score || 0));
    out.push({ name: h.name, heroId: h.heroId, plans: rows, best: rows[0]?.score ?? null, worst: rows[rows.length - 1]?.score ?? null });
  }
  return out;
}

const main = async () => {
  if (!URL_ARG) {
    console.error('用法: node tools/cbg/account_score.mjs --url "<账号地址>"');
    process.exitCode = 1;
    return;
  }
  const { serverid, ordersn } = parseAccountUrl(URL_ARG);
  console.log(`账号地址解析: serverid=${serverid}  ordersn=${ordersn}`);

  if (!EID_ARG) {
    console.error();
    console.error('缺少 eid —— 接口只认 eid，不认地址里的 ordersn。');
    console.error('拿 eid 的两个办法：');
    console.error('  a) 浏览器打开该商品页 → F12 → Network → find get_equip_detail → URL 里的 eid');
    console.error('  b) 打开页面上的「御魂搭配」弹窗，看 iframe 地址：');
    console.error('     /cgi/mweb/yuhun-collocation?eid=<eid>&serverid=' + serverid + '&isH5=true');
    console.error();
    console.error('然后重跑：--url "<原地址>" --eid <eid>');
    process.exitCode = 2;
    return;
  }

  const { eid, equip } = await resolveEid(serverid, EID_ARG);
  console.log(`eid=${eid}  价格 ¥${(equip.price || 0) / 100}  ${equip.server_name}  状态 ${equip.status_desc}`);

  let desc = {};
  try {
    desc = JSON.parse(equip.equip_desc || '{}');
  } catch {}
  const inv = desc.inventory || {};
  const { total, rows } = speedBySuit(inv);
  console.log(`御魂仓库 ${total} 件，其中带速度的按「御魂×位置」汇总为 ${rows.length} 种`);

  console.log();
  console.log('=== 每种御魂在 6 个位置的最快速 ===');
  console.log('  御魂'.padEnd(14) + ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((x) => x.padStart(7)).join('') + '   最高');
  for (const r of rows.slice(0, 25)) {
    const cells = [1, 2, 3, 4, 5, 6].map((p) => (r.pos[p] === null ? '—' : r.pos[p].toFixed(2)).padStart(7));
    console.log('  ' + r.name.padEnd(12) + cells.join('') + '  ' + r.max.toFixed(2).padStart(7));
  }

  console.log();
  console.log('=== 式神御魂搭配评分 ===');
  const heroes = await scoreHeroes(eid, serverid, HEROES, (n, i, len, row) => {
    console.log(`  [${n}] ${i}/${len}  ${String(row.suit).padEnd(18)} 总评分 ${row.score}`);
  });

  console.log();
  for (const h of heroes) {
    console.log(`【${h.name}】最优 ${h.best} / 最差 ${h.worst}（${h.plans.length} 套）`);
    for (const r of h.plans) {
      console.log(`    ${String(r.score).padStart(9)}  ${String(r.suit).padEnd(20)} ${r.limit}`);
    }
  }

  if (AS_JSON) {
    console.log();
    console.log(JSON.stringify({ serverid, ordersn, eid, speed: rows, heroes }, null, 1));
  }
};

// 直接运行时才执行（被 import 时不执行）
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('account_score.mjs')) {
  main().catch((e) => {
    console.error('失败: ' + e.message);
    process.exitCode = 1;
  });
}
