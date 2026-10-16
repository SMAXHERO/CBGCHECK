import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from './EChart';
import { CHART_HEIGHT, emptyOption, useChartTheme } from './theme';
import type { TierStat } from '@/utils/analytics';

interface Props {
  data: TierStat[];
  height?: number;
}

/** 平台占比 —— 环形图比饼图更省空间，中间放总数 */
export const PlatformPieChart = ({ data, height = CHART_HEIGHT }: Props) => {
  const t = useChartTheme();

  const option = useMemo<EChartsCoreOption>(() => {
    if (!data.length) return emptyOption(t);
    const total = data.reduce((a, b) => a + b.value, 0);
    return {
      color: [...t.palette],
      tooltip: {
        trigger: 'item',
        ...t.tooltip,
        formatter: (p: unknown) => {
          const item = p as { name: string; value: number; percent: number };
          return `${item.name}<br/>账号数：<b>${item.value}</b>（${item.percent}%）`;
        },
      },
      legend: {
        bottom: 0,
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { fontSize: 11, color: t.label },
      },
      series: [
        {
          type: 'pie',
          radius: ['48%', '70%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: t.ownSurface, borderWidth: 2 },
          label: {
            show: true,
            formatter: '{b}\n{d}%',
            fontSize: 10.5,
            color: t.label,
            lineHeight: 14,
          },
          labelLine: { length: 6, length2: 6, lineStyle: { color: t.axis } },
          data: data.map((d) => ({
            name: d.name,
            value: d.value,
            ...(d.color ? { itemStyle: { color: d.color } } : {}),
          })),
        },
      ],
      graphic: total
        ? [
            {
              type: 'text',
              left: 'center',
              top: '37%',
              style: { text: String(total), fontSize: 20, fontWeight: 'bold', fill: t.text },
            },
            {
              type: 'text',
              left: 'center',
              top: '48%',
              style: { text: '账号', fontSize: 11, fill: t.label },
            },
          ]
        : undefined,
    };
  }, [data, t]);

  return <EChart option={option} height={height} />;
};
