import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SearchParams } from '@/api/searchSchema';
import { liveApi, type HealthInfo, type SearchProgress, type SearchResult, type ServiceStatus } from '@/api/live';
import { computeAnalytics, type Analytics } from '@/utils/analytics';
import { useRenderCount } from '@/hooks/useRenderCount';
import type { Listing } from '@/types';

/**
 * 实时数据源：伴随服务 + 真实登录浏览器。
 *
 * 这个模式**没有快照兜底**：服务不可用或未登录时，界面只给出怎么修，
 * 绝不显示任何旧的静态数据——避免你看着一份过期清单做判断。
 *
 * 交互设计：不在条件变化时自动重查。藏宝阁有风控，条件每变一次就打一轮请求
 * 既慢又容易被限流。所以条件是「攒着」的，由你点查询才发出去。
 */

const POLL_MS = 1200;
const POLL_TIMEOUT_MS = 180_000; // 20 页 × 1.6 秒节流，留足余量

export interface LiveView {
  /** 服务状态 */
  status: ServiceStatus;
  health: HealthInfo | null;
  /** 是否正在跑查询 */
  running: boolean;
  progress: SearchProgress;
  /** 最近一次查询的结果 */
  result: SearchResult | null;
  rows: Listing[];
  analytics: Analytics;
  /** 是否已经查过至少一次（区分「还没查」和「查了没结果」） */
  hasQueried: boolean;
  /** 发起查询；不传参数则沿用上一次的条件 */
  query: (values?: SearchParams) => Promise<void>;
  /** 重新探测服务 */
  recheck: () => Promise<void>;
  /** 面向用户的错误提示 */
  errorText: string | null;
  serviceMessage: string;
}

const EMPTY_PROGRESS: SearchProgress = { pages: 0, count: 0, total: null };

export const useLiveDataset = (): LiveView => {
  useRenderCount('useLiveDataset');
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SearchProgress>(EMPTY_PROGRESS);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [hasQueried, setHasQueried] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const lastParams = useRef<SearchParams>({});
  const jobIdRef = useRef<string | null>(null);
  const pollTimer = useRef<number | null>(null);
  const pollDeadline = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const recheck = useCallback(async () => {
    const info = await liveApi.health();
    setHealth(info);
  }, []);

  /** 轮询查询进度 */
  const poll = useCallback(async () => {
    try {
      const r = await liveApi.result();

      // 服务重启过 / 任务已换人，停止轮询
      if (jobIdRef.current && r.jobId && r.jobId !== jobIdRef.current) {
        stopPolling();
        setRunning(false);
        return;
      }

      if (r.progress) setProgress(r.progress);
      if (r.status) setHealth((h) => (h ? { ...h, status: r.status!, message: r.message ?? h.message } : h));

      if (r.running) {
        if (Date.now() > pollDeadline.current) {
          stopPolling();
          setRunning(false);
          setErrorText('查询超时（超过 3 分钟）。可能页数太多，或站点响应变慢。');
          return;
        }
        pollTimer.current = window.setTimeout(poll, POLL_MS);
        return;
      }

      // 结束
      stopPolling();
      setRunning(false);
      setHasQueried(true);
      setResult(r.result);
      if (r.result && !r.result.ok) {
        setErrorText(
          r.result.error === 'SESSION_TIMEOUT' || r.result.error === 'e12'
            ? '登录态失效：请在服务拉起的浏览器窗口里登录藏宝阁，然后重新查询。'
            : r.result.error === 'CAPTCHA_AUTH' || r.result.error === 'NON_JSON'
              ? '触发了安全验证（滑块）：在那个窗口里随便打开一个商品页，完成滑块后重新查询。'
              : `查询失败：${r.result.error ?? '未知'}${r.result.msg ? ` · ${r.result.msg}` : ''}`,
        );
      } else {
        setErrorText(null);
      }
    } catch (err) {
      stopPolling();
      setRunning(false);
      setErrorText(`轮询失败：${(err as Error).message}`);
    }
  }, [stopPolling]);

  const query = useCallback(
    async (values?: SearchParams) => {
      if (running) return;
      const params = values ?? lastParams.current;
      lastParams.current = params;

      setErrorText(null);
      setRunning(true);
      setProgress(EMPTY_PROGRESS);
      pollDeadline.current = Date.now() + POLL_TIMEOUT_MS;

      try {
        const started = await liveApi.search(params);
        if (!started.ok) {
          setRunning(false);
          setErrorText(
            started.error === 'BUSY'
              ? '服务正在跑上一次查询，请稍等它跑完。'
              : `无法发起查询：${started.error ?? ''} ${started.message ?? ''}`.trim(),
          );
          return;
        }
        jobIdRef.current = started.jobId ?? null;
        // 立刻开始轮询，让进度条动起来
        pollTimer.current = window.setTimeout(poll, 600);
      } catch (err) {
        setRunning(false);
        setErrorText(`无法连接伴随服务：${(err as Error).message}`);
      }
    },
    [poll, running],
  );

  // 常驻探测：服务没起来时每 5 秒试一次，起来了就放慢到 15 秒（只用于感知下线）
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      const info = await liveApi.health();
      if (cancelled) return;
      setHealth(info);
      const delay = info.status === 'offline' ? 5000 : 15000;
      timer = window.setTimeout(tick, delay);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const rows = useMemo(() => result?.rows ?? [], [result]);
  const analytics = useMemo(() => computeAnalytics(rows), [rows]);

  return {
    status: health?.status ?? 'starting',
    health,
    running,
    progress,
    result,
    rows,
    analytics,
    hasQueried,
    query,
    recheck,
    errorText,
    serviceMessage: health?.message ?? '正在探测伴随服务…',
  };
};
