import type { SearchParams, ServerEntry } from '@/api/searchSchema';
import type { Listing } from '@/types';

/**
 * 把「藏宝阁筛选条件」翻译成「对已抓快照的前端过滤」。
 *
 * 为什么需要它：面板上有 73 项条件，而快照里只有列表页能拿到的字段。
 * 与其静默丢条件（用户以为筛了其实没筛），不如**明确区分**：
 *   - 能对应到快照字段的  -> 真正过滤
 *   - 对应不上的          -> 收集到 skipped，在界面上如实告知
 * 这样「命中 12 条」这个数字永远是可信的。
 */

type Predicate = (row: Listing, raw: string) => boolean;

const num = (raw: string): number | null => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/**
 * 速度类条件的倍率换算。
 *
 * 面板输入 159 会按 valueMultiply=100 转成接口参数 15900（藏宝阁接口收整数），
 * 但快照里存的是原始小数 159.56。直接拿 15900 去比会永远不满足，
 * 所以这里必须把接口参数除回来——这是这个面板最容易踩的一个坑。
 */
const SCALE_100 = (raw: string): number | null => {
  const n = num(raw);
  return n === null ? null : n / 100;
};

const gte = (row: Listing, key: keyof Listing, raw: string, scale = false): boolean => {
  const target = scale ? SCALE_100(raw) : num(raw);
  if (target === null) return true;
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return value >= target;
};

const splitIds = (raw: string): string[] =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** 参数名 -> 判定函数。做成表而不是一串 if，便于对照接口字段增删。 */
const PREDICATES: Record<string, Predicate> = {
  // 价格：单位「分」，面板算出来的已经是 ×100 后的值
  price_min: (row, raw) => {
    const v = num(raw);
    return v === null || (row.price !== null && row.price >= v);
  },
  price_max: (row, raw) => {
    const v = num(raw);
    return v === null || (row.price !== null && row.price <= v);
  },

  // 速度类字段在 schema 里是 valueMultiply=100，参数值要除回来（见 SCALE_100 注释）
  max_sanjian_speed: (row, raw) => gte(row, 'sanjian_speed', raw, true),
  max_zhaocai_speed: (row, raw) => gte(row, 'zhaocai_speed', raw, true),
  tou_speed: (row, raw) => gte(row, 'tou_speed', raw, true),
  wei_speed: (row, raw) => gte(row, 'tou_speed', raw, true),
  zhaocai_tou_speed: (row, raw) => gte(row, 'tou_speed', raw, true),

  // 整数类字段：参数与快照同单位，直接比
  tou_counts: (row, raw) => gte(row, 'tou_num', raw),
  wei_counts: (row, raw) => gte(row, 'wei_num', raw),
  six_star_num: (row, raw) => gte(row, 'six_star', raw),
  sign_days: (row, raw) => gte(row, 'sign_days', raw),
  pvp_score: (row, raw) => gte(row, 'pvp', raw),
  pvp_stage: (row, raw) => gte(row, 'pvp', raw), // 列表页里段位与积分同源
  collect_num: (row, raw) => gte(row, 'collect_num', raw),
  // 面板语义是「等级小于等于」
  equip_level: (row, raw) => {
    const v = num(raw);
    return v === null || (row.equip_level !== null && row.equip_level <= v);
  },

  // 多值
  serverid: (row, raw) => {
    const ids = splitIds(raw);
    return !ids.length || ids.includes(String(row.server_id));
  },
  platform_type: (row, raw) => {
    const ids = splitIds(raw);
    return !ids.length || ids.includes(String(row.platform_type));
  },

  /** 资产类（列表接口通常不返回，拿到就生效） */
  goyu: (row, raw) => gte(row, 'goyu', raw),

  // 公示期：0=只显示公示期，1=不显示公示期
  pass_fair_show: (row, raw) => {
    if (raw === '0') return row.status === 3;
    if (raw === '1') return row.status !== 3;
    return true;
  },
};

/** 这些参数名即使出现在条件里也不会生效，需要如实提示用户 */
export const UNSUPPORTED_PARAMS = new Set([
  'full_ssr', 'full_sp', 'full_ur', 'full_x',
  'hero_id', 'is_six_star', 'yuhun',
  'output_damage', 'attack', 'life', 'defense', 'speed', 'strike', 'strike_damage',
  'attack_effect', 'anti_effect',
  'full_speed_inventory_num', 'full_speed_inventory_speed',
  'zhaocai_tou_counts', 'zhaocai_tou_speed', 'full_speed_yuhun',
  'gameble_card', 'strength', 'money',
  'currency_900188', 'hunyu', 'soul_jade', 'currency_900218', 'currency_900217',
  'black_egg_num', 'skin_coupon', 'medal', 'six_lbscard_num', 'qianghua_yuhun_num',
  'yzg_open', 'gouyu_card', 'is_xinyi_vip',
  'ss_skin_num', 'skin_id', 'collection_skin_num', 'yard_skin_num',
  'gamble_skin_num', 'shishenlu_skin_num', 'battle_skin_num', 'yinyangshu_skin_num', 'fengzidu',
  'head_skin_id', 'has_jindamo', 'honor_id', 'achieve_ids',
]);

