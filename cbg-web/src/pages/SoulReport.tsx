import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App } from 'antd';
import { ModuleTabs } from '@/components/ModuleTabs';
import { useTheme } from '@/hooks/useTheme';
import { EChart } from '@/components/charts/EChart';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_HEIGHT,
  axisLabelStyle,
  baseGrid,
  emptyOption,
  tooltipBase,
  useChartTheme,
  valueAxis,
} from '@/components/charts/theme';
import {
  soulApi,
  type PreciseMetrics,
  type SoulMeta,
  type SoulReport as SoulReportData,
  type SoulSearchRow,
  type SpeedRow,
} from '@/api/soul';

/**
 * 模块三：御魂报告（照妖镜式分析）。
 *
 * 数据从 CBG 链接/上传的 yyx 文件来，计算全部由伴随服务背后的 Python 内核完成：
 *   ① 概览：御魂数 / 六星 / score、zscore 分布
 *   ② 一速：散件一~五速、命中/抵抗一速、14 个套装一速
 *   ③ 精确指标：头/尾/17 速（从 CBG 原始御魂档案算，yyx 会把同类副属性合并）
 *   ④ 组合搜索：指定式神/指标/面板限制/套装，找最优 6 件
 */

const SPEED_TABS = [
  { key: 'loose', label: '散件一速' },
  { key: 'hit', label: '命中一速' },
  { key: 'resist', label: '抵抗一速' },
  { key: 'suits', label: '套装一速' },
] as const;
type SpeedTab = (typeof SPEED_TABS)[number]['key'];

const fmt = (n: number | null | undefined, d = 2) =>
  n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(d);
const fmtInt = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('zh-CN');

