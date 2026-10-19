/**
 * verify_analysis.mjs — 模块二新增指标（A1 速度核心 / A2 速度分布 / A3 账号概览）的回归校验。
 *
 * 用缓存好的 get_equip_detail 响应离线校验，不需要联网、不需要登录：
 *   A1：散件一速 = 各位置最快之和；官方 highlights 存在时逐项比对（误差 ≤ 0.02）；
 *   A2：≥15/≥16/≥17 计数单调、真17 == ≥17、满速/近满速边界、副属性速度 ≤18；
 *   A3：六星数 / 式神条数 / 图鉴 got≤all / 皮肤数 等基本自洽。
 *
 * 用法：
 *   node tools/cbg/verify_analysis.mjs --file "<缓存详情.json>" [--file "<另一个>.json"]
 *
 * 缓存文件支持：{ equip: { equip_desc: "..." } } / { equip_desc: "..." } / { inventory: {...} }。
 */

import fs from 'node:fs';
import path from 'node:path';
import { buildAccountOverview, buildSpeedCore, buildSpeedStats } from './scraper-service/accountAnalyze.mjs';

const SPEED_SUB_MAX = 18;
const EPS = 0.02;
const round2 = (x) => Math.round(x * 100) / 100;

const args = process.argv.slice(2);
const files = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--file' && args[i + 1]) files.push(args[i + 1]);
}

if (!files.length) {
  console.error('用法: node tools/cbg/verify_analysis.mjs --file "<缓存详情.json>" [--file ...]');
  process.exitCode = 1;
} else {
  let failed = 0;
  for (const file of files) if (!verifyFile(file)) failed += 1;
  if (failed) process.exitCode = 1;
}

function loadDetail(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (raw?.equip?.equip_desc) return { equip: raw.equip, desc: JSON.parse(raw.equip.equip_desc || '{}') };
  if (raw?.equip_desc) return { equip: raw, desc: JSON.parse(raw.equip_desc || '{}') };
  if (raw?.inventory) return { equip: {}, desc: raw };
  throw new Error(`${file}: 识别不了缓存结构（需要 equip.equip_desc / equip_desc / inventory）`);
}

