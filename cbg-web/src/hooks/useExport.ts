import { useCallback } from 'react';
import type { ExportColumn } from '@/types';
import { exportCsv, exportExcel, printArea } from '@/utils/export';

/**
 * 导出动作内聚：Excel / CSV / 打印 + 禁用判断。
 *
 * 禁用条件与改造前一致：没有数据行时全部禁用（即 rows.length === 0）。
 * 文件名仍由 utils/export.ts 的默认参数生成，规则不变。
 */

export interface UseExportOptions<T> {
  rows: T[];
  columns: ExportColumn<T>[];
  printAreaId: string;
  printTitle: string;
}

export interface UseExportResult {
  exportExcel: () => void;
  exportCsv: () => void;
  print: () => void;
  disabled: boolean;
}

export const useExport = <T,>({
  rows,
  columns,
  printAreaId,
  printTitle,
}: UseExportOptions<T>): UseExportResult => {
  const disabled = rows.length === 0;

  const onExportExcel = useCallback(() => exportExcel(rows, columns), [rows, columns]);
  const onExportCsv = useCallback(() => exportCsv(rows, columns), [rows, columns]);
  const print = useCallback(() => printArea(printAreaId, printTitle), [printAreaId, printTitle]);

  return { exportExcel: onExportExcel, exportCsv: onExportCsv, print, disabled };
};
