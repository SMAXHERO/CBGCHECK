import { fenToYuan } from './format';
import type { Listing } from '@/types';

/** 面板顶部的核心指标 */
export interface Kpi {
  label: string;
  value: string;
  /** 副标题，例如「中位数 ¥1,290」 */
  hint?: string;
  /** 数值型原值，用于排序或后续扩展 */
  raw?: number | null;
}

export interface Histogram {
  labels: string[];
  /** 每个区间的下限（元），用于 tooltip */
  bounds: number[];
  counts: number[];
}

export interface TierStat {
  name: string;
  value: number;
  /** 可选的自定义配色（平台占比用） */
  color?: string;
}

export interface ScatterPoint {
  /** [签到天数, 散件一速, 价格(元), 记录索引] */
  value: [number, number, number, number];
  name: string;
}

export interface Analytics {
  kpis: Kpi[];
  priceHistogram: Histogram;
  speedTiers: TierStat[];
  platformShare: TierStat[];
  /** 签到天数 × 散件一速 散点 */
  signVsSpeed: ScatterPoint[];
  priceBins: number;
}

const quantile = (sorted: number[], q: number): number => {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
};

const mean = (nums: number[]): number => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);

const pick = (rows: Listing[], field: keyof Listing): number[] =>
  rows.map((r) => r[field]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

const yuan = (fen: number): string => `¥${Math.round(fenToYuan(fen) ?? 0).toLocaleString('zh-CN')}`;

/** 价格直方图：等宽分箱，箱数自适应记录数 */
export const buildPriceHistogram = (prices: number[], bins = 8): Histogram => {
  if (!prices.length) return { labels: [], bounds: [], counts: [] };
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  // 轴上只放下界（元），两个数已经够定位；原本的「下界~上界」在 8 个箱时会糊成一团
  const label = (v: number) => String(Math.round(fenToYuan(v) ?? 0));
  if (min === max) {
    return { labels: [label(min)], bounds: [min], counts: [prices.length] };
  }
  const width = (max - min) / bins;
  const bounds = Array.from({ length: bins }, (_, i) => min + width * i);
  const counts = new Array(bins).fill(0);
  for (const p of prices) {
    const idx = Math.min(bins - 1, Math.floor((p - min) / width));
    counts[idx] += 1;
  }
  const labels = bounds.map((b, i) => (i === bins - 1 ? `${label(b)}~${label(max)}` : label(b)));
  return { labels, bounds, counts };
};

/** 平台占比配色：安卓蓝、iOS 绿，避免与强调色（价格）的红撞在一起 */
const PLATFORM_COLORS: Record<string, string> = {
  安卓: '#1677ff',
  iOS: '#34d07f',
};

/** 散件一速分段统计，用于看「高速号」都集中在哪个区间 */
export const buildSpeedTiers = (speeds: number[]): TierStat[] => {
  const edges = [0, 150, 152, 154, 156, 158, 200];
  const names = ['<150', '150~152', '152~154', '154~156', '156~158', '158+'];
  const counts = new Array(names.length).fill(0);
  for (const s of speeds) {
    for (let i = names.length - 1; i >= 0; i -= 1) {
      if (s >= edges[i]) {
        counts[i] += 1;
        break;
      }
    }
  }
  return names.map((name, i) => ({ name, value: counts[i] })).filter((t) => t.value > 0);
};

const PLATFORM_NAMES: Record<number, string> = { 1: 'iOS', 2: '安卓', 3: '双平台', 4: '全平台' };

export const buildPlatformShare = (rows: Listing[]): TierStat[] => {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = r.platform_type !== null ? (PLATFORM_NAMES[r.platform_type] ?? `类型${r.platform_type}`) : '未知';
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value, color: PLATFORM_COLORS[name] }))
    .sort((a, b) => b.value - a.value);
};

/** 散点最多画 500 个点，避免 ECharts 在低端机上掉帧 */
const SCATTER_LIMIT = 500;

