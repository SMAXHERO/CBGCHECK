/**
 * fetch_detail_sample.mjs — 抽样抓取「列表 + 商品详情」，用于确认数据来源与字段。
 *
 * 背景（实测结论，别再重复踩）：
 *   1. 公开列表接口 /cgi/api/query **只返回在售商品**（status=2）。传 status=4 无效。
 *   2. 站点有个「最近成交」页 /cgi/mweb/pl/recent-trade，接口
 *      /cgi/api/query/query_recent_trade_history，但实测 result 为空，
 *      且加任何筛选参数都会返回「非正常访问」。
 *   3. **商品详情接口可用**，而且对「已售出」的商品同样有效：
 *        GET /cgi/api/get_equip_detail?client_type=h5&serverid=<id>&eid=<eid>
 *      注意：必须同时传 serverid 和 eid，缺一个会报
 *      「请选择服务器」/「流水号不能为空」；配对错误报「物品不存在」。
 *      返回约 0.3~1.8 MB。
 *
 *      ⚠️ **但它的可用性取决于请求频率**（这条是推翻过结论的）：
 *        几次请求 → 匿名即可，连 Referer 都不校验
 *        几十次   → 「请登录之后继续访问」SESSION_TIMEOUT
 *        更密集   → 「需要验证手机」MOBILE_AUTH
 *      一旦升级，间隔再久也不退回。所以本脚本只适合**小样本**（≤10 条），
 *      批量采集请用 harvest_market.mjs 并把间隔调大。
 *      详见 docs/filter-sources.md 第 6.4 节。
 *
 *   4. 详情里 equip.equip_desc 是一个 **1.6 MB 的 JSON 字符串**，
 *      勾玉 / 御魂 / 式神统计这些列表接口不返回的字段全在里面：
 *        JSON.parse(equip.equip_desc).goyu  → 勾玉数量
 *      这是补全默认条件所需字段的唯一已知途径。
 *      字段映射已校准：goyu/sign_days/fengzidu 精确吻合页面显示，
 *      skin.ss 才是「式神皮肤数」（skin 是 {分类:[...]}，不能取键数）。
 *
 *   5. 别混淆两个 status：顶层 status_code（MOBILE_AUTH/SESSION_TIMEOUT）
 *      是访问控制状态；equip.status = 6 是商品「已售出」。
 *
 * 用法（需要伴随服务的调试端口在跑）：
 *   node tools/cbg/fetch_detail_sample.mjs --price-min 50000 --price-max 55000 --limit 10
 */

const CDP = process.env.CBG_CDP ?? 'http://127.0.0.1:9334';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const PRICE_MIN = arg('price-min', '50000');
const PRICE_MAX = arg('price-max', '55000');
const LIMIT = Number(arg('limit', '10'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 连接受控浏览器的调试端口 */
async function connect() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((t) => t.type === 'page' && /cbg\.163\.com/.test(t.url || ''));
  if (!page) throw new Error('受控浏览器里没有打开藏宝阁页面');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  let id = 0;
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
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send('Runtime.enable');
  await send('Page.enable');

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) throw new Error('页面执行异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 200));
    return r?.result?.value;
  };
  return { send, evaluate };
}

/** 从 equip_desc 里取我们关心的字段 */
const DESC_KEYS = [
  'goyu', 'sign_days', 'damo_count_dict', 'gouyu_card',
  'ssr_coin', 'sp_coin', 'fengzidu', 'honor_score', 'medal',
  'money', 'strength', 'yuhun_buff', 'hero_summary', 'equips_summary',
  'skin', 'head_skin', 'head_skin_count', 'skin_coupon',
  'hero_count_dict', 'is_xinyi_vip', 'yzg', 'soul_jade', 'hunyu',
];

/** 把对象类字段压成可读的计数（skin 是 {分类: [...]} 字典，个数就是皮肤总数） */
const summarize = (desc) => {
  const out = {};
  for (const k of DESC_KEYS) {
    const v = desc[k];
    if (v === undefined) continue;
    if (Array.isArray(v)) out[k] = `数组(${v.length})`;
    else if (v && typeof v === 'object') out[k] = `字典(${Object.keys(v).length})`;
    else out[k] = v;
  }
  return out;
};

/**
 * 皮肤总数。
 *
 * equip_desc.skin 的形状是 { 分类: [[...皮肤],...] }，分类有
 * yard / yys / jiejie / **ss(式神皮肤)** / guard / battle / yinyangshu / shishenlu / gamble。
 * 拿 Object.keys(skin).length 只会得到分类数（9），不是皮肤数——
 * 实测对照：ss 分类的长度 329 正好等于详情页显示的「式神皮肤数 329」，所以按分类展开求和。
 */
const skinBreakdown = (desc) => {
  const per = {};
  let total = 0;
  const skin = desc?.skin;
  if (skin && typeof skin === 'object' && !Array.isArray(skin)) {
    for (const [cat, arr] of Object.entries(skin)) {
      const n = Array.isArray(arr) ? arr.length : arr && typeof arr === 'object' ? Object.keys(arr).length : 0;
      per[cat] = n;
      total += n;
    }
  }
  return { total, per };
};

/**
 * 御行达摩总数。
 *
 * equip_desc.damo_count_dict 是**两层嵌套**：{ 星级: { 星级内 id: 数量 } }。
 * 只加一层会得到 0（实测踩过），必须递归求和。
 * 注意 id（410/411/412/413）与「御行达摩」的对应关系未逐一验证，
 * 这里给的是各类合计，用之前建议人工核对一次。
 */
const sumDeep = (o) => {
  if (o === null || typeof o !== 'object') return Number(o) || 0;
  return Object.values(o).reduce((a, v) => a + sumDeep(v), 0);
};

