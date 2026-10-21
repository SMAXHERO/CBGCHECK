import type { CalcResult, InspectorMeta, JobState } from '@/api/inspector';
import { METRIC_LABELS } from './constants';
import { fmt, fmtInt } from './helpers';

/**
 * 「御魂计算器」标签页：式神/指标/预设/满暴/极速/取条数选择 + 计算按钮 + 结果表。
 * 对应原页面 InspectorReport.tsx 的 `tab === 'calc'` 段（原 L924–L1009）。
 * 所有表单 state 与 runCalc 请求保留在页面壳；本组件仅通过 props 与 onRun 回调交互。
 */
export interface CalcTabProps {
  meta: InspectorMeta | null;
  calcHero: string;
  calcMetric: string;
  calcPreset: string;
  calcFullCrit: boolean;
  calcFast: boolean;
  calcLimit: number;
  setCalcHero: (value: string) => void;
  setCalcMetric: (value: string) => void;
  setCalcPreset: (value: string) => void;
  setCalcFullCrit: (value: boolean) => void;
  setCalcFast: (value: boolean) => void;
  setCalcLimit: (value: number) => void;
  calcJob: JobState | null;
  calcRunning: boolean;
  calcResult: CalcResult | null;
  onRun: () => void;
}

export const CalcTab = ({
  meta,
  calcHero,
  calcMetric,
  calcPreset,
  calcFullCrit,
  calcFast,
  calcLimit,
  setCalcHero,
  setCalcMetric,
  setCalcPreset,
  setCalcFullCrit,
  setCalcFast,
  setCalcLimit,
  calcJob,
  calcRunning,
  calcResult,
  onRun,
}: CalcTabProps) => (
  <section className="soul-card">
    <h3 className="insp-h3">御魂计算器</h3>
    <p className="soul-p">
      从账号内六星 +15 御魂里为指定式神搜最优六件。极速模式用局部搜索（约 0.5 秒），精确模式用分支限界（较慢，结果更优）。
    </p>
    <div className="soul-input-row">
      <select className="insp-select" value={calcHero} onChange={(e) => setCalcHero(e.target.value)}>
        {(meta?.heroes ?? [{ name: '须佐之男' } as { name: string }]).map((hero) => (
          <option key={hero.name} value={hero.name}>
            {hero.name}
          </option>
        ))}
      </select>
      <select className="insp-select" value={calcMetric} onChange={(e) => setCalcMetric(e.target.value)}>
        {(meta?.metrics ?? ['damage']).map((metric) => (
          <option key={metric} value={metric}>
            {METRIC_LABELS[metric] ?? metric}
          </option>
        ))}
      </select>
      <select className="insp-select" value={calcPreset} onChange={(e) => setCalcPreset(e.target.value)}>
        <option value="attack">攻攻爆</option>
        <option value="health">生生爆</option>
        <option value="speed">纯速度</option>
      </select>
      <label className="insp-check">
        <input type="checkbox" checked={calcFullCrit} onChange={(e) => setCalcFullCrit(e.target.checked)} />
        满暴
      </label>
      <label className="insp-check">
        <input type="checkbox" checked={calcFast} onChange={(e) => setCalcFast(e.target.checked)} />
        极速模式
      </label>
      <select className="insp-select" value={calcLimit} onChange={(e) => setCalcLimit(Number(e.target.value))}>
        {[1, 3, 5, 10].map((n) => (
          <option key={n} value={n}>
            取 {n} 条
          </option>
        ))}
      </select>
      <button className="btn btn-primary" onClick={() => void onRun()} disabled={calcRunning}>
        {calcRunning ? '计算中…' : '开始计算'}
      </button>
    </div>
    {calcJob?.progress && <div className="dim">{calcJob.progress}</div>}
    {calcResult && (
      <>
        <div className="insp-sub">
          {calcResult.hero} · {METRIC_LABELS[calcResult.metric] ?? calcResult.metric} ·{' '}
          {calcResult.fastMode ? '极速模式' : '精确模式'}
        </div>
        <table className="insp-table">
          <thead>
            <tr>
              <th>#</th>
              <th>评分</th>
              <th>面板</th>
              <th>套装</th>
              <th>御魂</th>
            </tr>
          </thead>
          <tbody>
            {calcResult.rows.map((row, index) => (
              <tr key={index}>
                <td>{index + 1}</td>
                <td>
                  <b>{fmt(row.score)}</b>
                </td>
                <td className="dim">
                  攻 {fmtInt(row.panel.attack)} · 暴 {fmt(row.panel.critRate, 1)}% · 爆 {fmt(row.panel.critDamage, 1)}%
                </td>
                <td>{row.suits.join(' / ')}</td>
                <td className="dim">
                  {row.relics
                    .map((r) => `${r.position}号${r.suitName ?? ''}(${r.mainAttribute?.label ?? ''})`)
                    .join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    )}
  </section>
);
