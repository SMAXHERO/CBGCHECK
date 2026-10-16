import type {
  SearchField,
  SearchParams,
  SearchSchema,
  SearchSection,
  SelectedCondition,
} from '@/api/searchSchema';

/**
 * 条件 <-> 接口参数 的双向转换。
 *
 * 与 cbg-filter-kit 的 buildValues()/applyValues() 保持完全一致的语义，
 * 包括 ×100 / ×10000 这类倍率处理——否则算出来的参数和原面板对不上，
 * 拿去查询会得到不同结果。
 */

/** 已选状态的键：sectionIndex_fieldIndex */
export const fid = (si: number, fi: number): string => `${si}_${fi}`;

/** 选项值 -> 显示文案 */
const optionLabel = (field: SearchField, value: string): string => {
  const hit = (field.options ?? []).find((o) => String(o.value) === value);
  return hit?.label ?? value;
};

/**
 * 计算某个字段当前值对应的可读摘要（chips 上显示的那段）。
 * 返回空字符串表示不显示摘要（比如纯开关）。
 */
export const summarize = (
  field: SearchField,
  value: unknown,
  serverName: (id: string) => string,
): string => {
  if (value === null || value === undefined) return '';
  if (field.type === 'checkbox' || field.type === 'check_box') return '';

  if (field.displayType === 'select_server') {
    return (value as string[]).map(serverName).join('、');
  }
  if (Array.isArray(value)) {
    return value.map((v) => optionLabel(field, String(v))).join('、');
  }
  if (typeof value === 'object') {
    const v = value as { min?: string; max?: string; num?: string; speed?: string };
    if ('min' in v || 'max' in v) return `${v.min || 0}~${v.max || '不限'}`;
    return `${v.num || '?'}个 ≥ ${v.speed || '?'}`;
  }
  return `${field.symbol ?? ''}${String(value)}`;
};

/**
 * 已选状态 -> 接口参数。
 *
 * 返回值里顺带给出 labels（用于 chips / 打印页眉 / 「交给 Agent」这类场景）。
 */
export const buildParams = (
  schema: SearchSchema,
  selected: Map<string, unknown>,
  serverName: (id: string) => string,
): { params: SearchParams; labels: SelectedCondition[] } => {
  const params: SearchParams = { search_type: schema.searchType || 'role' };
  const labels: SelectedCondition[] = [];
  const usedKeys = new Set<string>();

  schema.sections.forEach((section: SearchSection, si: number) => {
    section.fields.forEach((field, fi) => {
      const id = fid(si, fi);
      if (!selected.has(id)) return;
      if (field.kind === 'note') return;

      const value = selected.get(id);
      const key = field.key ?? '';
      const mult = Number(field.valueMultiply ?? 1);
      const group = section.label;
      const label = field.label || field.key || '未命名条件';

      // 1) 区服
      if (field.displayType === 'select_server') {
        const ids = [...new Set((value as unknown[]).map(String))];
        params.serverid = ids.join(',');
        labels.push({
          id,
          group,
          label: '区服',
          display: ids.map(serverName).join('、'),
          param: `serverid=${params.serverid}`,
        });
        return;
      }

      // 2) 开关
      if (field.type === 'checkbox' || field.type === 'check_box') {
        params[key] = String(value);
        labels.push({ id, group, label, display: '是', param: `${key}=${value}` });
        return;
      }

      // 3) 区间 + 快捷档位（价格）
      if (field.type === 'range_input_with_select') {
        const v = value as { min: string; max: string };
        if (v.min !== '' && v.min != null) params[`${key}_min`] = String(Number(v.min) * mult);
        if (v.max !== '' && v.max != null) params[`${key}_max`] = String(Number(v.max) * mult);
        labels.push({
          id,
          group,
          label,
          display: `${v.min || 0}~${v.max || '不限'}`,
          param: `${key}_min/_max`,
        });
        return;
      }

      // 4) 个数 + 速度（个满速御魂速度）
      if (field.type === 'single_select_and_input') {
        const v = value as { num: string; speed: string };
        if (v.num !== '' && v.num != null && field.selectKey) {
          params[field.selectKey] = String(Number(v.num));
        }
        if (v.speed !== '' && v.speed != null && field.inputKey) {
          params[field.inputKey] = String(Number(v.speed) * mult);
        }
        labels.push({
          id,
          group,
          label,
          display: `${v.num || '?'}个 ≥ ${v.speed || '?'}`,
          param: `${field.selectKey ?? ''}+${field.inputKey ?? ''}`,
        });
        return;
      }

      // 5) 多选胶囊
      if ((field.options ?? []).length) {
        // 同一个 key（如皮肤 scene 下的 skin_id）只取第一个有值的字段，
        // 否则后写的会覆盖前面的——这是原面板的既有约定，保持一致。
        if (!key || usedKeys.has(key)) return;
        usedKeys.add(key);
        const ids = (value as unknown[]).map(String);
        params[key] = ids.join(',');
        labels.push({
          id,
          group,
          label,
          display: ids.map((v) => optionLabel(field, v)).join('、'),
          param: `${key}=${params[key]}`,
        });
        return;
      }

      // 6) 纯数字输入
      if (!key) return;
      const num = Number(value);
      params[key] = String(Number.isFinite(num) ? num * mult : value);
      labels.push({
        id,
        group,
        label,
        display: `${field.symbol ?? ''}${String(value)}`,
        param: `${key}=${params[key]}`,
      });
    });
  });

  return { params, labels };
};

