/**
 * accountAnalyze.mjs — 模块二「账号评分」的服务端逻辑。
 *
 * 为什么放在伴随服务里：这三个藏宝阁接口**没有 CORS 头**（实测
 * access-control-allow-origin 为空），浏览器不能直接从 github.io 或
 * 127.0.0.1:5173 调用。服务端在本机发请求就没有跨域限制。
 *
 * 三个接口全部**匿名可用**（不需要登录态，实测 Node 直接请求即可）：
 *
 *   GET /cgi/api/get_equip_detail?client_type=h5&serverid=<sid>&eid=<eid>
 *       → equip.equip_desc（约 1.6MB JSON 字符串）→ inventory / heroes
 *   GET /cgi/api/get_yys_heroes_matching_plan?client_type=h5&eid=<eid>&obj_serverid=<sid>
 *       → data = { heroId: { name, plans:[{ id, desc:[{label,value}] }] } }
 *   GET /cgi/api/compute_yys_heroes_plan?client_type=h5&eid=<eid>&obj_serverid=<sid>&heroId=<h>&planId=<p>
 *       → data.result.suit_vals.damage 就是页面上的「总评分」
 *
 * 两个必须记住的坑：
 *   1) 商品页地址里是 **ordersn**，接口要 **eid**，两者不同且**无法互相推导**
 *      （ordersn 查详情报「物品不存在」；HTML 不含 eid；首段差值不稳定）。
 *      所以这里接受「御魂搭配」弹窗地址，它直接带 eid：
 *        /cgi/mweb/yuhun-collocation?eid=<eid>&serverid=<sid>&isH5=true
 *   2) 御魂速度 = attrs 里的「速度」值 + Σ rattr.speedAdditionVal × 3
 *      （rattr 是 0~1 归一化比例，上限 0.9999；×3 换算为游戏数值）
 *      2 号位速度可以是**主属性**（满值 57），所以 P2 有两种口径，见 buildSpeedTable。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0';
const BASE = 'https://yys.cbg.163.com';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cbgGet = async (path) => {
  const res = await fetch(BASE + path, {
    headers: {
      'user-agent': UA,
      'x-requested-with': 'XMLHttpRequest',
      accept: 'application/json, text/plain, */*',
      referer: BASE + '/cgi/mweb/pl?search_type=role',
    },
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`藏宝阁返回非 JSON（HTTP ${res.status}）：${text.slice(0, 120)}`);
  }
};

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

/** 判断「速度」是不是 2 号位的主属性（满值 57，且没有随机速度加成） */
const isMainSpeed = (pos, base, random) => pos === 2 && base >= 55 && random === 0;

/**
 * 每种御魂在 6 个位置的**最快速**。
 *
 * subOnly = true 时排除 2 号位主属性速度——因为那个位置所有人都固定 57，
 * 混在一起看会让 P2 列失去区分度；只看副属性才能比较「谁的速攻更好」。
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

    const attrs = Object.fromEntries(v.attrs.map(([k, val]) => [k, val]));
    const base = parseFloat(attrs['速度'] || '0') || 0;
    const rSum = (v.rattr || []).filter(([k]) => k === 'speedAdditionVal').reduce((a, [, x]) => a + x, 0);
    const random = Math.round(rSum * 3 * 100) / 100;
    const sum = Math.round((base + random) * 100) / 100;

    if (isMainSpeed(pos, base, random)) {
      mainSpeedCount += 1;
      if (subOnly) continue;
    }
    if (!sum) continue;

    const name = v.name || '?';
    best[name] = best[name] || {};
    if (!best[name][pos] || sum > best[name][pos]) best[name][pos] = sum;
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

/** 拉指定式神的全部方案并逐个算分 */
async function scoreHeroes(eid, serverid, heroNames, onProgress) {
  const list = await cbgGet(
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
    for (const p of h.plans) {
      const c = await cbgGet(
        `/cgi/api/compute_yys_heroes_plan?client_type=h5&eid=${encodeURIComponent(eid)}` +
          `&obj_serverid=${serverid}&heroId=${h.heroId}&planId=${p.id}`,
      );
      const sv = c?.data?.result?.suit_vals || {};
      const desc = Object.fromEntries((p.desc || []).map((d) => [d.label, d.value]));
      const row = { planId: p.id, suit: desc['御魂套装'] || '', slots: desc['246号位选择'] || '', limit: desc['属性限制'] || '' };
      for (const [alias, key] of METRIC_KEYS) row[alias] = sv[key] ?? null;
      rows.push(row);
      if (onProgress) onProgress(h.name, rows.length, h.plans.length);
      await sleep(600);
    }
    rows.sort((a, b) => (b.score || 0) - (a.score || 0));
    out.push({
      name: h.name,
      heroId: h.heroId,
      planCount: rows.length,
      best: rows[0] || null,
      worst: rows[rows.length - 1] || null,
      plans: rows,
    });
  }
  return out;
}

/**
 * 主入口：给 eid + serverid，返回前端要的全部数据。
 * 注意只返回**提炼后的字段**——原始详情有 2.6MB，绝不能整体塞给浏览器。
 */
export async function analyzeAccount({ eid, serverid, heroes, subOnly = false }) {
  const detail = await cbgGet(
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
    scoreHeroes(realEid, serverid, heroes),
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