const main = async () => {
  const { send, evaluate } = await connect();

  // 必须停在藏宝阁页面里，接口才有正确的来源（否则「非正常访问」）
  await send('Page.navigate', { url: 'https://yys.cbg.163.com/cgi/mweb/pl?search_type=role' });
  await sleep(7000);

  console.log(`列表接口：价格 ${Number(PRICE_MIN) / 100}~${Number(PRICE_MAX) / 100} 元`);
  const listRaw = await evaluate(`
    (async () => {
      const r = await fetch('/cgi/api/query', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          search_type: 'role', client_type: 'h5', view_loc: 'equip_list',
          page: '1', count: '${Math.max(LIMIT, 15)}',
          price_min: '${PRICE_MIN}', price_max: '${PRICE_MAX}',
        }),
      });
      const j = await r.json();
      return JSON.stringify({
        total: j.total_num,
        rows: (j.result || []).map((x) => ({
          eid: x.eid, serverid: x.serverid, ordersn: x.game_ordersn,
          price: x.price, status: x.status, server: x.server_name,
          selling_time: x.selling_time, collect: x.collect_num,
          desc: x.desc_sumup_short, highlights: x.highlights,
        })),
      });
    })()
  `);
  const list = JSON.parse(listRaw);
  console.log(`  站点符合 ${list.total} 条，取回 ${list.rows.length} 条`);
  await sleep(2500);

  const out = [];
  for (const [i, it] of list.rows.slice(0, LIMIT).entries()) {
    const raw = await evaluate(`
      (async () => {
        const r = await fetch('/cgi/api/get_equip_detail?client_type=h5&serverid=' + ${it.serverid} +
          '&eid=' + encodeURIComponent(${JSON.stringify(it.eid)}),
          { credentials: 'include', headers: { 'x-requested-with': 'XMLHttpRequest' } });
        const j = await r.json();
        const eq = j.equip || {};
        // 关键：资产字段在 equip_desc 这个 JSON 字符串里
        let desc = {};
        try { desc = JSON.parse(eq.equip_desc || '{}'); } catch (e) {}
        const pick = {};
        for (const k of ${JSON.stringify(DESC_KEYS)}) {
          const v = desc[k];
          if (v === undefined) continue;
          // 对象类字段（skin / damo_count_dict 等）压成计数，避免把 1.6MB 原样带出来
          if (Array.isArray(v)) pick[k] = '数组(' + v.length + ')';
          else if (v && typeof v === 'object') pick[k] = '字典(' + Object.keys(v).length + ')';
          else pick[k] = v;
        }
        // 皮肤：按分类展开求和（skin 是 {分类: [...]}，不是平铺的皮肤列表）
        const sb = (() => {
          const per = {}; let total = 0;
          const sk = desc.skin;
          if (sk && typeof sk === 'object' && !Array.isArray(sk)) {
            for (const [cat, arr] of Object.entries(sk)) {
              const n = Array.isArray(arr) ? arr.length : (arr && typeof arr === 'object' ? Object.keys(arr).length : 0);
              per[cat] = n; total += n;
            }
          }
          return { total, per };
        })();
        // 御行达摩：damo_count_dict 是两层嵌套，必须递归求和
        const sumDeep = (o) => (o === null || typeof o !== 'object')
          ? (Number(o) || 0)
          : Object.values(o).reduce((a, v) => a + sumDeep(v), 0);

        pick['皮肤总数'] = sb.total;
        pick['皮肤分类明细'] = sb.per;
        pick['式神皮肤数'] = sb.per.ss ?? 0;
        pick['御行达摩总数'] = sumDeep(desc.damo_count_dict);
        return JSON.stringify({
          ok: j.status === 1,
          详情字节: JSON.stringify(j).length,
          desc字段数: Object.keys(desc).length,
          资产: pick,
          订单: {
            eid: eq.eid, ordersn: eq.game_ordersn, status: eq.status,
            status_desc: eq.status_desc, price: eq.price,
            create_time: eq.create_time, selling_time: eq.selling_time,
            expire_time: eq.expire_time,
            has_trade_history: eq.has_trade_history,
            has_sim_trade_history: eq.has_sim_trade_history,
            server_name: eq.server_name,
            desc_sumup_short: eq.desc_sumup_short,
            highlights: eq.highlights,
            detail_url: eq.equip_detail_url,
          },
        });
      })()
    `);
    const d = JSON.parse(raw);
    out.push({ 索引: i + 1, ...it, ...d });
    const a = d.资产 || {};
    console.log(
      `  [${i + 1}] ¥${it.price / 100} ${it.server}  status=${d.订单?.status}(${d.订单?.status_desc})  ` +
        `勾玉=${a.goyu ?? '—'} 式神皮肤=${a['式神皮肤数'] ?? '—'} 签到=${a.sign_days ?? '—'}天 ` +
        `风姿度=${a.fengzidu ?? '—'} 达摩合计=${a['御行达摩总数'] ?? '—'}`,
    );
    await sleep(2500);
  }

  const fs = await import('node:fs');
  const outPath = 'D:/deepseek_work/.tmp/detail-sample.json';
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1), 'utf8');
  console.log();
  console.log(`已保存 ${out.length} 条到 ${outPath}`);
  console.log('可用字段: ' + JSON.stringify(Object.keys(out[0]?.资产 ?? {})));
};

main()
  .then(() => process.exit(0))   // 必须显式退出：CDP 的 WebSocket 不会自己关，进程会一直挂着
  .catch((e) => {
    console.error('失败: ' + e.message);
    process.exit(1);
  });
