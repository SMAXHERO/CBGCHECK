import { useMemo, useState } from 'react';
import type { SearchField, SearchSchema } from '@/api/searchSchema';
import type { ServerIndex } from '@/utils/predicate';
import { fid } from '@/utils/params';
import { ConditionField } from './condition/ConditionField';

/**
 * 筛选条件面板 —— 复刻 cbg-filter-kit/src/filter-panel.html 的交互与视觉。
 *
 * 与原始实现的差异：
 * 1. 这里不做「查询」（那是本地服务干的事），而是把条件实时下推为前端过滤器，
 *    右侧结果区立刻跟着变；
 * 2. 已选状态由父组件持有（受控），这样顶部的 chips、底部的「清空」、
 *    以及将来「从文件恢复条件」都能操作同一份状态；
 * 3. 条件搜索框默认渲染在吸顶头部（窄屏时由父组件换成面板内联）。
 */

interface Props {
  schema: SearchSchema;
  serverIndex: ServerIndex;
  selected: Map<string, unknown>;
  onSelectedChange: (next: Map<string, unknown>) => void;
  /** 条件名搜索关键字 */
  query?: string;
  /** 是否在面板内部渲染搜索框（窄屏用） */
  inlineSearch?: boolean;
}

export const FilterPanel = ({
  schema,
  serverIndex,
  selected,
  onSelectedChange,
  query = '',
  inlineSearch = false,
}: Props) => {
  const [openSections, setOpenSections] = useState<Set<number>>(() => {
    // 默认展开前 3 组；此外把「已有已选项」的分组一并展开——
    // 否则套了默认条件后，用户只看得见价格那一条，另外几条藏在收起的分组里
    const initial = new Set<number>([0, 1, 2]);
    schema.sections.forEach((section, si) => {
      const hasSelected = section.fields.some((_, fi) => selected.has(fid(si, fi)));
      if (hasSelected) initial.add(si);
    });
    return initial;
  });
  const [localQuery, setLocalQuery] = useState('');

  const effectiveQuery = (inlineSearch ? localQuery : query).trim().toLowerCase();

  const setFieldValue = (id: string, value: unknown) => {
    const next = new Map(selected);
    if (value === undefined || value === null) next.delete(id);
    else next.set(id, value);
    onSelectedChange(next);
  };

  /** 每个分组已选几项（收起时靠角标可见） */
  const badgeCount = useMemo(() => {
    const counts = new Array<number>(schema.sections.length).fill(0);
    schema.sections.forEach((section, si) => {
      section.fields.forEach((_, fi) => {
        if (selected.has(fid(si, fi))) counts[si] += 1;
      });
    });
    return counts;
  }, [schema, selected]);

  /** 条件搜索：命中字段所在的卡片自动展开 */
  const visibility = useMemo(
    () =>
      schema.sections.map((section) => {
        const flags = section.fields.map((field: SearchField) => {
          if (!effectiveQuery) return true;
          const hay = `${field.label ?? ''} ${field.innerLabel ?? ''} ${field.key ?? ''} ${section.label}`;
          return hay.toLowerCase().includes(effectiveQuery);
        });
        return { show: flags.some(Boolean), fields: flags, hits: flags.filter(Boolean).length };
      }),
    [schema, effectiveQuery],
  );

  const allOpen = useMemo(
    () => schema.sections.every((_, si) => openSections.has(si)),
    [schema, openSections],
  );

  return (
    <div>
      {inlineSearch && (
        <div className="search-wrap-head" style={{ marginBottom: 8, maxWidth: 'none' }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5 14 14" />
          </svg>
          <input
            placeholder="搜索条件，例如「一速」「图鉴」「皮肤」"
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
          />
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
        <button className="link-btn" onClick={() => setOpenSections(allOpen ? new Set() : new Set(schema.sections.map((_, si) => si)))}>
          {allOpen ? '收起全部分组' : '展开全部分组'}
        </button>
      </div>

      {schema.sections.map((section, si) => {
        const vis = visibility[si];
        if (!vis?.show) return null;
        const open = openSections.has(si) || Boolean(effectiveQuery && vis.hits);
        return (
          <div className={`card${open ? ' open' : ''}`} key={`${section.label}-${si}`}>
            <div
              className="card-head"
              onClick={() =>
                setOpenSections((prev) => {
                  const next = new Set(prev);
                  if (next.has(si)) next.delete(si);
                  else next.add(si);
                  return next;
                })
              }
            >
              <span className="chev">
                <svg width="13" height="13" viewBox="0 0 16 16">
                  <path
                    d="M6 4l4 4-4 4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="nm">{section.label || `分组 ${si + 1}`}</span>
              <span className={`badge${badgeCount[si] ? ' show' : ''}`}>{badgeCount[si]}</span>
            </div>
            <div className="card-body">
              {section.fields.map((field, fi) =>
                vis.fields[fi] ? (
                  <ConditionField
                    key={fid(si, fi)}
                    id={fid(si, fi)}
                    field={field}
                    sectionLabel={section.label}
                    value={selected.get(fid(si, fi))}
                    onChange={setFieldValue}
                    serverIndex={serverIndex}
                  />
                ) : null,
              )}
            </div>
          </div>
        );
      })}

      {effectiveQuery && visibility.every((v) => !v.show) && (
        <div className="state-box">
          没有匹配「{effectiveQuery}」的条件
          <br />
          试试「一速」「图鉴」「皮肤」「签到」
        </div>
      )}
    </div>
  );
};
