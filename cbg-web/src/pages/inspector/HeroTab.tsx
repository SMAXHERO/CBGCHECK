import type { InspectorReport as InspectorReportData } from '@/api/inspector';

/**
 * 「式神技能」标签页：统计 chips / 未达标 / 多号机 / 联动式神 / 全部式神技能（带搜索与稀有度筛选）。
 * 对应原页面 InspectorReport.tsx 的 `tab === 'hero' && heroSkills` 段（原 L719–L853）。
 * heroGroups 的过滤（useMemo）保留在页面壳，本组件仅渲染；搜索/稀有度 state 与 setter 由页面壳持有。
 */
type HeroSkills = NonNullable<InspectorReportData['heroSkills']>;
type HeroGroup = { rarity: string; heroes: HeroSkills['groups'][number]['heroes'] };

export interface HeroTabProps {
  heroSkills: HeroSkills;
  heroGroups: HeroGroup[];
  heroQuery: string;
  heroRarity: string;
  setHeroQuery: (value: string) => void;
  setHeroRarity: (value: string) => void;
}

export const HeroTab = ({
  heroSkills,
  heroGroups,
  heroQuery,
  heroRarity,
  setHeroQuery,
  setHeroRarity,
}: HeroTabProps) => (
  <>
    <section className="soul-card">
      <div className="insp-chips">
        <span className="insp-chip">
          御行达摩 <b>{heroSkills.yuxingDama}</b>
        </span>
        <span className="insp-chip">
          未达标 <b>{heroSkills.counts.deficient}</b>
        </span>
        <span className="insp-chip">
          多号机 <b>{heroSkills.counts.duplicates}</b>
        </span>
        <span className="insp-chip">
          联动 <b>{heroSkills.counts.collaboration}</b>
        </span>
        {Object.entries(heroSkills.counts.groups).map(([rarity, count]) => (
          <span className="insp-chip" key={rarity}>
            {rarity} <b>{count}</b>
          </span>
        ))}
      </div>
    </section>

    <section className="soul-card">
      <h3 className="insp-h3">技能未达标（{heroSkills.deficient.length} 组）</h3>
      <table className="insp-table">
        <thead>
          <tr>
            <th>式神</th>
            <th>等级</th>
            <th>技能</th>
          </tr>
        </thead>
        <tbody>
          {heroSkills.deficient.map((hero) => (
            <tr key={hero.instanceId}>
              <td>{hero.name}</td>
              <td>{hero.level}</td>
              <td>{hero.skillLevels.join('')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>

    <section className="soul-card">
      <h3 className="insp-h3">存在多号机的式神（{heroSkills.counts.duplicates} 只）</h3>
      <table className="insp-table">
        <thead>
          <tr>
            <th>式神</th>
            <th>等级</th>
            <th>技能</th>
          </tr>
        </thead>
        <tbody>
          {heroSkills.duplicates.map((hero) => (
            <tr key={hero.instanceId}>
              <td>{hero.name}</td>
              <td>{hero.level}</td>
              <td>{hero.skillLevels.join('')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>

    <section className="soul-card">
      <h3 className="insp-h3">联动式神（{heroSkills.counts.collaboration} 只）</h3>
      <table className="insp-table">
        <thead>
          <tr>
            <th>式神</th>
            <th>等级</th>
            <th>技能</th>
          </tr>
        </thead>
        <tbody>
          {heroSkills.collaboration.map((hero) => (
            <tr key={hero.instanceId}>
              <td>{hero.name}</td>
              <td>{hero.level}</td>
              <td>{hero.skillLevels.join('')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>

    <section className="soul-card">
      <h3 className="insp-h3">全部式神技能</h3>
      <div className="soul-input-row">
        <input
          className="soul-input"
          placeholder="搜索式神名"
          value={heroQuery}
          onChange={(e) => setHeroQuery(e.target.value)}
          spellCheck={false}
        />
        <select className="insp-select" value={heroRarity} onChange={(e) => setHeroRarity(e.target.value)}>
          <option value="">全部稀有度</option>
          {heroSkills.groups.map((group) => (
            <option key={group.rarity} value={group.rarity}>
              {group.rarity}
            </option>
          ))}
        </select>
      </div>
      {heroGroups.map((group) => (
        <div key={group.rarity}>
          <div className="insp-sub">{group.rarity}</div>
          <table className="insp-table">
            <thead>
              <tr>
                <th>式神</th>
                <th>等级</th>
                <th>技能</th>
              </tr>
            </thead>
            <tbody>
              {group.heroes.map((hero) => (
                <tr key={hero.instanceId}>
                  <td>{hero.name}</td>
                  <td>{hero.level}</td>
                  <td>{hero.skillLevels.join('')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  </>
);
