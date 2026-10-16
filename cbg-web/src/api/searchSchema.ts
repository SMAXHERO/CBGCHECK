/**
 * 筛选条件 schema —— 与 cbg-filter-kit 的 data/filters.json 一一对应。
 *
 * 之所以保持「数据驱动」而不是把 72 项条件写死成 JSX：
 * 藏宝阁改版后只要重新生成 filters.json，前端不用改一行代码。
 */

export interface SearchOption {
  /** 选项值；range_input_with_select 这类选项没有 value，只有 min/max */
  value?: string | number | null;
  label: string;
  min?: number | string | null;
  max?: number | string | null;
  /** 式神/御魂的附加信息，如星级、拼音 */
  extra?: string | number | null;
  pinyin?: string | null;
}

export type FieldType =
  | 'checkbox'
  | 'check_box'
  | 'multiple_select'
  | 'input_integer'
  | 'input_float'
  | 'range_input_with_select'
  | 'single_select_and_input'
  | 'indexer_list_check'
  | 'custom_component';

export interface SearchField {
  key?: string | null;
  label?: string | null;
  innerLabel?: string | null;
  type?: FieldType | null;
  kind?: 'field' | 'note' | null;
  /** note 类型专用：一段说明文字 */
  text?: string;
  displayType?: string | null;
  symbol?: string | null;
  /** 界面上填 1，接口要乘 100（价格/一速这类） */
  valueMultiply?: number | null;
  multiple?: boolean;
  maxChecked?: number | null;
  options?: SearchOption[];
  min?: number | null;
  max?: number | null;
  selectKey?: string | null;
  inputKey?: string | null;
  checkboxValue?: string | number | null;
  hint?: string | null;
  hintMin?: string | null;
  hintMax?: string | null;
  /** single_select_and_input 的中间文案，如「个满速御魂 ≥」 */
  note?: string | null;
}

export interface SearchSection {
  label: string;
  fields: SearchField[];
}

export interface SearchSchema {
  searchType: string;
  name: string;
  totalFields: number;
  sections: SearchSection[];
}

/** 服务器条目：[serverid, 名称, ...] */
export interface ServerEntry {
  groupId: string;
  group: string;
  entry: [number, string, string, string, string, number[]];
}

/** 提交给藏宝阁搜索接口的参数（值一律是字符串） */
export type SearchParams = Record<string, string>;

/** 一条已选条件的可读描述，用于 chips 与打印页眉 */
export interface SelectedCondition {
  /** 稳定 id：`${sectionIndex}:${fieldIndex}` */
  id: string;
  /** 所属分组名 */
  group: string;
  /** 条件名 */
  label: string;
  /** 值的可读形式，如「158」「500~1999」「网易-相伴相随、今时月」 */
  display: string;
  /** 对应的接口参数名，如 `max_sanjian_speed=15800` */
  param: string;
}
