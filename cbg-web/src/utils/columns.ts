import type { ExportColumn, Listing } from '@/types';

/** 价格：分 -> 元（Excel 里保持数字类型，能直接求和排序） */
const yuan = (fen: number | null): number | null =>
  fen === null ? null : Math.round(fen / 100);

const round2 = (n: number | null): number | null => (n === null ? null : Math.round(n * 100) / 100);

/**
 * 导出列定义 —— 表格导出、CSV、打印共用同一份。
 */
export const listingExportColumns: ExportColumn<Listing>[] = [
  { key: 'title', title: '账号标题', value: (r) => r.title },
  { key: 'price', title: '价格(元)', numeric: true, value: (r) => yuan(r.price) },
  { key: 'collect_num', title: '收藏数', numeric: true, value: (r) => r.collect_num },
  { key: 'server_name', title: '服务器', value: (r) => r.server_name },
  { key: 'area_name', title: '大区', value: (r) => r.area_name },
  { key: 'level_desc', title: '等级', value: (r) => r.level_desc },
  { key: 'ssr', title: 'SSR', numeric: true, value: (r) => r.ssr },
  { key: 'six_star', title: '六星式神', numeric: true, value: (r) => r.six_star },
  { key: 'sign_days', title: '签到天数', numeric: true, value: (r) => r.sign_days },
  { key: 'sanjian_speed', title: '散件一速', numeric: true, value: (r) => round2(r.sanjian_speed) },
  { key: 'zhaocai_speed', title: '招财一速', numeric: true, value: (r) => round2(r.zhaocai_speed) },
  {
    key: 'tou_wei',
    title: '头尾',
    value: (r) => (r.tou_num === null ? null : `${r.tou_num}头${r.wei_num ?? 0}尾`),
  },
  { key: 'tou_speed', title: '头速度', numeric: true, value: (r) => round2(r.tou_speed) },
  { key: 'pvp', title: '斗技分', numeric: true, value: (r) => r.pvp },
  { key: 'titles', title: '称号', value: (r) => r.titles.join('、') },
  { key: 'highlights', title: '亮点标签', value: (r) => r.highlights.join(' / ') },
  { key: 'selling_time', title: '上架时间', value: (r) => r.selling_time },
  { key: 'fair_show_end_time', title: '公示结束', value: (r) => r.fair_show_end_time },
  { key: 'status_label', title: '状态', value: (r) => r.status_label },
  { key: 'expire_remain_hours', title: '剩余小时', numeric: true, value: (r) => r.expire_remain_hours },
  { key: 'allow_bargain', title: '可还价', value: (r) => (r.allow_bargain ? '是' : '否') },
  { key: 'source_tag', title: '数据来源', value: (r) => r.source_tag },
  {
    key: 'url',
    title: '藏宝阁链接',
    value: (r) => `https://yys.cbg.163.com/cgi/mweb/equip/${r.server_id ?? ''}/${r.id}`,
  },
];

/** 打印视图用更精简的列，A4 横向才放得下 */
export const listingPrintColumns = listingExportColumns.filter((c) =>
  [
    'title',
    'price',
    'server_name',
    'ssr',
    'six_star',
    'sign_days',
    'sanjian_speed',
    'zhaocai_speed',
    'tou_wei',
    'tou_speed',
    'pvp',
    'collect_num',
  ].includes(c.key),
);
