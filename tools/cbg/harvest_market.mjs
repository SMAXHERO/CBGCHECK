/**
 * harvest_market.mjs — 采集「行情样本」：列表 + 逐条详情，产出可用于成交价分析的记录。
 *
 * ⚠️ 先读这段，别重复踩坑（完整记录见 docs/filter-sources.md 第六节）
 *
 *   1) 列表接口 POST /cgi/api/query **必须登录**（无 Cookie → 登录超时 e12）。
 *      `count` 参数**被忽略**，恒返回 15 条/页，靠 page 翻页；页数 = ceil(total_num/15)。
 *      它**只接受有限参数**，多传一个就返回「非正常访问」。
 *
 *   2) 详情接口 GET /cgi/api/get_equip_detail 必须传 **serverid + eid 配对**：
 *        只传 eid      → 「请选择服务器」
 *        只传 serverid → 「流水号不能为空」
 *        配对错误      → 「物品不存在」
 *      eid 无法凭空构造（时间是时间戳-服务器-随机串），只能从列表接口拿。
 *
 *   3) **鉴权结论会随请求量变化，不是「能用/不能用」的二元状态**：
 *        几次请求   → 匿名即可，连 Referer 都不校验
 *        几十次     → 「请登录之后继续访问」SESSION_TIMEOUT
 *        更密集     → 「需要验证手机」MOBILE_AUTH
 *      实测批量跑到列表第 3 页就被要求手机验证。**所以必须保守限速**，
 *      否则会把低频时可行的路自己堵死（冷却 60 秒也不恢复）。
 *
 *   4) **两个不同的 status，别混**：
 *        顶层 status_code（"MOBILE_AUTH"/"SESSION_TIMEOUT"）= 访问控制状态
 *        顶层 status（1 成功 / 2 失败）                     = 请求是否成功
 *        equip.status（6 = 已售出「买家取走」）              = 商品状态
 *
 *   5) 列表接口**只返回在售**（传 status=4 会被忽略）。已售商品无法列出，
 *      它只有在你扫描时恰好卖掉才能被捕获（equip.status 变 6）。
 *      也就是说：**没有历史回溯，只能向前追踪**。
 *
 * 资产字段藏在 equip.equip_desc（一个 1MB 级的 JSON 字符串）里，关键映射：
 *   goyu            勾玉（已用页面显示的 20.3万 校准 ✅）
 *   sign_days       签到天数（1591 ✅）
 *   fengzidu        风姿度（14991 ✅）
 *   skin.ss         **式神皮肤数**（329 ✅）。注意 skin 是 {分类:[...]}，
 *                   取 Object.keys().length 只会得到分类数 9，必须按分类展开求和
 *   damo_count_dict 御行达摩，**两层嵌套** {星级:{id:数量}}，必须递归求和
 *   gouyu_card      永久勾玉卡
 *   ssr_coin/sp_coin 图鉴币（语义未确认，先原样留存）
 *
 * 用法：
 *   node tools/cbg/harvest_market.mjs --price-min 50000 --price-max 55000 --dry
 *   node tools/cbg/harvest_market.mjs --price-min 50000 --price-max 55000
 *
 * 大范围采集请**按价格分层抽样**（2000 元及以下约 10000 条，全量不可行），
 * 分层之间留足间隔。
 */

const CDP = process.env.CBG_CDP ?? 'http://127.0.0.1:9334';
const OUT = process.env.CBG_OUT ?? 'D:/deepseek_work/.tmp/market-sample.jsonl';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const has = (name) => process.argv.includes(`--${name}`);

const PRICE_MIN = arg('price-min', '50000');
const PRICE_MAX = arg('price-max', '55000');
const PAGE_DELAY = Number(arg('page-delay', '2600'));
/** 详情间隔。默认给大一点——风控是递进的，省这点时间不值得（见 6.4）。 */
const DETAIL_DELAY = Number(arg('detail-delay', '1800'));
const MAX_PAGES = Number(arg('max-pages', '40'));
const DRY = has('dry');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ 工具 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0';

/** 匿名取详情。
 *
 * 注意：这个函数**只在低频时可用**。批量调用会依次触发
 *   SESSION_TIMEOUT（请登录之后继续访问）→ MOBILE_AUTH（需要验证手机）。
 * 一旦升级，间隔再久也不会退回匿名可用状态。所以批量场景必须走登录会话，
 * 并且把 DETAIL_DELAY 留大（默认 500ms 偏激进，建议 ≥1500ms）。
 */
