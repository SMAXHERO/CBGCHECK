import type { Listing } from '@/types';

/**
 * 实时数据访问层 —— 伴随服务（tools/cbg/scraper-service）的客户端。
 *
 * 为什么必须有这个服务：藏宝阁的搜索接口要求登录态，而 Cookie 按域名隔离，
 * 网页（部署在任何域上）都不可能自己带着会话去请求。会话只能长在一个真实浏览器里，
 * 这个服务负责拉起浏览器、借用它的登录态发请求，再把结果通过 HTTP 交给网页。
 *
 * 服务地址默认本机 8791；可以用 VITE_SCRAPER_URL 覆盖（构建时注入）。
 */

export const SCRAPER_BASE =
  (import.meta.env.VITE_SCRAPER_URL as string | undefined) ?? 'http://127.0.0.1:8791';

/** 服务的状态机：前端据此决定显示什么引导 */
export type ServiceStatus = 'starting' | 'ready' | 'need-login' | 'need-captcha' | 'error' | 'offline';

/** 单次查询最多取几页（每页 15 条）。服务端也会再夹一次上限。 */
export const DEFAULT_MAX_PAGES = 8;

export interface HealthInfo {
  ok: boolean;
  service: string;
  version: number;
  status: ServiceStatus;
  message: string;
  browserReady: boolean;
  host: string;
  cdpPort: number;
  lastSuccessAt: string | null;
  lastTotal: number | null;
  busy: boolean;
}

export interface SearchProgress {
  pages: number;
  count: number;
  total: number | null;
}

export interface SearchResult {
  ok: boolean;
  rows: Listing[];
  error?: string;
  msg?: string;
  raw?: string;
  /** 因为用户取消而提前结束：rows 是已取到的部分结果，不完整 */
  cancelled?: boolean;
  meta?: { total: number | null; pages: number; count: number };
}

export interface ResultPoll {
  ok: boolean;
  jobId?: string;
  running: boolean;
  empty?: boolean;
  progress?: SearchProgress;
  error?: string | null;
  status?: ServiceStatus;
  message?: string;
  /** 取消请求已受理，但当前这一页还在返回途中 */
  cancelling?: boolean;
  /** 本次结果因为取消而不完整 */
  cancelled?: boolean;
  done?: boolean;
  result: SearchResult | null;
}

/** 带超时的 fetch：服务没起来时不能一直挂着 */
async function request<T>(path: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SCRAPER_BASE}${path}`, { ...init, signal: ctl.signal });
    if (!res.ok && res.status >= 500) {
      throw new Error(`服务返回 HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export const liveApi = {
  /** 探测服务是否在运行；不抛异常，失败即视为 offline */
  async health(): Promise<HealthInfo> {
    try {
      return await request<HealthInfo>('/api/health', undefined, 3000);
    } catch {
      return {
        ok: false,
        service: 'cbg-scraper',
        version: 0,
        status: 'offline',
        message: `探测不到伴随服务（${SCRAPER_BASE}）`,
        browserReady: false,
        host: '',
        cdpPort: 0,
        lastSuccessAt: null,
        lastTotal: null,
        busy: false,
      };
    }
  },

  /** 发起查询：立即返回 jobId，随后轮询 result() */
  async search(
    values: Record<string, string>,
    maxPages = DEFAULT_MAX_PAGES,
  ): Promise<{ ok: boolean; jobId?: string; error?: string; message?: string }> {
    return request('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values, maxPages }),
    }, 15000);
  },

  async result(): Promise<ResultPoll> {
    return request<ResultPoll>('/api/result', undefined, 8000);
  },

  /**
   * 取消正在进行的查询。
   *
   * 服务端在两处检查取消标志：每页开始前、以及页间 4 秒节流的等待中，
   * 所以点下去通常不到 1 秒就有反应。已经开始的那一次页面请求无法中断
   * （请求由页面里的 fetch 发出），最坏情况是「当前这页取完就停」。
   * 已取到的部分结果会保留并返回，前端会标注它不完整。
   */
  async cancel(): Promise<{ ok: boolean; cancelled: boolean; message?: string }> {
    return request('/api/cancel', { method: 'POST' }, 8000);
  },

  async logs(): Promise<{ ok: boolean; logs: string[] }> {
    return request('/api/logs', undefined, 5000);
  },

  async shutdown(): Promise<void> {
    await request('/api/shutdown', { method: 'POST' }, 5000);
  },
};

/** 给用户的排查指引，出现在错误页上 */
export const START_HINT = `cd ${'<项目目录>'}
node tools/cbg/scraper-service/server.mjs`;

/** 服务返回的错误码 -> 人话 */
export const ERROR_TEXT: Record<string, string> = {
  SESSION_TIMEOUT: '登录态失效：请在服务拉起的浏览器窗口里登录藏宝阁',
  e12: '登录态失效：请在服务拉起的浏览器窗口里登录藏宝阁',
  CAPTCHA_AUTH: '触发了安全验证（滑块）：在那个窗口里打开任意商品页完成验证后重试',
  NON_JSON: '接口返回了非 JSON 内容，通常是安全验证，请完成滑块后重试',
  BUSY: '已有一次查询在进行中，请等它跑完',
  BROWSER_NOT_READY: '浏览器还没就绪，稍等几秒再试',
};