function verifyFile(file) {
  const label = path.basename(file);
  const errors = [];

  let equip;
  let desc;
  try {
    ({ equip, desc } = loadDetail(file));
  } catch (e) {
    console.error(`\n== ${label} ==\n❌ ${e.message}`);
    return false;
  }

  const inventory = desc.inventory || {};
  const core = buildSpeedCore(inventory, equip.highlights || []);
  const stats = buildSpeedStats(inventory);
  const overview = buildAccountOverview(desc);

  /* ---------- A1：速度核心 ---------- */
  const perSum = round2([1, 2, 3, 4, 5, 6].reduce((s, p) => s + (core.perPosition[`p${p}`] ?? 0), 0));
  if (core.scatterSpeed !== null && Math.abs(core.scatterSpeed - perSum) > EPS) {
    errors.push(`[A1] 散件一速 ${core.scatterSpeed} ≠ 各位置之和 ${perSum}`);
  }
  if (core.zhaocaiSpeed !== null && core.scatterSpeed !== null && core.zhaocaiSpeed > core.scatterSpeed + EPS) {
    errors.push(`[A1] 招财一速 ${core.zhaocaiSpeed} 不应大于散件一速 ${core.scatterSpeed}`);
  }
  if (core.headSpeed !== null && core.headSpeed > SPEED_SUB_MAX + EPS) {
    errors.push(`[A1] 头速度 ${core.headSpeed} 超过单件副属性速度上限 ${SPEED_SUB_MAX}`);
  }
  if (core.official.tou !== null && core.official.wei === null) errors.push('[A1] 官方头尾数量解析异常');
  for (const c of core.checks) {
    if (!c.ok) errors.push(`[A1] ${c.label} 本地 ${c.local} ≠ 官方 ${c.official}`);
  }

  /* ---------- A2：速度分布 ---------- */
  if (!(stats.ge15 >= stats.ge16 && stats.ge16 >= stats.ge17)) {
    errors.push(`[A2] 档位计数不单调：ge15=${stats.ge15} ge16=${stats.ge16} ge17=${stats.ge17}`);
  }
  if (stats.ge17 !== stats.true17) errors.push(`[A2] ge17=${stats.ge17} ≠ true17=${stats.true17}`);
  if (!(stats.full <= stats.nearFull && stats.nearFull <= stats.ge17)) {
    errors.push(`[A2] 满速/近满速/17+ 计数异常：full=${stats.full} nearFull=${stats.nearFull} ge17=${stats.ge17}`);
  }
  if (stats.maxSubSpeed !== null && stats.maxSubSpeed > SPEED_SUB_MAX + EPS) {
    errors.push(`[A2] 最大副属性速度 ${stats.maxSubSpeed} > ${SPEED_SUB_MAX}`);
  }
  for (const key of ['hitTailSpeed', 'resistTailSpeed']) {
    if (stats[key] !== null && stats[key] > SPEED_SUB_MAX + EPS) errors.push(`[A2] ${key}=${stats[key]} > ${SPEED_SUB_MAX}`);
  }
  if (stats.hitTailCount > stats.subSpeedCount || stats.resistTailCount > stats.subSpeedCount) {
    errors.push('[A2] 头尾计数超过带速度御魂总数');
  }

  /* ---------- A3：账号概览 ---------- */
  const heroEntries = Object.values(desc.heroes || {}).filter((h) => h && typeof h === 'object');
  const sixStar = heroEntries.filter((h) => Number(h.star) === 6).length;
  if (overview.heroCount !== null && overview.heroCount !== heroEntries.length) {
    errors.push(`[A3] 式神条数 ${overview.heroCount} ≠ 实际 ${heroEntries.length}`);
  }
  if (overview.sixStar !== sixStar) errors.push(`[A3] 六星数 ${overview.sixStar} ≠ 逐条统计 ${sixStar}`);
  if (overview.dex) {
    for (const [k, v] of Object.entries(overview.dex)) {
      if (v.all !== null && v.got > v.all) errors.push(`[A3] 图鉴 ${k} got=${v.got} > all=${v.all}`);
    }
  }
  if (!overview.skinCount) errors.push('[A3] 皮肤数为空');
  if (overview.damoTotal !== null && overview.damoTotal < 0) errors.push('[A3] 达摩总数为负');

  /* ---------- 输出 ---------- */
  console.log(`\n== ${label} ==`);
  console.log(
    `A1 散件一速 ${fmt(core.scatterSpeed)} / 招财一速 ${fmt(core.zhaocaiSpeed)} / 头速度 ${fmt(core.headSpeed)}` +
      `　官方：${core.official.raw.length ? core.official.raw.join(' | ') : '未标注'}` +
      `　校验项 ${core.checks.length} 个（${core.checks.filter((c) => c.ok).length} 通过）`,
  );
  console.log(
    `A2 带速度御魂 ${stats.subSpeedCount} 件：≥15 ${stats.ge15} / ≥16 ${stats.ge16} / ≥17 ${stats.ge17}` +
      `（真17 ${stats.true17}，伪17 ${stats.fake17}）｜近满速 ${stats.nearFull} / 满速 ${stats.full}` +
      `｜胚子 ${stats.unleveled}｜最高副属性 ${fmt(stats.maxSubSpeed)}` +
      `｜命中4号位 ${stats.hitTailCount}（${fmt(stats.hitTailSpeed)}）/ 抵抗4号位 ${stats.resistTailCount}（${fmt(stats.resistTailSpeed)}）`,
  );
  console.log(
    `A3 六星 ${overview.sixStar}（满技能 ${overview.fullSkillSixStar}）/ SSR ${overview.ssrOwned} / SP ${overview.spOwned}` +
      `｜皮肤 ${fmt(overview.skinCount)} / 头像框 ${fmt(overview.headSkinCount)}｜勾玉 ${fmt(desc.goyu)} / 体力 ${fmt(overview.strength)}` +
      `｜斗技 ${fmt(overview.pvpScore)}（#${fmt(overview.pvpRank)}）｜图鉴 ${overview.dex ? Object.keys(overview.dex).join('/') : '—'}`,
  );

  if (!errors.length) {
    console.log('✅ 校验通过');
    return true;
  }
  console.log(`❌ 发现 ${errors.length} 个问题：`);
  for (const e of errors.slice(0, 10)) console.log('  - ' + e);
  return false;
}

function fmt(n) {
  return n === null || n === undefined ? '—' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}
