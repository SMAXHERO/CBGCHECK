import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App } from 'antd';
import { useLocation } from 'react-router-dom';
import { ModuleHeader } from '@/components/ModuleHeader';
import { StatusBlock } from '@/components/StatusBlock';
import {
  accountApi,
  parseInput,
  type AccountAnalysis,
  type HeroScore,
  type SpeedCore,
  type SpeedStats,
  type SuitSpeedRow,
} from '@/api/account';
import { SCRAPER_BASE } from '@/api/live';

/**
 * 模块二：账号评分。
 *
 * 输入一个藏宝阁账号地址，输出：
 *   ① 须佐之男 / 阿修罗 的御魂搭配方案评分（站点按该账号实际御魂算出来的）
 *   ② 每种御魂在 6 个位置上的最快速
 *
 * 关键限制（已在界面上如实说明，不要让用户猜）：
 *   接口要 `eid`，但商品页地址里只有 `ordersn`，两者**无法互相推导**。
 *   所以最省事的输入是「御魂搭配」弹窗的地址——它直接带 eid。
 */

const fmt = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined ? '—' : Number(n).toFixed(digits);

const fmtInt = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('zh-CN');

/** 缓存年龄 -> 「12 秒」/「3 分钟」/「2 小时」 */
const fmtAge = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return '刚刚';
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec} 秒`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} 分钟`;
  return `${Math.round(min / 60)} 小时`;
};

/** B1：自动取分的轮数与间隔 */
const RETRY_ROUNDS = 3;
const RETRY_WAIT_SEC = 20;

/**
 * B3：把服务端/接口的错误 code 翻成「用户接下来该做什么」。
 * 不同错误需要用户做的事完全不同（下架↔重新选号、登录失效↔重新登录、滑块↔手动验证），
 * 所以不能都显示一句「分析失败」。
 */
const friendlyError = (code: string | null | undefined, message: string | null | undefined): string => {
  switch (code) {
    case 'ITEM_NOT_FOUND':
      return '商品已下架或不存在（可能已被购买）。请回到模块一重新选一个在售账号。';
    case 'CAPTCHA_AUTH':
      return '藏宝阁要求安全验证：请到伴随服务弹出的浏览器窗口里打开任意商品页，完成滑块后重试。';
    case 'SESSION_TIMEOUT':
      return '登录态失效：请到伴随服务弹出的浏览器窗口里重新登录藏宝阁，然后重试。';
    case 'MOBILE_AUTH':
      return '需要手机验证：请在伴随服务弹出的浏览器窗口里完成验证，然后重试。';
    case 'COMPUTE_PENDING':
      return '藏宝阁还在计算这个账号，稍后点「重新分析」或使用自动取分。';
    case 'NO_CACHE':
      return '还没有可用的分析结果，请先点「开始分析」。';
    case 'BUSY':
      return '伴随服务正在处理其他请求，请稍等再试。';
    case 'API_ERROR':
      return `藏宝阁接口返回异常：${message || '未知错误'}`;
    default: {
      const msg = message || '分析失败';
      // 兼容旧版服务端（没有 code 字段）的错误文案
      if (/物品不存在|下架/.test(msg)) return '商品已下架或不存在（可能已被购买）。请回模块一重新选一个在售账号。';
      if (/SESSION_TIMEOUT|登录/.test(msg)) return '登录态失效：请到受控浏览器窗口重新登录藏宝阁后重试。';
      if (/CAPTCHA|安全验证|滑块/.test(msg)) return '藏宝阁要求安全验证：请到受控浏览器窗口完成滑块后重试。';
      return msg;
    }
  }
};

const SPEED_MODES = [
  { key: 'all', label: '总速度（含 2 号位主属性）', hint: '反映这个位置最快能到多少；2 号位 = 主属性 57 + 副属性速度（最高约 75），其余位置 ≤ 18' },
  { key: 'subOnly', label: '仅副属性速度', hint: '2 号位去掉 57 主属性，只看随机副属性堆出来的速度（≤ 18），更有区分度' },
] as const;

