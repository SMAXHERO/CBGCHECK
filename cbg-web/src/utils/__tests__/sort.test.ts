import { describe, expect, it } from 'vitest';
import { compareBy } from '@/utils/sort';
import type { Listing } from '@/types';

const row = (over: Partial<Listing>): Listing => ({ id: '', title: '', ...over }) as Listing;

describe('sort / compareBy', () => {
  describe('数字字段', () => {
    const rows = [row({ price: 300 }), row({ price: 100 }), row({ price: 200 })];

    it('升序按数值从小到大', () => {
      const sorted = [...rows].sort(compareBy('price', 'ascend'));
      expect(sorted.map((r) => r.price)).toEqual([100, 200, 300]);
    });

    it('降序按数值从大到小', () => {
      const sorted = [...rows].sort(compareBy('price', 'descend'));
      expect(sorted.map((r) => r.price)).toEqual([300, 200, 100]);
    });
  });

  describe('null / undefined 永远排最后', () => {
    const withMissing = () => [
      row({ price: null }),
      row({ price: 200 }),
      row({ price: undefined as unknown as number }),
      row({ price: 100 }),
    ];

    it('升序时缺失值在最后', () => {
      const sorted = withMissing().sort(compareBy('price', 'ascend'));
      expect(sorted.map((r) => r.price)).toEqual([100, 200, null, undefined]);
    });

    it('降序时缺失值仍在最后（不被顶到最前）', () => {
      const sorted = withMissing().sort(compareBy('price', 'descend'));
      expect(sorted.map((r) => r.price)).toEqual([200, 100, null, undefined]);
    });

    it('两边都缺失返回 0（相等）', () => {
      const cmp = compareBy('price', 'ascend');
      expect(cmp(row({ price: null }), row({ price: undefined as unknown as number }))).toBe(0);
    });
  });

  describe('字符串字段', () => {
    it('按 zh-CN localeCompare 排序（升序）', () => {
      const rows = [row({ title: '丙' }), row({ title: '甲' }), row({ title: '乙' })];
      const sorted = [...rows].sort(compareBy('title', 'ascend'));
      const expected = ['丙', '甲', '乙'].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      expect(sorted.map((r) => r.title)).toEqual(expected);
    });

    it('降序为升序的逆序', () => {
      const rows = [row({ title: 'a' }), row({ title: 'c' }), row({ title: 'b' })];
      const asc = [...rows].sort(compareBy('title', 'ascend')).map((r) => r.title);
      const desc = [...rows].sort(compareBy('title', 'descend')).map((r) => r.title);
      expect(desc).toEqual([...asc].reverse());
    });
  });

  describe('稳定性', () => {
    it('相等键保持原有相对顺序（Array.prototype.sort 稳定）', () => {
      const rows = [
        row({ id: 'a', price: 100 }),
        row({ id: 'b', price: 100 }),
        row({ id: 'c', price: 100 }),
      ];
      const asc = [...rows].sort(compareBy('price', 'ascend')).map((r) => r.id);
      const desc = [...rows].sort(compareBy('price', 'descend')).map((r) => r.id);
      expect(asc).toEqual(['a', 'b', 'c']);
      expect(desc).toEqual(['a', 'b', 'c']);
    });
  });
});
