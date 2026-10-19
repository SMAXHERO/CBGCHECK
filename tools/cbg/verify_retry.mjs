/**
 * verify_retry.mjs — B1（自动取分）/ B3（错误分类与请求预算）的离线回归校验。
 *
 * 不联网：用假的 pageGet 模拟藏宝阁的三种响应（详情 / 方案清单 / 算分），
 * 验证：
 *   1) analyzeAccount 的 meta.requestCount 计数正确（详情 + 清单 + 每个算分请求）；
 *   2) 冷计算账号：pending 方案被标出来，rescoreAccount 只重试 pending 方案并合并分数；
 *   3) 触发风控：errorCode = CAPTCHA_AUTH、后续方案不再请求、rescore 也会停止；
 *   4) 商品下架：analyzeAccount 抛出带 ITEM_NOT_FOUND code 的错误；
 *   5) classifyApiError 对 SESSION_TIMEOUT / MOBILE_AUTH / COMPUTE_PENDING 的分类。
 *
 * 用法：node tools/cbg/verify_retry.mjs
 */

import { analyzeAccount, classifyApiError, rescoreAccount } from './scraper-service/accountAnalyze.mjs';

const HERO_ID = '389';
const PLAN_IDS = ['105', '106'];

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) {
    console.log(`✅ ${label}`);
  } else {
    failures += 1;
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const buildDetail = (overrides = {}) => ({
  status: 1,
  equip: {
    eid: 'EID-TEST',
    game_ordersn: 'ORDER-TEST',
    server_name: '测试服',
    area_name: '测试大区',
    status: 3,
    status_desc: '上架中',
    price: 10000,
    level_desc: '60级',
    collect_num: 1,
    create_time: '2026-10-19 00:00:00',
    selling_time: '2026-10-19 00:00:00',
    equip_detail_url: 'https://example.com',
    highlights: ['散件一速 100.00'],
    equip_desc: JSON.stringify({ inventory: {}, heroes: {}, skin: {}, hero_history: {} }),
    ...overrides,
  },
});

const buildPlans = () => ({
  status: 1,
  data: {
    [HERO_ID]: {
      name: '须佐之男',
      plans: PLAN_IDS.map((id) => ({ id, desc: [{ label: '御魂套装', value: `测试套${id}` }] })),
    },
  },
});

const scored = (damage) => ({ status: 1, data: { result: { suit_vals: { damage, attackAdditionVal: 1000, speedAdditionVal: 10 } } } });

/** 统一假 pageGet：按路径前缀返回不同响应，并记录请求数 */
const makePageGet = ({ detail = buildDetail(), plans = buildPlans(), compute }) => {
  const calls = [];
  const pageGet = async (path) => {
    calls.push(path);
    if (path.startsWith('/cgi/api/get_equip_detail')) {
      if (detail.__reject) return JSON.stringify(detail);
      return JSON.stringify(detail);
    }
    if (path.startsWith('/cgi/api/get_yys_heroes_matching_plan')) return JSON.stringify(plans);
    if (path.startsWith('/cgi/api/compute_yys_heroes_plan')) return JSON.stringify(compute(path));
    throw new Error(`未预期的请求：${path}`);
  };
  return { pageGet, calls };
};

/* ---------------- 场景 1：冷计算 → pending → 自动取分 ---------------- */
{
  console.log('\n== 场景 1：冷计算账号 + 自动取分 ==');
  let mode = 'computing';
  const { pageGet, calls } = makePageGet({
    compute: () => (mode === 'computing' ? { status: 1, computing: true, msg: '该式神御魂搭配方式正在计算中！' } : scored(20000)),
  });

  const analysis = await analyzeAccount({ eid: 'EID-TEST', serverid: '45', heroes: ['须佐之男'], pageGet });
  const hero = analysis.heroes[0];
  // 详情 1 + 清单 1 + 第一套方案 2 次（默认重试一次）+ 第二套 1 次（冷账号只排一次）
  check('analyze 请求计数 = 5', analysis.meta.requestCount === 5, `实际 ${analysis.meta.requestCount}`);
  check('冷账号两套方案都在排队', hero.computing === 2, `computing=${hero.computing}`);
  check('plan.pending 被标记', hero.plans.every((p) => p.pending === true));
  check('未出分时 errorCode 为 null（不是错误）', hero.errorCode === null);
  const analyzeCalls = calls.length;

  // 模拟站点算完后再次取分：rescore 只重试 pending 的两套方案
  mode = 'scored';
  calls.length = 0;
  const rescored = await rescoreAccount({ eid: 'EID-TEST', serverid: '45', previous: analysis, pageGet });
  check('rescore 只请求 2 个算分请求', rescored.meta.requestCount === 2, `实际 ${rescored.meta.requestCount}（总调用 ${calls.length}）`);
  check('rescore 全部出分', rescored.heroes[0].scoredCount === 2 && rescored.heroes[0].computing === 0);
  check('rescore 未触发风控', rescored.blocked === false);
  check('analyze 阶段确实发过请求', analyzeCalls >= 5);
}

/* ---------------- 场景 2：算分触发风控 ---------------- */
{
  console.log('\n== 场景 2：算分触发 CAPTCHA_AUTH ==');
  const { pageGet } = makePageGet({
    compute: () => ({ status: 3, status_code: 'CAPTCHA_AUTH', msg: '进行安全验证' }),
  });
  const analysis = await analyzeAccount({ eid: 'EID-TEST', serverid: '45', heroes: ['须佐之男'], pageGet });
  const hero = analysis.heroes[0];
  check('hero.blocked = true', hero.blocked === true);
  check('hero.errorCode = CAPTCHA_AUTH', hero.errorCode === 'CAPTCHA_AUTH', `实际 ${hero.errorCode}`);
  check('顶层 errorCode 透传', analysis.errorCode === 'CAPTCHA_AUTH');
  // 详情 1 + 清单 1 + 第一套 1 次（风控立即停止，后续方案不再请求）
  check('风控后不再请求后续方案', analysis.meta.requestCount === 3, `实际 ${analysis.meta.requestCount}`);

  const rescored = await rescoreAccount({ eid: 'EID-TEST', serverid: '45', previous: analysis, pageGet });
  check('rescore 触发风控也停止', rescored.blocked === true && rescored.errorCode === 'CAPTCHA_AUTH');
  check('rescore 只发 1 个请求', rescored.meta.requestCount === 1, `实际 ${rescored.meta.requestCount}`);
}

/* ---------------- 场景 3：商品下架 ---------------- */
{
  console.log('\n== 场景 3：商品下架（ITEM_NOT_FOUND）==');
  const detail = { status: 0, status_code: 'ITEM_NOT_FOUND', msg: '物品不存在' };
  const { pageGet } = makePageGet({ detail });
  let code = null;
  let message = '';
  try {
    await analyzeAccount({ eid: 'EID-GONE', serverid: '45', heroes: ['须佐之男'], pageGet });
  } catch (err) {
    code = err.code;
    message = err.message;
  }
  check('抛出 ITEM_NOT_FOUND', code === 'ITEM_NOT_FOUND', `code=${code} msg=${message}`);
}

/* ---------------- 场景 4：错误分类 ---------------- */
{
  console.log('\n== 场景 4：classifyApiError ==');
  check('SESSION_TIMEOUT', classifyApiError({ status_code: 'SESSION_TIMEOUT', msg: '请登录之后继续访问' }) === 'SESSION_TIMEOUT');
  check('MOBILE_AUTH', classifyApiError({ status_code: 'MOBILE_AUTH', msg: '需要验证手机' }) === 'MOBILE_AUTH');
  check('COMPUTE_PENDING', classifyApiError({ status: 1, computing: true, msg: '该式神御魂搭配方式正在计算中！' }) === 'COMPUTE_PENDING');
  check('下架文案兜底', classifyApiError({ status: 0, msg: '物品不存在' }) === 'ITEM_NOT_FOUND');
}

console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`);
process.exitCode = failures === 0 ? 0 : 1;
