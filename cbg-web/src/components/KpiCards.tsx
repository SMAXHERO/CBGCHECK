import { Tooltip } from 'antd';
import type { Kpi } from '@/utils/analytics';

interface Props {
  kpis: Kpi[];
  loading?: boolean;
}

/**
 * 顶部 KPI 卡。用普通 div 而不是 antd Statistic：
 * 深色皮肤下 antd 的标题/数值颜色需要逐项覆盖，直接手写更短也更可控。
 */
export const KpiCards = ({ kpis, loading }: Props) => (
  <div className="kpi-grid">
    {kpis.map((k) => (
      <div className="kpi" key={k.label}>
        <div className="k-lab">
          <span>{k.label}</span>
          {k.hint && (
            <Tooltip title={k.hint}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 13,
                  height: 13,
                  borderRadius: '50%',
                  background: 'var(--surface-3)',
                  color: 'var(--faint)',
                  fontSize: 9,
                  cursor: 'help',
                }}
              >
                ?
              </span>
            </Tooltip>
          )}
        </div>
        <div className="k-val">{loading ? '—' : k.value}</div>
        {k.hint && <div className="k-hint">{k.hint}</div>}
      </div>
    ))}
  </div>
);
