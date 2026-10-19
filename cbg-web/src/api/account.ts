import { SCRAPER_BASE } from '@/api/live';

/**
 * 模块二「账号评分」的客户端。
 *
 * 这些数据由**伴随服务**代理获取，而不是浏览器直连藏宝阁——
 * 藏宝阁的接口没有 CORS 头（实测 access-control-allow-origin 为空），
 * 浏览器从 github.io / 127.0.0.1:5173 直接 fetch 会被拦。
 * 好处是那三个接口**匿名可用**，所以这个模块不依赖你是否登录藏宝阁。
 */

/** 一套御魂搭配方案的评分与属性 */
export interface PlanScore {
  planId: string;
  /** 御魂套装，如「狂骨四件套+荒骷髅」 */
  suit: string;
  /** 246 号位选择，如「攻攻暴/爆伤」 */
  slots: string;
  /** 属性限制，如「满暴速度≥158」 */
  limit: string;
  score: number | null;
  attack: number | null;
  hp: number | null;
  defense: number | null;
  speed: number | null;
  critRate: number | null;
  critPower: number | null;
  hit: number | null;
  resist: number | null;
  /** B1：这套方案还在站点排队计算（自动取分只重试 pending 的） */
  pending?: boolean;
  /** B3：这套方案失败时的分类 code */
  errorCode?: string | null;
}

export interface HeroScore {
  name: string;
  heroId?: string;
  planCount?: number;
  /** 成功拿到评分的套数 */
  scoredCount?: number;
  /** 还在「计算中」没拿到分的套数（站点是懒计算，第一次请求只是触发） */
  computing?: number;
  /** 触发了风控（验证/登录态）—— 需要用户去浏览器里过一次验证，或等冷却 */
  blocked?: boolean;
  error?: string | null;
  /** B3：错误分类（CAPTCHA_AUTH / SESSION_TIMEOUT / MOBILE_AUTH / API_ERROR…） */
  errorCode?: string | null;
  best?: PlanScore | null;
  worst?: PlanScore | null;
  plans: PlanScore[];
  /** 该式神在这个账号的可用方案清单里没找到 */
  missing?: boolean;
}

/** B3：一次分析/取分实际消耗的请求与耗时 */
export interface AnalyzeMeta {
  requestCount: number;
  durationMs: number;
  /** 自动取分累计回来的信息（上一次分析的时间不变，这里是附加统计） */
  lastRetry?: {
    requestCount: number;
    durationMs: number;
    attempted: number;
    stillPending: number;
  };
}

export interface RescoreResult {
  ok: boolean;
  heroes: HeroScore[];
  meta: {
    requestCount: number;
    durationMs: number;
    attempted: number;
    stillPending: number;
  };
  blocked?: boolean;
  errorCode?: string | null;
  cachedAt?: string | null;
}

/** 一种御魂在 6 个位置上的最快速 */
export interface SuitSpeedRow {
  name: string;
  p1: number | null;
  p2: number | null;
  p3: number | null;
  p4: number | null;
  p5: number | null;
  p6: number | null;
  /** 6 个位置里的最大值 */
  max: number;
  /** 6 个位置的合计（看这套御魂整体的速度厚度） */
  sum: number;
  /** 有几个位置有数据（0~6） */
  coverage: number;
}

/* -------------------- A1：速度核心 / 官方交叉校验 -------------------- */

/** 官方卖点（equip.highlights）解析结果 */
export interface OfficialHighlights {
  raw: string[];
  scatterSpeed: number | null;
  zhaocaiSpeed: number | null;
  headSpeed: number | null;
  /** 官方标注的「N头M尾」 */
  tou: number | null;
  wei: number | null;
}

/** 单个指标与官方标注的比对 */
export interface SpeedCheck {
  key: 'scatterSpeed' | 'zhaocaiSpeed' | 'headSpeed';
  label: string;
  local: number | null;
  official: number;
  /** 本地复算与官方标注一致（误差 ≤0.02） */
  ok: boolean;
}

export interface SpeedCore {
  /** 散件一速：6 个位置各自最快的总速度之和 */
  scatterSpeed: number | null;
  /** 招财一速：4 件招财猫 + 2 件任意套装 */
  zhaocaiSpeed: number | null;
  /** 头速度：2 号位速度主属性御魂里最高的副属性速度 */
  headSpeed: number | null;
  /** 散件一速的各位置贡献 */
  perPosition: {
    p1: number | null;
    p2: number | null;
    p3: number | null;
    p4: number | null;
    p5: number | null;
    p6: number | null;
  };
  official: OfficialHighlights;
  checks: SpeedCheck[];
}

/* -------------------- A2：副属性速度分布 -------------------- */

export interface SpeedStats {
  /** 带副属性速度的御魂件数 */
  subSpeedCount: number;
  ge15: number;
  ge16: number;
  ge17: number;
  /** 真 17：真实值 ≥17.00 */
  true17: number;
  /** 伪 17：16.5~16.99（显示像 17，实际不满） */
  fake17: number;
  /** 近满速：≥17.5 */
  nearFull: number;
  /** 满速：≥17.99（6★ 理论上限 18） */
  full: number;
  /** 未满级但带速度副属性的「速度胚子」 */
  unleveled: number;
  maxSubSpeed: number | null;
  /** 四号位主属性效果命中、且带速度副属性的御魂 */
  hitTailCount: number;
  hitTailSpeed: number | null;
  /** 四号位主属性效果抵抗、且带速度副属性的御魂 */
  resistTailCount: number;
  resistTailSpeed: number | null;
}

