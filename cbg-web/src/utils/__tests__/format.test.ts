import { describe, expect, it } from 'vitest';
import {
  compact,
  fenToYuan,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatPrice,
  formatPriceCompact,
  formatRemain,
  formatSignYears,
  formatSpeed,
} from '@/utils/format';

describe('format', () => {
  describe('fenToYuan', () => {
    it('null / undefined 返回 null', () => {
      expect(fenToYuan(null)).toBeNull();
      expect(fenToYuan(undefined)).toBeNull();
    });

    it('0 返回 0（不被当成缺失）', () => {
      expect(fenToYuan(0)).toBe(0);
    });

    it('分转元，支持负数', () => {
      expect(fenToYuan(12345)).toBe(123.45);
      expect(fenToYuan(-500)).toBe(-5);
    });
  });

  describe('formatPrice', () => {
    it('null / undefined 显示 "-"', () => {
      expect(formatPrice(null)).toBe('-');
      expect(formatPrice(undefined)).toBe('-');
    });

    it('按 zh-CN 人民币格式（无小数，四舍五入）', () => {
      // 期望值用同源 Intl 计算，避免 ICU 差异（见 plan Q5）
      const CNY = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 });
      expect(formatPrice(12345)).toBe(CNY.format(123.45));
      expect(formatPrice(0)).toBe(CNY.format(0));
    });
  });

  describe('formatPriceCompact', () => {
    it('null / undefined 显示 "-"', () => {
      expect(formatPriceCompact(null)).toBe('-');
      expect(formatPriceCompact(undefined)).toBe('-');
    });

    it('≥10000 元 用「万」并保留一位小数', () => {
      // 1,290,000 分 = 12,900 元 -> 1.3 万
      expect(formatPriceCompact(1290000)).toBe('1.3万');
    });

    it('<10000 元 取整不带单位', () => {
      expect(formatPriceCompact(12345)).toBe('123');
      expect(formatPriceCompact(0)).toBe('0');
    });

    it('正好 10000 元 边界进入万', () => {
      expect(formatPriceCompact(1000000)).toBe('1.0万');
    });
  });

  describe('formatNumber', () => {
    it('null / undefined / NaN 显示 "-"', () => {
      expect(formatNumber(null)).toBe('-');
      expect(formatNumber(undefined)).toBe('-');
      expect(formatNumber(Number.NaN)).toBe('-');
    });

    it('默认 0 位小数，传参控制位数', () => {
      expect(formatNumber(3.7)).toBe('4');
      expect(formatNumber(3.14159, 2)).toBe('3.14');
    });
  });

  describe('formatSpeed', () => {
    it('null / undefined 显示 "-"', () => {
      expect(formatSpeed(null)).toBe('-');
      expect(formatSpeed(undefined)).toBe('-');
    });

    it('固定两位小数', () => {
      expect(formatSpeed(158)).toBe('158.00');
      expect(formatSpeed(0)).toBe('0.00');
    });
  });

  describe('formatPercent', () => {
    it('比例转百分比，默认一位小数', () => {
      expect(formatPercent(0.5)).toBe('50.0%');
      expect(formatPercent(0.1234)).toBe('12.3%');
    });

    it('可指定小数位', () => {
      expect(formatPercent(0.5, 0)).toBe('50%');
    });
  });

  describe('formatRemain', () => {
    it('null / undefined 显示 "-"', () => {
      expect(formatRemain(null)).toBe('-');
      expect(formatRemain(undefined)).toBe('-');
    });

    it('≤0 显示「已结束」（含 0 边界）', () => {
      expect(formatRemain(0)).toBe('已结束');
      expect(formatRemain(-1)).toBe('已结束');
    });

    it('≥1 天用「天」', () => {
      expect(formatRemain(86400)).toBe('1.0 天');
      expect(formatRemain(86400 * 13.5)).toBe('13.5 天');
    });

    it('[1 小时, 1 天) 用「小时」', () => {
      expect(formatRemain(3600)).toBe('1.0 小时');
      expect(formatRemain(3600 * 5.5)).toBe('5.5 小时');
    });

    it('<1 小时 用「分钟」，最少显示 1 分钟', () => {
      expect(formatRemain(30)).toBe('1 分钟'); // 30s -> 0.5 min -> round=1 -> max(1,1)=1
      expect(formatRemain(600)).toBe('10 分钟');
      expect(formatRemain(1)).toBe('1 分钟');
    });
  });

  describe('formatSignYears', () => {
    it('null / undefined 显示 "-"', () => {
      expect(formatSignYears(null)).toBe('-');
      expect(formatSignYears(undefined)).toBe('-');
    });

    it('天数 / 365 保留一位小数', () => {
      expect(formatSignYears(365)).toBe('1.0 年');
      expect(formatSignYears(730)).toBe('2.0 年');
      expect(formatSignYears(0)).toBe('0.0 年');
    });
  });

  describe('formatDateTime', () => {
    it('null / 空串显示 "-"', () => {
      expect(formatDateTime(null)).toBe('-');
      expect(formatDateTime(undefined)).toBe('-');
      expect(formatDateTime('')).toBe('-');
    });

    it('ISO T 替换为空格并截断到秒', () => {
      expect(formatDateTime('2026-10-21T12:34:56.789+08:00')).toBe('2026-10-21 12:34:56');
    });

    it('无 T 的字符串只做截断', () => {
      expect(formatDateTime('2026-10-21 01:02:03.5')).toBe('2026-10-21 01:02:03');
    });
  });

  describe('compact', () => {
    it('≥1 亿 用「亿」保留两位小数', () => {
      expect(compact(250000000)).toBe('2.50 亿');
      expect(compact(-150000000)).toBe('-1.50 亿');
    });

    it('[1 万, 1 亿) 用「万」保留两位小数', () => {
      expect(compact(12345)).toBe('1.23 万');
    });

    it('<1 万 按 zh-CN 千分位输出', () => {
      expect(compact(999)).toBe((999).toLocaleString('zh-CN'));
      expect(compact(0)).toBe('0');
    });

    it('负数 |n| 同样适用阈值，符号保留', () => {
      expect(compact(-20000)).toBe('-2.00 万');
    });
  });
});
