import { describe, expect, it } from 'vitest';
import { applyParams, buildParams, fid, isSelectable, summarize } from '@/utils/params';
import type { SearchField, SearchSchema } from '@/api/searchSchema';

const serverName = (id: string) => `S${id}`;

/** 覆盖各类字段的最小 schema（section 0 为普通字段，section 1 为皮肤同 key 场景） */
const schema: SearchSchema = {
  searchType: 'role',
  name: 'test',
  totalFields: 0,
  sections: [
    {
      label: '基础',
      fields: [
        { kind: 'note', text: '说明文字' },
        { key: 'serverid', displayType: 'select_server', type: 'multiple_select' },
        { key: 'pass_fair_show', type: 'checkbox', label: '公示期' },
        { key: 'price', type: 'range_input_with_select', valueMultiply: 100, label: '价格' },
        { key: 'max_sanjian_speed', type: 'input_float', valueMultiply: 100, label: '散件一速', symbol: '≥' },
        {
          type: 'single_select_and_input',
          selectKey: 'tou_counts',
          inputKey: 'tou_speed',
          valueMultiply: 100,
          label: '头',
        },
        { key: 'sign_days', type: 'input_integer', label: '签到', symbol: '≥' },
        {
          key: 'platform_type',
          type: 'multiple_select',
          label: '平台',
          options: [
            { value: 1, label: 'iOS' },
            { value: 2, label: '安卓' },
          ],
        },
        { key: 'ghost', type: 'input_integer', label: '无选项且无 key 之外的情况' },
        { label: '无 key 的字段', type: 'input_integer' },
      ],
    },
    {
      label: '皮肤',
      fields: [
        // 同一 key 的两个多选字段：只取第一个有值的
        {
          key: 'skin_id',
          type: 'multiple_select',
          label: '皮肤A',
          options: [
            { value: 'a1', label: 'A1' },
            { value: 'a2', label: 'A2' },
          ],
        },
        {
          key: 'skin_id',
          type: 'multiple_select',
          label: '皮肤B',
          options: [
            { value: 'b1', label: 'B1' },
          ],
        },
      ],
    },
  ],
};

/** 按 fid 生成的字段下标：section0 field1=区服，section0 field2=开关 等 */
const F = {
  note: fid(0, 0),
  server: fid(0, 1),
  fair: fid(0, 2),
  price: fid(0, 3),
  speed: fid(0, 4),
  tou: fid(0, 5),
  sign: fid(0, 6),
  platform: fid(0, 7),
  ghost: fid(0, 8),
  noKey: fid(0, 9),
  skinA: fid(1, 0),
  skinB: fid(1, 1),
};

