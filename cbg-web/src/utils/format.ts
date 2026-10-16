const CNY = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  maximumFractionDigits: 0,
});

/** 藏宝阁价格单位是「分」，展示时转成「元」 */
export const fenToYuan = (fen: number | null | undefined): number | null =>
  fen === null || fen === undefined ? null : fen / 100;

export const formatPrice = (fen: number | null | undefined): string => {
  const yuan = fenToYuan(fen);
  return yuan === null ? '-' : CNY.format(yuan);
};

/** 图表轴线上的紧凑写法：12.9万 */
export const formatPriceCompact = (fen: number | null | undefined): string => {
  const yuan = fenToYuan(fen);
  if (yuan === null) return '-';
  if (yuan >= 10000) return `${(yuan / 10000).toFixed(1)}万`;
  return `${Math.round(yuan)}`;
};

export const formatNumber = (n: number | null | undefined, digits = 0): string =>
  n === null || n === undefined || Number.isNaN(n) ? '-' : n.toFixed(digits);

export const formatSpeed = (n: number | null | undefined): string =>
  n === null || n === undefined ? '-' : n.toFixed(2);

export const formatPercent = (n: number, digits = 1): string => `${(n * 100).toFixed(digits)}%`;

/** 剩余时间：秒 -> 「13.5 天」这种可读形式 */
export const formatRemain = (seconds: number | null | undefined): string => {
  if (seconds === null || seconds === undefined) return '-';
  if (seconds <= 0) return '已结束';
  const days = seconds / 86400;
  if (days >= 1) return `${days.toFixed(1)} 天`;
  const hours = seconds / 3600;
  if (hours >= 1) return `${hours.toFixed(1)} 小时`;
  return `${Math.max(1, Math.round(seconds / 60))} 分钟`;
};

/** 签到天数 -> 「8.0 年」 */
export const formatSignYears = (days: number | null | undefined): string =>
  days === null || days === undefined ? '-' : `${(days / 365).toFixed(1)} 年`;

export const formatDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '-';
  return iso.replace('T', ' ').slice(0, 19);
};

/**
 * 千分位 + 保留位数的通用格式化，用于图表 tooltip。
 */
export const compact = (n: number): string => {
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)} 亿`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e4).toFixed(2)} 万`;
  return n.toLocaleString('zh-CN');
};
