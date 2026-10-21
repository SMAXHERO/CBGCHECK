import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ModuleTabs } from '@/components/ModuleTabs';
import { useTheme } from '@/hooks/useTheme';
import {
  inspectorApi,
  type CalcResult,
  type InspectorMeta,
  type InspectorReport as InspectorReportData,
  type JobState,
  type RelicList,
  type SpeedCell,
} from '@/api/inspector';

/**
 * 模块四：藏宝阁看号工具（站点 yys-cbg-inspector 的蒸馏版）。
 *
 * 六个标签页对应原站六页，数据全部来自伴随服务背后的 Python 内核：
 *   ① 账号概览：速度亮点 / 资源 / 图鉴 / 御魂规模 / PVE 评分
 *   ② 速度盘点：满速统计、散件一速 top5、常用 PVP 套装一速表
 *   ③ PVE 预览：21 组（7 普通套 × 3 逢魔套）最优伤害与总平均值
 *   ④ 式神技能：稀有度分组、未达标、多号机、联动式神
 *   ⑤ 御魂库存：号位/套装/主属性筛选
 *   ⑥ 御魂计算器：式神面板 + 主属性预设 + 满暴约束的最优六件
 */

const TABS = [
  { key: 'overview', label: '账号概览' },
  { key: 'speed', label: '速度盘点' },
  { key: 'pve', label: 'PVE 预览' },
  { key: 'hero', label: '式神技能' },
  { key: 'relics', label: '御魂库存' },
  { key: 'calc', label: '御魂计算器' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const METRIC_LABELS: Record<string, string> = {
  damage: '伤害（攻击 × 暴伤）',
  healing: '治疗（生命 × 暴伤）',
  defenseOutput: '防御输出（防御 × 暴伤）',
  attack: '攻击',
  health: '生命',
  defense: '防御',
  speed: '速度',
  critRate: '暴击',
  critDamage: '暴击伤害',
  effectHit: '效果命中',
  effectResistance: '效果抵抗',
  hitResistance: '命中+抵抗',
};

const fmt = (n: number | null | undefined, d = 2) =>
  n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(d);
const fmtInt = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('zh-CN');
const numText = (v: { raw?: number; text?: string } | number | null | undefined) =>
  v === null || v === undefined
    ? '—'
    : typeof v === 'number'
      ? fmtInt(v)
      : v.text ?? fmtInt(v.raw);

/** 从链接/订单号里解析（服务端会再解析一次，这里只为提前校验与提示） */
function parseCbgInput(raw: string): { ordersn?: string; serverid?: string; url?: string } {
  const s = raw.trim();
  if (!s) return {};
  const m = s.match(/\/equip\/(\d+)\/([0-9]{8,}-[0-9]+-[0-9A-Za-z]+)/);
  if (m) return { serverid: m[1], ordersn: m[2], url: s };
  if (/^[0-9]{8,}-[0-9]+-[0-9A-Za-z]+$/.test(s)) return { ordersn: s, serverid: s.split('-')[1] };
  return {};
}

/** 轮询异步任务直到完成 */
async function pollJob(id: string, onProgress: (job: JobState) => void): Promise<JobState> {
  for (;;) {
    const { job } = await inspectorApi.job(id);
    onProgress(job);
    if (job.status === 'done' || job.status === 'error') return job;
    await new Promise((r) => setTimeout(r, 700));
  }
}

const CellTable = ({ cells }: { cells: SpeedCell[] }) => (
  <table className="insp-cells">
    <tbody>
      <tr>
        {cells.map((cell) => (
          <td key={cell.position}>
            <b>{fmt(cell.value)}</b>
            <span className="insp-cell-sub">
              {cell.position}号位 · {cell.suitName}
              {cell.labels.length > 0 ? ` · ${cell.labels.join('/')}` : ''}
            </span>
            <span className="insp-cell-main">
              {cell.mainAttribute.label}
              {cell.mainAttribute.isPercent ? ' %' : ''}
            </span>
          </td>
        ))}
      </tr>
    </tbody>
  </table>
);

export const InspectorReport = () => {
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const autoRanRef = useRef('');
  const fileDeepLink = useRef(false);

  const [meta, setMeta] = useState<InspectorMeta | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<InspectorReportData | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');

  const [relics, setRelics] = useState<RelicList | null>(null);
  const [relicPosition, setRelicPosition] = useState('');
  const [relicSuits, setRelicSuits] = useState('');
  const [relicMain, setRelicMain] = useState('');

  const [heroQuery, setHeroQuery] = useState('');
  const [heroRarity, setHeroRarity] = useState('');

  const [calcHero, setCalcHero] = useState('须佐之男');
  const [calcMetric, setCalcMetric] = useState('damage');
  const [calcPreset, setCalcPreset] = useState('attack');
  const [calcFullCrit, setCalcFullCrit] = useState(true);
  const [calcFast, setCalcFast] = useState(true);
  const [calcLimit, setCalcLimit] = useState(3);
  const [calcJob, setCalcJob] = useState<JobState | null>(null);
  const [calcRunning, setCalcRunning] = useState(false);
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null);

  const [pveJob, setPveJob] = useState<JobState | null>(null);
  const [pveRunning, setPveRunning] = useState(false);
  const [pveResult, setPveResult] = useState<{
    hero: string;
    average: number | null;
    rows: { suit: string; omaSuit: string; damage: number; panel: Record<string, number> }[];
  } | null>(null);

  const ordersn = report?.ordersn ?? '';
  const serverid = report?.serverid ?? '';

  const loadReport = useCallback(async (q: { ordersn?: string; serverid?: string; url?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const data = await inspectorApi.report(q);
      setReport(data);
      setTab('overview');
      setRelics(null);
      setPveResult(null);
      setCalcResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const run = useCallback(() => {
    const q = parseCbgInput(input);
    if (!q.ordersn && !q.url) {
      setError('请粘贴藏宝阁商品链接，或输入订单号（202610201501616-17-4G0RE3QTEDLIQ）');
      return;
    }
    void loadReport(q);
  }, [input, loadReport]);

  const runDemo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await inspectorApi.demo();
      setReport(data);
      setTab('overview');
      setRelics(null);
      setPveResult(null);
      setCalcResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // 静态资料（式神名 / 套装名 / 预设）只取一次
  useEffect(() => {
    let alive = true;
    inspectorApi
      .meta()
      .then((data) => {
        if (alive) setMeta(data);
      })
      .catch(() => {
        /* 内核没起来时由报告流程给出错误提示，这里静默 */
      });
    return () => {
      alive = false;
    };
  }, []);

  // 模块一/分享链接深链：?ordersn=…&serverid=… 或 ?url=… 或 ?demo=1
  useEffect(() => {
    if (fileDeepLink.current) return;
    const sp = new URLSearchParams(location.search);
    const key = sp.toString();
    if (!key || autoRanRef.current === key) return;
    autoRanRef.current = key;
    if (sp.get('demo') === '1') {
      void runDemo();
      return;
    }
    const url = sp.get('url') ?? '';
    const deepOrdersn = sp.get('ordersn') ?? '';
    const deepServerid = sp.get('serverid') ?? '';
    if (url || deepOrdersn) {
      if (url) setInput(url);
      void loadReport({ ordersn: deepOrdersn, serverid: deepServerid, url: url || undefined });
    }
  }, [location.search, loadReport, runDemo]);

  const reloadRelics = useCallback(async () => {
    if (!report) return;
    try {
      const data = await inspectorApi.relics({
        ordersn: ordersn || 'demo',
        serverid,
        position: relicPosition || undefined,
        suits: relicSuits.trim() || undefined,
        mainAttribute: relicMain.trim() || undefined,
        limit: 120,
      });
      setRelics(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [report, ordersn, serverid, relicPosition, relicSuits, relicMain]);

  useEffect(() => {
    if (tab !== 'relics' || relics || !report) return;
    void reloadRelics();
  }, [tab, relics, report, reloadRelics]);

  const runCalc = useCallback(async () => {
    if (!report) return;
    setCalcRunning(true);
    setCalcResult(null);
    setCalcJob(null);
    setError(null);
    try {
      const { jobId } = await inspectorApi.calc({
        ordersn: ordersn || 'demo',
        serverid,
        hero: calcHero,
        metric: calcMetric,
        preset: calcPreset,
        fullCrit: calcFullCrit,
        fastMode: calcFast,
        limit: calcLimit,
      });
      const job = await pollJob(jobId, setCalcJob);
      if (job.status === 'error') throw new Error(job.error || '计算失败');
      setCalcResult(job.result as CalcResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCalcRunning(false);
    }
  }, [report, ordersn, serverid, calcHero, calcMetric, calcPreset, calcFullCrit, calcFast, calcLimit]);

  const runPve = useCallback(async (refresh = false) => {
    if (!report) return;
    setPveRunning(true);
    setPveResult(null);
    setPveJob(null);
    setError(null);
    try {
      const { jobId } = await inspectorApi.pve({ ordersn: ordersn || 'demo', serverid, refresh });
      const job = await pollJob(jobId, setPveJob);
      if (job.status === 'error') throw new Error(job.error || 'PVE 计算失败');
      setPveResult(job.result as unknown as typeof pveResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPveRunning(false);
    }
  }, [report, ordersn, serverid]);

  const ov = report?.account;
  const speed = report?.speed;
  const pve = report?.pveScores;
  const heroSkills = report?.heroSkills;

  const heroGroups = useMemo(() => {
    if (!heroSkills) return [];
    const q = heroQuery.trim().toLowerCase();
    return heroSkills.groups
      .filter((group) => !heroRarity || group.rarity === heroRarity)
      .map((group) => ({
        rarity: group.rarity,
        heroes: group.heroes.filter((hero) => !q || hero.name.toLowerCase().includes(q)),
      }))
      .filter((group) => group.heroes.length > 0);
  }, [heroSkills, heroQuery, heroRarity]);

  const sourceText =
    report?.source === 'demo'
      ? '演示数据'
      : report?.source === 'mayday'
        ? '站点 action'
        : report?.source
          ? 'CBG 直连'
          : '—';

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="head-in">
          <h1>藏宝阁数据面板</h1>
          <span className="pill-tag">阴阳师 · 看号</span>
          <ModuleTabs />
          <span className="head-meta">模块四：粘贴链接，本地算速度 / PVE / 式神 / 库存 / 配装</span>
          <button
            className="icon-btn"
            onClick={toggle}
            title={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
            aria-label="切换主题"
          >
            {theme === 'dark' ? '☀' : '🌙'}
          </button>
        </div>
      </header>

      <div className="soul-body">
        <section className="soul-card">
          <h2 className="soul-h2">藏宝阁看号工具</h2>
          <p className="soul-p">
            粘一个藏宝阁商品链接（或订单号），本地解析装备档案并复刻原站的六项分析。全程不依赖原站前台。
          </p>
          <div className="soul-input-row">
            <input
              className="soul-input"
              placeholder="粘藏宝阁商品链接（https://yys.cbg.163.com/cgi/mweb/equip/17/…）或订单号"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') run();
              }}
              spellCheck={false}
            />
            <button className="btn btn-primary" onClick={run} disabled={loading}>
              {loading ? '读取中…' : '读取链接'}
            </button>
            <button className="btn btn-ghost" onClick={() => void runDemo()} disabled={loading}>
              演示数据
            </button>
          </div>
          {loading && (
            <div className="soul-alert info" role="status" aria-live="polite">
              正在抓取/解析，首次约 2~6 秒…
            </div>
          )}
          {error && (
            <div className="soul-alert err" role="alert">
              {error}
            </div>
          )}
        </section>

        {report && ov && (
          <>
            <section className="soul-card">
              <div className="soul-summary">
                <div className="soul-who">
                  <b>{ov.name}</b>
                  <span className="dim">{ov.serverName}</span>
                  <span className="dim">Lv.{ov.level}</span>
                </div>
                <div className="soul-tags">
                  <span className={`soul-tag${report.cached ? ' gold' : ''}`}>{report.cached ? '缓存命中' : '实时结果'}</span>
                  <span className="soul-tag">{sourceText}</span>
                  <span className="soul-tag">抓取 {fmtInt(report.fetch_ms)}ms</span>
                  {report.ordersn ? <code className="soul-code">{report.ordersn}</code> : null}
                </div>
              </div>

              <div className="insp-chips">
                <span className="insp-chip">
                  散件一速 <b>+{fmt(speed?.highlights.scatteredFirstSpeed)}</b>
                </span>
                <span className="insp-chip">
                  招财一速 <b>+{fmt(speed?.highlights.luckyFirstSpeed)}</b>
                </span>
                <span className="insp-chip">
                  头 <b>{speed?.headTail.heads ?? '—'}</b> / 尾 <b>{speed?.headTail.tails ?? '—'}</b>
                </span>
                <span className="insp-chip">
                  满速御魂 <b>{fmtInt(speed?.fullSpeedCount)}</b>
                </span>
              </div>

              <div className="insp-tabs" role="group" aria-label="看号分析视图">
                {TABS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`insp-tab${tab === item.key ? ' on' : ''}`}
                    onClick={() => setTab(item.key)}
                    aria-pressed={tab === item.key}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </section>

            {tab === 'overview' && (
              <>
                <section className="soul-card">
                  <h3 className="insp-h3">账号数据</h3>
                  <div className="insp-kpis">
                    <div className="insp-kpi">
                      <span>体力</span>
                      <b>{numText(ov.stamina)}</b>
                    </div>
                    <div className="insp-kpi">
                      <span>金币</span>
                      <b>{numText(ov.money)}</b>
                    </div>
                    <div className="insp-kpi">
                      <span>风姿度</span>
                      <b>{fmtInt(ov.fengzidu)}</b>
                    </div>
                    <div className="insp-kpi">
                      <span>斗技</span>
                      <b>
                        {ov.pvpStage}段 / {fmtInt(ov.pvpScore)}分
                      </b>
                    </div>
                    <div className="insp-kpi">
                      <span>勾玉</span>
                      <b>{numText(ov.soulJade)}</b>
                    </div>
                    <div className="insp-kpi">
                      <span>神秘符咒</span>
                      <b>{fmtInt(ov.mysteryTalisman)}</b>
                    </div>
                    <div className="insp-kpi">
                      <span>现世符咒</span>
                      <b>{fmtInt(ov.realityTalisman)}</b>
                    </div>
                    <div className="insp-kpi">
                      <span>抽卡能力</span>
                      <b>{fmtInt(ov.summonPower)} 抽</b>
                    </div>
                    <div className="insp-kpi">
                      <span>御行达摩</span>
                      <b>{fmtInt(ov.yuxingDama)}</b>
                    </div>
                    <div className="insp-kpi">
                      <span>典藏皮肤</span>
                      <b>{fmtInt(ov.collectionSkinCount)}</b>
                    </div>
                  </div>
                  <div className="insp-chips">
                    <span className="insp-chip">
                      图鉴 SSR <b>{ov.dex.ssr.owned}/{ov.dex.ssr.total}</b>
                    </span>
                    <span className="insp-chip">
                      SP <b>{ov.dex.sp.owned}/{ov.dex.sp.total}</b>
                    </span>
                    <span className="insp-chip">
                      UR <b>{ov.dex.ur.owned}/{ov.dex.ur.total}</b>
                    </span>
                    <span className="insp-chip">
                      500天未收录 <b>{ov.dex.uncollected500Days}</b>
                    </span>
                    <span className="insp-chip">
                      999天未收录 <b>{ov.dex.uncollected999Days}</b>
                    </span>
                    <span className="insp-chip">
                      未收录券 <b>{ov.dex.uncollectedCoupon}</b>
                    </span>
                  </div>
                </section>

                <section className="soul-card">
                  <h3 className="insp-h3">御魂规模</h3>
                  <div className="insp-kpis">
                    <div className="insp-kpi">
                      <span>全部御魂</span>
                      <b>{fmtInt(report.relics.totalInBag)}</b>
                    </div>
                    <div className="insp-kpi">
                      <span>参与统计</span>
                      <b>{fmtInt(report.relics.counted)}</b>
                    </div>
                    <div className="insp-kpi">
                      <span>6 星满级</span>
                      <b>{fmtInt(report.relics.maxLevelCount)}</b>
                    </div>
                    {Object.entries(report.relics.byPosition).map(([pos, count]) => (
                      <div className="insp-kpi" key={pos}>
                        <span>{pos} 号位</span>
                        <b>{fmtInt(count)}</b>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="soul-card">
                  <h3 className="insp-h3">PVE 御魂评分</h3>
                  <p className="soul-p">套件总评分 = 有效词条数之和（攻击加成/暴击/暴伤，2、4 号位仅攻击加成、6 号位仅暴击或暴伤）。</p>
                  <div className="insp-grid2">
                    <div>
                      <div className="insp-sub">普通 PVE 套装</div>
                      <table className="insp-table">
                        <thead>
                          <tr>
                            <th>套装</th>
                            <th>件数</th>
                            <th>总评分</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pve?.normalSuits.map((row) => (
                            <tr key={row.suitName}>
                              <td>{row.suitName}</td>
                              <td>{row.relicCount}</td>
                              <td>{row.totalScore}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div>
                      <div className="insp-sub">逢魔御魂</div>
                      <table className="insp-table">
                        <thead>
                          <tr>
                            <th>套装</th>
                            <th>件数</th>
                            <th>总评分</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pve?.omaSuits.map((row) => (
                            <tr key={row.suitName}>
                              <td>{row.suitName}</td>
                              <td>{row.relicCount}</td>
                              <td>{row.totalScore}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>
              </>
            )}

            {tab === 'speed' && speed && (
              <>
                <section className="soul-card">
                  <h3 className="insp-h3">满速御魂</h3>
                  <div className="insp-kpis">
                    <div className="insp-kpi">
                      <span>满速总量</span>
                      <b>{fmtInt(speed.fullSpeedCount)}</b>
                    </div>
                    {Object.entries(speed.fullSpeedByPosition).map(([pos, count]) => (
                      <div className="insp-kpi" key={pos}>
                        <span>{pos} 号位</span>
                        <b>{fmtInt(count)}</b>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="soul-card">
                  <h3 className="insp-h3">散件一速 TOP5</h3>
                  {speed.scatterTop.map((row) => (
                    <div className="insp-row" key={row.rank}>
                      <div className="insp-row-head">
                        <span className="insp-rank">#{row.rank}</span>
                        <b>{fmt(row.value)}</b>
                      </div>
                      <CellTable cells={row.cells} />
                    </div>
                  ))}
                </section>

                <section className="soul-card">
                  <h3 className="insp-h3">常用 PVP 套件速度</h3>
                  {speed.suitTable.map((row) => (
                    <div className="insp-row" key={row.suit}>
                      <div className="insp-row-head">
                        <b>{row.suit}</b>
                        <span className="insp-rank">{fmt(row.value)}</span>
                      </div>
                      <CellTable cells={row.cells} />
                    </div>
                  ))}
                </section>

                <section className="soul-card">
                  <h3 className="insp-h3">满速御魂清单</h3>
                  <table className="insp-table">
                    <thead>
                      <tr>
                        <th>号位</th>
                        <th>套装</th>
                        <th>主属性</th>
                        <th>速度副属性</th>
                      </tr>
                    </thead>
                    <tbody>
                      {speed.fullSpeedRelics.map((relic, index) => (
                        <tr key={`${relic.position}-${relic.suitName}-${index}`}>
                          <td>{relic.position}</td>
                          <td>{relic.suitName}</td>
                          <td>{relic.mainAttribute.label}</td>
                          <td>{fmt(relic.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </>
            )}

            {tab === 'pve' && (
              <>
                <section className="soul-card">
                  <h3 className="insp-h3">PVE 御魂组合</h3>
                  <p className="soul-p">
                    固定比较土蜘蛛、荒骷髅、鬼灵歌伎三种逢魔套；仅用账号内六星 +15 御魂；以满级须佐之男面板计算，普通两件套与逢魔一件套均计入。
                    仅保留满暴方案，伤害指标 = 最终攻击 × 最终暴击伤害；不含技能、四件套效果与副本增益。
                  </p>
                  <div className="soul-input-row">
                    <button className="btn btn-primary" onClick={() => void runPve()} disabled={pveRunning}>
                      {pveRunning ? '计算中…' : '算 21 组最优组合'}
                    </button>
                    {pveResult && (
                      <button className="btn" onClick={() => void runPve(true)} disabled={pveRunning}>
                        重新计算
                      </button>
                    )}
                    {pveJob?.progress && <span className="dim">{pveJob.progress}</span>}
                  </div>
                  <p className="soul-p dim">
                    首次计算约 30 秒（8 进程并行），结果按账号缓存 24 小时，之后秒开。PVE 数字与站点逐组一致。
                  </p>
                  {pveResult && (
                    <>
                      <div className="insp-chips">
                        <span className="insp-chip">
                          总平均值 <b>{fmtInt(pveResult.average ? Math.round(pveResult.average) : 0)}</b>
                        </span>
                        <span className="insp-chip">
                          已算出 <b>{pveResult.rows.length}</b> 组
                        </span>
                      </div>
                      <table className="insp-table">
                        <thead>
                          <tr>
                            <th>四件套</th>
                            <th>逢魔</th>
                            <th>伤害</th>
                            <th>面板</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pveResult.rows.map((row) => (
                            <tr key={`${row.suit}-${row.omaSuit}`}>
                              <td>{row.suit}</td>
                              <td>{row.omaSuit}</td>
                              <td>
                                <b>{fmt(row.damage)}</b>
                              </td>
                              <td className="dim">
                                攻 {fmtInt(row.panel.attack)} · 暴 {fmt(row.panel.critRate, 1)}% · 爆 {fmt(row.panel.critDamage, 1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </section>

                <section className="soul-card">
                  <h3 className="insp-h3">高评分御魂数量</h3>
                  <p className="soul-p">仅统计满级六星；有效词条 ≥5 才展示，按号位分组统计。</p>
                  <table className="insp-table">
                    <thead>
                      <tr>
                        <th>号位</th>
                        <th>高评分件数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(pve?.highScoreByPosition ?? {}).map(([pos, list]) => (
                        <tr key={pos}>
                          <td>{pos} 号位</td>
                          <td>{list.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </>
            )}

            {tab === 'hero' && heroSkills && (
              <>
                <section className="soul-card">
                  <div className="insp-chips">
                    <span className="insp-chip">
                      御行达摩 <b>{heroSkills.yuxingDama}</b>
                    </span>
                    <span className="insp-chip">
                      未达标 <b>{heroSkills.counts.deficient}</b>
                    </span>
                    <span className="insp-chip">
                      多号机 <b>{heroSkills.counts.duplicates}</b>
                    </span>
                    <span className="insp-chip">
                      联动 <b>{heroSkills.counts.collaboration}</b>
                    </span>
                    {Object.entries(heroSkills.counts.groups).map(([rarity, count]) => (
                      <span className="insp-chip" key={rarity}>
                        {rarity} <b>{count}</b>
                      </span>
                    ))}
                  </div>
                </section>

                <section className="soul-card">
                  <h3 className="insp-h3">技能未达标（{heroSkills.deficient.length} 组）</h3>
                  <table className="insp-table">
                    <thead>
                      <tr>
                        <th>式神</th>
                        <th>等级</th>
                        <th>技能</th>
                      </tr>
                    </thead>
                    <tbody>
                      {heroSkills.deficient.map((hero) => (
                        <tr key={hero.instanceId}>
                          <td>{hero.name}</td>
                          <td>{hero.level}</td>
                          <td>{hero.skillLevels.join('')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                <section className="soul-card">
                  <h3 className="insp-h3">存在多号机的式神（{heroSkills.counts.duplicates} 只）</h3>
                  <table className="insp-table">
                    <thead>
                      <tr>
                        <th>式神</th>
                        <th>等级</th>
                        <th>技能</th>
                      </tr>
                    </thead>
                    <tbody>
                      {heroSkills.duplicates.map((hero) => (
                        <tr key={hero.instanceId}>
                          <td>{hero.name}</td>
                          <td>{hero.level}</td>
                          <td>{hero.skillLevels.join('')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                <section className="soul-card">
                  <h3 className="insp-h3">联动式神（{heroSkills.counts.collaboration} 只）</h3>
                  <table className="insp-table">
                    <thead>
                      <tr>
                        <th>式神</th>
                        <th>等级</th>
                        <th>技能</th>
                      </tr>
                    </thead>
                    <tbody>
                      {heroSkills.collaboration.map((hero) => (
                        <tr key={hero.instanceId}>
                          <td>{hero.name}</td>
                          <td>{hero.level}</td>
                          <td>{hero.skillLevels.join('')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                <section className="soul-card">
                  <h3 className="insp-h3">全部式神技能</h3>
                  <div className="soul-input-row">
                    <input
                      className="soul-input"
                      placeholder="搜索式神名"
                      value={heroQuery}
                      onChange={(e) => setHeroQuery(e.target.value)}
                      spellCheck={false}
                    />
                    <select className="insp-select" value={heroRarity} onChange={(e) => setHeroRarity(e.target.value)}>
                      <option value="">全部稀有度</option>
                      {heroSkills.groups.map((group) => (
                        <option key={group.rarity} value={group.rarity}>
                          {group.rarity}
                        </option>
                      ))}
                    </select>
                  </div>
                  {heroGroups.map((group) => (
                    <div key={group.rarity}>
                      <div className="insp-sub">{group.rarity}</div>
                      <table className="insp-table">
                        <thead>
                          <tr>
                            <th>式神</th>
                            <th>等级</th>
                            <th>技能</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.heroes.map((hero) => (
                            <tr key={hero.instanceId}>
                              <td>{hero.name}</td>
                              <td>{hero.level}</td>
                              <td>{hero.skillLevels.join('')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </section>
              </>
            )}

            {tab === 'relics' && (
              <section className="soul-card">
                <h3 className="insp-h3">御魂库存</h3>
                <div className="soul-input-row">
                  <select className="insp-select" value={relicPosition} onChange={(e) => setRelicPosition(e.target.value)}>
                    <option value="">全部号位</option>
                    {['1', '2', '3', '4', '5', '6'].map((pos) => (
                      <option key={pos} value={pos}>
                        {pos} 号位
                      </option>
                    ))}
                  </select>
                  <input
                    className="soul-input"
                    placeholder="套装名（多个用逗号，如 狂骨,破势）"
                    value={relicSuits}
                    onChange={(e) => setRelicSuits(e.target.value)}
                    spellCheck={false}
                  />
                  <input
                    className="soul-input"
                    placeholder="主属性（如 攻击加成）"
                    value={relicMain}
                    onChange={(e) => setRelicMain(e.target.value)}
                    spellCheck={false}
                  />
                  <button className="btn btn-primary" onClick={() => void reloadRelics()}>
                    筛选
                  </button>
                </div>
                {relics && (
                  <>
                    <div className="insp-chips">
                      <span className="insp-chip">
                        命中 <b>{fmtInt(relics.matched)}</b> / {fmtInt(relics.total)}
                      </span>
                    </div>
                    <table className="insp-table">
                      <thead>
                        <tr>
                          <th>号位</th>
                          <th>套装</th>
                          <th>主属性</th>
                          <th>副属性</th>
                        </tr>
                      </thead>
                      <tbody>
                        {relics.items.map((relic) => (
                          <tr key={relic.relicId}>
                            <td>{relic.position}</td>
                            <td>{relic.suitName}</td>
                            <td>
                              {relic.mainAttribute.label} {fmt(relic.mainAttribute.value, 0)}
                              {relic.mainAttribute.isPercent ? '%' : ''}
                            </td>
                            <td className="dim">
                              {relic.subAttributes
                                .map((sub) => `${sub.label}+${fmt(sub.total)}×${sub.count}`)
                                .join(' · ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </section>
            )}

            {tab === 'calc' && (
              <section className="soul-card">
                <h3 className="insp-h3">御魂计算器</h3>
                <p className="soul-p">
                  从账号内六星 +15 御魂里为指定式神搜最优六件。极速模式用局部搜索（约 0.5 秒），精确模式用分支限界（较慢，结果更优）。
                </p>
                <div className="soul-input-row">
                  <select className="insp-select" value={calcHero} onChange={(e) => setCalcHero(e.target.value)}>
                    {(meta?.heroes ?? [{ name: '须佐之男' } as { name: string }]).map((hero) => (
                      <option key={hero.name} value={hero.name}>
                        {hero.name}
                      </option>
                    ))}
                  </select>
                  <select className="insp-select" value={calcMetric} onChange={(e) => setCalcMetric(e.target.value)}>
                    {(meta?.metrics ?? ['damage']).map((metric) => (
                      <option key={metric} value={metric}>
                        {METRIC_LABELS[metric] ?? metric}
                      </option>
                    ))}
                  </select>
                  <select className="insp-select" value={calcPreset} onChange={(e) => setCalcPreset(e.target.value)}>
                    <option value="attack">攻攻爆</option>
                    <option value="health">生生爆</option>
                    <option value="speed">纯速度</option>
                  </select>
                  <label className="insp-check">
                    <input type="checkbox" checked={calcFullCrit} onChange={(e) => setCalcFullCrit(e.target.checked)} />
                    满暴
                  </label>
                  <label className="insp-check">
                    <input type="checkbox" checked={calcFast} onChange={(e) => setCalcFast(e.target.checked)} />
                    极速模式
                  </label>
                  <select className="insp-select" value={calcLimit} onChange={(e) => setCalcLimit(Number(e.target.value))}>
                    {[1, 3, 5, 10].map((n) => (
                      <option key={n} value={n}>
                        取 {n} 条
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-primary" onClick={() => void runCalc()} disabled={calcRunning}>
                    {calcRunning ? '计算中…' : '开始计算'}
                  </button>
                </div>
                {calcJob?.progress && <div className="dim">{calcJob.progress}</div>}
                {calcResult && (
                  <>
                    <div className="insp-sub">
                      {calcResult.hero} · {METRIC_LABELS[calcResult.metric] ?? calcResult.metric} ·{' '}
                      {calcResult.fastMode ? '极速模式' : '精确模式'}
                    </div>
                    <table className="insp-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>评分</th>
                          <th>面板</th>
                          <th>套装</th>
                          <th>御魂</th>
                        </tr>
                      </thead>
                      <tbody>
                        {calcResult.rows.map((row, index) => (
                          <tr key={index}>
                            <td>{index + 1}</td>
                            <td>
                              <b>{fmt(row.score)}</b>
                            </td>
                            <td className="dim">
                              攻 {fmtInt(row.panel.attack)} · 暴 {fmt(row.panel.critRate, 1)}% · 爆 {fmt(row.panel.critDamage, 1)}%
                            </td>
                            <td>{row.suits.join(' / ')}</td>
                            <td className="dim">
                              {row.relics
                                .map((r) => `${r.position}号${r.suitName ?? ''}(${r.mainAttribute?.label ?? ''})`)
                                .join(' · ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
};
