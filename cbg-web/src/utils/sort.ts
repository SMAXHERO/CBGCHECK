import type { Listing } from '@/types';

/**
 * 表格排序比较器。
 * 约定：null / undefined 永远排最后，不管升序还是降序——
 * 否则「招财一速」这种有缺值的列在降序时会被 '- 未标注' 顶到最前面。
 */
export const compareBy = (
  field: keyof Listing,
  dir: 'ascend' | 'descend',
): ((a: Listing, b: Listing) => number) => {
  const sign = dir === 'ascend' ? 1 : -1;
  return (a, b) => {
    const av = a[field];
    const bv = b[field];

    const aMissing = av === null || av === undefined;
    const bMissing = bv === null || bv === undefined;
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;

    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
    return String(av).localeCompare(String(bv), 'zh-CN') * sign;
  };
};
