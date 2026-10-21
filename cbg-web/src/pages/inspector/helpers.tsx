import { inspectorApi, type JobState, type SpeedCell } from '@/api/inspector';

/**
 * 看号页共享工具：数字格式化、输入解析、异步任务轮询、速度单元格表。
 * 从 InspectorReport.tsx 原样迁出（原文件 L52–L103），函数体与注释保持不变。
 */

export const fmt = (n: number | null | undefined, d = 2) =>
  n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(d);
export const fmtInt = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('zh-CN');
export const numText = (v: { raw?: number; text?: string } | number | null | undefined) =>
  v === null || v === undefined
    ? '—'
    : typeof v === 'number'
      ? fmtInt(v)
      : v.text ?? fmtInt(v.raw);

/** 从链接/订单号里解析（服务端会再解析一次，这里只为提前校验与提示） */
export function parseCbgInput(raw: string): { ordersn?: string; serverid?: string; url?: string } {
  const s = raw.trim();
  if (!s) return {};
  const m = s.match(/\/equip\/(\d+)\/([0-9]{8,}-[0-9]+-[0-9A-Za-z]+)/);
  if (m) return { serverid: m[1], ordersn: m[2], url: s };
  if (/^[0-9]{8,}-[0-9]+-[0-9A-Za-z]+$/.test(s)) return { ordersn: s, serverid: s.split('-')[1] };
  return {};
}

/** 轮询异步任务直到完成 */
export async function pollJob(id: string, onProgress: (job: JobState) => void): Promise<JobState> {
  for (;;) {
    const { job } = await inspectorApi.job(id);
    onProgress(job);
    if (job.status === 'done' || job.status === 'error') return job;
    await new Promise((r) => setTimeout(r, 700));
  }
}

export interface CellTableProps {
  cells: SpeedCell[];
}

export const CellTable = ({ cells }: CellTableProps) => (
  <table className="insp-cells">
    <tbody>
      <tr>
        {cells.map((cell) => (
          <td key={cell.position}>
            <b>{fmt(cell.value)}</b>
            <span className="insp-cell-sub">
              {cell.position}号位 · {cell.suitName}
              {cell.labels.length > 0 ? ` · ${cell.labels.join('/')}` : ''}
            </span>
            <span className="insp-cell-main">
              {cell.mainAttribute.label}
              {cell.mainAttribute.isPercent ? ' %' : ''}
            </span>
          </td>
        ))}
      </tr>
    </tbody>
  </table>
);
