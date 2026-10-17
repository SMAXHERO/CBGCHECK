/**
 * score_sampling.mjs — 抽样统计「御魂数量 → 评分出分率」。
 *
 * 背景：实测发现御魂少的账号凑不出方案所需套装，站点会一直停在
 * `computing: true`，永远拿不到分。这个脚本就是把这个规律量化出来。
 *
 * 用一个**轻量探测端点**（`/api/account/probe`）：
 *   每个账号固定 4 个请求（详情 + 方案清单 + 每式神 1 次），
 *   而不是完整分析的 30+ 个。拿完整分析跑几十个账号必然触发风控。
 *
 * ⚠️ 限速是硬要求，不是建议：
 *   实测教训——第一版每套方案轮询 12 次、16 套 = 192 个请求，
 *   直接把站点打成 CAPTCHA_AUTH，随后连列表查询都要求手机验证。
 *   所以这里：账号之间默认隔 9 秒，一旦返回 blocked 立刻整体停止。
 *
 * 前置条件：伴随服务在跑（它负责用已登录页面发请求）。
 *
 * 用法：
 *   node tools/cbg/score_sampling.mjs --count 12
 *   node tools/cbg/score_sampling.mjs --count 20 --price-min 500 --price-max 1500
 *   node tools/cbg/score_sampling.mjs --eid-file .tmp/eids.txt
 */

const SVC = process.env.CBG_SERVICE ?? 'http://127.0.0.1:8791';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const has = (name) => process.argv.includes(`--${name}`);

