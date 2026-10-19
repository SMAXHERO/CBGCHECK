/**
 * verify_speed_table.mjs — 速度表算法的回归校验。
 *
 * 用缓存好的 get_equip_detail 响应（或 equip_desc JSON）验证修正后的速度口径：
 *   1) 每件御魂的副属性速度 ≤ 18（6★ 上限；低星只会更小）；
 *   2) 非 2 号位的单件总速度 ≤ 18（只有 2 号位主属性速度能让单件超过 18）；
 *   3) 2 号位主速度御魂的总速度 = 57 + 副属性速度，范围 [57, 75]；
 *   4) 6★ 御魂的副属性速度 == Σ rattr.speedAdditionVal × 3
 *      （两者是同一份数据的最终值与逐次 roll 比例，不能相加）；
 *   5) 速度表两种口径下：非 2 号位单元格全部 ≤ 18；
 *      总速度口径的 2 号位单元格 ≤ 75；仅副属性口径的 2 号位单元格 ≤ 18；
 *   6) 服务端 buildSpeedTable 与 CLI buildTable 的结果一致。
 *
 * 用法：
 *   node tools/cbg/verify_speed_table.mjs --file "<缓存详情.json>" [--file "<另一个>.json"]
 *
 * 缓存文件支持三种形态：
 *   - { equip: { equip_desc: "<JSON 字符串>" } }   ← 藏宝阁 get_equip_detail 响应
 *   - { equip_desc: "<JSON 字符串>" }
 *   - { inventory: {...} }                          ← 已解析的 equip_desc
 */

import fs from 'node:fs';
import path from 'node:path';
import { buildSpeedTable } from './scraper-service/accountAnalyze.mjs';
import { buildTable } from './soul_speed_table.mjs';
import { speedBySuit } from './account_score.mjs';

const SPEED_SUB_MAX = 18; // 6★ 副属性速度满值：6 次 roll × 每次上限 3
const SPEED_MAIN_MAX = 57; // 2 号位主属性速度满级
const EPS = 0.02;

const args = process.argv.slice(2);
const files = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--file' && args[i + 1]) files.push(args[i + 1]);
}

if (!files.length) {
  console.error('用法: node tools/cbg/verify_speed_table.mjs --file "<缓存详情.json>" [--file ...]');
  process.exitCode = 1;
} else {
  let failed = 0;
  for (const file of files) if (!verifyFile(file)) failed += 1;
  if (failed) process.exitCode = 1;
}

function loadInventory(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (raw && raw.inventory) return raw.inventory;
  if (raw?.equip?.equip_desc) return JSON.parse(raw.equip.equip_desc).inventory || {};
  if (raw?.equip_desc) return JSON.parse(raw.equip_desc).inventory || {};
  throw new Error(`${file}: 识别不了缓存结构（需要 equip.equip_desc / equip_desc / inventory）`);
}

function countOver(rows, key, limit) {
  let n = 0;
  for (const r of rows) {
    const v = r[key];
    if (v !== null && v !== undefined && v > limit + EPS) n += 1;
  }
  return n;
}

