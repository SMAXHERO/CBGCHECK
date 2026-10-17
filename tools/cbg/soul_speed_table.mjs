/**
 * soul_speed_table.mjs — 统计一个账号「每种御魂在 6 个位置的最快速」。
 *
 * 数据来源：GET /cgi/api/get_equip_detail?client_type=h5&serverid=<sid>&eid=<eid>
 *           → equip.equip_desc（约 1.6MB JSON 字符串）→ inventory（御魂仓库）
 * 接口**匿名可用**，不需要登录。
 *
 * 速度的算法（实测校准过）：
 *   速度 = attrs 里的「速度」值  +  Σ rattr.speedAdditionVal × 3
 *   rattr 是 0~1 的归一化比例（上限 0.9999），× 3 换算为游戏数值。
 *   验证：主属性 57 的 2 号位，rattr 和为 0 → 总速度 57，正确。
 *
 * ⚠️ 2 号位的歧义（本脚本同时给出两种口径）：
 *   2 号位的主属性**可以是速度**，满值 57。所以按「总速度」统计时，
 *   所有御魂的 P2 都是 57.00，没有任何区分度。
 *   因此额外提供 --sub-only：排除主属性速度，只看**副属性堆出来的速度**。
 *   给「哪些御魂速度更好」做参考时，用 --sub-only 更有意义。
 *
 * 用法：
 *   node tools/cbg/soul_speed_table.mjs --serverid 47 --eid <eid>
 *   node tools/cbg/soul_speed_table.mjs --serverid 47 --eid <eid> --sub-only --json
 */

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const has = (name) => process.argv.includes(`--${name}`);

const SID = arg('serverid', '');
const EID = arg('eid', '');
const SUB_ONLY = has('sub-only');
const AS_JSON = has('json');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0';

/** 判断「速度」是不是 2 号位的主属性（满值 57 且没有随机速度加成） */
const isMainSpeed = (pos, base, random) => pos === 2 && base >= 55 && random === 0;

export function buildTable(inventory, subOnly) {
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
    const totalSpd = Math.round((base + random) * 100) / 100;

    if (isMainSpeed(pos, base, random)) {
      mainSpeedCount += 1;
      if (subOnly) continue; // 排除主属性速度
    }
    if (!totalSpd) continue;

    const name = v.name || '?';
    best[name] = best[name] || {};
    if (!best[name][pos] || totalSpd > best[name][pos].total) {
      best[name][pos] = { total: totalSpd, base, random, star: v.qua, level: v.level };
    }
  }

  const rows = Object.entries(best)
    .map(([name, byPos]) => {
      const pos = {};
      for (let p = 1; p <= 6; p += 1) pos[p] = byPos[p] ? byPos[p].total : null;
      const vals = Object.values(pos).filter((x) => x !== null);
      return {
        name,
        pos,
        max: vals.length ? Math.max(...vals) : 0,
        sum: Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100,
        coverage: vals.length,
      };
    })
    .sort((a, b) => b.max - a.max || b.sum - a.sum);

  return { total, mainSpeedCount, rows };
}

const main = async () => {
  if (!SID || !EID) {
    console.error('用法: node tools/cbg/soul_speed_table.mjs --serverid <id> --eid <eid> [--sub-only] [--json]');
    process.exitCode = 1;
    return;
  }
  const res = await fetch(
    `https://yys.cbg.163.com/cgi/api/get_equip_detail?client_type=h5&serverid=${SID}&eid=${encodeURIComponent(EID)}`,
    {
      headers: {
        'user-agent': UA,
        'x-requested-with': 'XMLHttpRequest',
        accept: 'application/json, text/plain, */*',
        referer: 'https://yys.cbg.163.com/cgi/mweb/pl?search_type=role',
      },
    },
  );
  const j = await res.json();
  if (j.status !== 1) {
    console.error('详情接口失败: ' + (j.msg || j.status_code));
    process.exitCode = 1;
    return;
  }
  const desc = JSON.parse(j.equip.equip_desc || '{}');
  const { total, mainSpeedCount, rows } = buildTable(desc.inventory || {}, SUB_ONLY);

  console.log(
    `账号 eid=${EID}  御魂 ${total} 件（2 号位主属性速度 ${mainSpeedCount} 件）` +
      (SUB_ONLY ? '  — 口径：仅副属性速度' : '  — 口径：总速度（含主属性）'),
  );
  console.log();
  const head = '  御魂'.padEnd(14) + ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'].map((x) => x.padStart(7)).join('') + '    最高    合计  覆盖';
  console.log(head);
  console.log('  ' + '-'.repeat(head.length - 2));
  for (const r of rows) {
    const cells = [1, 2, 3, 4, 5, 6].map((p) => (r.pos[p] === null ? '—' : r.pos[p].toFixed(2)).padStart(7));
    console.log(
      '  ' + r.name.padEnd(12) + cells.join('') + r.max.toFixed(2).padStart(8) + r.sum.toFixed(1).padStart(9) + String(r.coverage).padStart(6),
    );
  }
  if (AS_JSON) {
    console.log();
    console.log(JSON.stringify({ eid: EID, subOnly: SUB_ONLY, rows }, null, 1));
  }
};

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('soul_speed_table.mjs')) {
  main().catch((e) => {
    console.error('失败: ' + e.message);
    process.exitCode = 1;
  });
}