describe('params', () => {
  describe('fid', () => {
    it('生成 sectionIndex_fieldIndex 键', () => {
      expect(fid(0, 0)).toBe('0_0');
      expect(fid(3, 12)).toBe('3_12');
    });
  });

  describe('summarize', () => {
    const f = (over: Partial<SearchField>): SearchField => ({ key: 'k', ...over });

    it('null / undefined 返回空串', () => {
      expect(summarize(f({}), null, serverName)).toBe('');
      expect(summarize(f({}), undefined, serverName)).toBe('');
    });

    it('checkbox / check_box 始终返回空串（纯开关不显示摘要）', () => {
      expect(summarize(f({ type: 'checkbox' }), 'x', serverName)).toBe('');
      expect(summarize(f({ type: 'check_box' }), 'x', serverName)).toBe('');
    });

    it('select_server 调用 serverName 并以顿号连接', () => {
      const field = f({ displayType: 'select_server' });
      expect(summarize(field, ['1', '2'], serverName)).toBe('S1、S2');
    });

    it('数组值经 options 映射为 label，未命中时保留原值', () => {
      const field = f({
        options: [
          { value: 1, label: 'iOS' },
          { value: 2, label: '安卓' },
        ],
      });
      expect(summarize(field, ['1', '2', '9'], serverName)).toBe('iOS、安卓、9');
    });

    it('区间对象：min/max 缺省时分别显示 0 与「不限」', () => {
      expect(summarize(f({}), { min: '10', max: '20' }, serverName)).toBe('10~20');
      expect(summarize(f({}), { min: '', max: '' }, serverName)).toBe('0~不限');
      expect(summarize(f({}), { min: '5' }, serverName)).toBe('5~不限');
    });

    it('单速度对象（num/speed）：缺省显示 ?', () => {
      expect(summarize(f({}), { num: '3', speed: '158' }, serverName)).toBe('3个 ≥ 158');
      expect(summarize(f({}), { num: '', speed: '' }, serverName)).toBe('?个 ≥ ?');
    });

    it('普通值拼接 symbol；无 symbol 时只有值', () => {
      expect(summarize(f({ symbol: '≥' }), 100, serverName)).toBe('≥100');
      expect(summarize(f({}), 'abc', serverName)).toBe('abc');
      expect(summarize(f({}), 0, serverName)).toBe('0');
    });
  });

  describe('buildParams', () => {
    it('空选择仅输出 search_type（默认 role）', () => {
      const { params, labels } = buildParams(schema, new Map(), serverName);
      expect(params).toEqual({ search_type: 'role' });
      expect(labels).toEqual([]);
    });

    it('schema 未指定 searchType 时回退为 role', () => {
      const s = { ...schema, searchType: '' };
      const { params } = buildParams(s, new Map(), serverName);
      expect(params.search_type).toBe('role');
    });

    it('note 字段即使被选中也跳过', () => {
      const sel = new Map<string, unknown>([[F.note, 'x']]);
      const { params, labels } = buildParams(schema, sel, serverName);
      expect(params).toEqual({ search_type: 'role' });
      expect(labels).toHaveLength(0);
    });

    it('区服：去重后逗号拼接，并生成中文显示名', () => {
      const sel = new Map<string, unknown>([[F.server, ['12', '12', '13']]]);
      const { params, labels } = buildParams(schema, sel, serverName);
      expect(params.serverid).toBe('12,13');
      expect(labels[0]).toMatchObject({ label: '区服', display: 'S12、S13' });
    });

    it('开关字段输出 key=字符串化值，label 显示「是」', () => {
      const sel = new Map<string, unknown>([[F.fair, '1']]);
      const { params, labels } = buildParams(schema, sel, serverName);
      expect(params.pass_fair_show).toBe('1');
      expect(labels[0]).toMatchObject({ display: '是', param: 'pass_fair_show=1' });
    });

    it('区间 ×mult：min/max 分别乘倍率；空串与 null 不输出', () => {
      const sel = new Map<string, unknown>([[F.price, { min: '100', max: '' }]]);
      const { params, labels } = buildParams(schema, sel, serverName);
      expect(params.price_min).toBe('10000');
      expect(params).not.toHaveProperty('price_max');
      expect(labels[0].display).toBe('100~不限');
    });

    it('区间 max 有值时输出 price_max ×mult', () => {
      const sel = new Map<string, unknown>([[F.price, { min: '', max: '2.5' }]]);
      const { params } = buildParams(schema, sel, serverName);
      expect(params.price_max).toBe('250');
      expect(params).not.toHaveProperty('price_min');
    });

    it('single_select_and_input：selectKey 不乘倍率，inputKey 乘倍率', () => {
      const sel = new Map<string, unknown>([[F.tou, { num: '3', speed: '158' }]]);
      const { params, labels } = buildParams(schema, sel, serverName);
      expect(params.tou_counts).toBe('3');
      expect(params.tou_speed).toBe('15800');
      expect(labels[0]).toMatchObject({ display: '3个 ≥ 158' });
    });

    it('single_select_and_input：空 num / 空 speed 时不输出对应参数', () => {
      const sel = new Map<string, unknown>([[F.tou, { num: '', speed: '' }]]);
      const { params } = buildParams(schema, sel, serverName);
      expect(params).not.toHaveProperty('tou_counts');
      expect(params).not.toHaveProperty('tou_speed');
    });

    it('多选胶囊：同 key 只保留第一个有值的字段（皮肤去重）', () => {
      const sel = new Map<string, unknown>([
        [F.skinA, ['a1', 'a2']],
        [F.skinB, ['b1']],
      ]);
      const { params, labels } = buildParams(schema, sel, serverName);
      expect(params.skin_id).toBe('a1,a2');
      // 第二个同 key 字段被丢弃，不产生第二条 label
      expect(labels.filter((l) => l.param.startsWith('skin_id'))).toHaveLength(1);
    });

    it('多选胶囊 display 经 options 映射 label', () => {
      const sel = new Map<string, unknown>([[F.platform, [1, 2]]]);
      const { params, labels } = buildParams(schema, sel, serverName);
      expect(params.platform_type).toBe('1,2');
      expect(labels[0].display).toBe('iOS、安卓');
    });

    it('纯数字输入 ×mult：有限数值参与倍率，非数字原样输出', () => {
      const sel = new Map<string, unknown>([[F.sign, '500']]);
      const { params } = buildParams(schema, sel, serverName);
      expect(params.sign_days).toBe('500');

      // NaN 分支：valueMultiply 缺省为 1，非数字字符串原样保留
      const nanSel = new Map<string, unknown>([[F.speed, 'abc']]);
      const { params: p2 } = buildParams(schema, nanSel, serverName);
      expect(p2.max_sanjian_speed).toBe('abc');
    });

    it('纯数字输入 ×mult：倍率字段的数字参与乘法', () => {
      const sel = new Map<string, unknown>([[F.speed, '158']]);
      const { params, labels } = buildParams(schema, sel, serverName);
      expect(params.max_sanjian_speed).toBe('15800');
      expect(labels[0].display).toBe('≥158');
    });

    it('没有 key 的普通字段被跳过', () => {
      const sel = new Map<string, unknown>([[F.noKey, '1']]);
      const { params, labels } = buildParams(schema, sel, serverName);
      expect(params).toEqual({ search_type: 'role' });
      expect(labels).toHaveLength(0);
    });

    it('未选中的字段不输出', () => {
      const { params } = buildParams(schema, new Map([[F.fair, '1']]), serverName);
      expect(params).not.toHaveProperty('sign_days');
    });
  });

  describe('applyParams', () => {
    it('会先清空 selected 再回填', () => {
      const sel = new Map<string, unknown>([['stale', 1]]);
      applyParams(schema, { search_type: 'role' }, sel);
      expect(sel.has('stale')).toBe(false);
      expect(sel.size).toBe(0);
    });

    it('区服回填为数组；serverid 为空串时得到空数组', () => {
      const sel = new Map<string, unknown>();
      applyParams(schema, { serverid: '12, 13' }, sel);
      expect(sel.get(F.server)).toEqual(['12', '13']);

      const sel2 = new Map<string, unknown>();
      applyParams(schema, { serverid: '' }, sel2);
      expect(sel2.get(F.server)).toEqual([]);
    });

    it('开关回填为字符串', () => {
      const sel = new Map<string, unknown>();
      applyParams(schema, { pass_fair_show: '0' }, sel);
      expect(sel.get(F.fair)).toBe('0');
    });

    it('区间回填：min/max ÷mult', () => {
      const sel = new Map<string, unknown>();
      applyParams(schema, { price_min: '10000', price_max: '25000' }, sel);
      expect(sel.get(F.price)).toEqual({ min: '100', max: '250' });
    });

    it('区间仅一侧存在时另一侧为空串', () => {
      const sel = new Map<string, unknown>();
      applyParams(schema, { price_min: '5000' }, sel);
      expect(sel.get(F.price)).toEqual({ min: '50', max: '' });
    });

    it('单速度回填：selectKey 原样、inputKey ÷mult', () => {
      const sel = new Map<string, unknown>();
      applyParams(schema, { tou_counts: '3', tou_speed: '15800' }, sel);
      expect(sel.get(F.tou)).toEqual({ num: '3', speed: '158' });
    });

    it('单速度仅有一侧时另一侧为空', () => {
      const sel = new Map<string, unknown>();
      applyParams(schema, { tou_speed: '15200' }, sel);
      expect(sel.get(F.tou)).toEqual({ num: '', speed: '152' });
    });

    it('多选胶囊仅回填在 options 中有效的值', () => {
      const sel = new Map<string, unknown>();
      applyParams(schema, { platform_type: '1,9,2' }, sel);
      expect(sel.get(F.platform)).toEqual(['1', '2']);
    });

    it('多选胶囊全部无效时不回填', () => {
      const sel = new Map<string, unknown>();
      applyParams(schema, { platform_type: '8,9' }, sel);
      expect(sel.has(F.platform)).toBe(false);
    });

    it('同 key 多选字段只回填第一个生效的', () => {
      const sel = new Map<string, unknown>();
      applyParams(schema, { skin_id: 'b1,a1' }, sel);
      // 第一个字段 skinA 命中 a1，之后 skinB 因 used 已含 skin_id 被跳过
      expect(sel.get(F.skinA)).toEqual(['a1']);
      expect(sel.has(F.skinB)).toBe(false);
    });

    it('普通数字回填 ÷mult', () => {
      const sel = new Map<string, unknown>();
      applyParams(schema, { max_sanjian_speed: '15800' }, sel);
      expect(sel.get(F.speed)).toBe('158');
    });

    it('无 key 或参数缺失时不回填', () => {
      const sel = new Map<string, unknown>();
      applyParams(schema, {}, sel);
      expect(sel.size).toBe(0);
    });
  });

  describe('buildParams ↔ applyParams 往返一致性', () => {
    it('倍率字段 158 -> 15800 -> 158 保持不变', () => {
      const sel = new Map<string, unknown>([[F.speed, '158']]);
      const { params } = buildParams(schema, sel, serverName);
      expect(params.max_sanjian_speed).toBe('15800');

      const back = new Map<string, unknown>();
      applyParams(schema, params, back);
      expect(back.get(F.speed)).toBe('158');
    });

    it('区间与单速度往返后一致', () => {
      const sel = new Map<string, unknown>([
        [F.price, { min: '100', max: '300' }],
        [F.tou, { num: '2', speed: '152' }],
      ]);
      const { params } = buildParams(schema, sel, serverName);
      const back = new Map<string, unknown>();
      applyParams(schema, params, back);
      expect(back.get(F.price)).toEqual({ min: '100', max: '300' });
      expect(back.get(F.tou)).toEqual({ num: '2', speed: '152' });
    });
  });

  describe('isSelectable', () => {
    it('note 字段不可选', () => {
      expect(isSelectable({ kind: 'note', key: 'x' })).toBe(false);
    });

    it('checkbox / check_box 无 key 也可选', () => {
      expect(isSelectable({ type: 'checkbox' })).toBe(true);
      expect(isSelectable({ type: 'check_box' })).toBe(true);
    });

    it('有 key 的字段可选；无 key 且非开关、非区服则不可选', () => {
      expect(isSelectable({ key: 'sign_days' })).toBe(true);
      expect(isSelectable({ type: 'input_integer' })).toBe(false);
    });

    it('select_server 即使无 key 也可选', () => {
      expect(isSelectable({ displayType: 'select_server' })).toBe(true);
    });
  });
});
