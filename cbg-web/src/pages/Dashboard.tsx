import { useEffect, useMemo, useRef, useState } from 'react';
import type { SearchParams } from '@/api/searchSchema';
import { SCRAPER_BASE } from '@/api/live';
import { CompareDrawer } from '@/components/CompareDrawer';
import { DashboardLayout } from '@/components/DashboardLayout';
import { DataTable } from '@/components/DataTable';
import { FilterPanel } from '@/components/FilterPanel';
import { KpiCards } from '@/components/KpiCards';
import { PrintView } from '@/components/PrintView';
import { PlatformPieChart } from '@/components/charts/PlatformPieChart';
import { PriceHistogramChart } from '@/components/charts/PriceHistogramChart';
import { PriceSignScatterChart } from '@/components/charts/PriceSignScatterChart';
import { SpeedTierChart } from '@/components/charts/SpeedTierChart';
import { useLiveDataset } from '@/hooks/useLiveDataset';
import { useRenderCount } from '@/hooks/useRenderCount';
import { useSearchConfig } from '@/hooks/useSearchConfig';
import { useAppStore } from '@/store/useAppStore';
import { listingExportColumns } from '@/utils/columns';
import { exportCsv, exportExcel, printArea } from '@/utils/export';
import { buildParams } from '@/utils/params';
import { resolveDefaults } from '@/config/defaults';

/**
 * 实时模式面板。
 *
 * 数据只有一个来源：本机伴随服务 -> 真实登录浏览器 -> 藏宝阁。
 * 没有快照兜底——服务不可用或未登录时只给指引，不显示任何旧数据。
 *
 * 交互约定：条件改动**不会**自动重查（站点有风控，频繁请求会被限流），
 * 条件是攒着的，点「查询」才发出去。因此底栏在条件变更后会提示「条件已改」。
 */

