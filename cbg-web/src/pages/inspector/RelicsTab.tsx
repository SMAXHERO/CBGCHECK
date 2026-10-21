import type { RelicList } from '@/api/inspector';
import { fmt, fmtInt } from './helpers';

/**
 * 「御魂库存」标签页：号位/套装/主属性筛选 + 结果表。
 * 对应原页面 InspectorReport.tsx 的 `tab === 'relics'` 段（原 L855–L922）。
 * 筛选 state 与 reloadRelics 请求保留在页面壳，本组件通过 props 接收并以 onFilter 回调触发。
 */
export interface RelicsTabProps {
  relics: RelicList | null;
  relicPosition: string;
  relicSuits: string;
  relicMain: string;
  setRelicPosition: (value: string) => void;
  setRelicSuits: (value: string) => void;
  setRelicMain: (value: string) => void;
  onFilter: () => void;
}

export const RelicsTab = ({
  relics,
  relicPosition,
  relicSuits,
  relicMain,
  setRelicPosition,
  setRelicSuits,
  setRelicMain,
  onFilter,
}: RelicsTabProps) => (
  <section className="soul-card">
    <h3 className="insp-h3">御魂库存</h3>
    <div className="soul-input-row">
      <select className="insp-select" value={relicPosition} onChange={(e) => setRelicPosition(e.target.value)}>
        <option value="">全部号位</option>
        {['1', '2', '3', '4', '5', '6'].map((pos) => (
          <option key={pos} value={pos}>
            {pos} 号位
          </option>
        ))}
      </select>
      <input
        className="soul-input"
        placeholder="套装名（多个用逗号，如 狂骨,破势）"
        value={relicSuits}
        onChange={(e) => setRelicSuits(e.target.value)}
        spellCheck={false}
      />
      <input
        className="soul-input"
        placeholder="主属性（如 攻击加成）"
        value={relicMain}
        onChange={(e) => setRelicMain(e.target.value)}
        spellCheck={false}
      />
      <button className="btn btn-primary" onClick={() => void onFilter()}>
        筛选
      </button>
    </div>
    {relics && (
      <>
        <div className="insp-chips">
          <span className="insp-chip">
            命中 <b>{fmtInt(relics.matched)}</b> / {fmtInt(relics.total)}
          </span>
        </div>
        <table className="insp-table">
          <thead>
            <tr>
              <th>号位</th>
              <th>套装</th>
              <th>主属性</th>
              <th>副属性</th>
            </tr>
          </thead>
          <tbody>
            {relics.items.map((relic) => (
              <tr key={relic.relicId}>
                <td>{relic.position}</td>
                <td>{relic.suitName}</td>
                <td>
                  {relic.mainAttribute.label} {fmt(relic.mainAttribute.value, 0)}
                  {relic.mainAttribute.isPercent ? '%' : ''}
                </td>
                <td className="dim">
                  {relic.subAttributes
                    .map((sub) => `${sub.label}+${fmt(sub.total)}×${sub.count}`)
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