/* -------------------- A3：账号概览 -------------------- */

export interface DexEntry {
  got: number;
  all: number | null;
}

export interface AccountOverview {
  heroCount: number | null;
  sixStar: number;
  fiveStar: number;
  /** 拥有（含重复）的 SSR / SP / UR 数量 */
  ssrOwned: number;
  spOwned: number;
  urOwned: number;
  /** 六星且技能全满的式神数 */
  fullSkillSixStar: number;
  starCounts: Record<string, number>;
  rarityCounts: Record<string, number>;
  /** 图鉴收集：r / sr / ssr / sp / ur / gua / x */
  dex: Record<string, DexEntry> | null;
  skinCount: number | null;
  headSkinCount: number | null;
  damoTotal: number | null;
  money: number | null;
  strength: number | null;
  soulJade: number | null;
  skinCoupon: number | null;
  pvpScore: number | null;
  pvpRank: number | null;
  honorScore: number | null;
  medal: number | null;
  achieveCount: number | null;
  bossEquipCount: number | null;
}

export interface AccountInfo {
  ordersn: string;
  serverName: string;
  areaName: string;
  status: number;
  statusDesc: string;
  price: number;
  level: string | null;
  collectNum: number;
  createTime: string;
  sellingTime: string;
  detailUrl: string;
  goyu: number | null;
  signDays: number | null;
  fengzidu: number | null;
  soulCount: number;
  mainSpeedSouls: number;
}

export interface AccountAnalysis {
  ok: boolean;
  eid: string;
  serverid: string;
  /** A5：结果是否来自服务端缓存（默认 10 分钟内有效） */
  cached?: boolean;
  /** 缓存生成时间（ISO 字符串） */
  cachedAt?: string | null;
  /** 缓存年龄（毫秒） */
  cacheAgeMs?: number | null;
  /** 服务端缓存有效期（毫秒） */
  cacheTtlMs?: number;
  account: AccountInfo;
  /** A1：速度核心指标 + 与官方卖点的交叉校验 */
  speedCore: SpeedCore;
  /** A2：副属性速度分布 / 真 17 / 命中与抵抗四号位速度 */
  speedStats: SpeedStats;
  /** A3：式神、资产、图鉴收集概览 */
  overview: AccountOverview;
  /** B3：本次分析实际消耗的请求数与耗时 */
  meta?: AnalyzeMeta;
  /** B3：顶层错误分类（某个式神触发风控时） */
  errorCode?: string | null;
  speed: { all: SuitSpeedRow[]; subOnly: SuitSpeedRow[] };
  heroes: HeroScore[];
}

export interface AnalyzeError {
  ok: false;
  error: string;
  message: string;
}

const request = async <T,>(path: string, init?: RequestInit, timeoutMs = 180_000): Promise<T> => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SCRAPER_BASE}${path}`, { ...init, signal: ctl.signal });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`服务返回非 JSON（HTTP ${res.status}）：${text.slice(0, 120)}`);
    }
    // 400 带着结构化的 error/message，直接抛给调用方展示
    if (!res.ok) {
      const e = body as AnalyzeError | null;
      const err = new Error(e?.message || `HTTP ${res.status}`) as Error & { code?: string; parsed?: unknown };
      err.code = e?.error;
      err.parsed = (e as unknown as { parsed?: unknown })?.parsed;
      throw err;
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
};

export const accountApi = {
  /** 用地址分析（地址里含 eid 时最省事）；refresh=true 强制绕过服务端缓存 */
  async analyzeByUrl(url: string, heroes?: string[], refresh = false): Promise<AccountAnalysis> {
    return request<AccountAnalysis>('/api/account/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, heroes, refresh }),
    });
  },

  /** 分别给 eid + serverid（用户只有商品页地址时走这个）；refresh=true 强制绕过服务端缓存 */
  async analyze(eid: string, serverid: string, heroes?: string[], refresh = false): Promise<AccountAnalysis> {
    return request<AccountAnalysis>('/api/account/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eid, serverid, heroes, refresh }),
    });
  },

  /**
   * B1：自动取分——只重试上次分析里还在排队计算的方案（不重新拉详情/方案清单）。
   * 需要服务端还保留着这次分析的结果（10 分钟内，或之后仍缓存着）。
   */
  async rescore(eid: string, serverid: string, heroes?: string[], subOnly?: boolean): Promise<RescoreResult> {
    return request<RescoreResult>('/api/account/rescore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eid, serverid, heroes, subOnly }),
    });
  },
};

/** 把用户粘贴的东西拆成可用参数（前端先粗判，避免白跑一次请求） */
export function parseInput(raw: string): { url?: string; eid?: string; serverid?: string; looksLikeEquipOnly?: boolean } {
  const s = raw.trim();
  if (!s) return {};
  const eid = s.match(/[?&]eid=([0-9A-Za-z-]+)/)?.[1];
  const sid = s.match(/[?&](?:serverid|obj_serverid)=(\d+)/)?.[1];
  if (eid && sid) return { url: s, eid, serverid: sid };
  const equip = s.match(/\/equip\/(\d+)\//);
  if (equip) return { url: s, looksLikeEquipOnly: true };
  // 直接粘 eid 的情况
  if (/^[0-9]{10,}-\d+-[0-9A-Za-z]+$/.test(s)) return { eid: s };
  return { url: s };
}
