import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from './EChart';
import {
  axisLabelStyle,
  baseGrid,
  CHART_HEIGHT,
  emptyOption,
  tooltipBase,
  useChartTheme,
  valueAxis,
  valueLabel,
} from './theme';
import type { Histogram } from '@/utils/analytics';
import { compact } from '@/utils/format';

interface Props {
  histogram: Histogram;
  height?: number;
}

/** 价格分布直方图：柱子用强调色做竖向渐变（渐变下端随主题变化） */
export const PriceHistogramChart = ({ histogram, height = CHART_HEIGHT }: Props) => {
  const t = useChartTheme();

  const option = useMemo<EChartsCoreOption>(() => {
    if (!histogram.labels.length) return emptyOption(t);
    return {
      // 旋转 30° 的刻度标签较高，给足底部空间（与散点图保持同一套留白尺度）
      grid: baseGrid({ bottom: 40, left: 48, right: 12, top: 24 }),
      tooltip: {
        ...tooltipBase(t),
        formatter: (params: unknown) => {
          const arr = params as { dataIndex: number; value: number }[];
          const p = arr[0];
          if (!p) return '';
          const lo = histogram.bounds[p.dataIndex] / 100;
          const hi =
            histogram.bounds[p.dataIndex + 1] !== undefined
              ? histogram.bounds[p.dataIndex + 1] / 100
              : lo;
          return `价格 ${compact(lo)} ~ ${compact(hi)} 元<br/>账号数：<b>${p.value}</b>`;
        },
      },
      xAxis: {
        type: 'category',
        data: histogram.labels,
        // 标签只放下界（元），旋转 30° 够用，不会被 hideOverlap 吃掉
        axisLabel: { ...axisLabelStyle(t), rotate: 30, hideOverlap: true, fontSize: 10 },
        axisTick: { alignWithLabel: true },
        axisLine: { lineStyle: { color: t.axis } },
      },
      yAxis: valueAxis(t, '账号数'),
      series: [
        {
          type: 'bar',
          data: histogram.counts,
          itemStyle: {
            borderRadius: [4, 4, 0, 0],
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: t.accent },
                { offset: 1, color: t.accentDeep },
              ],
            },
          },
          label: valueLabel(t),
          barMaxWidth: 44,
        },
      ],
    };
  }, [histogram, t]);

  return <EChart option={option} height={height} />;
};
