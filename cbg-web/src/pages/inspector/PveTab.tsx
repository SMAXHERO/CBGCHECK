import type { InspectorReport as InspectorReportData, JobState } from '@/api/inspector';
import { fmt, fmtInt } from './helpers';

/**
 * 「PVE 预览」标签页：21 组逢魔组合计算按钮与结果 / 高评分御魂数量。
 * 对应原页面 InspectorReport.tsx 的 `tab === 'pve'` 段（原 L636–L717）。
 * 请求由页面壳的 runPve 发起，本组件只通过 onRun 回调触发并展示 props。
 */
export interface PveResultRow {
  suit: string;
  omaSuit: string;
  damage: number;
  panel: Record<string, number>;
}

export interface PveResult {
  hero: string;
  average: number | null;
  rows: PveResultRow[];
}

export interface PveTabProps {
  pve: InspectorReportData['pveScores'] | undefined;
  pveJob: JobState | null;
  pveRunning: boolean;
  pveResult: PveResult | null;
  onRun: (refresh?: boolean) => void;
}

export const PveTab = ({ pve, pveJob, pveRunning, pveResult, onRun }: PveTabProps) => (
  <>
    <section className="soul-card">
      <h3 className="insp-h3">PVE 御魂组合</h3>
      <p className="soul-p">
        固定比较土蜘蛛、荒骷髅、鬼灵歌伎三种逢魔套；仅用账号内六星 +15 御魂；以满级须佐之男面板计算，普通两件套与逢魔一件套均计入。
        仅保留满暴方案，伤害指标 = 最终攻击 × 最终暴击伤害；不含技能、四件套效果与副本增益。
      </p>
      <div className="soul-input-row">
        <button className="btn btn-primary" onClick={() => void onRun()} disabled={pveRunning}>
          {pveRunning ? '计算中…' : '算 21 组最优组合'}
        </button>
        {pveResult && (
          <button className="btn" onClick={() => void onRun(true)} disabled={pveRunning}>
            重新计算
          </button>
        )}
        {pveJob?.progress && <span className="dim">{pveJob.progress}</span>}
      </div>
      <p className="soul-p dim">
        首次计算约 30 秒（8 进程并行），结果按账号缓存 24 小时，之后秒开。PVE 数字与站点逐组一致。
      </p>
      {pveResult && (
        <>
          <div className="insp-chips">
            <span className="insp-chip">
              总平均值 <b>{fmtInt(pveResult.average ? Math.round(pveResult.average) : 0)}</b>
            </span>
            <span className="insp-chip">
              已算出 <b>{pveResult.rows.length}</b> 组
            </span>
          </div>
          <table className="insp-table">
            <thead>
              <tr>
                <th>四件套</th>
                <th>逢魔</th>
                <th>伤害</th>
                <th>面板</th>
              </tr>
            </thead>
            <tbody>
              {pveResult.rows.map((row) => (
                <tr key={`${row.suit}-${row.omaSuit}`}>
                  <td>{row.suit}</td>
                  <td>{row.omaSuit}</td>
                  <td>
                    <b>{fmt(row.damage)}</b>
                  </td>
                  <td className="dim">
                    攻 {fmtInt(row.panel.attack)} · 暴 {fmt(row.panel.critRate, 1)}% · 爆 {fmt(row.panel.critDamage, 1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>

    <section className="soul-card">
      <h3 className="insp-h3">高评分御魂数量</h3>
      <p className="soul-p">仅统计满级六星；有效词条 ≥5 才展示，按号位分组统计。</p>
      <table className="insp-table">
        <thead>
          <tr>
            <th>号位</th>
            <th>高评分件数</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(pve?.highScoreByPosition ?? {}).map(([pos, list]) => (
            <tr key={pos}>
              <td>{pos} 号位</td>
              <td>{list.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  </>
);
