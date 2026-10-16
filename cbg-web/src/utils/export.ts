import * as XLSX from 'xlsx';
import type { ExportColumn } from '@/types';

/**
 * 导出工具。
 *
 * 两个必须处理的坑：
 * 1. **中文 CSV 乱码** —— Excel 默认按 GBK 解析 CSV，必须写 UTF-8 BOM（\uFEFF）。
 * 2. **价格单位** —— 内部存的是「分」，导出给人看必须转成「元」，
 *    并且要在 Excel 里保持数字类型，否则没法直接求和排序。
 */

const timestamp = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

const triggerDownload = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 交给浏览器读完再释放，立即 revoke 在部分浏览器会导致下载中断
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

/** CSV 单元格转义：含逗号/引号/换行时用双引号包裹并把内部引号翻倍 */
const csvCell = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const exportCsv = <T>(
  rows: T[],
  columns: ExportColumn<T>[],
  filename = `藏宝阁筛选结果_${timestamp()}`,
): void => {
  const header = columns.map((c) => csvCell(c.title)).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(',')).join('\r\n');
  // \uFEFF 是 UTF-8 BOM，缺了它 Excel 打开中文就是乱码
  const content = `\uFEFF${header}\r\n${body}`;
  triggerDownload(new Blob([content], { type: 'text/csv;charset=utf-8;' }), `${filename}.csv`);
};

export const exportExcel = <T>(
  rows: T[],
  columns: ExportColumn<T>[],
  filename = `藏宝阁筛选结果_${timestamp()}`,
): void => {
  const header = columns.map((c) => c.title);
  const body = rows.map((r) => columns.map((c) => c.value(r) ?? ''));
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);

  // 列宽按内容长度估算，上限 40 字符
  sheet['!cols'] = columns.map((c) => {
    const maxLen = rows.reduce((acc, r) => {
      const v = c.value(r);
      return Math.max(acc, v === null || v === undefined ? 0 : String(v).length);
    }, c.title.length * 2);
    return { wch: Math.min(40, Math.max(8, maxLen + 2)) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, '筛选结果');

  // 第二个 sheet 记录导出上下文，便于日后回溯这份表是怎么筛出来的
  const info = XLSX.utils.aoa_to_sheet([
    ['导出时间', new Date().toLocaleString('zh-CN')],
    ['记录条数', rows.length],
    ['说明', '由藏宝阁数据面板导出，价格单位为人民币元'],
  ]);
  info['!cols'] = [{ wch: 12 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, info, '导出说明');

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  triggerDownload(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${filename}.xlsx`,
  );
};

/**
 * 打印/另存为 PDF。
 *
 * 思路：给 <body> 加一个 print-mode class，配合 index.css 里的 @media print
 * 规则只显示 `#print-area`，其余（侧栏、按钮、图表）全部隐藏。
 * 打完用 afterprint 移除 class，避免影响后续正常浏览。
 */
export const printArea = (areaId: string, title = '藏宝阁筛选结果'): void => {
  const area = document.getElementById(areaId);
  if (!area) {
    window.print();
    return;
  }

  const prevTitle = document.title;
  const cleanup = () => {
    document.body.classList.remove('print-mode');
    document.title = prevTitle;
    window.removeEventListener('afterprint', cleanup);
  };

  document.title = title;
  document.body.classList.add('print-mode');
  window.addEventListener('afterprint', cleanup);

  // 等一帧让样式生效，再调起打印
  requestAnimationFrame(() => {
    window.print();
    // Safari 不触发 afterprint，兜底清理
    setTimeout(cleanup, 1500);
  });
};
