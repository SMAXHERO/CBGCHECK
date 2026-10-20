import { useMemo } from 'react';
import { Empty, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { TablePaginationConfig } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import type { Listing } from '@/types';
import { cbgDetailUrl } from '@/api/dataset';
import { useAppStore } from '@/store/useAppStore';
import { compareBy } from '@/utils/sort';
import { formatNumber, formatPrice, formatRemain, formatSpeed } from '@/utils/format';

const { Text, Link } = Typography;

interface Props {
  rows: Listing[];
  loading?: boolean;
  /** compact：只留决策相关的核心列，便于窄屏与打印 */
  columns?: 'full' | 'compact';
}

/** 精简模式下保留的列 */
const COMPACT_KEYS = new Set([
  'title',
  'price',
  'server_name',
  'sanjian_speed',
  'zhaocai_speed',
  'tou_wei',
  'sign_days',
  'status',
]);

const sorterFor = (field: keyof Listing & string, dir: 'ascend' | 'descend') =>
  compareBy(field as never, dir);

/** 亮点标签配色：一速类蓝、招财绿、头尾橙、斗技红、称号紫 */
const highlightColor = (label: string): string => {
  if (label.includes('散件一速')) return 'blue';
  if (label.includes('招财一速')) return 'green';
  if (/头|尾/.test(label)) return 'orange';
  if (label.includes('斗技')) return 'red';
  if (label.startsWith('地域') || label.includes('世界') || label.includes('之巅')) return 'purple';
  return 'default';
};

/** 模块二「账号评分」的路由，带上 eid 与 serverid 直接打开分析 */
export const scoreRouteFor = (row: Listing) =>
  `/score?eid=${encodeURIComponent(row.eid ?? '')}&serverid=${row.server_id ?? ''}`;

/** 模块三「御魂报告」的路由，带上订单号与 serverid 直接出报告（与评分按钮一致的做法） */
export const soulRouteFor = (row: Listing) =>
  `/soul?ordersn=${encodeURIComponent(row.order_sn)}&serverid=${row.server_id ?? ''}`;

export const DataTable = ({ rows, loading, columns: variant = 'full' }: Props) => {
  const selectedIds = useAppStore((s) => s.selectedIds);
  const setSelected = useAppStore((s) => s.setSelected);
  const navigate = useNavigate();

  const allColumns = useMemo<ColumnsType<Listing>>(
    () => [
      {
        title: '账号',
        dataIndex: 'title',
        key: 'title',
        width: 190,
        fixed: 'left',
        sorter: (a, b) => a.title.localeCompare(b.title, 'zh-CN'),
        render: (_: unknown, r) => (
          <div className="cell-title">
            <Link
              className="ext-link"
              href={cbgDetailUrl(r)}
              target="_blank"
              rel="noreferrer noopener"
              ellipsis
            >
              {r.title}
              <svg
                width="9"
                height="9"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path d="M6 3h7v7M13 3 6 10" />
              </svg>
            </Link>
            <span className="cell-sub">
              {r.order_sn.slice(-12)}
              {r.eid ? (
                <button
                  type="button"
                  className="cell-score-link"
                  title="用这个账号的御魂数据做评分（须佐之男 / 阿修罗）"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(scoreRouteFor(r));
                  }}
                >
                  评分
                  <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 3h7v7M13 3 6 10" />
                  </svg>
                </button>
              ) : null}
              {r.order_sn && r.server_id ? (
                <button
                  type="button"
                  className="cell-score-link"
                  title="看这个账号的御魂报告（一速 / 头尾 / 组合搜索）"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(soulRouteFor(r));
                  }}
                >
                  御魂
                  <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 3h7v7M13 3 6 10" />
                  </svg>
                </button>
              ) : null}
            </span>
          </div>
        ),
      },
      {
        title: '价格',
        dataIndex: 'price',
        key: 'price',
        width: 104,
        align: 'right',
        fixed: 'left',
        defaultSortOrder: 'descend',
        sorter: (a, b) => (a.price ?? 0) - (b.price ?? 0),
        render: (v: number | null) => (
          <Text className="price-em" style={{ fontSize: 13 }}>
            {formatPrice(v)}
          </Text>
        ),
      },
      {
        title: '服务器 / 大区',
        dataIndex: 'server_name',
        key: 'server_name',
        width: 148,
        filters: [...new Set(rows.map((r) => r.server_name))].map((s) => ({ text: s, value: s })),
        onFilter: (value, r) => r.server_name === value,
        render: (v: string, r) => (
          <div className="cell-title">
            <span>{v || '-'}</span>
            <span className="cell-sub">{r.area_name}</span>
          </div>
        ),
      },
      {
        title: '散件一速',
        dataIndex: 'sanjian_speed',
        key: 'sanjian_speed',
        width: 100,
        align: 'right',
        sorter: sorterFor('sanjian_speed', 'descend'),
        render: (v: number | null) => (
          <span className={`num${v !== null && v >= 158 ? ' hot' : ''}`}>{formatSpeed(v)}</span>
        ),
      },
      {
        title: '招财',
        dataIndex: 'zhaocai_speed',
        key: 'zhaocai_speed',
        width: 88,
        align: 'right',
        sorter: sorterFor('zhaocai_speed', 'descend'),
        render: (v: number | null) => <span className="num">{formatSpeed(v)}</span>,
      },
      {
        title: '头/尾',
        key: 'tou_wei',
        width: 84,
        align: 'center',
        sorter: sorterFor('tou_num', 'descend'),
        render: (_, r) =>
          r.tou_num === null ? (
            <span className="num">-</span>
          ) : (
            <Tag color={r.tou_num >= 4 ? 'gold' : 'default'} style={{ margin: 0 }}>
              {r.tou_num}头{r.wei_num ?? 0}尾
            </Tag>
          ),
      },
      {
        title: '头速度',
        dataIndex: 'tou_speed',
        key: 'tou_speed',
        width: 88,
        align: 'right',
        sorter: sorterFor('tou_speed', 'descend'),
        render: (v: number | null) => <span className="num">{formatSpeed(v)}</span>,
      },
      {
        title: '签到',
        dataIndex: 'sign_days',
        key: 'sign_days',
        width: 92,
        align: 'right',
        sorter: sorterFor('sign_days', 'descend'),
        render: (v: number | null) => (
          <Tooltip title={v === null ? '' : `${(v / 365).toFixed(1)} 年`}>
            <span className="num">{v === null ? '-' : `${v} 天`}</span>
          </Tooltip>
        ),
      },
      {
        title: 'SSR',
        dataIndex: 'ssr',
        key: 'ssr',
        width: 70,
        align: 'right',
        sorter: sorterFor('ssr', 'descend'),
        render: (v: number | null) => <span className="num">{v ?? '-'}</span>,
      },
      {
        title: '六星',
        dataIndex: 'six_star',
        key: 'six_star',
        width: 70,
        align: 'right',
        sorter: sorterFor('six_star', 'descend'),
        render: (v: number | null) => <span className="num">{v ?? '-'}</span>,
      },
      {
        title: '斗技',
        dataIndex: 'pvp',
        key: 'pvp',
        width: 78,
        align: 'right',
        sorter: sorterFor('pvp', 'descend'),
        render: (v: number | null) => (
          <span className="num">{v === null ? '-' : formatNumber(v)}</span>
        ),
      },
      {
        title: '收藏',
        dataIndex: 'collect_num',
        key: 'collect_num',
        width: 72,
        align: 'right',
        sorter: sorterFor('collect_num', 'descend'),
        render: (v: number) => <span className="num">{v}</span>,
      },
      {
        title: '状态',
        key: 'status',
        width: 118,
        render: (_, r) => (
          <div className="cell-title">
            <Tag
              color={r.status === 3 ? 'orange' : 'green'}
              style={{ margin: 0, width: 'fit-content' }}
            >
              {r.status_label}
            </Tag>
            <span className="cell-sub">剩余 {formatRemain(r.expire_remain_seconds)}</span>
          </div>
        ),
      },
      {
        title: '上架时间',
        dataIndex: 'selling_time',
        key: 'selling_time',
        width: 140,
        sorter: (a, b) => a.selling_time.localeCompare(b.selling_time),
        render: (v: string) => (
          <span className="num" style={{ fontSize: 11.5 }}>
            {v}
          </span>
        ),
      },
    ],
    [rows],
  );

  const columns = useMemo(
    () =>
      variant === 'compact'
        ? allColumns.filter((c) => COMPACT_KEYS.has(String(c.key)))
        : allColumns,
    [allColumns, variant],
  );

  /** 点击行任意位置即勾选，比精确点复选框效率高 */
  const onRow = (record: Listing) => ({
    onClick: (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest('a') ||
        target.closest('.ant-checkbox-wrapper') ||
        target.closest('.ant-table-column-sorters')
      ) {
        return;
      }
      setSelected(
        selectedIds.includes(record.id)
          ? selectedIds.filter((x) => x !== record.id)
          : [...selectedIds, record.id],
      );
    },
  });

  const pagination: TablePaginationConfig = {
    defaultPageSize: 20,
    showSizeChanger: true,
    pageSizeOptions: ['10', '20', '50', '100'],
    showTotal: (total, range) => `${range[0]}-${range[1]} / 共 ${total} 条`,
    size: 'small',
    responsive: true,
  };

  if (!rows.length) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={<span style={{ color: 'var(--dim)' }}>没有符合条件的数据，试着放宽条件</span>}
        style={{ padding: '40px 0' }}
      />
    );
  }

  return (
    <Table<Listing>
      rowKey="id"
      size="middle"
      columns={columns}
      dataSource={rows}
      loading={loading}
      pagination={pagination}
      scroll={{ x: 1420 }}
      rowSelection={{
        selectedRowKeys: selectedIds,
        onChange: (keys) => setSelected(keys as string[]),
        columnWidth: 42,
      }}
      rowClassName={() => 'row-clickable'}
      onRow={onRow}
      expandable={{
        rowExpandable: (r) => r.highlights.length > 0,
        expandedRowRender: (r) => (
          <div className="row" style={{ gap: 4 }}>
            {r.highlights.map((h) => (
              <Tag key={h} color={highlightColor(h)} style={{ margin: 0 }}>
                {h}
              </Tag>
            ))}
          </div>
        ),
      }}
    />
  );
};
