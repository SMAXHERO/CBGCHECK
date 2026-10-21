import type { InspectorReport as InspectorReportData } from '@/api/inspector';
import { CellTable, fmt, fmtInt } from './helpers';

/**
 * 「速度盘点」标签页：满速统计 / 散件一速 TOP5 / 常用 PVP 套件速度 / 满速御魂清单。
 * 对应原页面 InspectorReport.tsx 的 `tab === 'speed' && speed` 段（原 L566–L634）。
 * 纯展示组件；`speed` 的非空判断由页面壳守卫，子组件只接收非空值。
 */
export interface SpeedTabProps {
  speed: NonNullable<InspectorReportData['speed']>;
}

export const SpeedTab = ({ speed }: SpeedTabProps) => (
  <>
    <section className="soul-card">
      <h3 className="insp-h3">满速御魂</h3>
      <div className="insp-kpis">
        <div className="insp-kpi">
          <span>满速总量</span>
          <b>{fmtInt(speed.fullSpeedCount)}</b>
        </div>
        {Object.entries(speed.fullSpeedByPosition).map(([pos, count]) => (
          <div className="insp-kpi" key={pos}>
            <span>{pos} 号位</span>
            <b>{fmtInt(count)}</b>
          </div>
        ))}
      </div>
    </section>

    <section className="soul-card">
      <h3 className="insp-h3">散件一速 TOP5</h3>
      {speed.scatterTop.map((row) => (
        <div className="insp-row" key={row.rank}>
          <div className="insp-row-head">
            <span className="insp-rank">#{row.rank}</span>
            <b>{fmt(row.value)}</b>
          </div>
          <CellTable cells={row.cells} />
        </div>
      ))}
    </section>

    <section className="soul-card">
      <h3 className="insp-h3">常用 PVP 套件速度</h3>
      {speed.suitTable.map((row) => (
        <div className="insp-row" key={row.suit}>
          <div className="insp-row-head">
            <b>{row.suit}</b>
            <span className="insp-rank">{fmt(row.value)}</span>
          </div>
          <CellTable cells={row.cells} />
        </div>
      ))}
    </section>

    <section className="soul-card">
      <h3 className="insp-h3">满速御魂清单</h3>
      <table className="insp-table">
        <thead>
          <tr>
            <th>号位</th>
            <th>套装</th>
            <th>主属性</th>
            <th>速度副属性</th>
          </tr>
        </thead>
        <tbody>
          {speed.fullSpeedRelics.map((relic, index) => (
            <tr key={`${relic.position}-${relic.suitName}-${index}`}>
              <td>{relic.position}</td>
              <td>{relic.suitName}</td>
              <td>{relic.mainAttribute.label}</td>
              <td>{fmt(relic.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  </>
);
