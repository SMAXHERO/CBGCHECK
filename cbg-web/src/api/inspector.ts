import { request } from '@/api/client';

/**
 * 模块四「看号工具」客户端。
 *
 * 数据与计算全部由 Python 内核（tools/cbg/inspector-service）完成，
 * 前端只访问伴随服务：`/api/inspector/*` 由 server.mjs 透明代理到内核，
 * 因此不需要第二个地址，也不会有跨源问题。
 */

export interface AttributeText {
  label: string;
  value: number;
  isPercent: boolean;
}

export interface SpeedCell {
  position: number;
  /** 单元格显示值：2 号位为「副属性和 + 主属性速度」，其余为副属性和 */
  value: number;
  subSpeed: number;
  mainAttribute: AttributeText;
  suitName: string;
  /** 散件 / 非套装件的来源提示（如「被服」两件套） */
  labels: string[];
}

export interface SpeedRow {
  rank?: number;
  suit?: string;
  value: number;
  cells: SpeedCell[];
}

export interface SpeedHighlights {
  scatteredFirstSpeed: number | null;
  luckyFirstSpeed: number | null;
  speedHeadCount: number | null;
  speedTailCount: number | null;
  text?: string;
}

export interface InspectorSpeed {
  highlights: SpeedHighlights;
  headTail: { heads: number; tails: number };
  fullSpeedCount: number;
  fullSpeedByPosition: Record<string, number>;
  /** 散件一速 top5（六件互不重复） */
  scatterTop: SpeedRow[];
  /** 常用 PVP 套装一速表（默认 11 个四件套） */
  suitTable: SpeedRow[];
  fullSpeedRelics: {
    position: number;
    value: number;
    suitName: string;
    mainAttribute: AttributeText;
  }[];
}

export interface PveScoreRow {
  suitName: string;
  totalScore: number;
  relicCount: number;
}

export interface HighScoreRelic {
  relicId: string;
  effectiveCount: number;
  position: number;
  setBonusCount: boolean;
}

export interface InspectorPve {
  normalSuits: PveScoreRow[];
  omaSuits: PveScoreRow[];
  /** 号位 → 有效词条 ≥5 的高评分御魂（只统计普通 PVE 套） */
  highScoreByPosition: Record<string, HighScoreRelic[]>;
}

export interface HeroEntry {
  instanceId: string;
  heroId: number;
  name: string;
  rarity: number;
  level: number;
  skillLevels: number[];
}

export interface InspectorHeroSkills {
  yuxingDama: number;
  /** 同名式神里技能达标的有 >=2 只 */
  duplicates: HeroEntry[];
  /** 同名式神里没有任何一只技能达标（取技能最高的一只代表） */
  deficient: HeroEntry[];
  /** 联动式神 */
  collaboration: HeroEntry[];
  groups: { rarity: string; heroes: HeroEntry[] }[];
  counts: {
    duplicates: number;
    deficient: number;
    collaboration: number;
    /** 稀有度 → 数量 */
    groups: Record<string, number>;
  };
}

export interface InspectorAccount {
  name: string;
  serverName: string;
  level: number;
  fengzidu: number;
  pvpStage: number;
  pvpScore: number;
  stamina: { raw: number; text: string } | number;
  money: { raw: number; text: string } | number;
  soulJade: { raw: number; text: string } | number;
  mysteryTalisman: number;
  realityTalisman: number;
  collectionSkinCount: number;
  summonPower: number;
  yuxingDama: number;
  dex: {
    ssr: { owned: number; total: number };
    sp: { owned: number; total: number };
    ur: { owned: number; total: number };
    uncollected500Days: string;
    uncollected999Days: string;
    uncollectedCoupon: number;
  };
}

export interface InspectorRelics {
  totalInBag: number;
  counted: number;
  maxLevelCount: number;
  byPosition: Record<string, number>;
}

