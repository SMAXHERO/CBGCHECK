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
} from '@/api/inspector';
import { TABS, type TabKey } from './inspector/constants';
import { fmt, fmtInt, parseCbgInput, pollJob } from './inspector/helpers';
import { OverviewTab } from './inspector/OverviewTab';
import { SpeedTab } from './inspector/SpeedTab';
import { PveTab, type PveResult } from './inspector/PveTab';
import { HeroTab } from './inspector/HeroTab';
import { RelicsTab } from './inspector/RelicsTab';
import { CalcTab } from './inspector/CalcTab';

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
 *
 * 页面壳：所有 state / effect / 请求函数保留在此；六个标签页的 JSX 已迁至 ./inspector/ 下的视图组件，
 * 本文件只负责按 tab 渲染对应视图并下传 props。拆分映射见 .pipeline/evidence/refactor-map.md。
 */

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
  const [pveResult, setPveResult] = useState<PveResult | null>(null);

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

            {tab === 'overview' && <OverviewTab report={report} ov={ov} pve={pve} />}

            {tab === 'speed' && speed && <SpeedTab speed={speed} />}

            {tab === 'pve' && (
              <PveTab
                pve={pve}
                pveJob={pveJob}
                pveRunning={pveRunning}
                pveResult={pveResult}
                onRun={(refresh) => void runPve(refresh)}
              />
            )}

            {tab === 'hero' && heroSkills && (
              <HeroTab
                heroSkills={heroSkills}
                heroGroups={heroGroups}
                heroQuery={heroQuery}
                heroRarity={heroRarity}
                setHeroQuery={setHeroQuery}
                setHeroRarity={setHeroRarity}
              />
            )}

            {tab === 'relics' && (
              <RelicsTab
                relics={relics}
                relicPosition={relicPosition}
                relicSuits={relicSuits}
                relicMain={relicMain}
                setRelicPosition={setRelicPosition}
                setRelicSuits={setRelicSuits}
                setRelicMain={setRelicMain}
                onFilter={() => void reloadRelics()}
              />
            )}

            {tab === 'calc' && (
              <CalcTab
                meta={meta}
                calcHero={calcHero}
                calcMetric={calcMetric}
                calcPreset={calcPreset}
                calcFullCrit={calcFullCrit}
                calcFast={calcFast}
                calcLimit={calcLimit}
                setCalcHero={setCalcHero}
                setCalcMetric={setCalcMetric}
                setCalcPreset={setCalcPreset}
                setCalcFullCrit={setCalcFullCrit}
                setCalcFast={setCalcFast}
                setCalcLimit={setCalcLimit}
                calcJob={calcJob}
                calcRunning={calcRunning}
                calcResult={calcResult}
                onRun={() => void runCalc()}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};