const COUNT = Number(arg('count', '12'));
const PRICE_MIN = Number(arg('price-min', '500'));
const PRICE_MAX = Number(arg('price-max', '1500'));
const GAP_MS = Number(arg('gap', '9000'));
const OUT = arg('out', 'D:/deepseek_work/.tmp/score-sampling.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const post = async (path, body) => {
  const r = await fetch(SVC + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  try {
    return { status: r.status, json: JSON.parse(t) };
  } catch {
    return { status: r.status, json: { ok: false, message: t.slice(0, 200) } };
  }
};
const getJson = async (path) => {
  const r = await fetch(SVC + path);
  return r.json();
};

/** 跑一次列表查询，拿候选账号（values 里的价格单位是分） */
async function fetchCandidates() {
  await post('/api/search', {
    values: {
      price_min: String(PRICE_MIN * 100),
      price_max: String(PRICE_MAX * 100),
    },
    maxPages: 1,
  });
  for (let i = 0; i < 40; i += 1) {
    await sleep(2500);
    const r = await getJson('/api/result');
    const rows = r?.result?.rows ?? [];
    if (rows.length) return rows;
    if (r?.status === 'need-captcha' || r?.status === 'need-login') {
      throw new Error('列表查询触发风控：' + r.status);
    }
  }
  return [];
}

const bucketOf = (n) => {
  if (n < 300) return '<300';
  if (n < 600) return '300-600';
  if (n < 1000) return '600-1000';
  if (n < 1500) return '1000-1500';
  if (n < 2000) return '1500-2000';
  return '>=2000';
};
const BUCKET_ORDER = ['<300', '300-600', '600-1000', '1000-1500', '1500-2000', '>=2000'];

const main = async () => {
  // 服务在不在
  try {
    const h = await getJson('/api/health');
    if (h.status !== 'ready' && h.status !== 'error') throw new Error('状态 ' + h.status);
    console.log(`伴随服务：${h.status}`);
  } catch (e) {
    console.error('伴随服务不可用（要先用 node tools/cbg/scraper-service/server.mjs 启动）：' + e.message);
    process.exitCode = 1;
    return;
  }

  const eidFile = arg('eid-file', '');
  let targets;
  if (eidFile) {
    const fs = await import('node:fs');
    targets = fs
      .readFileSync(eidFile, 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((line) => {
        const [eid, sid] = line.split(/\s+/);
        return { eid, server_id: sid };
      });
    console.log(`从文件读入 ${targets.length} 个账号`);
  } else {
    console.log(`拉取候选账号（¥${PRICE_MIN}~${PRICE_MAX}）…`);
    const rows = await fetchCandidates();
    console.log(`拿到 ${rows.length} 行，取前 ${COUNT} 个`);
    targets = rows.slice(0, COUNT);
  }

  const results = [];
  let stopped = null;
  for (let i = 0; i < targets.length; i += 1) {
    const t = targets[i];
    const label = `[${i + 1}/${targets.length}] ¥${(t.price ?? 0) / 100} ${t.server_name ?? ''}`;
    try {
      const json = await getJson(
        `/api/account/probe?eid=${encodeURIComponent(t.eid)}&serverid=${t.server_id}`,
      );
      if (!json.ok) {
        console.log(`  ${label}  探测失败：${json.error ?? json.message ?? ''}`);
        if (json.blocked) {
          stopped = `第 ${i + 1} 个账号触发风控：${json.error}`;
          break;
        }
        await sleep(GAP_MS);
        continue;
      }
      const scored = json.heroes.filter((h) => h.scored).length;
      const withPlans = json.heroes.filter((h) => h.hasPlans).length;
      console.log(
        `  ${label}  御魂 ${String(json.soulCount).padStart(4)}  ` +
          `出分 ${scored}/${withPlans}` +
          json.heroes.map((h) => `  ${h.name}:${h.scored ? h.score : h.hasPlans ? '算不出' : '无方案'}`).join(''),
      );
      results.push({ ...json, bucket: bucketOf(json.soulCount) });
      if (json.blocked) {
        stopped = `第 ${i + 1} 个账号的评分接口触发风控`;
        break;
      }
    } catch (e) {
      console.log(`  ${label}  异常：${e.message}`);
    }
    if (i < targets.length - 1) await sleep(GAP_MS);
  }

  // ---- 汇总 ----
  console.log();
  console.log('='.repeat(70));
  console.log('御魂数量 → 出分率');
  console.log('='.repeat(70));
  const byBucket = {};
  for (const r of results) {
    const b = r.bucket;
    byBucket[b] = byBucket[b] || { n: 0, scored: 0, attempts: 0 };
    byBucket[b].n += 1;
    for (const h of r.heroes) {
      if (!h.hasPlans) continue;
      byBucket[b].attempts += 1;
      if (h.scored) byBucket[b].scored += 1;
    }
  }
  console.log('  御魂区间      账号数   可评方案   出分   出分率');
  for (const b of BUCKET_ORDER) {
    const v = byBucket[b];
    if (!v) continue;
    const rate = v.attempts ? ((v.scored / v.attempts) * 100).toFixed(0) + '%' : '—';
    console.log(
      `  ${b.padEnd(12)} ${String(v.n).padStart(5)} ${String(v.attempts).padStart(9)} ${String(v.scored).padStart(6)} ${rate.padStart(7)}`,
    );
  }

  const totalAttempts = results.reduce((a, r) => a + r.heroes.filter((h) => h.hasPlans).length, 0);
  const totalScored = results.reduce((a, r) => a + r.heroes.filter((h) => h.scored).length, 0);
  console.log();
  console.log(`  合计：${results.length} 个账号，${totalScored}/${totalAttempts} 个式神方案出分`);

  // 相关性（粗略）：御魂数 vs 是否出分
  const pairs = [];
  for (const r of results) {
    for (const h of r.heroes) {
      if (h.hasPlans) pairs.push([r.soulCount, h.scored ? 1 : 0]);
    }
  }
  if (pairs.length >= 4) {
    const n = pairs.length;
    const mx = pairs.reduce((a, p) => a + p[0], 0) / n;
    const my = pairs.reduce((a, p) => a + p[1], 0) / n;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (const [x, y] of pairs) {
      num += (x - mx) * (y - my);
      dx += (x - mx) ** 2;
      dy += (y - my) ** 2;
    }
    const rho = dx && dy ? num / Math.sqrt(dx * dy) : 0;
    console.log(`  相关系数（御魂数 vs 出分）：r = ${rho.toFixed(2)}（越接近 1 说明御魂越多越容易出分）`);
  }

  if (stopped) {
    console.log();
    console.log('⚠️  提前停止：' + stopped);
    console.log('   等几分钟冷却后再跑，不要立刻重试。');
  }

  const fs = await import('node:fs');
  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), results, stopped }, null, 1), 'utf8');
  console.log();
  console.log(`明细已保存：${OUT}`);
};

main().catch((e) => {
  console.error('失败：' + e.message);
  process.exitCode = 1;
});