async function fetchDetail(serverid, eid) {
  const url =
    `https://yys.cbg.163.com/cgi/api/get_equip_detail?client_type=h5` +
    `&serverid=${serverid}&eid=${encodeURIComponent(eid)}`;
  const res = await fetch(url, {
    headers: {
      'user-agent': UA,
      'x-requested-with': 'XMLHttpRequest',
      accept: 'application/json, text/plain, */*',
      referer: 'https://yys.cbg.163.com/cgi/mweb/pl?search_type=role',
    },
  });
  const text = await res.text();
  let j = null;
  try {
    j = JSON.parse(text);
  } catch {
    return { ok: false, why: 'NON_JSON', raw: text.slice(0, 120) };
  }
  if (j.status !== 1 || !j.equip) return { ok: false, why: j.msg || 'NO_EQUIP' };
  return { ok: true, equip: j.equip };
}

const sumDeep = (o) =>
  o === null || typeof o !== 'object' ? Number(o) || 0 : Object.values(o).reduce((a, v) => a + sumDeep(v), 0);

/** 从 equip 里抽出分析需要的字段（扔掉 1MB 的原始数据） */
function extract(equip) {
  let d = {};
  try {
    d = JSON.parse(equip.equip_desc || '{}');
  } catch {
    /* 解析失败就留空 */
  }
  const skinPer = {};
  let skinTotal = 0;
  if (d.skin && typeof d.skin === 'object' && !Array.isArray(d.skin)) {
    for (const [cat, arr] of Object.entries(d.skin)) {
      const n = Array.isArray(arr) ? arr.length : arr && typeof arr === 'object' ? Object.keys(arr).length : 0;
      skinPer[cat] = n;
      skinTotal += n;
    }
  }
  return {
    // 身份与状态
    ordersn: equip.game_ordersn,
    eid: equip.eid,
    serverid: equip.serverid,
    server_name: equip.server_name,
    area_name: equip.area_name,
    status: equip.status,
    status_desc: equip.status_desc,
    price: equip.price,
    // 时间（成交判断的核心）
    create_time: equip.create_time,
    selling_time: equip.selling_time,
    expire_time: equip.expire_time,
    expire_remain_seconds: equip.expire_remain_seconds,
    has_trade_history: equip.has_trade_history,
    // 展示字段（评分可用）
    level_desc: equip.level_desc,
    collect_num: equip.collect_num,
    highlights: equip.highlights,
    desc_sumup_short: equip.desc_sumup_short,
    detail_url: equip.equip_detail_url,
    // 资产（列表接口全都不返回，只有详情有）
    goyu: d.goyu ?? null,
    sign_days: d.sign_days ?? null,
    fengzidu: d.fengzidu ?? null,
    ssr_coin: d.ssr_coin ?? null,
    sp_coin: d.sp_coin ?? null,
    skin_total: skinTotal,
    skin_ss: skinPer.ss ?? null,
    skin_per: skinPer,
    damo_total: sumDeep(d.damo_count_dict),
    gouyu_card: d.gouyu_card ?? null,
    honor_score: d.honor_score ?? null,
    money: d.money ?? null,
    strength: d.strength ?? null,
    yuhun_buff: d.yuhun_buff ?? null,
    hero_summary: d.hero_summary ?? null,
    equips_summary: d.equips_summary ?? null,
  };
}

/* ------------------------------------------------------------------ 主流程 */

