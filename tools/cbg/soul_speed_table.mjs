/**
 * soul_speed_table.mjs — 统计一个账号「每种御魂在 6 个位置的最快速」。
 *
 * 数据来源：GET /cgi/api/get_equip_detail?client_type=h5&serverid=<sid>&eid=<eid>
 *           → equip.equip_desc（约 1.6MB JSON 字符串）→ inventory（御魂仓库）
 * 接口**匿名可用**，不需要登录。
 *
 * 速度的算法（实测自藏宝阁 get_equip_detail 的 inventory）：
 *   attrs 里的「速度」条目**已经是最终值**；2 号位主速度御魂有两条
 *   （主属性 57.00 + 副属性 x）。所以：
 *     副属性速度 = attrs 里所有「速度」之和 −（2 号位主属性 57）
 *     总速度     = 副属性速度 +（2 号位主属性 57）
 *   副属性速度满值 18（6★ 共 6 次 roll、每次上限 3），
 *   非 2 号位的单件总速度不可能超过 18。
 *
 * ⚠️ 旧算法「attrs 速度 + Σ rattr.speedAdditionVal × 3」是错的：
 *   rattr 只是同一份副属性速度的「每次 roll 归一化比例」，相加会把速度算两遍
 *   （实测非 2 号位出现 34.24 这种值），已修正。
 *
 * ⚠️ 2 号位的两种口径（本脚本同时给出）：
 *   - 默认「总速度」：P2 = 57 + 副属性速度，最高约 75；
 *   - --sub-only：P2 去掉 57 主属性，只看副属性堆出来的速度（≤18），更有区分度。
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

/** 6★ 副属性速度理论满值：6 次 roll × 每次上限 3 */
const SPEED_SUB_MAX = 18;
/** 2 号位主属性速度满级固定值 */
const SPEED_MAIN_MAX = 57;

/**
 * 拆出一件御魂的速度。
 * attrs 里「速度」条目是最终值；2 号位主速度御魂有两条（57 主属性 + x 副属性），
 * 副属性不可能 >18，所以 2 号位 >18 的「速度」必是主属性。
 */
export function soulSpeed(v) {
  const vals = (v.attrs || [])
    .filter(([k]) => k === '速度')
    .map(([, x]) => parseFloat(x))
    .filter((x) => Number.isFinite(x) && x > 0);

  const hasMain = v.pos === 2 && vals.some((x) => x > SPEED_SUB_MAX);
  const main = hasMain ? SPEED_MAIN_MAX : 0;
  const sub = Math.max(0, vals.reduce((a, b) => a + b, 0) - main);
  const round2 = (x) => Math.round(x * 100) / 100;
  return { sub: round2(sub), main, total: round2(sub + main) };
}

export function buildTable(inventory, subOnly) {
  const best = {};
  let total = 0;
  let mainSpeedCount = 0;

  for (const v of Object.values(inventory || {})) {
    if (!v || typeof v !== 'object' || !v.attrs) continue;
    const pos = v.pos;
    if (!pos) continue;
    total += 1;

    const { sub, main, total: totalSpd } = soulSpeed(v);
    if (main) mainSpeedCount += 1;
    if (!totalSpd) continue;

    // 仅副属性口径：只去掉 2 号位的 57 主属性，仍比较副属性速度
    const value = subOnly ? sub : totalSpd;
    if (!value) continue;

    const name = v.name || '?';
    best[name] = best[name] || {};
    if (!best[name][pos] || value > best[name][pos].total) {
      best[name][pos] = { total: value, sub, main, star: v.qua, level: v.level };
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
