import type { SearchField, SearchSchema } from '@/api/searchSchema';
import { fid } from '@/utils/params';

/**
 * 默认筛选条件。
 *
 * 为什么用「分组名 + 条件名」而不是下标定位：filters.json 是站点生成的，
 * 藏宝阁加一项条件，后面的下标就全错位了。用名字定位，即使顺序变了也能对上；
 * 真找不到就跳过并在控制台说明，绝不静默套用到错误的条件上。
 */
export interface DefaultCondition {
  section: string;
  label: string;
  /** 值的形状与 ConditionField 保持一致 */
  value: unknown;
  /** 便于在日志/文档里说明这条默认条件 */
  note: string;
}

/**
 * 一个重要区分（实测确认，别再搞混）：
 *
 *   站点「接不接受这个参数去筛选」  ≠  「列表接口返不返回这个字段」
 *
 * 实测对照 total_num 的结果——下面这些参数全部**真实参与筛选**：
 *
 *   full_ssr=1        10000 → 1824
 *   goyu=88888        10000 →  512
 *   six_star_num=80   10000 → 3490
 *   sign_days=1500    10000 → 2806
 *   max_sanjian_speed 10000 → 2226
 *   ss_skin_num=350   10000 → 2160
 *   black_egg_num=30  10000 → 1476
 *   gouyu_card=1      10000 → 9901
 *
 * 但列表接口的 49 个顶层字段里**没有**任何一个承载这些值
 * （other_info 只有 top_heros / top_skins / basic_attrs 等展示字段）。
 *
 * 所以后果是：**筛选是对的，只是本地拿不到这些字段的值**——表格里看不到勾玉、
 * 皮肤数，也没法在本地对这几点做二次筛选或排序。
 * 界面会把这类条件标为「服务端已筛选（本地无该字段）」，而不是「未生效」。
 */
export const DEFAULT_CONDITIONS: DefaultCondition[] = [
  {
    section: '价格(元)',
    label: '价格(元)',
    value: { min: '500', max: '1500' },
    note: '价格 500~1500 元',
  },
  {
    section: '图鉴',
    label: 'SSR全图鉴',
    value: '1',
    note: 'SSR 全图鉴',
  },
  {
    section: '图鉴',
    label: 'SP全图鉴',
    value: '1',
    note: 'SP 全图鉴',
  },
  {
    section: '图鉴',
    label: 'UR全图鉴',
    value: '1',
    note: 'UR 全图鉴',
  },
  {
    section: '式神',
    label: '6星式神数量',
    value: '80',
    note: '6 星式神 ≥ 80',
  },
  {
    section: '个人斗技',
    label: '散件一速',
    value: '158',
    note: '散件一速 ≥ 158',
  },
  {
    section: '资产',
    label: '勾玉',
    value: '88888',
    note: '勾玉 ≥ 88888',
  },
  {
    section: '资产',
    label: '御行达摩',
    value: '30',
    note: '御行达摩 ≥ 30',
  },
  {
    section: '资产',
    label: '永久勾玉卡',
    value: '1',
    note: '永久勾玉卡',
  },
  {
    section: '皮肤',
    label: '式神皮肤总数',
    value: '350',
    note: '式神皮肤总数 ≥ 350',
  },
  {
    section: '成就/签到',
    label: '签到天数',
    value: '1500',
    note: '签到天数 ≥ 1500',
  },
];

export interface ResolvedDefaults {
  /** 可直接塞进 FilterPanel 的 selected Map */
  selected: Map<string, unknown>;
  /** 成功套用的条件说明 */
  applied: string[];
  /** 找不到对应字段、被跳过的条件 */
  missing: string[];
}

/** 把默认条件解析成面板的 selected 结构 */
export const resolveDefaults = (schema: SearchSchema): ResolvedDefaults => {
  const selected = new Map<string, unknown>();
  const applied: string[] = [];
  const missing: string[] = [];

  for (const def of DEFAULT_CONDITIONS) {
    const si = schema.sections.findIndex((s) => s.label === def.section);
    if (si < 0) {
      missing.push(`${def.section}（分组不存在）`);
      continue;
    }
    const fi = schema.sections[si].fields.findIndex((f: SearchField) => f.label === def.label);
    if (fi < 0) {
      missing.push(`${def.section} · ${def.label}（字段不存在）`);
      continue;
    }
    selected.set(fid(si, fi), def.value);
    applied.push(def.note);
  }

  if (missing.length) {
    console.warn('[默认条件] 以下条件在 filters.json 里找不到，已跳过：', missing);
  }
  return { selected, applied, missing };
};