/**
 * 接口参数 -> 已选状态（回填默认条件用）。
 * 这里必须把倍率除回去，否则把 15800 填进「散件一速」会变成 15800。
 */
export const applyParams = (
  schema: SearchSchema,
  params: SearchParams,
  selected: Map<string, unknown>,
): void => {
  selected.clear();
  const used = new Set<string>();

  schema.sections.forEach((section, si) => {
    section.fields.forEach((field, fi) => {
      if (field.kind === 'note') return;
      const id = fid(si, fi);
      const key = field.key ?? '';
      const mult = Number(field.valueMultiply ?? 1);
      const opts = field.options ?? [];

      if (field.displayType === 'select_server' && params.serverid !== undefined) {
        selected.set(
          id,
          String(params.serverid)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        );
        return;
      }
      if (field.type === 'checkbox' || field.type === 'check_box') {
        if (key && params[key] !== undefined) selected.set(id, String(params[key]));
        return;
      }
      if (field.type === 'range_input_with_select') {
        const mn = params[`${key}_min`];
        const mx = params[`${key}_max`];
        if (mn !== undefined || mx !== undefined) {
          selected.set(id, {
            min: mn !== undefined ? String(Number(mn) / mult) : '',
            max: mx !== undefined ? String(Number(mx) / mult) : '',
          });
        }
        return;
      }
      if (field.type === 'single_select_and_input') {
        const a = field.selectKey ? params[field.selectKey] : undefined;
        const b = field.inputKey ? params[field.inputKey] : undefined;
        if (a !== undefined || b !== undefined) {
          selected.set(id, {
            num: a ?? '',
            speed: b !== undefined ? String(Number(b) / mult) : '',
          });
        }
        return;
      }
      if (opts.length) {
        if (!key || params[key] === undefined || used.has(key)) return;
        const wanted = String(params[key])
          .split(',')
          .map((s) => s.trim());
        const own = wanted.filter((w) => opts.some((o) => String(o.value) === w));
        if (own.length) {
          selected.set(id, own);
          used.add(key);
        }
        return;
      }
      if (key && params[key] !== undefined) {
        selected.set(id, String(Number(params[key]) / mult));
      }
    });
  });
};

/** 字段是否处于「可参与筛选」状态（note 和没有 key 的字段不算） */
export const isSelectable = (field: SearchField): boolean =>
  field.kind !== 'note' && (field.type === 'checkbox' || field.type === 'check_box' || Boolean(field.key) || field.displayType === 'select_server');