function verifyFile(file) {
  const label = path.basename(file);
  const errors = [];
  let inventory;
  try {
    inventory = loadInventory(file);
  } catch (e) {
    console.error(`\n== ${label} ==\n❌ ${e.message}`);
    return false;
  }

  let souls = 0;
  let mainCount = 0;
  const maxByPos = new Map();

  for (const v of Object.values(inventory)) {
    if (!v || typeof v !== 'object' || !Array.isArray(v.attrs)) continue;
    const pos = Number(v.pos);
    if (!pos) continue;
    souls += 1;

    const vals = v.attrs
      .filter(([k]) => k === '速度')
      .map(([, x]) => parseFloat(x))
      .filter((x) => Number.isFinite(x) && x > 0);

    const hasMain = pos === 2 && vals.some((x) => x > SPEED_SUB_MAX);
    const main = hasMain ? SPEED_MAIN_MAX : 0;
    const sub = Math.max(0, vals.reduce((a, b) => a + b, 0) - main);
    const total = sub + main;
    if (hasMain) mainCount += 1;

    if (sub > SPEED_SUB_MAX + EPS) errors.push(`副属性速度 ${sub.toFixed(2)} > 18（pos=${pos} uuid=${v.uuid}）`);
    if (pos !== 2 && total > SPEED_SUB_MAX + EPS) errors.push(`非 2 号位总速度 ${total.toFixed(2)} > 18（pos=${pos} uuid=${v.uuid}）`);
    if (pos === 2 && total > SPEED_MAIN_MAX + SPEED_SUB_MAX + EPS) errors.push(`2 号位总速度 ${total.toFixed(2)} > 75（uuid=${v.uuid}）`);
    if (hasMain && Math.abs(total - (SPEED_MAIN_MAX + sub)) > EPS) errors.push(`2 号位主属性速度合计异常（uuid=${v.uuid}）`);

    if (Number(v.qua) === 6) {
      const rSum = (v.rattr || [])
        .filter(([k]) => k === 'speedAdditionVal')
        .reduce((a, [, x]) => a + x, 0);
      if (Math.abs(sub - rSum * 3) > EPS) {
        errors.push(`6★ 副属性速度 ${sub.toFixed(2)} ≠ Σrattr×3 ${(rSum * 3).toFixed(2)}（uuid=${v.uuid}）`);
      }
    }

    maxByPos.set(pos, Math.max(maxByPos.get(pos) ?? 0, total));
  }

  const all = buildSpeedTable(inventory, false);
  const subOnly = buildSpeedTable(inventory, true);

  const checkTable = (tbl, mode) => {
    for (const r of tbl.rows) {
      for (const p of [1, 3, 4, 5, 6]) {
        const v = r[`p${p}`];
        if (v !== null && v > SPEED_SUB_MAX + EPS) errors.push(`[${mode}] ${r.name} P${p}=${v.toFixed(2)} > 18`);
      }
      const cap = mode === 'all' ? SPEED_MAIN_MAX + SPEED_SUB_MAX : SPEED_SUB_MAX;
      if (r.p2 !== null && r.p2 > cap + EPS) errors.push(`[${mode}] ${r.name} P2=${r.p2.toFixed(2)} > ${cap}`);
    }
  };
  checkTable(all, 'all');
  checkTable(subOnly, 'subOnly');

  // 服务端（buildSpeedTable）、独立 CLI（buildTable）、account_score（speedBySuit）必须给出同一张表
  const cli = buildTable(inventory, false);
  const cliRows = new Map(cli.rows.map((r) => [r.name, r]));
  const account = speedBySuit(inventory);
  const accountRows = new Map(account.rows.map((r) => [r.name, r]));
  for (const r of all.rows) {
    const c = cliRows.get(r.name);
    const a = accountRows.get(r.name);
    for (const p of [1, 2, 3, 4, 5, 6]) {
      const v = r[`p${p}`];
      const cv = c?.pos?.[p] ?? null;
      const av = a?.pos?.[p] ?? null;
      if ((v ?? null) !== (cv ?? null)) errors.push(`服务端/CLI 不一致：${r.name} P${p} ${v} vs ${cv}`);
      if ((v ?? null) !== (av ?? null)) errors.push(`服务端/account_score 不一致：${r.name} P${p} ${v} vs ${av}`);
    }
  }
  if (all.mainSpeedCount !== mainCount) {
    errors.push(`2 号位主速度件数不一致：buildSpeedTable=${all.mainSpeedCount} 实际=${mainCount}`);
  }

  const subOver = countOver(subOnly.rows, 'p2', SPEED_SUB_MAX) +
    [1, 3, 4, 5, 6].reduce((s, p) => s + countOver(subOnly.rows, `p${p}`, SPEED_SUB_MAX), 0);

  console.log(`\n== ${label} ==`);
  console.log(`御魂 ${souls} 件，2 号位主属性速度 ${mainCount} 件，御魂种类 ${all.rows.length}`);
  console.log(
    '各位置单件最大总速：' + [1, 2, 3, 4, 5, 6].map((p) => `P${p}=${(maxByPos.get(p) ?? 0).toFixed(2)}`).join(' '),
  );
  console.log(`「仅副属性速度」口径 >18 的单元格：${subOver} 个（应为 0）`);

  if (errors.length === 0) {
    console.log('✅ 校验通过');
    return true;
  }
  console.log(`❌ 发现 ${errors.length} 个问题：`);
  for (const e of errors.slice(0, 10)) console.log('  - ' + e);
  return false;
}
