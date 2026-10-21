import { describe, expect, it } from 'vitest';
import { listingExportColumns, listingPrintColumns } from '@/utils/columns';
import type { ExportColumn, Listing } from '@/types';

const base = {
  id: 'ord-1',
  order_sn: 'ord-1',
  eid: 'eid-1',
  title: '账号',
  price: 12345,
  collect_num: 3,
  server_id: 12,
  server_name: '区一',
  area_name: '华东',
  level_desc: '满级',
  ssr: 10,
  six_star: 5,
  sign_days: 500,
  sanjian_speed: 158.456,
  zhaocai_speed: 150.111,
  tou_num: 3,
  wei_num: 2,
  tou_speed: 120.999,
  pvp: 2000,
  titles: ['天下一', '地域'],
  highlights: ['亮点A', '亮点B'],
  selling_time: '2026-10-01',
  fair_show_end_time: '2026-10-10',
  status_label: '在售',
  expire_remain_hours: 24,
  allow_bargain: true,
  source_tag: 'src',
} as unknown as Listing;

const byKey = (key: string): ExportColumn<Listing> => {
  const col = listingExportColumns.find((c) => c.key === key);
  if (!col) throw new Error(`missing column ${key}`);
  return col;
};

describe('columns', () => {
  describe('listingExportColumns 结构', () => {
    it('key 全局唯一', () => {
      const keys = listingExportColumns.map((c) => c.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('每列都有非空 title 与 value 函数', () => {
      for (const c of listingExportColumns) {
        expect(c.title.length).toBeGreaterThan(0);
        expect(typeof c.value).toBe('function');
      }
    });
  });

  describe('listingPrintColumns', () => {
    it('是 listingExportColumns 的子集（引用相同）', () => {
      for (const c of listingPrintColumns) {
        expect(listingExportColumns).toContain(c);
      }
    });

    it('key 清单与设计一致（12 列，顺序保持导出列原序）', () => {
      // 结果按 listingExportColumns 原顺序过滤，collect_num 位于 price 之后
      expect(listingPrintColumns.map((c) => c.key)).toEqual([
        'title',
        'price',
        'collect_num',
        'server_name',
        'ssr',
        'six_star',
        'sign_days',
        'sanjian_speed',
        'zhaocai_speed',
        'tou_wei',
        'tou_speed',
        'pvp',
      ]);
    });
  });

  describe('price 列：分 -> 元取整', () => {
    it('12345 分 -> 123 元（Math.round）', () => {
      expect(byKey('price').value(base)).toBe(123);
    });

    it('null 返回 null', () => {
      expect(byKey('price').value({ ...base, price: null } as Listing)).toBeNull();
    });

    it('标记为 numeric', () => {
      expect(byKey('price').numeric).toBe(true);
    });
  });

  describe('其余导出列取值（直接映射字段）', () => {
    it('逐列返回对应字段原值', () => {
      const expected: Record<string, unknown> = {
        title: '账号',
        collect_num: 3,
        server_name: '区一',
        area_name: '华东',
        level_desc: '满级',
        ssr: 10,
        six_star: 5,
        sign_days: 500,
        pvp: 2000,
        selling_time: '2026-10-01',
        fair_show_end_time: '2026-10-10',
        status_label: '在售',
        expire_remain_hours: 24,
        source_tag: 'src',
      };
      for (const [key, value] of Object.entries(expected)) {
        expect(byKey(key).value(base)).toBe(value);
      }
    });

    it('zhaocai_speed 列 round2', () => {
      expect(byKey('zhaocai_speed').value(base)).toBe(150.11);
    });

    it('numeric 标记：数值列为 true，文本列未标记', () => {
      expect(byKey('ssr').numeric).toBe(true);
      expect(byKey('sanjian_speed').numeric).toBe(true);
      expect(byKey('title').numeric).toBeUndefined();
    });
  });

  describe('tou_wei 列', () => {
    it('tou_num 存在时拼接为「N头M尾」，wei_num 缺省按 0', () => {
      expect(byKey('tou_wei').value(base)).toBe('3头2尾');
      expect(byKey('tou_wei').value({ ...base, wei_num: null } as Listing)).toBe('3头0尾');
    });

    it('tou_num 为 null 时整列返回 null', () => {
      expect(byKey('tou_wei').value({ ...base, tou_num: null } as Listing)).toBeNull();
    });
  });

  describe('速度列保留两位小数', () => {
    it('散件一速 round2', () => {
      expect(byKey('sanjian_speed').value(base)).toBe(158.46);
    });

    it('头速度 null 时保持 null', () => {
      expect(byKey('tou_speed').value({ ...base, tou_speed: null } as Listing)).toBeNull();
    });
  });

  describe('allow_bargain 列', () => {
    it('true 为「是」，false 为「否」', () => {
      expect(byKey('allow_bargain').value(base)).toBe('是');
      expect(byKey('allow_bargain').value({ ...base, allow_bargain: false } as Listing)).toBe('否');
    });
  });

  describe('url 列拼接格式', () => {
    it('https://yys.cbg.163.com/cgi/mweb/equip/{server_id}/{id}', () => {
      expect(byKey('url').value(base)).toBe('https://yys.cbg.163.com/cgi/mweb/equip/12/ord-1');
    });

    it('server_id 为 null 时以空串代替', () => {
      expect(byKey('url').value({ ...base, server_id: null } as Listing)).toBe(
        'https://yys.cbg.163.com/cgi/mweb/equip//ord-1',
      );
    });
  });

  describe('titles / highlights 的 join 分隔符', () => {
    it('titles 以「、」连接', () => {
      expect(byKey('titles').value(base)).toBe('天下一、地域');
    });

    it('highlights 以「 / 」连接', () => {
      expect(byKey('highlights').value(base)).toBe('亮点A / 亮点B');
    });

    it('空数组输出空串', () => {
      expect(byKey('titles').value({ ...base, titles: [] } as Listing)).toBe('');
    });
  });
});