const HeroCard = ({ hero, onRetry }: { hero: HeroScore; onRetry?: () => void }) => {
  const [open, setOpen] = useState(false);
  if (hero.missing) {
    return (
      <div className="score-hero missing">
        <div className="score-hero-head">
          <b>{hero.name}</b>
          <span className="score-warn">这个账号的方案清单里没有该式神</span>
        </div>
      </div>
    );
  }
  const { best, worst, plans } = hero;
  const noScore = !best && !worst;
  return (
    <div className="score-hero">
      <div className="score-hero-head">
        <b>{hero.name}</b>
        {noScore ? (
          <span className="score-warn">
            {hero.blocked
              ? '藏宝阁要求安全验证 —— 在受控浏览器窗口里打开这个账号的商品页过一次验证（或等几分钟冷却），再点分析'
              : hero.computing
                ? `${hero.computing} 套方案还在站点排队计算（懒计算，通常 20~60 秒出结果）。可点下方「自动取分」重试，或点「重新分析」。`
                : hero.error
                  ? `没算出评分：${hero.error}`
                  : '这套账号没能算出评分'}
          </span>
        ) : (
          <span className="score-range">
            最优 <em>{fmt(best?.score, 1)}</em> · 最差 {fmt(worst?.score, 1)}
          </span>
        )}
        {noScore && hero.errorCode && <code className="score-error-code">{hero.errorCode}</code>}
        <span className="score-count">
          {hero.scoredCount != null && hero.planCount != null && hero.scoredCount < hero.planCount
            ? `${hero.scoredCount}/${hero.planCount} 套已出分`
            : `${hero.planCount} 套方案`}
        </span>
        {noScore && onRetry && (
          <button className="score-toggle" onClick={onRetry}>
            重新分析
          </button>
        )}
        <button className="score-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? '收起' : '展开全部方案'}
        </button>
      </div>
      {best && (
        <div className="score-best">
          最佳：{best.suit}（{best.limit || '无额外限制'}）· 246 号位 {best.slots}
        </div>
      )}
      {open && (
        <div className="score-plans">
          <table className="score-table">
            <thead>
              <tr>
                <th>总评分</th>
                <th>御魂套装</th>
                <th>246 号位</th>
                <th>属性限制</th>
                <th>攻击</th>
                <th>速度</th>
                <th>暴击</th>
                <th>暴伤</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.planId}>
                  <td className="num strong">{fmt(p.score, 1)}</td>
                  <td>{p.suit}</td>
                  <td>{p.slots}</td>
                  <td>{p.limit || '—'}</td>
                  <td className="num">{fmt(p.attack)}</td>
                  <td className="num">{fmt(p.speed)}</td>
                  <td className="num">{fmt(p.critRate, 1)}%</td>
                  <td className="num">{fmt(p.critPower, 1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const SpeedTable = ({ rows, mode }: { rows: SuitSpeedRow[]; mode: 'all' | 'subOnly' }) => {
  const [sortKey, setSortKey] = useState<'max' | 'sum' | 'name'>('max');
  const sorted = useMemo(() => {
    const arr = [...rows];
    if (sortKey === 'name') arr.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    else arr.sort((a, b) => b[sortKey] - a[sortKey]);
    return arr;
  }, [rows, sortKey]);

  const head = (label: string, key: 'max' | 'sum' | 'name') => (
    <th className="sortable" onClick={() => setSortKey(key)}>
      {label}
      {sortKey === key ? ' ↓' : ''}
    </th>
  );

  return (
    <div className="speed-wrap">
      <table className="score-table speed-table">
        <thead>
          <tr>
            {head('御魂', 'name')}
            <th className="num">P1</th>
            <th className="num">P2</th>
            <th className="num">P3</th>
            <th className="num">P4</th>
            <th className="num">P5</th>
            <th className="num">P6</th>
            {head('最高', 'max')}
            {head('合计', 'sum')}
            <th className="num">覆盖</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              {[r.p1, r.p2, r.p3, r.p4, r.p5, r.p6].map((v, i) => (
                <td key={i} className={`num${v === null ? ' dim' : ''}`}>
                  {v === null ? '—' : fmt(v)}
                </td>
              ))}
              <td className="num strong">{fmt(r.max)}</td>
              <td className="num">{fmt(r.sum, 1)}</td>
              <td className="num">{r.coverage}/6</td>
            </tr>
          ))}
        </tbody>
      </table>
      {mode === 'subOnly' && (
        <p className="speed-note">
          已排除 2 号位的「主属性速度」（满级固定 57，叠加副属性后最高约 75），
          这里看的是各御魂在副属性上堆速度的能力（单件上限 18）。
        </p>
      )}
    </div>
  );
};

/** A1：速度核心指标 + 与官方卖点的交叉校验 */
const SpeedCoreCard = ({ core }: { core: SpeedCore }) => {
  const posVals = [
    core.perPosition.p1,
    core.perPosition.p2,
    core.perPosition.p3,
    core.perPosition.p4,
    core.perPosition.p5,
    core.perPosition.p6,
  ];
  const checkOf = (key: string) => core.checks?.find((c) => c.key === key);
  const badge = (key: string) => {
    const c = checkOf(key);
    if (!c) return <span className="speed-check muted">官方未标注</span>;
    return c.ok ? (
      <span className="speed-check ok">官方 {fmt(c.official)} ✓</span>
    ) : (
      <span className="speed-check warn">官方 {fmt(c.official)} / 本地 {fmt(c.local)}</span>
    );
  };
  const matched = core.checks.filter((c) => c.ok).length;
  return (
    <section className="score-card">
      <h2 className="score-h2">
        速度核心
        <span className="score-badge">本地复算 · 与官方卖点比对</span>
      </h2>
      <div className="speed-core-grid">
        <div className="speed-core-item">
          <span className="speed-core-k">散件一速</span>
          <b className="speed-core-v">{fmt(core.scatterSpeed)}</b>
          <span className="speed-core-sub">
            {posVals.map((v, i) => `P${i + 1} ${fmt(v)}`).join(' · ')}
          </span>
          {badge('scatterSpeed')}
        </div>
        <div className="speed-core-item">
          <span className="speed-core-k">招财一速</span>
          <b className="speed-core-v">{fmt(core.zhaocaiSpeed)}</b>
          <span className="speed-core-sub">4 件招财猫 + 2 件任意套装</span>
          {badge('zhaocaiSpeed')}
        </div>
        <div className="speed-core-item">
          <span className="speed-core-k">头速度</span>
          <b className="speed-core-v">{fmt(core.headSpeed)}</b>
          <span className="speed-core-sub">2 号位速度主属性的最高副属性速度</span>
          {badge('headSpeed')}
        </div>
        <div className="speed-core-item">
          <span className="speed-core-k">头 / 尾数量</span>
          <b className="speed-core-v">
            {core.official?.tou === null || core.official?.tou === undefined
              ? '—'
              : `${core.official.tou}头${core.official.wei ?? 0}尾`}
          </b>
          <span className="speed-core-sub">官方口径：头 = 2 号位速度主属性，尾 = 4 号位命中/抵抗主属性（且速度达标）</span>
          <span className="speed-check muted">直接引用官方 highlights</span>
        </div>
      </div>
      <p className="speed-note">
        散件一速 = 六个位置各自最快的总速度之和；招财一速 = 4 件招财猫 + 2 件任意套装（与藏宝阁官方口径一致）。
        {core.checks.length > 0
          ? ` 本次 ${matched}/${core.checks.length} 项与官方标注一致。`
          : ' 这个账号的官方卖点里没有可比的数值，以上为本地复算。'}
      </p>
    </section>
  );
};

/** A2：副属性速度分布 */
const SpeedStatsCard = ({ stats }: { stats: SpeedStats }) => {
  const chips: Array<{ k: string; v: string }> = [
    { k: '副属性 ≥15', v: String(stats.ge15) },
    { k: '≥16', v: String(stats.ge16) },
    { k: '≥17', v: String(stats.ge17) },
    { k: '真 17', v: String(stats.true17) },
    { k: '伪 17', v: String(stats.fake17) },
    { k: '近满速', v: String(stats.nearFull) },
    { k: '满速', v: String(stats.full) },
    { k: '速度胚子', v: String(stats.unleveled) },
    { k: '最高副属性', v: fmt(stats.maxSubSpeed) },
    {
      k: '命中4号位',
      v: stats.hitTailSpeed === null ? String(stats.hitTailCount) : `${stats.hitTailCount}（${fmt(stats.hitTailSpeed)}）`,
    },
    {
      k: '抵抗4号位',
      v:
        stats.resistTailSpeed === null ? String(stats.resistTailCount) : `${stats.resistTailCount}（${fmt(stats.resistTailSpeed)}）`,
    },
  ];
  return (
    <section className="score-card">
      <h2 className="score-h2">
        速度分布
        <span className="score-badge">共 {stats.subSpeedCount} 件带速度副属性</span>
      </h2>
      <div className="stat-chips">
        {chips.map((c) => (
          <span className="stat-chip" key={c.k}>
            <b>{c.v}</b>
            <span>{c.k}</span>
          </span>
        ))}
      </div>
      <p className="speed-note">
        副属性速度理论上限 18（6★ 共 6 次 roll、每次上限 3）。「真 17」= 实际值 ≥17.00；
        「伪 17」= 16.5~16.99（显示像 +17）。命中/抵抗 4 号位 = 四号位主属性效果命中 / 效果抵抗、且带速度副属性的御魂；
        官方「尾」的计数更严格（还要求速度达标），见上方「头 / 尾数量」。
      </p>
    </section>
  );
};

export const AccountScore = () => {
  const { message } = App.useApp();
  const location = useLocation();

  const [input, setInput] = useState('');
  const [eidOnly, setEidOnly] = useState('');
  const [serveridOnly, setServeridOnly] = useState('');
  const [needEid, setNeedEid] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AccountAnalysis | null>(null);
  const [speedMode, setSpeedMode] = useState<'all' | 'subOnly'>('all');
  const [showHelp, setShowHelp] = useState(false);
  /**
   * 常驻错误提示。
   *
   * 用 antd 的 message 弹一下就消失，用户回头看不到失败原因；
   * 更要紧的是**失败时必须清掉上一次的结果**——否则会出现
   * 「URL 是账号 A、界面显示账号 B 的数据」这种误导（真踩过）。
   * B3：除了文案，还保留服务端归类后的 code，界面会分开提示。
   */
  const [errorInfo, setErrorInfo] = useState<{ text: string; code: string | null } | null>(null);

  /** B1：自动取分（只重试还在排队计算的方案） */
  const [retry, setRetry] = useState<{
    running: boolean;
    round: number;
    wait: number;
    log: string[];
    requests: number;
  }>({ running: false, round: 0, wait: 0, log: [], requests: 0 });
  const retryAbort = useRef(false);
  const retryRunningRef = useRef(false);
  const dataRef = useRef<AccountAnalysis | null>(null);
  dataRef.current = data;

  /**
   * 从 URL 参数自动分析。
   *
   * 模块一的表格每行都有「评分」入口，点它会跳到
   *   #/score?eid=…&serverid=…
   * 这里读参数直接跑，用户不用再粘一次地址。
   *
   * 用 ref 记住已处理过的参数：React 严格模式下 effect 会跑两遍，
   * 不做去重会重复请求两遍（每次 15 秒，很浪费）。
   */
  const autoRanRef = useRef('');

  const runParams = useCallback(
    async (eid: string, serverid: string, refresh = false) => {
      setLoading(true);
      setNeedEid(false);
      setErrorInfo(null);
      try {
        const res = await accountApi.analyze(eid, serverid, undefined, refresh);
        setData(res);
        setInput(`eid=${eid}&serverid=${serverid}`);
        message.success(refresh ? '重新分析完成' : '分析完成');
      } catch (err) {
        // 失败就清掉旧结果，避免把上一个账号的数字当成这个账号的
        setData(null);
        const e = err as Error & { code?: string };
        const msg = e.message || '分析失败';
        const code = e.code ?? null;
        setErrorInfo({ text: friendlyError(code, msg), code });
        message.error(friendlyError(code, msg));
      } finally {
        setLoading(false);
      }
    },
    [message],
  );

  /** 手动刷新：跳过服务端缓存，重新抓一遍（风控风险由用户自己决定） */
  const refresh = useCallback(() => {
    if (data?.eid && data?.serverid) void runParams(data.eid, data.serverid, true);
  }, [data, runParams]);

  /** B1：停止自动取分 */
  const stopAutoRescore = useCallback(() => {
    retryAbort.current = true;
  }, []);

  /**
   * B1：自动取分。
   *
   * 只重试「还在排队计算」的方案（服务端从分析缓存里取 planId，不重新拉详情），
   * 每轮间隔 20 秒、最多 3 轮；每轮结束把结果合并进当前页面。
   * 任何一轮触发风控就立即停止，并提示用户去完成验证。
   */
  const startAutoRescore = useCallback(async () => {
    const current = dataRef.current;
    if (!current?.eid || !current?.serverid || retryRunningRef.current) return;
    retryRunningRef.current = true;
    retryAbort.current = false;
    setRetry({ running: true, round: 0, wait: 0, log: [], requests: 0 });

    const logs: string[] = [];
    let heroes = current.heroes;
    let totalRequests = 0;
    try {
      for (let round = 1; round <= RETRY_ROUNDS; round += 1) {
        // 倒计时等待：给站点计算队列留时间，同时让用户随时停止
        for (let sec = RETRY_WAIT_SEC; sec > 0; sec -= 1) {
          if (retryAbort.current) break;
          setRetry((s) => ({ ...s, round, wait: sec }));
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (retryAbort.current) {
          logs.push('已停止自动取分。');
          break;
        }
        setRetry((s) => ({ ...s, wait: 0 }));

        try {
          const res = await accountApi.rescore(current.eid, current.serverid, heroes.map((h) => h.name));
          totalRequests += res.meta.requestCount;
          heroes = res.heroes;
          const pending = res.heroes.reduce((n, h) => n + (h.computing || 0), 0);
          logs.push(`第 ${round} 轮：请求 ${res.meta.requestCount} 个，仍缺 ${pending} 套`);
          setData((d) =>
            d
              ? {
                  ...d,
                  heroes: res.heroes,
                  meta: {
                    ...(d.meta || { requestCount: 0, durationMs: 0 }),
                    requestCount: (d.meta?.requestCount ?? 0) + res.meta.requestCount,
                  },
                  errorCode: res.errorCode ?? d.errorCode ?? null,
                }
              : d,
          );
          setRetry((s) => ({ ...s, log: [...logs], requests: totalRequests }));
          if (res.blocked) {
            logs.push(`触发风控（${res.errorCode ?? 'CAPTCHA_AUTH'}），已停止；请先在浏览器窗口里完成验证。`);
            break;
          }
          if (!pending) {
            logs.push('全部方案已取到评分 ✅');
            break;
          }
        } catch (err) {
          const e = err as Error & { code?: string };
          logs.push(`第 ${round} 轮失败：${friendlyError(e.code, e.message)}`);
          break;
        }
      }
    } finally {
      retryRunningRef.current = false;
      setRetry((s) => ({ ...s, running: false, wait: 0, log: [...logs], requests: totalRequests }));
    }
  }, []);

  // 页面卸载时停止倒计时，避免后台空转
  useEffect(
    () => () => {
      retryAbort.current = true;
    },
    [],
  );

  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const eid = sp.get('eid') || '';
    const sid = sp.get('serverid') || '';
    if (!eid || !sid) return;
    const key = `${eid}|${sid}`;
    if (autoRanRef.current === key) return;
    autoRanRef.current = key;
    void runParams(eid, sid);
  }, [location.search, runParams]);

  const run = useCallback(async () => {
    const raw = input.trim();
    if (!raw) {
      message.warning('先粘一个账号地址');
      return;
    }
    const parsed = parseInput(raw);
    setLoading(true);
    setNeedEid(false);
    setErrorInfo(null);
    try {
      const res = parsed.eid && parsed.serverid
        ? await accountApi.analyze(parsed.eid, parsed.serverid, undefined, true)
        : await accountApi.analyzeByUrl(raw, undefined, true);
      setData(res);
      message.success('分析完成');
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'NEED_EID') {
        setNeedEid(true);
      } else {
        setData(null);
        const msg = e.message || '分析失败';
        const code = e.code ?? null;
        setErrorInfo({ text: friendlyError(code, msg), code });
        message.error(friendlyError(code, msg));
      }
    } finally {
      setLoading(false);
    }
  }, [input, message]);

  const runWithEid = useCallback(async () => {
    const e = eidOnly.trim();
    const s = serveridOnly.trim();
    if (!e || !s) {
      message.warning('eid 和 serverid 都要填');
      return;
    }
    setLoading(true);
    try {
      const res = await accountApi.analyze(e, s, undefined, true);
      setData(res);
      setNeedEid(false);
      message.success('分析完成');
    } catch (err) {
      message.error((err as Error).message || '分析失败');
    } finally {
      setLoading(false);
    }
  }, [eidOnly, serveridOnly, message]);

  const acct = data?.account;
  const ov = data?.overview;
  const speedRows = data ? (speedMode === 'all' ? data.speed.all : data.speed.subOnly) : [];
  const dexText = (key: string) => {
    const d = ov?.dex?.[key];
    return d ? `${d.got}/${d.all ?? '?'}` : '—';
  };
  /** B1：还有多少套方案在站点排队计算 */
  const pendingCount = data ? data.heroes.reduce((n, h) => n + (h.computing || 0), 0) : 0;
  const anyBlocked = data ? data.heroes.some((h) => h.blocked) : false;
  /** B3：本次分析（含自动取分追加）的请求预算 */
  const budget = data?.meta
    ? `${data.meta.requestCount} 个请求 · ${(data.meta.durationMs / 1000).toFixed(1)} 秒`
    : null;

  return (
    <div className="app-shell">
      <ModuleHeader
        title="藏宝阁数据面板"
        badge="阴阳师 · 角色"
        themeVariant="text"
        meta={`数据源 ${SCRAPER_BASE.replace('http://', '')}（本机伴随服务代理，无需登录藏宝阁）`}
      />

      <div className="score-body">
        <section className="score-card">
          <h2 className="score-h2">账号分析</h2>
          <p className="score-p">
            粘一个账号地址即可 —— 会读这个账号的御魂仓库与式神搭配方案，算出评分与各位置最快速。
            <b>接口不需要登录藏宝阁</b>，但需要一个含 <code>eid</code> 的地址。
          </p>

          <div className="score-input-row">
            <input
              className="score-input"
              placeholder="粘「御魂搭配」地址（含 eid=…）或商品页地址"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void run();
              }}
              spellCheck={false}
            />
            <button className="btn btn-primary" onClick={() => void run()} disabled={loading}>
              {loading ? '分析中…' : '开始分析'}
            </button>
            <button className="btn btn-ghost" onClick={() => setShowHelp((v) => !v)}>
              {showHelp ? '收起说明' : '怎么拿地址？'}
            </button>
          </div>

          {showHelp && (
            <div className="score-help">
              <p>
                <b>为什么要特殊地址？</b> 藏宝阁的接口只认 <code>eid</code>，而商品页地址里是{' '}
                <code>ordersn</code>（两者不同，且无法互相推导——实测 ordersn 查详情一律「物品不存在」）。
              </p>
              <ol>
                <li>打开账号的商品详情页</li>
                <li>切到「<b>御魂</b>」标签，点「<b>御魂搭配方案</b>」</li>
                <li>弹窗出现后，复制地址栏里那条 <code>…/yuhun-collocation?eid=…&amp;serverid=…</code></li>
                <li>粘到上面输入框</li>
              </ol>
              <p>
                或者直接手动填：<code>eid</code> + <code>serverid</code>（serverid 就是商品页地址里{' '}
                <code>/equip/<b>47</b>/</code> 那个数字）。
              </p>
            </div>
          )}

          {needEid && (
            <div className="score-need">
              <b>这个地址里只有 ordersn，接口需要 eid。</b>{' '}
              请按上面「怎么拿地址」的步骤取一条含 eid 的地址，或在这里直接填：
              <div className="score-input-row" style={{ marginTop: 8 }}>
                <input
                  className="score-input"
                  placeholder="eid，形如 202610161701613-47-SMSV5P0UFDMEW"
                  value={eidOnly}
                  onChange={(e) => setEidOnly(e.target.value)}
                  spellCheck={false}
                />
                <input
                  className="score-input score-input-sm"
                  placeholder="serverid（如 47）"
                  value={serveridOnly}
                  onChange={(e) => setServeridOnly(e.target.value)}
                  spellCheck={false}
                />
                <button className="btn btn-primary" onClick={() => void runWithEid()} disabled={loading}>
                  用 eid 分析
                </button>
              </div>
            </div>
          )}
        </section>

        {loading && (
          <StatusBlock variant="inline" loading>
            正在读取详情并逐个方案算分（方案多的会慢一些，约 10~20 秒）…
          </StatusBlock>
        )}

        {errorInfo && !loading && (
          <div className="score-need score-error" role="alert">
            <b>分析失败：</b>
            {errorInfo.text}
            {errorInfo.code && <code className="score-error-code">{errorInfo.code}</code>}
            <div className="score-error-hint">
              提示「安全验证 / 登录态失效」时，请到伴随服务弹出的浏览器窗口里完成后回来重试；
              商品下架则回模块一换一个在售账号。
            </div>
          </div>
        )}

        {data && (
          <div className="cache-bar">
            <span>
              {data.cached
                ? `结果来自 ${fmtAge(data.cacheAgeMs)}前的缓存（服务端 TTL ${Math.round(
                    (data.cacheTtlMs ?? 0) / 60000,
                  )} 分钟，刷新可重新抓取）`
                : '实时分析结果'}
              {budget && ` ｜ 本次消耗 ${budget}`}
            </span>
            <button className="score-toggle" onClick={refresh} disabled={loading}>
              {loading ? '刷新中…' : '刷新'}
            </button>
          </div>
        )}

        {data && acct && (
          <>
            <section className="score-card">
              <h2 className="score-h2">
                账号概览
                <span className="score-badge">{acct.statusDesc}</span>
              </h2>
              <div className="acct-grid">
                <div>
                  <span className="acct-k">价格</span>
                  <b className="acct-v price">¥{(acct.price / 100).toLocaleString('zh-CN')}</b>
                </div>
                <div>
                  <span className="acct-k">区服</span>
                  <b className="acct-v">{acct.serverName}</b>
                </div>
                <div>
                  <span className="acct-k">勾玉</span>
                  <b className="acct-v">{acct.goyu === null ? '—' : Number(acct.goyu).toLocaleString('zh-CN')}</b>
                </div>
                <div>
                  <span className="acct-k">签到</span>
                  <b className="acct-v">{acct.signDays === null ? '—' : `${fmtInt(acct.signDays)} 天`}</b>
                </div>
                <div>
                  <span className="acct-k">风姿度</span>
                  <b className="acct-v">{fmtInt(acct.fengzidu)}</b>
                </div>
                <div>
                  <span className="acct-k">御魂总数</span>
                  <b className="acct-v">{fmtInt(acct.soulCount)}</b>
                </div>
                <div>
                  <span className="acct-k">2 号位速度御魂</span>
                  <b className="acct-v">{fmtInt(acct.mainSpeedSouls)}</b>
                </div>
                <div>
                  <span className="acct-k">收藏</span>
                  <b className="acct-v">{fmtInt(acct.collectNum)}</b>
                </div>
              </div>
              {ov && (
                <>
                  <h3 className="acct-subtitle">养成 / 资产 / 收集</h3>
                  <div className="acct-grid">
                    <div>
                      <span className="acct-k">式神条目</span>
                      <b className="acct-v">{fmtInt(ov.heroCount)} 条</b>
                    </div>
                    <div>
                      <span className="acct-k">六星式神</span>
                      <b className="acct-v">
                        {ov.sixStar} 只 <span className="acct-note">· 满技能 {ov.fullSkillSixStar} 只</span>
                      </b>
                    </div>
                    <div>
                      <span className="acct-k">SSR / SP</span>
                      <b className="acct-v">
                        {ov.ssrOwned} / {ov.spOwned}
                        <span className="acct-note">（含重复）</span>
                      </b>
                    </div>
                    <div>
                      <span className="acct-k">式神图鉴</span>
                      <b className="acct-v">
                        SSR {dexText('ssr')} · SP {dexText('sp')}
                      </b>
                    </div>
                    <div>
                      <span className="acct-k">皮肤 / 头像框</span>
                      <b className="acct-v">
                        {fmtInt(ov.skinCount)} / {fmtInt(ov.headSkinCount)}
                      </b>
                    </div>
                    <div>
                      <span className="acct-k">金币</span>
                      <b className="acct-v">{fmtInt(ov.money)}</b>
                    </div>
                    <div>
                      <span className="acct-k">体力</span>
                      <b className="acct-v">{fmtInt(ov.strength)}</b>
                    </div>
                    <div>
                      <span className="acct-k">达摩</span>
                      <b className="acct-v">{fmtInt(ov.damoTotal)}</b>
                    </div>
                    <div>
                      <span className="acct-k">魂玉 / 皮肤券</span>
                      <b className="acct-v">
                        {fmtInt(ov.soulJade)} / {fmtInt(ov.skinCoupon)}
                      </b>
                    </div>
                    <div>
                      <span className="acct-k">斗技 / 排名</span>
                      <b className="acct-v">
                        {ov.pvpScore === null ? '—' : fmtInt(ov.pvpScore)}
                        {ov.pvpRank !== null && ov.pvpRank > 0 ? ` / #${fmtInt(ov.pvpRank)}` : ' / 未上榜'}
                      </b>
                    </div>
                    <div>
                      <span className="acct-k">荣誉分 / 勋章</span>
                      <b className="acct-v">
                        {fmtInt(ov.honorScore)} / {fmtInt(ov.medal)}
                      </b>
                    </div>
                    <div>
                      <span className="acct-k">成就 / 首领御魂</span>
                      <b className="acct-v">
                        {fmtInt(ov.achieveCount)} / {fmtInt(ov.bossEquipCount)}
                      </b>
                    </div>
                  </div>
                </>
              )}
              <p className="score-foot">
                上架 {acct.createTime}
                {acct.sellingTime && acct.sellingTime !== acct.createTime ? ` ｜ 更新 ${acct.sellingTime}` : ''}
                {' ｜ '}
                <a href={acct.detailUrl} target="_blank" rel="noreferrer">
                  打开藏宝阁原页
                </a>
              </p>
            </section>

            {data.speedCore && <SpeedCoreCard core={data.speedCore} />}
            {data.speedStats && <SpeedStatsCard stats={data.speedStats} />}

            <section className="score-card">
              <h2 className="score-h2">式神御魂搭配评分</h2>
              <p className="score-p">
                评分由藏宝阁按<b>这个账号实际的御魂</b>逐套算出来，不是静态攻略。同一式神的不同套装会得到不同分。
              </p>
              <div className="score-heroes">
                {data.heroes.map((h) => (
                  <HeroCard
                    key={h.name}
                    hero={h}
                    onRetry={
                      data.eid && data.serverid
                        ? () => void runParams(data.eid, data.serverid, true)
                        : undefined
                    }
                  />
                ))}
              </div>

              {/* B1：冷计算账号自动取分 */}
              {(pendingCount > 0 || retry.log.length > 0 || retry.running) && (
                <div className="rescore-box">
                  <div className="rescore-head">
                    <b>还有 {pendingCount} 套方案在藏宝阁排队计算</b>
                    <span>
                      站点是懒计算，通常等 20~60 秒就能出分。自动取分只重试未出分的方案，
                      不会重新拉详情（不会重复消耗详情请求）。
                    </span>
                  </div>
                  <div className="rescore-actions">
                    {retry.running ? (
                      <>
                        <span className="rescore-status">
                          第 {retry.round}/{RETRY_ROUNDS} 轮
                          {retry.wait > 0 ? ` · ${retry.wait} 秒后取分…` : ' · 正在取分…'}
                        </span>
                        <button className="score-toggle" onClick={stopAutoRescore}>
                          停止
                        </button>
                      </>
                    ) : anyBlocked ? (
                      <span className="rescore-status warn">
                        已触发风控，请先在浏览器窗口里完成验证/登录，再点「重新分析」。
                      </span>
                    ) : pendingCount > 0 ? (
                      <button className="score-toggle" onClick={() => void startAutoRescore()}>
                        自动取分（最多 {RETRY_ROUNDS} 轮）
                      </button>
                    ) : (
                      <span className="rescore-status">已全部取到评分。</span>
                    )}
                    {retry.requests > 0 && (
                      <span className="rescore-requests">累计请求 {retry.requests} 个</span>
                    )}
                  </div>
                  {retry.log.length > 0 && (
                    <ul className="rescore-log">
                      {retry.log.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>

            <section className="score-card">
              <h2 className="score-h2">
                每种御魂在 6 个位置的最快速
                <span className="score-badge">{speedRows.length} 种</span>
              </h2>
              <div className="seg" role="group" aria-label="速度口径">
                {SPEED_MODES.map((m) => (
                  <button
                    key={m.key}
                    className={`seg-btn${speedMode === m.key ? ' on' : ''}`}
                    onClick={() => setSpeedMode(m.key)}
                    title={m.hint}
                    aria-pressed={speedMode === m.key}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <SpeedTable rows={speedRows} mode={speedMode} />
            </section>
          </>
        )}
      </div>
    </div>
  );
};