/** 从链接/订单号里解析（服务端也会再解析一次，这里只是为了提前校验与提示） */
function parseCbgInput(raw: string): { ordersn?: string; serverid?: string; cbgUrl?: string } {
  const s = raw.trim();
  if (!s) return {};
  const m = s.match(/\/equip\/(\d+)\/([0-9]{8,}-[0-9]+-[0-9A-Za-z]+)/);
  if (m) return { serverid: m[1], ordersn: m[2], cbgUrl: s };
  if (/^[0-9]{8,}-[0-9]+-[0-9A-Za-z]+$/.test(s)) return { ordersn: s, serverid: s.split('-')[1] };
  return {};
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SpeedTable = ({ rows, tab }: { rows: SpeedRow[]; tab: SpeedTab }) => {
  if (!rows.length) return <div className="soul-empty">暂无数据</div>;
  return (
    <table className="soul-table">
      <thead>
        <tr>
          <th style={{ width: 44 }}>#</th>
          <th>指标</th>
          <th className="num">速度</th>
          {tab !== 'suits' ? <th>御魂组合</th> : <th>套装</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.kind}-${i}`}>
            <td className="dim">{i + 1}</td>
            <td>{r.kind}</td>
            <td className="num strong">{fmt(r.value, 3)}</td>
            <td className="dim">{r.suits.join(' / ') || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export const SoulReport = () => {
  const { message } = App.useApp();
  const { theme, toggle } = useTheme();
  const t = useChartTheme();

  const [meta, setMeta] = useState<SoulMeta | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SoulReportData | null>(null);
  const [speedTab, setSpeedTab] = useState<SpeedTab>('loose');

  const [precise, setPrecise] = useState<PreciseMetrics | null>(null);
  const [preciseLoading, setPreciseLoading] = useState(false);

  const [searchHero, setSearchHero] = useState('天照');
  const [searchTarget, setSearchTarget] = useState('Speed');
  const [minCrit, setMinCrit] = useState<string>('');
  const [minSpeed, setMinSpeed] = useState<string>('');
  const [suitName, setSuitName] = useState('');
  const [suitCount, setSuitCount] = useState('4');
  const [searchRows, setSearchRows] = useState<SoulSearchRow[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchStatus, setSearchStatus] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement | null>(null);

  /**
   * 内核可能比页面晚就绪（启动时 Python 要 ~1 秒），所以 meta 加载要可重试：
   * 首次加载失败不报错，等用户真正操作（分析/演示/搜索）时再补一次。
   */
  const loadMeta = useCallback(async () => {
    try {
      const m = await soulApi.meta();
      setMeta(m);
      if (m.targets.length && !m.targets.some((x) => x.key === 'Speed')) {
        setSearchTarget(m.targets[0].key);
      }
    } catch {
      /* 内核未就绪时静默：页面其余功能仍可用（上传/演示） */
    }
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const applyReport = useCallback((d: SoulReportData) => {
    setReport(d);
    setPrecise(null);
    setSearchRows(null);
    setSearchStatus(null);
    setError(null);
    if (d.speeds.loose.length) setSpeedTab('loose');
  }, []);

  const run = useCallback(async () => {
    if (!meta) void loadMeta();
    const p = parseCbgInput(input);
    if (!p.ordersn && !p.cbgUrl) {
      message.warning('请输入藏宝阁链接或订单号（形如 202606282101616-16-XXXX）');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const d = await soulApi.report({ ...p, refresh: false });
      applyReport(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [applyReport, input, loadMeta, message, meta]);

  const runDemo = useCallback(async () => {
    if (!meta) void loadMeta();
    setLoading(true);
    setError(null);
    try {
      applyReport(await soulApi.demo());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [applyReport, loadMeta, meta]);

  const onPickFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setLoading(true);
      setError(null);
      try {
        applyReport(await soulApi.upload(file));
        message.success('文件解析完成');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    },
    [applyReport, message],
  );

  const loadPrecise = useCallback(async () => {
    if (!report?.ordersn) {
      message.warning('上传的数据没有订单号，无法拉取 CBG 御魂档案');
      return;
    }
    setPreciseLoading(true);
    try {
      setPrecise(await soulApi.precise(report.ordersn, true));
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPreciseLoading(false);
    }
  }, [message, report?.ordersn]);

  const runSearch = useCallback(async () => {
    if (!report) return;
    if (!report.ordersn && !report.upload_key) {
      message.warning('请先分析或上传一份数据');
      return;
    }
    if (!meta) void loadMeta();
    setSearchLoading(true);
    setSearchRows(null);
    setSearchStatus('提交搜索…');
    try {
      const payload = {
        ordersn: report.ordersn || undefined,
        upload_key: report.upload_key || undefined,
        hero: searchHero,
        target: searchTarget,
        min_crit_rate: minCrit ? Number(minCrit) : null,
        min_speed: minSpeed ? Number(minSpeed) : null,
        suit_name: suitName || null,
        suit_count: suitCount ? Number(suitCount) : null,
        top: 5,
      };
      const { job_id } = await soulApi.search(payload);
      for (let i = 0; i < 120; i += 1) {
        await sleep(500);
        const job = await soulApi.job(job_id);
        if (job.status === 'done') {
          setSearchRows(job.result ?? []);
          setSearchStatus(`完成 · ${job.elapsed_ms ?? 0} ms`);
          return;
        }
        if (job.status === 'error') throw new Error(job.error || '搜索失败');
        setSearchStatus(`搜索中…（${job.status}）`);
      }
      throw new Error('搜索超时');
    } catch (e) {
      setSearchStatus(`失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSearchLoading(false);
    }
  }, [loadMeta, message, meta, minCrit, minSpeed, report, searchHero, searchTarget, suitCount, suitName]);

  /** score 分布柱状图 */
  const scoreOption = useMemo<EChartsCoreOption>(() => {
    const hist = report?.overview.score.hist ?? {};
    const keys = Object.keys(hist)
      .filter((k) => Number(k) >= 0)
      .sort((a, b) => Number(a) - Number(b));
    if (!keys.length) return emptyOption(t);
    return {
      grid: baseGrid({ top: 24, bottom: 30, left: 40, right: 12 }),
      tooltip: tooltipBase(t),
      xAxis: {
        type: 'category',
        data: keys.map((k) => `${k} 分`),
        axisLabel: axisLabelStyle(t),
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
      },
      yAxis: valueAxis(t),
      series: [
        {
          type: 'bar',
          data: keys.map((k) => hist[k]),
          barMaxWidth: 24,
          itemStyle: { color: t.accent, borderRadius: [3, 3, 0, 0] },
        },
      ],
    };
  }, [report, t]);

  const ov = report?.overview;
  const speedRows = report ? report.speeds[speedTab] : [];
  const sourceText =
    report?.meta?.source === 'upload'
      ? '本地上传'
      : report?.meta?.source === 'fetch-by-url'
        ? '照妖镜抓取'
        : report?.meta?.source
          ? 'CBG 直连'
          : '—';

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="head-in">
          <h1>藏宝阁数据面板</h1>
          <span className="pill-tag">阴阳师 · 御魂</span>
          <ModuleTabs />
          <span className="head-meta">模块三：粘贴链接或上传 yyx，本地算御魂报告（不依赖站点前台）</span>
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
          <h2 className="soul-h2">御魂报告</h2>
          <p className="soul-p">
            粘一个藏宝阁账号地址（或订单号），或直接上传痒痒熊/官方导出的 yyx 文件。
            报告包含御魂概览、一速、score 分布、精确头尾与组合搜索。
          </p>
          <div className="soul-input-row">
            <input
              className="soul-input"
              placeholder="粘藏宝阁链接（https://yys.cbg.163.com/cgi/mweb/equip/16/…）或订单号"
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
            <button className="btn btn-ghost" onClick={() => void runDemo()} disabled={loading}>
              演示数据
            </button>
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={loading}>
              上传 yyx
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.txt"
              style={{ display: 'none' }}
              onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {loading && <div className="soul-alert info">正在抓取/解析，首次约 5~15 秒…</div>}
          {error && <div className="soul-alert err">{error}</div>}
        </section>

        {report && ov && (
          <>
            <section className="soul-card">
              <div className="soul-summary">
                <div className="soul-who">
                  <b>{ov.player?.name || '未知角色'}</b>
                  {ov.player?.level ? <span className="dim">Lv.{ov.player.level}</span> : null}
                  {report.ordersn ? <code className="soul-code">{report.ordersn}</code> : null}
                </div>
                <div className="soul-tags">
                  <span className={`soul-tag${report.cached ? ' gold' : ''}`}>{report.cached ? '缓存命中' : '实时结果'}</span>
                  <span className="soul-tag">{sourceText}</span>
                  <span className="soul-tag">计算 {fmtInt(report.elapsed_ms)} ms</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => void run()}
                    disabled={loading || !report.ordersn}
                    title={report.ordersn ? '强制重新抓取' : '上传数据不支持刷新'}
                  >
                    刷新
                  </button>
                </div>
              </div>

              <div className="soul-kpis">
                {[
                  ['御魂总数', fmtInt(ov.souls_total), '件'],
                  ['六星御魂', fmtInt(ov.souls_six_star), '件'],
                  ['散件一速', fmt(report.speeds.loose[0]?.value, 3), ''],
                  ['score 均值', fmt(ov.score.avg, 2), ''],
                  ['zscore 均值', fmt(ov.zscore.avg, 2), ''],
                  ['score ≥ 6', fmtInt(ov.score.ge6), '件'],
                ].map(([k, v, u]) => (
                  <div className="soul-kpi" key={k}>
                    <div className="soul-kpi-k">{k}</div>
                    <div className="soul-kpi-v">
                      {v}
                      {u ? <small>{u}</small> : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="soul-card">
              <h2 className="soul-h2">一速（散件 / 命中 / 抵抗 / 套装）</h2>
              <div className="soul-tabs">
                {SPEED_TABS.map((x) => (
                  <button
                    key={x.key}
                    className={`soul-tab${speedTab === x.key ? ' on' : ''}`}
                    onClick={() => setSpeedTab(x.key)}
                  >
                    {x.label}
                  </button>
                ))}
              </div>
              <div className="soul-table-wrap">
                <SpeedTable rows={speedRows} tab={speedTab} />
              </div>
            </section>

            <div className="soul-grid2">
              <section className="soul-card">
                <h2 className="soul-h2">score 分布</h2>
                <EChart option={scoreOption} height={CHART_HEIGHT} />
                <p className="soul-note">
                  score 为「有效属性成长次数」（普通 0~9 / 首领 0~12，-1 表示未评定），由第三方服务端给出，本页只展示不重算。
                </p>
              </section>

              <section className="soul-card">
                <h2 className="soul-h2">各位置御魂数</h2>
                <div className="soul-pos">
                  {['一', '二', '三', '四', '五', '六'].map((name, i) => {
                    const n = ov.position_counts[String(i + 1)] ?? 0;
                    const max = Math.max(
                      ...Object.values(ov.position_counts).map((x) => Number(x)),
                      1,
                    );
                    return (
                      <div className="soul-pos-row" key={name}>
                        <span className="soul-pos-k">{name}号位</span>
                        <span className="soul-pos-track">
                          <i style={{ width: `${(Number(n) / max) * 100}%` }} />
                        </span>
                        <span className="soul-pos-v">{fmtInt(n)}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="soul-note">共 {fmtInt(ov.souls_total)} 件御魂；六星 {fmtInt(ov.souls_six_star)} 件。</p>
              </section>
            </div>

            <section className="soul-card">
              <h2 className="soul-h2">TOP 御魂（按速度）</h2>
              <div className="soul-table-wrap">
                <table className="soul-table">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>#</th>
                      <th>套装</th>
                      <th className="num">位置</th>
                      <th>主属性</th>
                      <th className="num">总速度</th>
                      <th className="num">score</th>
                      <th className="num">zscore</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.top_souls.map((s, i) => (
                      <tr key={`${s.kind}-${s.pos}-${i}`}>
                        <td className="dim">{i + 1}</td>
                        <td>{s.kind}</td>
                        <td className="num">{s.pos}</td>
                        <td className="dim">{s.main}</td>
                        <td className="num strong">{fmt(s.speed, 3)}</td>
                        <td className="num">{s.score ?? '—'}</td>
                        <td className="num">{s.zscore ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="soul-card">
              <div className="soul-card-head">
                <h2 className="soul-h2">精确指标（头 / 尾 / 17 速）</h2>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => void loadPrecise()}
                  disabled={preciseLoading || !report.ordersn}
                  title={report.ordersn ? '从 CBG 原始御魂档案计算（逐条副属性）' : '上传数据没有订单号'}
                >
                  {preciseLoading ? '计算中…' : '精确计算'}
                </button>
              </div>
              {precise ? (
                <>
                  <div className="soul-kpis">
                    {[
                      ['头（满速二号位）', fmtInt(precise.head.count), '个'],
                      ['头速度', fmt(precise.head.topSpeed, 3), ''],
                      ['尾（满速四号位命中）', fmtInt(precise.hitTail.count), '个'],
                      ['脚（满速四号位抵抗）', fmtInt(precise.resistTail.count), '个'],
                      ['满速御魂', fmtInt(precise.maxSpeedCount), '件'],
                      ['17 速御魂', fmtInt(precise.zhen17Count), '件'],
                    ].map(([k, v, u]) => (
                      <div className="soul-kpi" key={k}>
                        <div className="soul-kpi-k">{k}</div>
                        <div className="soul-kpi-v">
                          {v}
                          {u ? <small>{u}</small> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="soul-note">
                    散件一~五速（精确）：{['scatter1', 'scatter2', 'scatter3', 'scatter4', 'scatter5']
                      .map((k) => fmt(precise.speeds[k as keyof PreciseMetrics['speeds']], 3))
                      .join(' / ')}
                  </p>
                  <p className="soul-note">
                    头明细：{precise.head.details.map((d) => `${d.name} ${fmt(d.speed, 3)}`).join('、') || '—'}
                  </p>
                  <p className="soul-note">
                    17 速明细：{precise.zhen17Details.map((d) => `${d.set} ${d.speed}`).join('、') || '—'}
                  </p>
                </>
              ) : (
                <p className="soul-note">
                  yyx 会把同类副属性合并成一条，判定不了「头/尾」；点上面的按钮从 CBG 公开御魂档案逐条计算。
                </p>
              )}
            </section>

            <section className="soul-card">
              <h2 className="soul-h2">组合搜索</h2>
              <p className="soul-p">按式神 / 指标 / 面板限制 / 套装找最优 6 件组合（计算在内核，异步任务）。</p>
              <div className="soul-form">
                <label>
                  式神
                  <select value={searchHero} onChange={(e) => setSearchHero(e.target.value)}>
                    {(meta?.heroes ?? [searchHero]).map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  指标
                  <select value={searchTarget} onChange={(e) => setSearchTarget(e.target.value)}>
                    {(meta?.targets ?? [{ key: 'Speed', name: '速度' }]).map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  暴击率 ≥（%）
                  <input value={minCrit} onChange={(e) => setMinCrit(e.target.value)} placeholder="如 100" inputMode="numeric" />
                </label>
                <label>
                  速度 ≥
                  <input value={minSpeed} onChange={(e) => setMinSpeed(e.target.value)} placeholder="如 160" inputMode="numeric" />
                </label>
                <label>
                  套装
                  <select value={suitName} onChange={(e) => setSuitName(e.target.value)}>
                    <option value="">不限</option>
                    {(meta?.suits ?? []).map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name}（{s.type}）
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  件数
                  <select value={suitCount} onChange={(e) => setSuitCount(e.target.value)}>
                    <option value="4">4 件套</option>
                    <option value="2">2 件套</option>
                  </select>
                </label>
                <button className="btn btn-primary" onClick={() => void runSearch()} disabled={searchLoading}>
                  {searchLoading ? '搜索中…' : '搜索'}
                </button>
              </div>
              {searchStatus && <div className="soul-note">{searchStatus}</div>}
              {searchRows && (
                <div className="soul-table-wrap">
                  {searchRows.length === 0 ? (
                    <div className="soul-empty">没有满足条件的组合（试试放宽限制）</div>
                  ) : (
                    <table className="soul-table">
                      <thead>
                        <tr>
                          <th style={{ width: 44 }}>#</th>
                          <th className="num">数值</th>
                          <th>套装组合</th>
                          <th>御魂</th>
                        </tr>
                      </thead>
                      <tbody>
                        {searchRows.map((r, i) => (
                          <tr key={i}>
                            <td className="dim">{i + 1}</td>
                            <td className="num strong">{fmt(r.value, 2)}</td>
                            <td>{r.suits.join(' / ')}</td>
                            <td className="dim">{r.equips.map((e) => `${e.kind}(${e.pos})`).join('、')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
};
