import type { SearchField, SearchOption } from '@/api/searchSchema';

/** 已选状态的键：`${sectionIndex}_${fieldIndex}` */
export interface FieldProps {
  id: string;
  field: SearchField;
  /** 当前值，具体形状由 field.type 决定；未选中时为 undefined */
  value: unknown;
  onChange: (id: string, value: unknown) => void;
}

/** 计算要显示的元信息，如「×100」「最多3」「0-162」 */
export const fieldMeta = (field: SearchField): string => {
  const parts: string[] = [];
  if (field.multiple && field.maxChecked) parts.push(`最多${field.maxChecked}`);
  if (field.valueMultiply && field.valueMultiply !== 1) parts.push(`×${field.valueMultiply}`);
  else if (field.min != null && field.max != null && field.type?.startsWith('input')) {
    parts.push(`${field.min}~${field.max}`);
  }
  return parts.join(' · ');
};

/**
 * 字段标题行。
 * 原面板有个细节：字段名和分组名相同时不重复显示（如「价格(元)」组里的「价格(元)」字段）。
 */
export const FieldLabel = ({
  field,
  sectionLabel,
}: {
  field: SearchField;
  sectionLabel: string;
}) => {
  const sameAsSection = (field.label || field.key) === sectionLabel;
  const meta = fieldMeta(field);
  if (sameAsSection && !field.symbol && !meta) return null;
  return (
    <div className="flabel">
      {!sameAsSection && <span className="t">{field.label || field.key}</span>}
      {field.symbol && <span className="sym">{field.symbol}</span>}
      {meta && <span className="meta">{meta}</span>}
    </div>
  );
};

/** 选项胶囊列表（长列表由 OptionField 负责折叠与搜索） */
export const OptionPills = ({
  options,
  selected,
  onToggle,
  shake,
}: {
  options: SearchOption[];
  selected: string[];
  onToggle: (value: string, node?: HTMLElement) => void;
  /** 触发「超出可选数量」抖动动画的选项值 */
  shake?: string | null;
}) => (
  <>
    {options.map((opt) => {
      const v = String(opt.value);
      const on = selected.includes(v);
      return (
        <div
          key={`${v}-${opt.label}`}
          className={`opt${on ? ' on' : ''}${shake === v ? ' shake' : ''}`}
          title={opt.pinyin ? `${opt.label}（${opt.pinyin}）` : opt.label}
          onClick={(e) => onToggle(v, e.currentTarget)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onToggle(v, e.currentTarget);
          }}
        >
          {opt.label}
        </div>
      );
    })}
  </>
);

/** 单个数字输入 */
export const NumberInput = ({
  value,
  placeholder,
  onChange,
  width,
}: {
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  width?: number;
}) => (
  <input
    className="num-in"
    type="number"
    inputMode="decimal"
    style={width ? { width } : undefined}
    placeholder={placeholder}
    value={value}
    onChange={(e) => onChange(e.target.value)}
  />
);

/** 开关 */
export const Switch = ({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) => (
  <div className="sw-row" onClick={onToggle} role="switch" aria-checked={on} tabIndex={0}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') onToggle();
    }}>
    <div className="txt">{label}</div>
    <div className={`sw${on ? ' on' : ''}`} />
  </div>
);
