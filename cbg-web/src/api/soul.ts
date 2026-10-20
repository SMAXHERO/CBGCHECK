import { SCRAPER_BASE } from '@/api/live';

/**
 * 模块三「御魂报告」客户端。
 *
 * 数据与计算都由 Python 内核（tools/cbg/soul-service）完成，
 * 当前端只访问伴随服务：`/api/soul/*` 会被 server.mjs 透明代理到内核，
 * 所以这里不需要第二个地址，也不会出现跨源问题。
 */

export interface SoulPlayer {
  id?: number;
  name?: string;
  level?: number;
  server_id?: number;
}

export interface SoulOverview {
  player: SoulPlayer;
  souls_total: number;
  souls_six_star: number;
  position_counts: Record<string, number>;
  score: { avg: number | null; max: number | null; ge6: number; hist: Record<string, number> };
  zscore: { avg: number | null; max: number | null; ge8: number };
  version?: string;
  timestamp?: string;
}

export interface SpeedRow {
  kind: string;
  value: number;
  suits: string[];
}

export interface SoulSpeeds {
  loose: SpeedRow[];
  hit: SpeedRow[];
  resist: SpeedRow[];
  suits: SpeedRow[];
}

export interface PieDatum {
  value: number;
  name: string;
}

export interface ScoreDistribution {
  total: number;
  data: PieDatum[];
  perPos: { name: string; center: [string, string]; data: PieDatum[] }[];
}

export interface TopSoul {
  kind: string;
  pos: number;
  main: string;
  speed: number;
  score: number | null;
  zscore: number | null;
}

export interface SoulReport {
  ok: boolean;
  ordersn?: string;
  serverid?: string;
  cached?: boolean;
  upload_key?: string;
  overview: SoulOverview;
  speeds: SoulSpeeds;
  score_distribution: ScoreDistribution;
  top_souls: TopSoul[];
  meta?: { source?: string; fetch_ms?: number; filename?: string };
  elapsed_ms?: number;
}

export interface PreciseDetail {
  name?: string;
  speed?: number;
  pos?: number;
}

export interface PreciseMetrics {
  ok: boolean;
  ordersn: string;
  speeds: { scatter1: number | null; scatter2: number | null; scatter3: number | null; scatter4: number | null; scatter5: number | null };
  head: { count: number | null; topSpeed: number | null; details: PreciseDetail[] };
  hitTail: { count: number | null; topSpeed: number | null; details: PreciseDetail[] };
  resistTail: { count: number | null; topSpeed: number | null; details: PreciseDetail[] };
  maxSpeedCount: number | null;
  zhen17Count: number | null;
  zhen17Details: { set?: string; speed?: string }[];
  cached?: boolean;
}

export interface SoulMeta {
  heroes: string[];
  suits: { id: number; name: string; type: string }[];
  targets: { key: string; name: string }[];
}

export interface SoulSearchRow {
  value: number;
  yuhunGain: Record<string, number>;
  suits: string[];
  equips: { kind: string; pos: number; score: number | null }[];
}

export interface SoulJob {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  result?: SoulSearchRow[];
  error?: string;
  elapsed_ms?: number;
}

export interface SoulSearchPayload {
  ordersn?: string;
  upload_key?: string;
  hero: string;
  target: string;
  min_crit_rate?: number | null;
  min_speed?: number | null;
  suit_name?: string | null;
  suit_count?: number | null;
  top?: number;
}

/** 带超时的 fetch；服务/内核没起来时给出可读错误，而不是裸的 AbortError */
async function request<T>(path: string, init?: RequestInit, timeoutMs = 30000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SCRAPER_BASE}${path}`, { ...init, signal: ctl.signal });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* 非 JSON（代理层 502 之类） */
    }
    if (!res.ok) {
      const body = (parsed ?? {}) as { message?: string; msg?: string; error?: string };
      throw new Error(body.message || body.msg || body.error || `HTTP ${res.status}`);
    }
    if (parsed && typeof parsed === 'object' && (parsed as { ok?: boolean }).ok === false) {
      const body = parsed as { message?: string; msg?: string };
      throw new Error(body.message || body.msg || '请求失败');
    }
    return parsed as T;
  } finally {
    clearTimeout(timer);
  }
}

export const soulApi = {
  /** 取式神/套装/指标枚举（前端下拉） */
  meta: () => request<SoulMeta>('/api/soul/meta', undefined, 10000),

  /** 内置示例数据（无需网络/抓取） */
  demo: () => request<SoulReport>('/api/soul/demo', undefined, 180000),

  /** 按订单号/链接出报告；refresh=1 强制重抓 */
  report: (q: { ordersn?: string; serverid?: string; cbgUrl?: string; refresh?: boolean }) => {
    const sp = new URLSearchParams();
    if (q.ordersn) sp.set('ordersn', q.ordersn);
    if (q.serverid) sp.set('serverid', q.serverid);
    if (q.cbgUrl) sp.set('cbg_url', q.cbgUrl);
    if (q.refresh) sp.set('refresh', '1');
    return request<SoulReport>(`/api/soul/report?${sp.toString()}`, undefined, 300000);
  },

  /** 上传 yyx / 痒痒熊导出文件 */
  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file, file.name);
    return request<SoulReport>('/api/soul/report/upload', { method: 'POST', body: fd }, 180000);
  },

  /** 用 CBG 原始御魂档案算精确的头/尾/17 速 */
  precise: (ordersn: string, refresh = false) =>
    request<PreciseMetrics>(
      `/api/soul/precise?ordersn=${encodeURIComponent(ordersn)}${refresh ? '&refresh=1' : ''}`,
      undefined,
      180000,
    ),

  /** 提交组合搜索（异步任务） */
  search: (payload: SoulSearchPayload) =>
    request<{ ok: boolean; job_id: string }>('/api/soul/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }),

  /** 轮询搜索结果 */
  job: (id: string) => request<SoulJob>(`/api/soul/job?id=${encodeURIComponent(id)}`, undefined, 10000),
};