export const buildSignVsSpeed = (rows: Listing[]): ScatterPoint[] => {
  const pts: ScatterPoint[] = [];
  rows.forEach((r, i) => {
    if (r.sign_days === null || r.sanjian_speed === null) return;
    pts.push({
      value: [r.sign_days, r.sanjian_speed, Math.round(fenToYuan(r.price) ?? 0), i],
      name: r.title,
    });
  });
  if (pts.length <= SCATTER_LIMIT) return pts;
  const step = pts.length / SCATTER_LIMIT;
  return Array.from({ length: SCATTER_LIMIT }, (_, i) => pts[Math.floor(i * step)]);
};

/**
 * 一次性算出面板需要的所有统计量。
 * 传入的 rows 应当是**已筛选**后的数据，这样图表和表格永远说的是同一批账号。
 */
export const computeAnalytics = (rows: Listing[]): Analytics => {
  const prices = pick(rows, 'price').sort((a, b) => a - b);
  const speeds = pick(rows, 'sanjian_speed');
  const zhaocai = pick(rows, 'zhaocai_speed');
  const signs = pick(rows, 'sign_days');
  const ssr = pick(rows, 'ssr');
  const sixStar = pick(rows, 'six_star');
  const collects = pick(rows, 'collect_num');

  const median = quantile(prices, 0.5);
  const p25 = quantile(prices, 0.25);
  const p75 = quantile(prices, 0.75);
  const fastest = speeds.length ? Math.max(...speeds) : null;
  const fastestZhaocai = zhaocai.length ? Math.max(...zhaocai) : null;

  const kpis: Kpi[] = [
    {
      label: '命中账号',
      value: rows.length.toLocaleString('zh-CN'),
      hint: collects.length ? `累计收藏 ${collects.reduce((a, b) => a + b, 0)} 次` : undefined,
      raw: rows.length,
    },
    {
      label: '价格中位数',
      value: prices.length ? yuan(median) : '-',
      hint: prices.length ? `区间 ${yuan(prices[0])} ~ ${yuan(prices[prices.length - 1])}` : undefined,
      raw: median,
    },
    {
      label: '价格四分位',
      value: prices.length ? `${yuan(p25)} ~ ${yuan(p75)}` : '-',
      hint: 'P25 ~ P75，代表主流成交带',
      raw: p75 - p25,
    },
    {
      label: '最快散件一速',
      value: fastest === null ? '-' : fastest.toFixed(2),
      hint:
        speeds.length > 1
          ? `平均 ${mean(speeds).toFixed(2)}，${speeds.filter((s) => s >= 158).length} 个 ≥158`
          : undefined,
      raw: fastest,
    },
    {
      label: '最快招财一速',
      value: fastestZhaocai === null ? '-' : fastestZhaocai.toFixed(2),
      hint: zhaocai.length ? `平均 ${mean(zhaocai).toFixed(2)}` : undefined,
      raw: fastestZhaocai,
    },
    {
      label: '平均签到',
      value: signs.length ? `${Math.round(mean(signs))} 天` : '-',
      hint: signs.length ? `最长 ${(Math.max(...signs) / 365).toFixed(1)} 年` : undefined,
      raw: signs.length ? mean(signs) : null,
    },
    {
      label: 'SSR / 六星 均值',
      value: ssr.length || sixStar.length
        ? `${Math.round(mean(ssr))} / ${Math.round(mean(sixStar))}`
        : '-',
      hint: `SSR 最高 ${ssr.length ? Math.max(...ssr) : '-'}`,
      raw: ssr.length ? mean(ssr) : null,
    },
    {
      label: '高战号占比',
      value: rows.length ? `${((speeds.filter((s) => s >= 158).length / rows.length) * 100).toFixed(1)}%` : '-',
      hint: '散件一速 ≥ 158 的比例',
      raw: rows.length ? speeds.filter((s) => s >= 158).length / rows.length : null,
    },
  ];

  return {
    kpis,
    priceHistogram: buildPriceHistogram(prices, 8),
    speedTiers: buildSpeedTiers(speeds),
    platformShare: buildPlatformShare(rows),
    signVsSpeed: buildSignVsSpeed(rows),
    priceBins: 8,
  };
};