export interface InspectorReport {
  ok: boolean;
  account: InspectorAccount;
  relics: InspectorRelics;
  speed: InspectorSpeed;
  pveScores: InspectorPve;
  heroSkills: InspectorHeroSkills;
  source: string;
  cached: boolean;
  fetch_ms: number;
  elapsed_ms: number;
  ordersn: string;
  serverid: string;
  message?: string;
}

export interface InspectorHeroMeta {
  name: string;
  level: string;
  baseStats: {
    attack: number;
    health: number;
    defense: number;
    speed: number;
    critRate: number;
    critDamage: number;
    effectHit: number;
    effectResistance: number;
  };
}

export interface InspectorMeta {
  ok: boolean;
  heroes: InspectorHeroMeta[];
  suits: string[];
  pveNormalSuits: string[];
  pveOmaSuits: string[];
  attributes: string[];
  presets: Record<string, Record<string, string[]>>;
  metrics: string[];
}

export interface RelicListRow {
  position: number;
  suitName: string;
  mainAttribute: AttributeText;
  subAttributes: { label: string; total: number; count: number }[];
  quality: number;
  level: number;
  relicId: string;
}

export interface RelicList {
  ok: boolean;
  total: number;
  matched: number;
  byPosition: Record<string, number>;
  items: RelicListRow[];
  limit: number;
  message?: string;
}

export interface CalcRow {
  score: number;
  panel: Record<string, number>;
  suits: string[];
  relics: {
    relicId?: string;
    suitName?: string;
    position?: number;
    mainAttribute?: AttributeText;
  }[];
}

export interface CalcResult {
  hero: string;
  metric: string;
  fastMode: boolean;
  rows: CalcRow[];
}

export interface JobState {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress?: string;
  error?: string;
  created?: number;
  finished?: number;
  result?: CalcResult | { ok: boolean; [key: string]: unknown };
}

export const inspectorApi = {
  meta: () => request<InspectorMeta>('/api/inspector/meta', undefined, { timeoutMs: 15000 }),

  demo: () => request<InspectorReport>('/api/inspector/demo', undefined, { timeoutMs: 180000 }),

  report: (q: { ordersn?: string; serverid?: string; url?: string; refresh?: boolean }) => {
    const sp = new URLSearchParams();
    if (q.ordersn) sp.set('ordersn', q.ordersn);
    if (q.serverid) sp.set('serverid', q.serverid);
    if (q.url) sp.set('url', q.url);
    if (q.refresh) sp.set('refresh', '1');
    return request<InspectorReport>(`/api/inspector/report?${sp.toString()}`, undefined, { timeoutMs: 300000 });
  },

  relics: (q: {
    ordersn?: string;
    serverid?: string;
    url?: string;
    position?: number | string;
    suits?: string;
    mainAttribute?: string;
    subAttributes?: string;
    limit?: number;
  }) => {
    const sp = new URLSearchParams();
    if (q.ordersn) sp.set('ordersn', q.ordersn);
    if (q.serverid) sp.set('serverid', q.serverid);
    if (q.url) sp.set('url', q.url);
    if (q.position) sp.set('position', String(q.position));
    if (q.suits) sp.set('suits', q.suits);
    if (q.mainAttribute) sp.set('mainAttribute', q.mainAttribute);
    if (q.subAttributes) sp.set('subAttributes', q.subAttributes);
    if (q.limit) sp.set('limit', String(q.limit));
    return request<RelicList>(`/api/inspector/relics?${sp.toString()}`, undefined, { timeoutMs: 120000 });
  },

  /** 提交 PVE 21 组合任务 */
  pve: (q: { ordersn?: string; serverid?: string; url?: string; refresh?: boolean }) =>
    request<{ ok: boolean; jobId: string }>('/api/inspector/pve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(q),
    }),

  /** 提交御魂组合搜索任务 */
  calc: (payload: Record<string, unknown>) =>
    request<{ ok: boolean; jobId: string }>('/api/inspector/calc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  job: (id: string) => request<{ ok: boolean; job: JobState }>(`/api/inspector/job?id=${encodeURIComponent(id)}`),
};
