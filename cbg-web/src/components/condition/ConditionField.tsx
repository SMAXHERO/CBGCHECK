import { useMemo, useState } from 'react';
import type { FieldProps } from './bits';
import { FieldLabel, NumberInput, OptionPills, Switch } from './bits';
import type { ServerEntry } from '@/api/searchSchema';
import { ServerIndex } from '@/utils/predicate';

/**
 * 按 field.type 渲染控件。
 *
 * 覆盖 filters.json 里出现的全部类型：
 *   note / checkbox / input_integer / input_float / range_input_with_select /
 *   single_select_and_input / multiple_select / indexer_list_check /
 *   custom_component（式神、御魂、区服）
 */

export const ConditionField = ({
  id,
  field,
  value,
  sectionLabel,
  onChange,
  serverIndex,
}: FieldProps & { sectionLabel: string; serverIndex: ServerIndex }) => {
  // 超出 maxChecked 时抖一下，告诉用户「不能再选了」
  const [shake, setShake] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [optQuery, setOptQuery] = useState('');
  const [srvQuery, setSrvQuery] = useState('');
  const [srvOpen, setSrvOpen] = useState(false);

  const selectedValues = useMemo<string[]>(() => {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === 'string' && value !== '' && (field.options ?? []).length) return [value];
    return [];
  }, [value, field.options]);

  // ---- 说明文字 ----
  if (field.kind === 'note') {
    return (
      <div className="field">
        <div className="note">{field.text}</div>
      </div>
    );
  }

  const setValue = (v: unknown) => onChange(id, v);

  /** 选项多选/单选切换，含 maxChecked 限制 */
  const toggleOption = (v: string, node?: HTMLElement) => {
    const cur = [...selectedValues];
    const idx = cur.indexOf(v);
    if (idx >= 0) {
      cur.splice(idx, 1);
    } else {
      if (field.maxChecked === 1) {
        cur.length = 0;
      } else if (field.maxChecked && cur.length >= field.maxChecked) {
        setShake(v);
        node?.animate?.(
          [{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }],
          180,
        );
        setTimeout(() => setShake(null), 220);
        return;
      }
      cur.push(v);
    }
    setValue(cur.length ? cur : undefined);
  };

  // ---- 开关 ----
  if (field.type === 'checkbox' || field.type === 'check_box') {
    const on = value !== undefined && value !== null;
    return (
      <div className="field">
        <Switch on={on} label={field.label || field.key || ''} onToggle={() => setValue(on ? undefined : (field.checkboxValue ?? '1'))} />
      </div>
    );
  }

  // ---- 区服 ----
  if (field.displayType === 'select_server') {
    const picked = Array.isArray(value) ? value.map(String) : [];
    const groups = serverIndex.search(srvQuery);
    return (
      <div className="field">
        <div className="srv-chips">
          {!picked.length && <span className="unit">不限（全服）</span>}
          {picked.map((sid) => (
            <span className="srv-chip" key={sid}>
              {serverIndex.name(sid)}
              <i
                className="x"
                onClick={() => {
                  const next = picked.filter((x) => x !== sid);
                  setValue(next.length ? next : undefined);
                }}
              >
                ✕
              </i>
            </span>
          ))}
        </div>
        <input
          className="num-in"
          style={{ width: '100%' }}
          placeholder="搜索服务器，例如「夏之蝉」"
          value={srvQuery}
          onFocus={() => setSrvOpen(true)}
          onChange={(e) => {
            setSrvQuery(e.target.value);
            setSrvOpen(true);
          }}
        />
        <div className={`srv-groups${srvOpen ? ' show' : ''}`}>
          {groups.map(([group, list]: [string, ServerEntry[]]) => (
            <div className="srv-group" key={group}>
              <div className="gt">
                {group} · {list.length}
              </div>
              <div className="row">
                <OptionPills
                  options={list.map((s) => ({ value: String(s.entry[0]), label: s.entry[1] }))}
                  selected={picked}
                  onToggle={(sid) => {
                    const next = picked.includes(sid) ? picked.filter((x) => x !== sid) : [...picked, sid];
                    setValue(next.length ? next : undefined);
                  }}
                />
              </div>
            </div>
          ))}
          {!groups.length && <div className="unit">没有匹配的服务器</div>}
        </div>
      </div>
    );
  }

  // ---- 区间 + 快捷档位（价格）----
  if (field.type === 'range_input_with_select') {
    const v = (value as { min?: string; max?: string } | undefined) ?? {};
    const update = (patch: { min?: string; max?: string }) => {
      const next = { min: v.min ?? '', max: v.max ?? '', ...patch };
      setValue(next.min === '' && next.max === '' ? undefined : next);
    };
    return (
      <div className="field">
        <FieldLabel field={field} sectionLabel={sectionLabel} />
        <div className="row">
          <NumberInput value={v.min ?? ''} placeholder={field.hintMin || '最低'} onChange={(x) => update({ min: x })} />
          <span className="unit">~</span>
          <NumberInput value={v.max ?? ''} placeholder={field.hintMax || '最高'} onChange={(x) => update({ max: x })} />
          <span className="unit">元</span>
        </div>
        <div className="row" style={{ marginTop: 7 }}>
          {(field.options ?? []).map((opt, i) => {
            const on =
              value !== undefined &&
              String(opt.min ?? '') === String(v.min ?? '') &&
              String(opt.max ?? '') === String(v.max ?? '');
            return (
              <div
                key={`${opt.label}-${i}`}
                className={`opt${on ? ' on' : ''}`}
                onClick={() =>
                  update({ min: opt.min != null ? String(opt.min) : '', max: opt.max != null ? String(opt.max) : '' })
                }
              >
                {opt.label}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---- 个数 + 速度（个满速御魂速度）----
  if (field.type === 'single_select_and_input') {
    const v = (value as { num?: string; speed?: string } | undefined) ?? {};
    const update = (patch: { num?: string; speed?: string }) => {
      const next = { num: v.num ?? '', speed: v.speed ?? '', ...patch };
      setValue(next.num === '' && next.speed === '' ? undefined : next);
    };
    return (
      <div className="field">
        <FieldLabel field={field} sectionLabel={sectionLabel} />
        <div className="row">
          <NumberInput value={v.num ?? ''} placeholder="个数" onChange={(x) => update({ num: x })} />
          <span className="unit">{field.note || '个满速御魂 ≥'}</span>
          <NumberInput value={v.speed ?? ''} placeholder={field.hint || '速度'} onChange={(x) => update({ speed: x })} />
        </div>
      </div>
    );
  }

  // ---- 纯数字输入 ----
  if (field.type === 'input_integer' || field.type === 'input_float') {
    const unit = field.label?.includes('天') ? '天' : field.label?.includes('元') ? '元' : '';
    return (
      <div className="field">
        <FieldLabel field={field} sectionLabel={sectionLabel} />
        <div className="row">
          <NumberInput
            value={value === undefined || value === null ? '' : String(value)}
            placeholder="不限"
            onChange={(x) => setValue(x === '' ? undefined : x)}
          />
          {unit && <span className="unit">{unit}</span>}
        </div>
      </div>
    );
  }

  // ---- 选项类（胶囊 + 长列表折叠搜索）----
  const options = field.options ?? [];
  if (options.length) {
    const long = options.length > 12;
    const visible = long && !expanded ? options.slice(0, 12) : options;
    const q = optQuery.trim().toLowerCase();
    const filtered = q
      ? visible.filter(
          (o) => o.label.toLowerCase().includes(q) || String(o.value).includes(q) ||
            (o.pinyin ?? '').toLowerCase().includes(q),
        )
      : visible;
    return (
      <div className="field">
        <FieldLabel field={field} sectionLabel={sectionLabel} />
        <div className="row">
          <OptionPills
            options={filtered}
            selected={selectedValues}
            onToggle={toggleOption}
            shake={shake}
          />
        </div>
        {long && (
          <div className="row" style={{ marginTop: 7 }}>
            <div
              className="opt more"
              onClick={() => {
                setExpanded((x) => !x);
                setOptQuery('');
              }}
            >
              {expanded ? '收起' : `展开 ${options.length} 项`}
            </div>
          </div>
        )}
        {long && expanded && (
          <div className="expand-panel show">
            <input
              className="sbox"
              placeholder="搜索选项…"
              value={optQuery}
              onChange={(e) => setOptQuery(e.target.value)}
            />
            <div className="opt-wrap">
              <OptionPills options={filtered} selected={selectedValues} onToggle={toggleOption} shake={shake} />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="field">
      <div className="note">该条件（{field.key || '无参数名'}）暂无可选项</div>
    </div>
  );
};