const main = async () => {
  // 列表接口需要登录态 → 走受控浏览器
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((t) => t.type === 'page' && /cbg\.163\.com/.test(t.url || ''));
  if (!page) throw new Error('受控浏览器里没有藏宝阁页面（列表接口需要登录态）');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let mid = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++mid;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send('Runtime.enable');
  await send('Page.enable');
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 160));
    return r?.result?.value;
  };

  await send('Page.navigate', { url: 'https://yys.cbg.163.com/cgi/mweb/pl?search_type=role' });
  await sleep(6500);

  console.log(`=== 1) 列表翻页：价格 ${Number(PRICE_MIN) / 100}~${Number(PRICE_MAX) / 100} 元 ===`);
  const seeds = [];
  const seen = new Set();
  let total = null;
  let lastPage = false;

  for (let p = 1; p <= MAX_PAGES && !lastPage; p += 1) {
    const raw = await ev(`
      (async () => {
        const r = await fetch('/cgi/api/query', { method:'POST', credentials:'include',
          headers:{'content-type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({ search_type:'role', client_type:'h5', view_loc:'equip_list',
            page:'${p}', count:'15', price_min:'${PRICE_MIN}', price_max:'${PRICE_MAX}' }) });
        const j = await r.json();
        return JSON.stringify({ status:j.status, msg:j.msg, total:j.total_num, last:!!j.paging?.is_last_page,
          rows:(j.result||[]).map(x=>({ serverid:x.serverid, eid:x.eid, ordersn:x.game_ordersn,
            price:x.price, status:x.status, status_desc:x.status_desc, server:x.server_name,
            selling_time:x.selling_time, collect:x.collect_num })) });
      })()
    `);
    const j = JSON.parse(raw);
    if (j.status !== 1) {
      console.log(`  page=${p} 失败：${j.msg}（可能触发风控，稍后重试）`);
      break;
    }
    if (total === null) {
      total = j.total;
      const pages = Math.ceil(total / 15);
      console.log(`  站点符合 ${total} 条，预计 ${pages} 页`);
    }
    for (const r of j.rows) {
      if (!seen.has(r.eid)) {
        seen.add(r.eid);
        seeds.push(r);
      }
    }
    lastPage = j.last;
    console.log(`  page=${String(p).padStart(2)}  +${j.rows.length}  累计 ${seeds.length}`);
    if (!lastPage) await sleep(PAGE_DELAY);
  }

  if (!seeds.length) throw new Error('没取到任何种子');
  console.log(`  种子合计 ${seeds.length} 条（去重后）`);
  if (DRY) {
    console.log('  --dry：不抓详情，结束');
    return;
  }

  console.log();
  console.log('=== 2) 抓详情（低频时匿名可用；批量后会升级要求登录/手机验证）===');
  const fs = await import('node:fs');
  fs.writeFileSync(OUT, '', 'utf8'); // 重开文件

  let done = 0;
  let sold = 0;
  let failed = 0;
  const soldRows = [];

  for (const s of seeds) {
    done += 1;
    try {
      const d = await fetchDetail(s.serverid, s.eid);
      if (!d.ok) {
        failed += 1;
        if (failed <= 5) console.log(`  [${done}/${seeds.length}] 跳过（${d.why}）`);
      } else {
        const rec = extract(d.equip);
        // 以详情为准覆盖列表值（更权威）
        rec.price = rec.price ?? s.price;
        rec.collect_num = rec.collect_num ?? s.collect;
        fs.appendFileSync(OUT, JSON.stringify(rec) + '\n', 'utf8');
        if (rec.status === 6 || /买家取走|已售/.test(rec.status_desc || '')) {
          sold += 1;
          soldRows.push(rec);
          console.log(
            `  ★ [${done}/${seeds.length}] 已售  ¥${(rec.price || 0) / 100}  ${rec.server_name}  ` +
              `成交=${rec.selling_time}  上架=${rec.create_time}  勾玉=${rec.goyu}  皮肤=${rec.skin_ss}`,
          );
        } else if (done % 25 === 0) {
          console.log(`  [${done}/${seeds.length}] 进行中，已发现已售 ${sold} 条`);
        }
      }
    } catch (e) {
      failed += 1;
      if (failed <= 5) console.log(`  [${done}/${seeds.length}] 异常：${e.message}`);
    }
    await sleep(DETAIL_DELAY);
  }

  console.log();
  console.log(`=== 完成 ===`);
  console.log(`  写入 ${OUT}`);
  console.log(`  成功 ${done - failed} 条，失败 ${failed} 条，其中**已售 ${sold} 条**`);

  if (soldRows.length) {
    console.log();
    console.log('  已售样本（可用于成交价分析）：');
    for (const r of soldRows.slice(0, 20)) {
      console.log(
        `    ¥${(r.price || 0) / 100}  ${r.server_name}  成交 ${r.selling_time}  ` +
          `上架 ${r.create_time}  勾玉 ${r.goyu}  皮肤(式神) ${r.skin_ss}  签到 ${r.sign_days}`,
      );
    }
  } else {
    console.log('  本次没有捕获到已售样本——在售商品要等它卖掉才会变 status=6。');
    console.log('  这条样本可留作追踪种子，隔一段时间重跑即可。');
  }
};

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('失败: ' + e.message);
    process.exit(1);
  });
