import type { Listing } from '@/types';
import { listingPrintColumns } from '@/utils/columns';
import { fenToYuan } from '@/utils/format';

interface Props {
  rows: Listing[];
  /** 页面上的条件摘要，打印出来才知道这份表是怎么筛的 */
  filterSummary: string;
  generatedAt: string;
}

/**
 * 打印专用视图。
 *
 * 为什么不直接打印 antd 的 Table：表格分页只渲染当前页的 DOM，
 * 而且滚动容器在打印时会被裁掉。这里用一个纯 <table> 把**全部**筛选结果铺开，
 * 配合 index.css 的 @media print 规则，Ctrl+P 就能得到完整清单（也能另存为 PDF）。
 */
export const PrintView = ({ rows, filterSummary, generatedAt }: Props) => {
  const prices = rows.map((r) => r.price).filter((v): v is number => v !== null);
  const lo = prices.length ? Math.min(...prices) : 0;
  const hi = prices.length ? Math.max(...prices) : 0;

  return (
    <div id="print-area" className="print-view">
      <h1 className="print-title">藏宝阁账号筛选结果</h1>
      <div className="print-meta">
        <div>筛选条件：{filterSummary || '无（全部数据）'}</div>
        <div>
          记录条数：{rows.length} 条 ｜ 数据生成时间：{generatedAt} ｜ 打印时间：
          {new Date().toLocaleString('zh-CN')}
        </div>
      </div>
      <table className="print-table">
        <thead>
          <tr>
            <th>#</th>
            {listingPrintColumns.map((c) => (
              <th key={c.key}>{c.title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td>{i + 1}</td>
              {listingPrintColumns.map((c) => {
                const raw = c.value(r);
                // 价格列在导出定义里已经是「元」，这里补上货币符号更好读
                const text =
                  c.key === 'price' && raw !== null && raw !== undefined
                    ? `¥${Number(raw).toLocaleString('zh-CN')}`
                    : raw === null || raw === undefined
                      ? '-'
                      : String(raw);
                return (
                  <td key={c.key} className={c.numeric ? 'num' : undefined}>
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="print-foot">
        数据来源：藏宝阁公开列表页聚合信息（价格单位：元）。本页仅供个人比价参考，请遵守平台用户协议。
        {rows.length > 0 && (
          <span>
            {' '}
            价格区间：¥{Math.round(fenToYuan(lo) ?? 0).toLocaleString('zh-CN')} ~ ¥
            {Math.round(fenToYuan(hi) ?? 0).toLocaleString('zh-CN')}
          </span>
        )}
      </div>
    </div>
  );
};
