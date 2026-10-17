import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App, Spin } from 'antd';
import { useLocation } from 'react-router-dom';
import { ModuleTabs } from '@/components/ModuleTabs';
import { useTheme } from '@/hooks/useTheme';
import {
  accountApi,
  parseInput,
  type AccountAnalysis,
  type HeroScore,
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

const SPEED_MODES = [
  { key: 'all', label: '总速度（含 2 号位主属性）', hint: '反映这个位置最快能到多少；2 号位因主属性可加速度，所有御魂都是 57' },
  { key: 'subOnly', label: '仅副属性速度', hint: '排除 2 号位主属性，只看随机副属性堆出来的速度，更有区分度' },
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
                ? `${hero.computing} 套方案没算出来。御魂数量不足时，这套方案可能凑不齐 —— 可点「重新分析」再试一次`
                : hero.error
                  ? `没算出评分：${hero.error}`
                  : '这套账号没能算出评分'}
          </span>
        ) : (
          <span className="score-range">
            最优 <em>{fmt(best?.score, 1)}</em> · 最差 {fmt(worst?.score, 1)}
          </span>
        )}
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
          已排除 2 号位的「主属性速度」——那个位置满值固定 57，混在一起会让 P2 列失去比较意义。
          这里看的是各御魂在副属性上堆速度的能力。
        </p>
      )}
    </div>
  );
};

export const AccountScore = () => {
  const { theme, toggle } = useTheme();
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
   */
  const [errorText, setErrorText] = useState('');

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
    async (eid: string, serverid: string) => {
      setLoading(true);
      setNeedEid(false);
      setErrorText('');
      try {
        const res = await accountApi.analyze(eid, serverid);
        setData(res);
        setInput(`eid=${eid}&serverid=${serverid}`);
        message.success('分析完成');
      } catch (err) {
        // 失败就清掉旧结果，避免把上一个账号的数字当成这个账号的
        setData(null);
        const msg = (err as Error).message || '分析失败';
        setErrorText(msg);
        message.error(msg);
      } finally {
        setLoading(false);
      }
    },
    [message],
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
    setErrorText('');
    try {
      const res = parsed.eid && parsed.serverid
        ? await accountApi.analyze(parsed.eid, parsed.serverid)
        : await accountApi.analyzeByUrl(raw);
      setData(res);
      message.success('分析完成');
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'NEED_EID') {
        setNeedEid(true);
      } else {
        setData(null);
        const msg = e.message || '分析失败';
        setErrorText(msg);
        message.error(msg);
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
      const res = await accountApi.analyze(e, s);
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
  const speedRows = data ? (speedMode === 'all' ? data.speed.all : data.speed.subOnly) : [];

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="head-in">
          <h1>藏宝阁数据面板</h1>
          <span className="pill-tag">阴阳师 · 角色</span>
          <ModuleTabs />
          <span className="head-meta">
            数据源 {SCRAPER_BASE.replace('http://', '')}（本机伴随服务代理，无需登录藏宝阁）
          </span>
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
          <div className="score-loading">
            <Spin /> <span>正在读取详情并逐个方案算分（方案多的会慢一些，约 10~20 秒）…</span>
          </div>
        )}

        {errorText && !loading && (
          <div className="score-need score-error">
            <b>分析失败：</b>
            {errorText}
            <div className="score-error-hint">
              常见原因：藏宝阁触发了安全验证 / 登录态失效。可到受控浏览器窗口里打开任意商品页过一次验证，
              或等几分钟冷却后重试。
            </div>
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
                  <b className="acct-v">{acct.signDays === null ? '—' : `${acct.signDays} 天`}</b>
                </div>
                <div>
                  <span className="acct-k">风姿度</span>
                  <b className="acct-v">{acct.fengzidu === null ? '—' : acct.fengzidu}</b>
                </div>
                <div>
                  <span className="acct-k">御魂总数</span>
                  <b className="acct-v">{acct.soulCount}</b>
                </div>
                <div>
                  <span className="acct-k">2 号位速度御魂</span>
                  <b className="acct-v">{acct.mainSpeedSouls}</b>
                </div>
                <div>
                  <span className="acct-k">收藏</span>
                  <b className="acct-v">{acct.collectNum}</b>
                </div>
              </div>
              <p className="score-foot">
                上架 {acct.createTime}
                {acct.sellingTime && acct.sellingTime !== acct.createTime ? ` ｜ 更新 ${acct.sellingTime}` : ''}
                {' ｜ '}
                <a href={acct.detailUrl} target="_blank" rel="noreferrer">
                  打开藏宝阁原页
                </a>
              </p>
            </section>

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
                        ? () => void runParams(data.eid, data.serverid)
                        : undefined
                    }
                  />
                ))}
              </div>
            </section>

            <section className="score-card">
              <h2 className="score-h2">
                每种御魂在 6 个位置的最快速
                <span className="score-badge">{speedRows.length} 种</span>
              </h2>
              <div className="seg">
                {SPEED_MODES.map((m) => (
                  <button
                    key={m.key}
                    className={`seg-btn${speedMode === m.key ? ' on' : ''}`}
                    onClick={() => setSpeedMode(m.key)}
                    title={m.hint}
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
