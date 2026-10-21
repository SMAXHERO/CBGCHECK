import { describe, expect, it } from 'vitest';
import {
  PARAM_LABELS,
  ServerIndex,
  UNSUPPORTED_PARAMS,
  buildPredicate,
  classifyConditionSupport,
} from '@/utils/predicate';
import type { ServerEntry, SearchParams } from '@/api/searchSchema';
import type { Listing } from '@/types';

const makeListing = (overrides: Partial<Listing> = {}): Listing =>
  ({
    id: 'ord-1',
    order_sn: 'ord-1',
    eid: 'eid-1',
    title: '测试账号',
    price: 10000,
    bare_price: null,
    collect_num: 0,
    server_id: 12,
    server_name: '区一',
    area_name: '华东',
    platform_type: 2,
    game_channel: '',
    equip_level: 100,
    level_desc: '',
    ssr: 10,
    six_star: 5,
    sign_days: 500,
    sanjian_speed: 158.5,
    zhaocai_speed: 150,
    tou_num: 3,
    wei_num: 2,
    tou_speed: 120,
    pvp: 2000,
    goyu: null,
    titles: [],
    highlights: [],
    icon: '',
    selling_time: '',
    fair_show_end_time: '',
    expire_remain_seconds: null,
    expire_remain_hours: null,
    status: 1,
    status_label: '',
    allow_bargain: false,
    is_ad: false,
    source_tag: '',
    captured_at: '',
    ...overrides,
  }) as Listing;