export interface PredicateResult {
  /** 过滤函数；没有任何可用条件时为 null */
  match: ((row: Listing) => boolean) | null;
  /** 本次真正生效的参数名 */
  applied: string[];
  /** 被忽略的参数名（快照里没有对应数据） */
  skipped: string[];
}

/**
 * 把参数表**编译**成一个过滤函数。
 * 注意：判定函数在编译期就绑定了 raw 值，所以多值参数（区服/平台）不会丢。
 */
export const buildPredicate = (params: SearchParams): PredicateResult => {
  const applied: string[] = [];
  const skipped: string[] = [];
  const checks: ((row: Listing) => boolean)[] = [];

  for (const [key, raw] of Object.entries(params)) {
    if (key === 'search_type') continue;
    if (raw === '' || raw === null || raw === undefined) continue;

    const fn = PREDICATES[key];
    if (fn) {
      applied.push(key);
      checks.push((row) => fn(row, raw));
    } else {
      skipped.push(key);
    }
  }

  return {
    match: checks.length ? (row: Listing) => checks.every((c) => c(row)) : null,
    applied,
    skipped,
  };
};

/** 参数名 -> 中文名，用于「已忽略条件」提示 */
export const PARAM_LABELS: Record<string, string> = {
  full_ssr: 'SSR全图鉴',
  full_sp: 'SP全图鉴',
  full_ur: 'UR全图鉴',
  full_x: '联动全图鉴',
  hero_id: '式神',
  is_six_star: '所选式神为6星',
  yuhun: '指定御魂',
  output_damage: '输出',
  attack: '攻击',
  life: '生命',
  defense: '防御',
  speed: '速度',
  strike: '暴击',
  strike_damage: '暴击伤害',
  attack_effect: '效果命中',
  anti_effect: '效果抵抗',
  goyu: '勾玉',
  gameble_card: '神秘符咒',
  strength: '体力',
  money: '金币',
  black_egg_num: '御行达摩',
  skin_coupon: '皮肤券',
  medal: '勋章',
  gouyu_card: '永久勾玉卡',
  is_xinyi_vip: '心易徽记',
  yzg_open: '曜之阁开启',
  collection_skin_num: '典藏皮肤总数',
  ss_skin_num: '式神皮肤总数',
  fengzidu: '风姿度',
  head_skin_id: '头像框',
  has_jindamo: '京都之主(金达摩)',
  honor_id: '徽章',
  achieve_ids: '成就',
  max_sanjian_speed: '散件一速',
  max_zhaocai_speed: '招财一速',
  tou_speed: '头速度',
  tou_counts: '头个数',
  wei_counts: '尾个数',
  six_star_num: '6星式神数量',
  sign_days: '签到天数',
  pvp_score: '斗技积分',
  pvp_stage: '斗技段位',
  equip_level: '等级',
  price_min: '价格下限',
  price_max: '价格上限',
  serverid: '区服',
  platform_type: '操作系统',
  pass_fair_show: '公示期',
  full_speed_inventory_num: '个满速御魂个数',
  full_speed_inventory_speed: '个满速御魂速度',
  zhaocai_tou_counts: '招财头个数',
  zhaocai_tou_speed: '招财头速度',
  full_speed_yuhun: '满速御魂数',
};

/** 服务器清单的索引工具（127 项，按 id / 分组建索引） */
export class ServerIndex {
  private byId = new Map<string, ServerEntry>();

  private byGroup = new Map<string, ServerEntry[]>();

  constructor(list: ServerEntry[]) {
    for (const s of list) {
      // 防御：跳过结构不完整的条目（例如 sync_servers.py 写入的 _meta 元信息条目，
      // 它的 entry 是空数组）。不跳过会建出 "undefined" 垃圾键和一个空分组。
      if (!Array.isArray(s.entry) || s.entry.length < 2) continue;
      this.byId.set(String(s.entry[0]), s);
      const arr = this.byGroup.get(s.group) ?? [];
      arr.push(s);
      this.byGroup.set(s.group, arr);
    }
  }

  name(id: string | number): string {
    return this.byId.get(String(id))?.entry[1] ?? String(id);
  }

  groups(): [string, ServerEntry[]][] {
    return [...this.byGroup.entries()];
  }

  search(keyword: string): [string, ServerEntry[]][] {
    const q = keyword.trim().toLowerCase();
    if (!q) return this.groups();
    const out: [string, ServerEntry[]][] = [];
    for (const [group, list] of this.byGroup) {
      const hit = list.filter(
        (s) => s.entry[1].toLowerCase().includes(q) || String(s.entry[0]).includes(q),
      );
      if (hit.length) out.push([group, hit]);
    }
    return out;
  }

  all(): ServerEntry[] {
    return [...this.byId.values()];
  }
}
