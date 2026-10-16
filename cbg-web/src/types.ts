/** 规范化后的账号记录。字段定义与 tools/cbg/seed_web_data.py 的输出严格对应。 */
export interface Listing {
  /** 商品唯一 ID（藏宝阁 eid） */
  id: string;
  /** 订单号 */
  order_sn: string;
  /** 账号标题（藏宝阁叫 format_equip_name） */
  title: string;

  /** 售价，单位：分 */
  price: number | null;
  /** 原价，单位：分 */
  bare_price: number | null;
  /** 收藏人数 */
  collect_num: number;

  server_id: number | null;
  server_name: string;
  area_name: string;
  /** 1=iOS 2=安卓 等，以藏宝阁定义为准 */
  platform_type: number | null;
  game_channel: string;

  equip_level: number | null;
  level_desc: string;

  /** SSR 数量 */
  ssr: number | null;
  /** 六星式神数量 */
  six_star: number | null;
  /** 签到天数 */
  sign_days: number | null;

  /** 散件一速 */
  sanjian_speed: number | null;
  /** 招财一速 */
  zhaocai_speed: number | null;
  /** 头数量 */
  tou_num: number | null;
  /** 尾数量 */
  wei_num: number | null;
  /** 头速度 */
  tou_speed: number | null;
  /** 斗技分数 */
  pvp: number | null;

  /**
   * 勾玉数量。
   *
   * 注意：这个字段**不在藏宝阁列表接口的响应里**（列表只返回 top_heros / basic_attrs
   * 这类摘要，勾玉属于商品详情数据）。所以实际抓到的快照里它通常是 null，
   * 对应的筛选条件会被界面标为「未生效」。
   * 这里仍然保留该字段并接好过滤逻辑：一旦数据源能带上它（比如换成详情接口），
   * 勾玉条件立刻生效，不用改代码。
   */
  goyu: number | null;

  /** 称号类标签，如「地域·天下一」 */
  titles: string[];
  /** 原始 highlights 文本 */
  highlights: string[];
  icon: string;

  selling_time: string;
  fair_show_end_time: string;
  expire_remain_seconds: number | null;
  expire_remain_hours: number | null;
  status: number | null;
  status_label: string;
  allow_bargain: boolean;
  is_ad: boolean;

  /** 数据来源标记（哪一轮筛选抓到的） */
  source_tag: string;
  captured_at: string;
}

/** 数值字段名，供表格排序与图表聚合复用 */
export type NumericField =
  | 'price'
  | 'collect_num'
  | 'ssr'
  | 'six_star'
  | 'sign_days'
  | 'sanjian_speed'
  | 'zhaocai_speed'
  | 'tou_num'
  | 'wei_num'
  | 'tou_speed'
  | 'pvp'
  | 'expire_remain_hours';

/** 表格导出用的列定义 */
export interface ExportColumn<T> {
  key: string;
  title: string;
  /** 导出到 Excel/CSV 的取值函数，返回原始值（不带单位） */
  value: (row: T) => string | number | null | undefined;
  /** 数值列在 Excel 里保持数字类型 */
  numeric?: boolean;
}
