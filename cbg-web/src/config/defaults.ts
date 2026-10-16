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

export const DEFAULT_CONDITIONS: DefaultCondition[] = [
  {
    section: '价格(元)',
    label: '价格(元)',
    value: { min: '500', max: '1500' },
    note: '价格 500~1500 元',
  },
  {
    section: '资产',
    label: '勾玉',
    value: '100000',
    note: '勾玉 ≥ 100000（列表接口不返回该字段，实际不会生效，界面会明示）',
  },
  {
    section: '个人斗技',
    label: '散件一速',
    value: '158',
    note: '散件一速 ≥ 158',
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
