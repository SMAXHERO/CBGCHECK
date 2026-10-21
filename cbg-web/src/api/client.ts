/**
 * 伴随服务 HTTP 客户端 —— 四个 API 模块共用的唯一 fetch 实现。
 *
 * 之前 live / account / soul / inspector 各写了一份 request()，超时、错误上报、
 * 非 JSON 处理的行为都不一致；现在统一到这里：
 *  - 超时用 AbortController 控制，到点转成可读的 ApiError（而不是裸的 AbortError）
 *  - 非 JSON 响应给出可读报错（通常是代理层 502 或安全验证页）
 *  - HTTP 非 2xx 一律抛 ApiError，消息优先取 body 的 message / msg / error
 *  - 2xx 但 body.ok === false 也抛 ApiError（服务端约定：业务失败用 ok 表示）
 *  - 幂等 GET 失败默认重试 1 次；POST / 上传等绝不重试
 *
 * 所有 API 模块都只访问 SCRAPER_BASE 一个地址，跨源问题由伴随服务处理。
 */

/** 伴随服务地址：默认本机 8791；可用 VITE_SCRAPER_URL 覆盖（构建时注入）。 */
export const SCRAPER_BASE =
  (import.meta.env.VITE_SCRAPER_URL as string | undefined) ?? 'http://127.0.0.1:8791';

/** 默认超时（毫秒）：与模块三/四原来的 request() 默认值保持一致。 */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** GET 失败重试的间隔（毫秒）：只用来扛一次网络抖动，不做指数退避。 */
const RETRY_DELAY_MS = 300;

/** 单次请求的可选行为。 */
export interface RequestOptions {
  /** 超时毫秒数；不传用 DEFAULT_TIMEOUT_MS（30 秒）。 */
  timeoutMs?: number;
  /**
   * 幂等请求（GET/HEAD）失败后的重试次数，默认 1。
   * 非 GET（POST / 上传 / 取消等）没有副作用保证，永远不重试。
   */
  retryGet?: number;
}

/**
 * 统一的接口错误。
 *
 * 保留 code / status / parsed 三个附加字段：
 *  - code   服务端业务错误码（body.error 或 body.code），如 SESSION_TIMEOUT、BUSY
 *  - status HTTP 状态码；网络层失败或超时为 0
 *  - parsed 响应体里的 body.parsed（如账号分析的 NEED_EID 会附带解析结果）
 */
export class ApiError extends Error {
  /** 服务端业务错误码；没有就是 undefined */
  code?: string;
  /** HTTP 状态码；网络错误 / 超时为 0 */
  status: number;
  /** 响应体里的 body.parsed；没有就是 undefined */
  parsed?: unknown;

  constructor(message: string, init: { status: number; code?: string; parsed?: unknown }) {
    super(message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.parsed = init.parsed;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** 响应体里可能承载错误信息的字段，按优先级取第一个非空字符串 */
const BODY_MESSAGE_KEYS = ['message', 'msg', 'error'] as const;

const pickMessage = (body: unknown): string | undefined => {
  if (!isRecord(body)) return undefined;
  for (const key of BODY_MESSAGE_KEYS) {
    const v = body[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return undefined;
};

const pickCode = (body: unknown): string | undefined => {
  if (!isRecord(body)) return undefined;
  const v = body.error ?? body.code;
  return typeof v === 'string' && v ? v : undefined;
};

const pickParsed = (body: unknown): unknown => (isRecord(body) ? body.parsed : undefined);

/** GET / HEAD 才允许自动重试；method 缺省即 GET */
const isIdempotent = (init?: RequestInit): boolean => {
  const method = (init?.method ?? 'GET').toUpperCase();
  return method === 'GET' || method === 'HEAD';
};

const isAbortError = (err: unknown): boolean =>
  isRecord(err) && (err as { name?: unknown }).name === 'AbortError';

const isRetryable = (err: unknown): boolean => {
  if (!(err instanceof ApiError)) return false;
  // 网络抖动、代理层 5xx 值得重试；4xx / 业务 ok:false / 非 JSON 的 2xx 不重试
  return err.code === 'NETWORK' || err.status >= 500;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const timeoutError = (path: string, timeoutMs: number): ApiError =>
  new ApiError(`请求超时（${timeoutMs} ms）：${path}`, { status: 0, code: 'TIMEOUT' });

const networkError = (err: unknown): ApiError =>
  new ApiError(
    `无法连接伴随服务（${SCRAPER_BASE}）：${err instanceof Error ? err.message : String(err)}`,
    { status: 0, code: 'NETWORK' },
  );

/** 发一次请求并解析；失败按约定抛 ApiError。 */
async function requestOnce<T>(path: string, init: RequestInit | undefined, timeoutMs: number): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(`${SCRAPER_BASE}${path}`, { ...init, signal: ctl.signal });
    } catch (err) {
      throw isAbortError(err) ? timeoutError(path, timeoutMs) : networkError(err);
    }

    let text: string;
    try {
      text = await res.text();
    } catch (err) {
      throw isAbortError(err) ? timeoutError(path, timeoutMs) : networkError(err);
    }

    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        // 代理层 502 的 HTML、安全验证页之类：把开头一段带上，便于定位
        throw new ApiError(`服务返回非 JSON（HTTP ${res.status}）：${text.slice(0, 120)}`, {
          status: res.status,
          code: 'NON_JSON',
        });
      }
    }

    if (!res.ok) {
      throw new ApiError(pickMessage(body) ?? `HTTP ${res.status} ${res.statusText}`.trim(), {
        status: res.status,
        code: pickCode(body),
        parsed: pickParsed(body),
      });
    }

    if (isRecord(body) && body.ok === false) {
      throw new ApiError(pickMessage(body) ?? '请求失败', {
        status: res.status,
        code: pickCode(body),
        parsed: pickParsed(body),
      });
    }

    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 访问伴随服务。
 *
 * @param path 以 `/` 开头的接口路径，如 `/api/account/analyze`
 * @param init 透传给 fetch 的 init（method / headers / body）
 * @param opts 超时与重试选项；默认 30 秒、GET 重试 1 次
 */
export async function request<T>(path: string, init?: RequestInit, opts: RequestOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = isIdempotent(init) ? Math.max(0, opts.retryGet ?? 1) : 0;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestOnce<T>(path, init, timeoutMs);
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      await sleep(RETRY_DELAY_MS);
    }
  }
}