describe('predicate', () => {
  describe('buildPredicate', () => {
    it('空参数时 match 为 null 且没有 applied/skipped', () => {
      const r = buildPredicate({ search_type: 'role' });
      expect(r.match).toBeNull();
      expect(r.applied).toEqual([]);
      expect(r.skipped).toEqual([]);
    });

    it('search_type 被忽略，不计入 applied 也不计入 skipped', () => {
      const r = buildPredicate({ search_type: 'role', pvp_score: '' });
      expect(r.applied).toEqual([]);
      expect(r.skipped).toEqual([]);
    });

    it('null / undefined / 空串的参数被跳过（不进入 applied 或 skipped）', () => {
      const params = {
        pvp_score: '',
        sign_days: undefined,
        six_star_num: null,
      } as unknown as SearchParams;
      const r = buildPredicate(params);
      expect(r.match).toBeNull();
      expect(r.applied).toEqual([]);
      expect(r.skipped).toEqual([]);
    });

    it('未知键进入 skipped，不产生过滤函数', () => {
      const r = buildPredicate({ totally_unknown_key: '1' });
      expect(r.match).toBeNull();
      expect(r.skipped).toEqual(['totally_unknown_key']);
      expect(r.applied).toEqual([]);
    });

    it('已知键进入 applied 并产生过滤函数', () => {
      const r = buildPredicate({ sign_days: '100' });
      expect(r.applied).toEqual(['sign_days']);
      expect(r.skipped).toEqual([]);
      expect(r.match).toBeTypeOf('function');
    });

    it('多条件之间是 AND 语义：全部满足才命中', () => {
      const r = buildPredicate({ sign_days: '100', pvp_score: '1000' });
      expect(r.match!(makeListing({ sign_days: 200, pvp: 1500 }))).toBe(true);
      expect(r.match!(makeListing({ sign_days: 50, pvp: 1500 }))).toBe(false);
      expect(r.match!(makeListing({ sign_days: 200, pvp: 500 }))).toBe(false);
    });

    it('同时含已知键与未知键：已知键生效，未知键进 skipped', () => {
      const r = buildPredicate({ sign_days: '100', foo: '1' });
      expect(r.applied).toEqual(['sign_days']);
      expect(r.skipped).toEqual(['foo']);
      expect(r.match!(makeListing({ sign_days: 200 }))).toBe(true);
      expect(r.match!(makeListing({ sign_days: 10 }))).toBe(false);
    });
  });

  describe('classifyConditionSupport', () => {
    it('忽略 search_type 与空值', () => {
      const s = classifyConditionSupport({
        search_type: 'role',
        pvp_score: '',
        sign_days: null,
      } as unknown as SearchParams);
      expect(s.localKeys).toEqual([]);
      expect(s.serverOnlyKeys).toEqual([]);
    });

    it('有本地判定函数的键归入 localKeys，其余归入 serverOnlyKeys', () => {
      const s = classifyConditionSupport({ sign_days: '100', full_ssr: '1' });
      expect(s.localKeys).toEqual(['sign_days']);
      expect(s.serverOnlyKeys).toEqual(['full_ssr']);
    });

    it('尾速度 / 招财头速 / 段位归入 serverOnlyKeys（回归 F3/F4）', () => {
      const s = classifyConditionSupport({
        wei_speed: '15000',
        zhaocai_tou_speed: '15000',
        pvp_stage: '3000',
        pvp_score: '2000',
      });
      expect(s.localKeys).toEqual(['pvp_score']);
      expect(s.serverOnlyKeys).toEqual(['wei_speed', 'zhaocai_tou_speed', 'pvp_stage']);
    });

    it('price_min 与 price_max 归并为 price 且只报一次', () => {
      const s = classifyConditionSupport({ price_min: '100', price_max: '900' });
      expect(s.localKeys).toEqual(['price']);
      expect(s.serverOnlyKeys).toEqual([]);
    });

    it('serverOnly 下的价格归并同样只报一次', () => {
      // price_* 本身在 PREDICATES 中，故在本地；此处验证归并不会重复
      const s = classifyConditionSupport({ price_min: '1', price_max: '2', price_x: '3' });
      expect(s.localKeys.filter((k) => k === 'price')).toHaveLength(1);
    });
  });

  describe('PREDICATES 关键语义', () => {
    it('速度类参数 ×100 倍率：接口参数 15800 对齐快照 158', () => {
      // 面板输入 158 -> 接口 15800；快照存 158.x
      const r = buildPredicate({ max_sanjian_speed: '15800' });
      expect(r.match!(makeListing({ sanjian_speed: 158 }))).toBe(true);
      expect(r.match!(makeListing({ sanjian_speed: 157.99 }))).toBe(false);
    });

    it('zhaocai 一速同样 ×100 对齐', () => {
      const r = buildPredicate({ max_zhaocai_speed: '15000' });
      expect(r.match!(makeListing({ zhaocai_speed: 150 }))).toBe(true);
      expect(r.match!(makeListing({ zhaocai_speed: 149 }))).toBe(false);
    });

    it('tou_speed 映射到快照 tou_speed 并 ×100', () => {
      const r = buildPredicate({ tou_speed: '12000' });
      expect(r.match!(makeListing({ tou_speed: 120 }))).toBe(true);
      expect(r.match!(makeListing({ tou_speed: 119 }))).toBe(false);
    });

    it('尾速度 / 招财头速 / 段位 不做本地过滤（快照无对应字段，只服务端生效）', () => {
      // 回归 F3/F4：这三个参数曾经被误映射到 tou_speed / pvp，导致「尾速」实际筛头速、
      // 「段位」实际比积分。现在它们必须进入 skipped，且不产生任何本地过滤。
      for (const key of ['wei_speed', 'zhaocai_tou_speed', 'pvp_stage']) {
        const r = buildPredicate({ [key]: '12000' });
        expect(r.match).toBeNull();
        expect(r.applied).toEqual([]);
        expect(r.skipped).toEqual([key]);
        expect(UNSUPPORTED_PARAMS.has(key)).toBe(true);
      }
    });

    it('误映射回归：头速条件不会因尾速字段而被复用', () => {
      // 同时给出 tou_speed 与 wei_speed 时，只应用 tou_speed；wei_speed 记为 skipped。
      const r = buildPredicate({ tou_speed: '10000', wei_speed: '16000' });
      expect(r.applied).toEqual(['tou_speed']);
      expect(r.skipped).toEqual(['wei_speed']);
      expect(r.match!(makeListing({ tou_speed: 100 }))).toBe(true);
      expect(r.match!(makeListing({ tou_speed: 99 }))).toBe(false);
    });

    it('整数类 gte：tou_counts / wei_counts / six_star_num / sign_days / pvp_score / pvp_stage / collect_num / goyu', () => {
      // [参数名, 阈值, 满足的行, 不满足的行]
      const cases: [string, string, Partial<Listing>, Partial<Listing>][] = [
        ['tou_counts', '3', { tou_num: 3 }, { tou_num: 2 }],
        ['wei_counts', '2', { wei_num: 2 }, { wei_num: 1 }],
        ['six_star_num', '5', { six_star: 5 }, { six_star: 4 }],
        ['sign_days', '500', { sign_days: 500 }, { sign_days: 499 }],
        ['pvp_score', '2000', { pvp: 2000 }, { pvp: 1999 }],
        ['collect_num', '10', { collect_num: 10 }, { collect_num: 9 }],
        ['goyu', '100', { goyu: 100 }, { goyu: 99 }],
      ];
      for (const [key, threshold, pass, fail] of cases) {
        const r = buildPredicate({ [key]: threshold });
        expect(r.match!(makeListing(pass))).toBe(true);
        expect(r.match!(makeListing(fail))).toBe(false);
      }
    });

    it('gte 边界含等号：值等于下限命中', () => {
      const r = buildPredicate({ sign_days: '500' });
      expect(r.match!(makeListing({ sign_days: 500 }))).toBe(true);
    });

    it('gte 对 undefined / NaN / null 字段返回 false（值缺失不满足下限）', () => {
      const r = buildPredicate({ sign_days: '100' });
      expect(r.match!(makeListing({ sign_days: null }))).toBe(false);
      expect(r.match!(makeListing({ sign_days: NaN }))).toBe(false);
      expect(r.match!({ ...makeListing(), sign_days: undefined as unknown as number } as Listing)).toBe(false);
    });

    it('gte 目标值非法（NaN 字符串）时视为不限制，返回 true', () => {
      const r = buildPredicate({ sign_days: 'abc' });
      expect(r.match!(makeListing({ sign_days: null }))).toBe(true);
      expect(r.match!(makeListing({ sign_days: 1 }))).toBe(true);
    });

    it('速度 gte 对 null 字段返回 false', () => {
      const r = buildPredicate({ max_sanjian_speed: '15800' });
      expect(r.match!(makeListing({ sanjian_speed: null }))).toBe(false);
    });

    it('equip_level 为「小于等于」语义', () => {
      const r = buildPredicate({ equip_level: '100' });
      expect(r.match!(makeListing({ equip_level: 100 }))).toBe(true);
      expect(r.match!(makeListing({ equip_level: 99 }))).toBe(true);
      expect(r.match!(makeListing({ equip_level: 101 }))).toBe(false);
      expect(r.match!(makeListing({ equip_level: null }))).toBe(false);
    });

    it('equip_level 非数字参数视为不限制', () => {
      const r = buildPredicate({ equip_level: 'x' });
      expect(r.match!(makeListing({ equip_level: null }))).toBe(true);
    });

    it('price_min 下限含等号，price_max 上限含等号', () => {
      const r = buildPredicate({ price_min: '10000', price_max: '20000' });
      expect(r.match!(makeListing({ price: 10000 }))).toBe(true);
      expect(r.match!(makeListing({ price: 20000 }))).toBe(true);
      expect(r.match!(makeListing({ price: 9999 }))).toBe(false);
      expect(r.match!(makeListing({ price: 20001 }))).toBe(false);
    });

    it('price 为 null 时 price_min/price_max 都不满足', () => {
      const min = buildPredicate({ price_min: '1' });
      const max = buildPredicate({ price_max: '99999' });
      expect(min.match!(makeListing({ price: null }))).toBe(false);
      expect(max.match!(makeListing({ price: null }))).toBe(false);
    });

    it('price_min 非数字参数视为不限制', () => {
      const r = buildPredicate({ price_min: 'abc' });
      expect(r.match!(makeListing({ price: null }))).toBe(true);
    });

    it('serverid 多值：逗号分隔，忽略空白与空段', () => {
      const r = buildPredicate({ serverid: '12, 13 ,,' });
      expect(r.match!(makeListing({ server_id: 12 }))).toBe(true);
      expect(r.match!(makeListing({ server_id: 13 }))).toBe(true);
      expect(r.match!(makeListing({ server_id: 14 }))).toBe(false);
    });

    it('serverid 空串或仅分隔符时不限制（无 ids -> 放行）', () => {
      const r = buildPredicate({ serverid: ' , ' });
      expect(r.match!(makeListing({ server_id: 999 }))).toBe(true);
    });

    it('platform_type 多值匹配，空串放行', () => {
      const r = buildPredicate({ platform_type: '1,2' });
      expect(r.match!(makeListing({ platform_type: 1 }))).toBe(true);
      expect(r.match!(makeListing({ platform_type: 3 }))).toBe(false);
      const none = buildPredicate({ platform_type: '' });
      expect(none.applied).toEqual([]);
    });

    it('pass_fair_show=0 只保留公示期（status===3），=1 排除公示期，其他值放行', () => {
      const only = buildPredicate({ pass_fair_show: '0' });
      expect(only.match!(makeListing({ status: 3 }))).toBe(true);
      expect(only.match!(makeListing({ status: 1 }))).toBe(false);

      const exclude = buildPredicate({ pass_fair_show: '1' });
      expect(exclude.match!(makeListing({ status: 3 }))).toBe(false);
      expect(exclude.match!(makeListing({ status: 1 }))).toBe(true);

      const other = buildPredicate({ pass_fair_show: '2' });
      expect(other.match!(makeListing({ status: 3 }))).toBe(true);
      expect(other.match!(makeListing({ status: 1 }))).toBe(true);
    });
  });

  describe('UNSUPPORTED_PARAMS / PARAM_LABELS', () => {
    it('UNSUPPORTED_PARAMS 包含典型的不可本地判定参数', () => {
      expect(UNSUPPORTED_PARAMS.has('full_ssr')).toBe(true);
      expect(UNSUPPORTED_PARAMS.has('hero_id')).toBe(true);
      expect(UNSUPPORTED_PARAMS.has('sign_days')).toBe(false);
    });

    it('PARAM_LABELS 为关键参数提供中文名', () => {
      expect(PARAM_LABELS.price_min).toBe('价格下限');
      expect(PARAM_LABELS.max_sanjian_speed).toBe('散件一速');
      expect(PARAM_LABELS.serverid).toBe('区服');
    });
  });

  describe('ServerIndex', () => {
    const list: ServerEntry[] = [
      { groupId: 'g1', group: '华东', entry: [12, '区一', '', '', '', []] },
      { groupId: 'g1', group: '华东', entry: [13, '区二', '', '', '', []] },
      { groupId: 'g2', group: '华南', entry: [21, 'Alpha', '', '', '', []] },
      // _meta 元信息：entry 为空数组，必须被跳过
      { groupId: '_meta', group: '_meta', entry: [] as unknown as ServerEntry['entry'] },
      // 结构不完整：entry 只有 1 个元素，也被跳过
      { groupId: 'g3', group: '残缺', entry: [99] as unknown as ServerEntry['entry'] },
    ];
    const idx = new ServerIndex(list);

    it('跳过 _meta 与结构不完整的条目', () => {
      expect(idx.all()).toHaveLength(3);
      expect(idx.groups().map(([g]) => g)).toEqual(['华东', '华南']);
    });

    it('name 命中返回名称，未命中返回原 id 字符串', () => {
      expect(idx.name(12)).toBe('区一');
      expect(idx.name('21')).toBe('Alpha');
      expect(idx.name(404)).toBe('404');
    });

    it('search 空关键字返回全部分组', () => {
      expect(idx.search('   ')).toEqual(idx.groups());
      expect(idx.search('')).toHaveLength(2);
    });

    it('search 按名称大小写不敏感匹配', () => {
      const hit = idx.search('alpha');
      expect(hit).toHaveLength(1);
      expect(hit[0][0]).toBe('华南');
      expect(hit[0][1].map((s) => s.entry[1])).toEqual(['Alpha']);
    });

    it('search 按 id 子串匹配', () => {
      const hit = idx.search('13');
      expect(hit).toHaveLength(1);
      expect(hit[0][1].map((s) => s.entry[0])).toEqual([13]);
    });

    it('search 无命中时返回空数组', () => {
      expect(idx.search('不存在的区服')).toEqual([]);
    });
  });
});
