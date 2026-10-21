import type { InspectorReport as InspectorReportData } from '@/api/inspector';
import { fmtInt, numText } from './helpers';

/**
 * 「账号概览」标签页：账号数据 / 御魂规模 / PVE 御魂评分。
 * 对应原页面 InspectorReport.tsx 的 `tab === 'overview'` 段（原 L421–L564）。
 * 纯展示组件：不发请求、不持有状态；数据由页面壳以 props 下传。
 */
export interface OverviewTabProps {
  report: InspectorReportData;
  ov: NonNullable<InspectorReportData['account']>;
  pve: InspectorReportData['pveScores'] | undefined;
}

export const OverviewTab = ({ report, ov, pve }: OverviewTabProps) => (
  <>
    <section className="soul-card">
      <h3 className="insp-h3">账号数据</h3>
      <div className="insp-kpis">
        <div className="insp-kpi">
          <span>体力</span>
          <b>{numText(ov.stamina)}</b>
        </div>
        <div className="insp-kpi">
          <span>金币</span>
          <b>{numText(ov.money)}</b>
        </div>
        <div className="insp-kpi">
          <span>风姿度</span>
          <b>{fmtInt(ov.fengzidu)}</b>
        </div>
        <div className="insp-kpi">
          <span>斗技</span>
          <b>
            {ov.pvpStage}段 / {fmtInt(ov.pvpScore)}分
          </b>
        </div>
        <div className="insp-kpi">
          <span>勾玉</span>
          <b>{numText(ov.soulJade)}</b>
        </div>
        <div className="insp-kpi">
          <span>神秘符咒</span>
          <b>{fmtInt(ov.mysteryTalisman)}</b>
        </div>
        <div className="insp-kpi">
          <span>现世符咒</span>
          <b>{fmtInt(ov.realityTalisman)}</b>
        </div>
        <div className="insp-kpi">
          <span>抽卡能力</span>
          <b>{fmtInt(ov.summonPower)} 抽</b>
        </div>
        <div className="insp-kpi">
          <span>御行达摩</span>
          <b>{fmtInt(ov.yuxingDama)}</b>
        </div>
        <div className="insp-kpi">
          <span>典藏皮肤</span>
          <b>{fmtInt(ov.collectionSkinCount)}</b>
        </div>
      </div>
      <div className="insp-chips">
        <span className="insp-chip">
          图鉴 SSR <b>{ov.dex.ssr.owned}/{ov.dex.ssr.total}</b>
        </span>
        <span className="insp-chip">
          SP <b>{ov.dex.sp.owned}/{ov.dex.sp.total}</b>
        </span>
        <span className="insp-chip">
          UR <b>{ov.dex.ur.owned}/{ov.dex.ur.total}</b>
        </span>
        <span className="insp-chip">
          500天未收录 <b>{ov.dex.uncollected500Days}</b>
        </span>
        <span className="insp-chip">
          999天未收录 <b>{ov.dex.uncollected999Days}</b>
        </span>
        <span className="insp-chip">
          未收录券 <b>{ov.dex.uncollectedCoupon}</b>
        </span>
      </div>
    </section>

    <section className="soul-card">
      <h3 className="insp-h3">御魂规模</h3>
      <div className="insp-kpis">
        <div className="insp-kpi">
          <span>全部御魂</span>
          <b>{fmtInt(report.relics.totalInBag)}</b>
        </div>
        <div className="insp-kpi">
          <span>参与统计</span>
          <b>{fmtInt(report.relics.counted)}</b>
        </div>
        <div className="insp-kpi">
          <span>6 星满级</span>
          <b>{fmtInt(report.relics.maxLevelCount)}</b>
        </div>
        {Object.entries(report.relics.byPosition).map(([pos, count]) => (
          <div className="insp-kpi" key={pos}>
            <span>{pos} 号位</span>
            <b>{fmtInt(count)}</b>
          </div>
        ))}
      </div>
    </section>

    <section className="soul-card">
      <h3 className="insp-h3">PVE 御魂评分</h3>
      <p className="soul-p">套件总评分 = 有效词条数之和（攻击加成/暴击/暴伤，2、4 号位仅攻击加成、6 号位仅暴击或暴伤）。</p>
      <div className="insp-grid2">
        <div>
          <div className="insp-sub">普通 PVE 套装</div>
          <table className="insp-table">
            <thead>
              <tr>
                <th>套装</th>
                <th>件数</th>
                <th>总评分</th>
              </tr>
            </thead>
            <tbody>
              {pve?.normalSuits.map((row) => (
                <tr key={row.suitName}>
                  <td>{row.suitName}</td>
                  <td>{row.relicCount}</td>
                  <td>{row.totalScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <div className="insp-sub">逢魔御魂</div>
          <table className="insp-table">
            <thead>
              <tr>
                <th>套装</th>
                <th>件数</th>
                <th>总评分</th>
              </tr>
            </thead>
            <tbody>
              {pve?.omaSuits.map((row) => (
                <tr key={row.suitName}>
                  <td>{row.suitName}</td>
                  <td>{row.relicCount}</td>
                  <td>{row.totalScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </>
);
