import { Button, Drawer, Empty, Table, Tag, Typography } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { Listing } from '@/types';
import { useAppStore } from '@/store/useAppStore';
import { useRenderCount } from '@/hooks/useRenderCount';
import { cbgDetailUrl } from '@/api/dataset';
import { formatPrice, formatSpeed, formatSignYears } from '@/utils/format';

const { Text } = Typography;

interface Props {
  /** 全量数据，用于把勾选 id 还原成记录 */
  rows: Listing[];
}

/**
 * 对比清单：勾选的账号横向对比。
 * 只展示决策最相关的维度（价格 / 一速 / 头尾 / 签到 / 收藏 / 称号）。
 */
export const CompareDrawer = ({ rows }: Props) => {
  useRenderCount('CompareDrawer');
  const selectedIds = useAppStore((s) => s.selectedIds);
  const clearSelected = useAppStore((s) => s.clearSelected);
  const toggleSelect = useAppStore((s) => s.toggleSelect);

  const picked = selectedIds
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is Listing => Boolean(r));

  const columns: ColumnsType<Listing> = [
    {
      title: '账号',
      dataIndex: 'title',
      width: 180,
      render: (v: string, r) => (
        <div className="cell-title">
          <a className="ext-link" href={cbgDetailUrl(r)} target="_blank" rel="noreferrer noopener">
            {v}
          </a>
          <span className="cell-sub">{r.server_name}</span>
        </div>
      ),
    },
    {
      title: '价格',
      dataIndex: 'price',
      width: 96,
      align: 'right',
      render: (v: number | null) => <span className="price-em">{formatPrice(v)}</span>,
    },
    {
      title: '散件一速',
      dataIndex: 'sanjian_speed',
      width: 92,
      align: 'right',
      render: (v: number | null) => (
        <span className={`num${v !== null && v >= 158 ? ' hot' : ''}`}>{formatSpeed(v)}</span>
      ),
    },
    {
      title: '招财一速',
      dataIndex: 'zhaocai_speed',
      width: 92,
      align: 'right',
      render: (v: number | null) => <span className="num">{formatSpeed(v)}</span>,
    },
    {
      title: '头/尾',
      key: 'touwei',
      width: 80,
      align: 'center',
      render: (_, r) => (r.tou_num === null ? '-' : `${r.tou_num}头${r.wei_num ?? 0}尾`),
    },
    {
      title: '头速度',
      dataIndex: 'tou_speed',
      width: 84,
      align: 'right',
      render: (v: number | null) => <span className="num">{formatSpeed(v)}</span>,
    },
    {
      title: '签到',
      dataIndex: 'sign_days',
      width: 84,
      align: 'right',
      render: (v: number | null) => <span className="num">{formatSignYears(v)}</span>,
    },
    { title: 'SSR', dataIndex: 'ssr', width: 64, align: 'right' },
    { title: '六星', dataIndex: 'six_star', width: 64, align: 'right' },
    { title: '收藏', dataIndex: 'collect_num', width: 64, align: 'right' },
    {
      title: '称号',
      key: 'titles',
      render: (_, r) =>
        r.titles.length ? (
          <span className="row" style={{ gap: 3 }}>
            {r.titles.map((t) => (
              <Tag key={t} color="purple" style={{ margin: 0 }}>
                {t}
              </Tag>
            ))}
          </span>
        ) : (
          <Text style={{ color: 'var(--faint)' }}>-</Text>
        ),
    },
    {
      title: '',
      key: 'op',
      width: 48,
      render: (_, r) => (
        <Button
          type="text"
          size="small"
          icon={<DeleteOutlined />}
          onClick={() => toggleSelect(r.id)}
        />
      ),
    },
  ];

  const prices = picked.map((r) => r.price).filter((v): v is number => v !== null);
  const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const fastest = picked
    .map((r) => r.sanjian_speed)
    .filter((v): v is number => v !== null)
    .sort((a, b) => b - a)[0];

  return (
    <Drawer
      title={`对比清单（${picked.length} 个账号）`}
      placement="bottom"
      height="70%"
      open={selectedIds.length > 0}
      onClose={clearSelected}
      styles={{ body: { padding: 12 } }}
      extra={
        <Button size="small" onClick={clearSelected}>
          清空
        </Button>
      }
    >
      {!picked.length ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span style={{ color: 'var(--dim)' }}>勾选的账号不在当前数据里</span>}
        />
      ) : (
        <>
          <div className="row" style={{ gap: 24, marginBottom: 12 }}>
            <div>
              <div className="k-lab">对比数量</div>
              <div className="k-val" style={{ fontSize: 17 }}>{picked.length}</div>
            </div>
            <div>
              <div className="k-lab">均价</div>
              <div className="k-val" style={{ fontSize: 17 }}>{formatPrice(avgPrice)}</div>
            </div>
            {fastest !== undefined && (
              <div>
                <div className="k-lab">最快散件一速</div>
                <div className="k-val" style={{ fontSize: 17 }}>{fastest.toFixed(2)}</div>
              </div>
            )}
          </div>
          <Table<Listing>
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={picked}
            pagination={false}
            scroll={{ x: 1100 }}
          />
        </>
      )}
    </Drawer>
  );
};
