import { describe, expect, it } from 'vitest';
import {
  buildPlatformShare,
  buildPriceHistogram,
  buildSignVsSpeed,
  buildSpeedTiers,
  computeAnalytics,
} from '@/utils/analytics';
import type { Listing } from '@/types';

const makeListing = (overrides: Partial<Listing> = {}): Listing =>
  ({
    id: 'x',
    order_sn: 'x',
    eid: 'x',
    title: 't',
    price: null,
    bare_price: null,
    collect_num: 0,
    server_id: null,
    server_name: '',
    area_name: '',
    platform_type: null,
    game_channel: '',
    equip_level: null,
    level_desc: '',
    ssr: null,
    six_star: null,
    sign_days: null,
    sanjian_speed: null,
    zhaocai_speed: null,
    tou_num: null,
    wei_num: null,
    tou_speed: null,
    pvp: null,
    goyu: null,
    titles: [],
    highlights: [],
    icon: '',
    selling_time: '',
    fair_show_end_time: '',
    expire_remain_seconds: null,
    expire_remain_hours: null,
    status: null,
    status_label: '',
    allow_bargain: false,
    is_ad: false,
    source_tag: '',
    captured_at: '',
    ...overrides,
  }) as Listing;

describe('analytics', () => {
  describe('buildPriceHistogram', () => {
    it('空输入返回空直方图', () => {
      expect(buildPriceHistogram([])).toEqual({ labels: [], bounds: [], counts: [] });
    });

    it('单值（min===max）只产生一个箱，计数为样本数', () => {
      const h = buildPriceHistogram([10000, 10000, 10000]);
      expect(h.labels).toEqual(['100']);
      expect(h.bounds).toEqual([10000]);
      expect(h.counts).toEqual([3]);
    });

    it('等宽分箱：计数总和等于样本数', () => {
      const prices = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map((p) => p * 100);
      const h = buildPriceHistogram(prices, 8);
      expect(h.counts).toHaveLength(8);
      expect(h.counts.reduce((a, b) => a + b, 0)).toBe(prices.length);
      expect(h.bounds).toHaveLength(8);
    });

    it('最大值落在最后一箱（边界不溢出）', () => {
      const h = buildPriceHistogram([0, 10000], 4);
      expect(h.counts[h.counts.length - 1]).toBeGreaterThanOrEqual(1);
      expect(h.counts.reduce((a, b) => a + b, 0)).toBe(2);
    });

    it('最后一个 label 含「~」（区间形式），前面的为单个下界', () => {
      const h = buildPriceHistogram([100, 900], 4);
      expect(h.labels[h.labels.length - 1]).toContain('~');
      expect(h.labels[0]).not.toContain('~');
    });

    it('bins 参数控制箱数', () => {
      const h = buildPriceHistogram([100, 200, 300, 400], 2);
      expect(h.counts).toHaveLength(2);
      expect(h.labels).toHaveLength(2);
    });

    it('bounds 为每个箱的下界（分值）', () => {
      const h = buildPriceHistogram([0, 800], 4);
      expect(h.bounds).toEqual([0, 200, 400, 600]);
    });
  });

  describe('buildSpeedTiers', () => {
    it('空输入返回空数组', () => {
      expect(buildSpeedTiers([])).toEqual([]);
    });

    it('按边界归档：150/152/154/156/158/200 落在对应分段', () => {
      const tiers = buildSpeedTiers([150, 152, 154, 156, 158, 200]);
      expect(tiers).toEqual([
        { name: '150~152', value: 1 },
        { name: '152~154', value: 1 },
        { name: '154~156', value: 1 },
        { name: '156~158', value: 1 },
        { name: '158+', value: 2 },
      ]);
    });

    it('低于 150 归入 <150 分段', () => {
      expect(buildSpeedTiers([10, 149.9])).toEqual([{ name: '<150', value: 2 }]);
    });

    it('过滤计数为 0 的分段', () => {
      const tiers = buildSpeedTiers([159]);
      expect(tiers).toEqual([{ name: '158+', value: 1 }]);
      expect(tiers.every((t) => t.value > 0)).toBe(true);
    });
  });

  describe('buildPlatformShare', () => {
    it('空输入返回空数组', () => {
      expect(buildPlatformShare([])).toEqual([]);
    });

    it('platform_type 映射：1=iOS，2=安卓，3=双平台，4=全平台', () => {
      const rows = [1, 2, 3, 4].map((p) => makeListing({ platform_type: p }));
      const names = buildPlatformShare(rows).map((t) => t.name).sort();
      expect(names).toEqual(['iOS', '安卓', '全平台', '双平台'].sort());
    });

    it('null 归为「未知」', () => {
      const shares = buildPlatformShare([makeListing({ platform_type: null })]);
      expect(shares).toEqual([{ name: '未知', value: 1, color: undefined }]);
    });

    it('未知编码归为「类型N」', () => {
      const shares = buildPlatformShare([makeListing({ platform_type: 9 })]);
      expect(shares[0].name).toBe('类型9');
    });

    it('按数量降序排列', () => {
      const rows = [
        makeListing({ platform_type: 2 }),
        makeListing({ platform_type: 1 }),
        makeListing({ platform_type: 1 }),
      ];
      const shares = buildPlatformShare(rows);
      expect(shares.map((s) => s.name)).toEqual(['iOS', '安卓']);
      expect(shares[0].value).toBe(2);
    });

    it('颜色仅为安卓与 iOS 配置，其余无颜色', () => {
      const shares = buildPlatformShare([
        makeListing({ platform_type: 1 }),
        makeListing({ platform_type: 2 }),
        makeListing({ platform_type: 3 }),
      ]);
      const byName = Object.fromEntries(shares.map((s) => [s.name, s.color]));
      expect(byName['iOS']).toBe('#34d07f');
      expect(byName['安卓']).toBe('#1677ff');
      expect(byName['双平台']).toBeUndefined();
    });
  });

  describe('buildSignVsSpeed', () => {
    it('过滤 sign_days 或 sanjian_speed 为 null 的记录', () => {
      const rows = [
        makeListing({ sign_days: null, sanjian_speed: 158 }),
        makeListing({ sign_days: 100, sanjian_speed: null }),
        makeListing({ sign_days: 100, sanjian_speed: 158, price: 10000, title: 'ok' }),
      ];
      const pts = buildSignVsSpeed(rows);
      expect(pts).toHaveLength(1);
      expect(pts[0].name).toBe('ok');
    });

    it('点的 value 结构为 [签到天数, 散件一速, 价格元, 索引]', () => {
      const rows = [makeListing({ sign_days: 300, sanjian_speed: 156.5, price: 12345, title: 'p' })];
      const [pt] = buildSignVsSpeed(rows);
      // 12345 分 -> 123.45 元 -> round -> 123
      expect(pt.value).toEqual([300, 156.5, 123, 0]);
    });

    it('price 为 null 时价格写为 0（当前行为，见 findings）', () => {
      const rows = [makeListing({ sign_days: 1, sanjian_speed: 1, price: null })];
      expect(buildSignVsSpeed(rows)[0].value[2]).toBe(0);
    });

    it('不超过 500 个点时原样返回', () => {
      const rows = Array.from({ length: 10 }, (_, i) =>
        makeListing({ sign_days: i, sanjian_speed: i, price: 100 }),
      );
      expect(buildSignVsSpeed(rows)).toHaveLength(10);
    });

    it('超过 500 个点时抽样到恰好 500 个', () => {
      const rows = Array.from({ length: 1200 }, (_, i) =>
        makeListing({ sign_days: i, sanjian_speed: 150, price: 100 }),
      );
      const pts = buildSignVsSpeed(rows);
      expect(pts).toHaveLength(500);
      // 抽样保持原顺序（索引单调递增）
      const idx = pts.map((p) => p.value[3]);
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    });
  });

  describe('computeAnalytics', () => {
    it('空输入：KPI 长度为 8，命中数为 0，其余值为 "-"', () => {
      const a = computeAnalytics([]);
      expect(a.kpis).toHaveLength(8);
      expect(a.kpis[0]).toMatchObject({ label: '命中账号', value: '0' });
      for (let i = 1; i < 8; i += 1) {
        if (i === 6) continue; // 平均签到在空输入时同样为 '-'，下方单独断言
        expect(a.kpis[i].value).toBe('-');
      }
      expect(a.kpis[6].value).toBe('-');
    });

    it('priceBins 固定为 8', () => {
      expect(computeAnalytics([]).priceBins).toBe(8);
      expect(computeAnalytics([makeListing({ price: 100 })]).priceBins).toBe(8);
    });

    it('价格中位数按分位数计算（奇数个样本取中间值）', () => {
      // 分：1000, 2000, 3000 -> 中位数 2000 分 = 20 元
      const rows = [1000, 2000, 3000].map((p) => makeListing({ price: p }));
      const a = computeAnalytics(rows);
      expect(a.kpis[1].raw).toBe(2000);
      expect(a.kpis[1].value).toBe('¥20');
    });

    it('偶数个样本时中位数为两中值的线性插值', () => {
      const rows = [1000, 3000].map((p) => makeListing({ price: p }));
      const a = computeAnalytics(rows);
      // 中位数 2000 分 = 20 元
      expect(a.kpis[1].raw).toBe(2000);
    });

    it('四分位：P25 ~ P75 展示为元区间，raw 为 P75-P25 差值', () => {
      // 价格分：1000,2000,3000,4000,5000 -> P25=2000, P75=4000
      const rows = [1000, 2000, 3000, 4000, 5000].map((p) => makeListing({ price: p }));
      const a = computeAnalytics(rows);
      expect(a.kpis[2].value).toBe('¥20 ~ ¥40');
      expect(a.kpis[2].raw).toBe(2000);
    });

    it('最快散件一速取最大值并保留两位小数', () => {
      const rows = [makeListing({ sanjian_speed: 156.1 }), makeListing({ sanjian_speed: 158.456 })];
      const a = computeAnalytics(rows);
      expect(a.kpis[3].value).toBe('158.46');
      expect(a.kpis[3].raw).toBeCloseTo(158.456);
    });

    it('多条记录时 hint 含平均与 ≥158 个数', () => {
      const rows = [makeListing({ sanjian_speed: 150 }), makeListing({ sanjian_speed: 160 })];
      const a = computeAnalytics(rows);
      expect(a.kpis[3].hint).toBe('平均 155.00，1 个 ≥158');
    });

    it('高战号占比 = 散件一速 ≥158 的比例（以总行数为分母）', () => {
      const rows = [
        makeListing({ sanjian_speed: 160 }),
        makeListing({ sanjian_speed: 150 }),
        makeListing({ sanjian_speed: null }),
        makeListing({ sanjian_speed: 158 }),
      ];
      const a = computeAnalytics(rows);
      // 2 / 4 = 50%
      expect(a.kpis[7].raw).toBe(0.5);
      expect(a.kpis[7].value).toBe('50.0%');
    });

    it('平均签到取整加「天」，最长按年展示', () => {
      const rows = [makeListing({ sign_days: 365 }), makeListing({ sign_days: 730 })];
      const a = computeAnalytics(rows);
      expect(a.kpis[5].label).toBe('平均签到');
      expect(a.kpis[5].value).toBe('548 天');
      expect(a.kpis[5].hint).toBe('最长 2.0 年');
    });

    it('SSR / 六星 均值与 SSR 最高', () => {
      const rows = [
        makeListing({ ssr: 10, six_star: 2 }),
        makeListing({ ssr: 20, six_star: 4 }),
      ];
      const a = computeAnalytics(rows);
      expect(a.kpis[6].label).toBe('SSR / 六星 均值');
      expect(a.kpis[6].value).toBe('15 / 3');
      expect(a.kpis[6].hint).toBe('SSR 最高 20');
    });

    it('收藏合计写入第一个 KPI 的 hint', () => {
      const rows = [makeListing({ collect_num: 3 }), makeListing({ collect_num: 4 })];
      const a = computeAnalytics(rows);
      expect(a.kpis[0].hint).toBe('累计收藏 7 次');
    });

    it('分布组件（直方图、速度分段、平台占比、散点）一并返回', () => {
      const rows = [
        makeListing({ price: 10000, sanjian_speed: 158, sign_days: 100, platform_type: 1 }),
        makeListing({ price: 20000, sanjian_speed: 150, sign_days: 200, platform_type: 2 }),
      ];
      const a = computeAnalytics(rows);
      expect(a.priceHistogram.counts.reduce((x, y) => x + y, 0)).toBe(2);
      expect(a.speedTiers.length).toBeGreaterThan(0);
      expect(a.platformShare.map((p) => p.name).sort()).toEqual(['iOS', '安卓']);
      expect(a.signVsSpeed).toHaveLength(2);
    });
  });
});