export const Dashboard = ({ active = true }: { active?: boolean }) => {
  useRenderCount('Dashboard');
  const config = useSearchConfig();
  const live = useLiveDataset();

  const conditions = useAppStore((s) => s.conditions);
  const resetToken = useAppStore((s) => s.resetToken);
  const setParams = useAppStore((s) => s.setParams);

  const [selected, setSelected] = useState<Map<string, unknown>>(new Map());
  const [query, setQuery] = useState('');
  const [compact, setCompact] = useState(false);
  const [lastQueried, setLastQueried] = useState<string | null>(null);
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  const [conditionPanelKey, setConditionPanelKey] = useState(0);

  /**
   * 默认条件：schema 一到就套用一次。
   *
   * 用户的改动会被记住（localStorage）：下次打开时优先用用户的选择，
   * 而不是每次都被默认值覆盖。想恢复默认就点底栏「恢复默认条件」。
   */
  useEffect(() => {
    if (!config.schema || defaultsApplied) return;
    let restored: Map<string, unknown> | null = null;
    try {
      const raw = localStorage.getItem('cbg-default-conditions');
      if (raw !== null) {
        // 空字符串是「用户清空过默认条件」的哨兵值，不能当成没存过
        restored = raw === '' ? new Map() : new Map(JSON.parse(raw) as [string, unknown][]);
      }
    } catch {
      restored = null;
    }
    if (restored) {
      setSelected(restored);
    } else {
      const resolved = resolveDefaults(config.schema);
      setSelected(resolved.selected);
      try {
        localStorage.setItem(
          'cbg-default-conditions',
          JSON.stringify([...resolved.selected.entries()]),
        );
      } catch {
        /* 隐私模式忽略 */
      }
    }
    setDefaultsApplied(true);
  }, [config.schema, defaultsApplied]);

  // 记住用户对条件的改动
  useEffect(() => {
    if (!defaultsApplied) return;
    try {
      localStorage.setItem(
        'cbg-default-conditions',
        selected.size ? JSON.stringify([...selected.entries()]) : '',
      );
    } catch {
      /* 忽略 */
    }
  }, [selected, defaultsApplied]);

  /** 恢复内置默认条件（底栏按钮） */
  const restoreDefaults = () => {
    if (!config.schema) return;
    const resolved = resolveDefaults(config.schema);
    setSelected(resolved.selected);
    setConditionPanelKey((k) => k + 1); // 让面板重挂载，展开态也回到初始
  };

  // 底栏「清空」：清掉当前条件，但**不抹掉默认条件**——
  // 下次打开仍然从默认条件开始（用户要的是「默认就有这几条」）
  useEffect(() => {
    if (resetToken > 0) setSelected(new Map());
  }, [resetToken]);

  // 底栏「清空」：递增 resetToken 触发重置
  useEffect(() => {
    if (resetToken > 0) setSelected(new Map());
  }, [resetToken]);

  /** 条件 -> 藏宝阁接口参数（与本地工具同一套口径） */
  const built = useMemo(() => {
    if (!config.schema) return { params: {} as SearchParams, labels: [] };
    return buildParams(config.schema, selected, (id) => config.serverIndex.name(id));
  }, [config.schema, config.serverIndex, selected]);

  /**
   * 指纹比较：只有条件「内容」真的变了才写 store。
   *
   * 为什么不能只靠依赖数组：`built` 依赖 serverIndex / schema，只要上游有一个
   * 非稳定引用（比如每次渲染新建的对象），这个 effect 就会每次渲染都触发；
   * 写 store → 组件重渲染 → 再写 store，直接变成无限循环
   * （实测报 Maximum update depth exceeded，整页被卸载）。
   * 用内容指纹兜底，无论上游引用稳不稳定都不会自激。
   */
  const paramsFingerprint = useMemo(
    () =>
      Object.keys(built.params)
        .filter((k) => k !== 'search_type')
        .sort()
        .map((k) => `${k}=${built.params[k]}`)
        .join('&'),
    [built.params],
  );
  const lastFingerprint = useRef<string | null>(null);

  useEffect(() => {
    if (lastFingerprint.current === paramsFingerprint) return;
    lastFingerprint.current = paramsFingerprint;
    setParams(built.params, built.labels);
  }, [built, paramsFingerprint, setParams]);

  // 服务就绪后自动跑一次，省得进来是一片空白。
  //
  // 这里刻意**不把 built.params 写进依赖**：它是每次渲染新建的对象，
  // 而 query() 内部会 setState 触发重渲染 —— 两者一挂上就是无限循环
  // （实测会直接报 Maximum update depth exceeded）。用 ref 取一次性快照。
  const autoQueried = useRef(false);
  const paramsRef = useRef(built.params);
  paramsRef.current = built.params;
  const dirtyRef = useRef<() => void>(() => {});
  useEffect(() => {
    // 模块切换后页面保持挂载：只有当前处于模块一（active）时才允许自动查首屏，
    // 避免停留在模块二时后台偷偷打一轮藏宝阁接口。
    if (!active) return;
    if (autoQueried.current) return;
    // 必须等默认条件套用完成再查，否则首次查询会漏掉默认条件
    if (live.status !== 'ready' || !config.schema || !defaultsApplied) return;
    autoQueried.current = true;
    const first = paramsRef.current;
    void live.query(first).then(() => dirtyRef.current());
    // 只在「模块一可见 + 服务就绪 + schema 载入 + 默认条件套用」后触发一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, live.status, config.schema, defaultsApplied]);

  // 记录本次查询用的参数指纹，供「条件已改」提示使用
  dirtyRef.current = () => setLastQueried(JSON.stringify(built.params));

  const handleQuery = () => {
    void live.query(built.params).then(() => setLastQueried(JSON.stringify(built.params)));
  };

  // 条件改过但还没查询 —— 底栏给提示、按钮加动效
  const dirty = lastQueried !== null && JSON.stringify(built.params) !== lastQueried;

  const generatedAt = live.result?.ok
    ? `${new Date().toLocaleDateString('zh-CN')} ${new Date().toLocaleTimeString('zh-CN')}（实时查询）`
    : '-';
  const summary = conditions.length
    ? conditions.map((c) => `${c.label}${c.display ? ` ${c.display}` : ''}`).join(' ｜ ')
    : '无（全部数据）';

  const progressText = live.running
    ? `查询中：第 ${live.progress.pages} 页，已取回 ${live.progress.count} 条${
        live.progress.total ? ` / 站点共 ${live.progress.total} 条` : ''
      }`
    : null;

  const exportDisabled = live.rows.length === 0;

  /* ------------------------- 服务不可用：只给指引，不显示旧数据 ------------------------- */

  if (live.status === 'offline') {
    return (
      <div className="app-shell">
        <header className="app-header">
          <div className="head-in">
            <h1>藏宝阁数据面板</h1>
            <span className="pill-tag">实时模式</span>
          </div>
        </header>
        <div className="layout" style={{ gridTemplateColumns: '1fr' }}>
          <div className="guide">
            <div className="guide-icon">🔌</div>
            <h2>没探测到本地查询服务</h2>
            <p>
              本页面不保存也不显示任何历史数据，所有结果都来自实时查询。
              实时查询需要本机运行一个伴随服务——它负责拉起浏览器、借用你的登录态去请求藏宝阁。
            </p>
            <p className="guide-why">
              为什么必须在本地：藏宝阁的搜索接口要求登录态，而浏览器 Cookie 按域名隔离，
              任何部署在别处的网页都拿不到这个会话。这是浏览器的安全规则，不是实现问题。
            </p>
            <div className="guide-steps">
              <div className="guide-step">
                <span className="n">1</span>
                <div>
                  在本机启动伴随服务
                  <pre>node tools/cbg/scraper-service/server.mjs</pre>
                </div>
              </div>
              <div className="guide-step">
                <span className="n">2</span>
                <div>会弹出一个浏览器窗口，在里面登录藏宝阁（只需一次，登录态存在本地）</div>
              </div>
              <div className="guide-step">
                <span className="n">3</span>
                <div>回到本页，点下面的按钮重新探测</div>
              </div>
            </div>
            <div className="guide-actions">
              <button className="btn btn-primary" onClick={() => void live.recheck()}>
                重新探测
              </button>
              <span className="guide-path">当前探测地址：{SCRAPER_BASE}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (live.status === 'need-login' || live.status === 'need-captcha') {
    const isCaptcha = live.status === 'need-captcha';
    return (
      <div className="app-shell">
        <header className="app-header">
          <div className="head-in">
            <h1>藏宝阁数据面板</h1>
            <span className="pill-tag">实时模式</span>
          </div>
        </header>
        <div className="layout" style={{ gridTemplateColumns: '1fr' }}>
          <div className="guide">
            <div className="guide-icon">{isCaptcha ? '🧩' : '🔐'}</div>
            <h2>{isCaptcha ? '需要完成滑块验证' : '需要登录藏宝阁'}</h2>
            <p>{live.serviceMessage}</p>
            <div className="guide-steps">
              <div className="guide-step">
                <span className="n">1</span>
                <div>
                  找到伴随服务启动时弹出的那个浏览器窗口（标题栏是藏宝阁）；
                  如果是无窗口模式（<code>--headless</code>），请去掉该参数重启服务
                </div>
              </div>
              <div className="guide-step">
                <span className="n">2</span>
                <div>
                  {isCaptcha
                    ? '在那个窗口里随便打开一个商品页，页面会要求滑动验证，拖动滑块完成即可'
                    : '在那个窗口里完成登录；如果随后出现滑块，同样拖动完成'}
                </div>
              </div>
              <div className="guide-step">
                <span className="n">3</span>
                <div>
                  回到本页点「重新查询」。若仍提示验证，请等 1~2 分钟再试——
                  短时间内连续查询会再次触发风控
                </div>
              </div>
            </div>
            <div className="guide-actions">
              <button className="btn btn-primary" onClick={handleQuery}>
                重新查询
              </button>
              <button className="btn btn-ghost" onClick={() => void live.recheck()}>
                重新探测服务
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------ 正常面板 ------------------------------ */

  return (
    <>
      <DashboardLayout
        title="藏宝阁数据面板"
        badge="阴阳师 · 角色"
        status={live.status}
        running={live.running}
        cancelling={live.cancelling}
        meta={
          live.health?.lastSuccessAt
            ? `站点共 ${live.health.lastTotal ?? '?'} 条 ｜ 上次成功 ${new Date(
                live.health.lastSuccessAt,
              ).toLocaleTimeString('zh-CN')}`
            : undefined
        }
        conditionSearch={{ value: query, onChange: setQuery }}
        hitCount={live.rows.length}
        progressText={progressText}
        dirty={dirty}
        onQuery={handleQuery}
        onCancel={() => void live.cancel()}
        canQuery={live.status === 'ready' && Boolean(config.schema)}
        onRemoveCondition={(id) =>
          setSelected((prev) => {
            const next = new Map(prev);
            next.delete(id);
            return next;
          })
        }
        onExportExcel={() => exportExcel(live.rows, listingExportColumns)}
        onExportCsv={() => exportCsv(live.rows, listingExportColumns)}
        onPrint={() => printArea('print-area', '藏宝阁筛选结果')}
        onRestoreDefaults={restoreDefaults}
        exportDisabled={exportDisabled}
        sidebar={
          config.schema ? (
            <FilterPanel
              key={conditionPanelKey}
              schema={config.schema}
              serverIndex={config.serverIndex}
              selected={selected}
              onSelectedChange={setSelected}
              query={query}
            />
          ) : (
            <div className="state-box">
              <div className="spinner" />
              正在加载筛选条件…
            </div>
          )
        }
      >
        {live.errorText && (
          <div className="callout callout-error">
            <span>⚠️</span>
            <div>{live.errorText}</div>
          </div>
        )}

        {live.notice && !live.errorText && (
          <div className="callout callout-notice">
            <span>⏹</span>
            <div>{live.notice}</div>
          </div>
        )}

        {live.hasQueried && !live.errorText && (
          <div className="callout">
            <span>📡</span>
            <div>
              {live.result?.cancelled ? <>结果不完整（查询已取消，仅含已取到的部分）：</> : <>实时结果：</>}
              本次取回 <b>{live.rows.length}</b> 条
              {live.result?.meta?.total ? <>（站点符合条件共 <b>{live.result.meta.total}</b> 条）</> : null}
              ，共 {live.result?.meta?.pages ?? 0} 页。
              {live.result?.meta?.total && live.result.meta.total > live.rows.length ? (
                <> 站点条数多于已取回数量，若要看全请提高抓取页数上限（服务端 <code>--max-pages</code>）。</>
              ) : null}
            </div>
          </div>
        )}

        {/*
          条件生效情况：必须如实说明，不能让用户以为「命中 N 条」是全部条件筛出来的。
          表述分两类，因为实测确认过站点的行为不同：
            · 服务端已筛选但本地无字段 —— 站点真的按它筛了，只是列表接口不返回该值
            · 本地可核对 —— 表格里有这个字段，能排序、能本地复筛
        */}
        {live.hasQueried &&
          !live.errorText &&
          (live.conditionSupport.serverOnly.length > 0 || live.conditionSupport.local.length > 0) && (
            <div className="callout callout-cond">
              <span>🧭</span>
              <div>
                {live.conditionSupport.serverOnly.length > 0 && (
                  <>
                    <b>{live.conditionSupport.serverOnly.length} 项条件由服务端筛选，但本地无法核对</b>：
                    {live.conditionSupport.serverOnly.join('、')}。
                    <span className="hint-sm">
                      藏宝阁接受这些参数并据此筛选（站点返回的符合条数会变），但列表接口不返回对应字段，
                      所以表格里看不到这些值，也无法按它们排序或二次筛选。
                    </span>
                  </>
                )}
                {live.conditionSupport.serverOnly.length > 0 && live.conditionSupport.local.length > 0 && <br />}
                {live.conditionSupport.local.length > 0 && (
                  <>
                    <b>{live.conditionSupport.local.length} 项可在本地核对</b>：
                    {live.conditionSupport.local.join('、')}。
                    <span className="hint-sm">表格里有这些字段，可排序、可二次筛选。</span>
                  </>
                )}
              </div>
            </div>
          )}

        {!live.hasQueried && !live.running && (
          <div className="state-box">
            <div className="big">还没有查询结果</div>
            <div>在左侧选好条件，点右下角「查询」即可从藏宝阁实时获取。</div>
          </div>
        )}

        {live.running && (
          <div className="state-box">
            <div className="spinner" />
            {progressText ?? '正在查询…'}
            <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 6 }}>
              页间有 1.6 秒节流，是为了不触发站点风控，请耐心等
            </div>
          </div>
        )}

        {live.hasQueried && !live.running && (
          <>
            <KpiCards kpis={live.analytics.kpis} />

            <div className="panel">
              <div className="panel-head">
                <span className="t">数据总览</span>
                <span className="s">价格分布 · 一速分段 · 平台占比 · 价格 × 签到</span>
              </div>
              <div className="panel-body">
                <div className="charts">
                  <div className="cbox">
                    <h4>
                      价格分布 <span>共 {live.rows.length} 条</span>
                    </h4>
                    <PriceHistogramChart histogram={live.analytics.priceHistogram} />
                  </div>
                  <div className="cbox">
                    <h4>
                      散件一速分段{' '}
                      <span>
                        ≥158 有{' '}
                        {live.analytics.speedTiers.find((t) => t.name === '158+')?.value ?? 0} 个
                      </span>
                    </h4>
                    <SpeedTierChart tiers={live.analytics.speedTiers} />
                  </div>
                  <div className="cbox">
                    <h4>
                      平台占比 <span>按操作系统</span>
                    </h4>
                    <PlatformPieChart data={live.analytics.platformShare} />
                  </div>
                  <div className="cbox full">
                    <h4>
                      价格 × 签到年数 <span>纵轴对数刻度 · 悬停看详情</span>
                    </h4>
                    <PriceSignScatterChart points={live.analytics.signVsSpeed} />
                  </div>
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <span className="t">账号明细</span>
                <span className="s">
                  命中 {live.rows.length} 条 ｜ 点击行加入对比清单 ｜ 点标题跳藏宝阁
                </span>
                <div className="right">
                  <button className="link-btn" onClick={() => setCompact((v) => !v)}>
                    {compact ? '显示全部列' : '精简列（便于打印）'}
                  </button>
                </div>
              </div>
              <DataTable rows={live.rows} columns={compact ? 'compact' : 'full'} />
            </div>
          </>
        )}
      </DashboardLayout>

      <CompareDrawer rows={live.rows} />
      <PrintView rows={live.rows} filterSummary={summary} generatedAt={generatedAt} />
    </>
  );
};
