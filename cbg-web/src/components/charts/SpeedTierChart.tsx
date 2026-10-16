import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from './EChart';
import { axisLabelStyle, emptyOption, useChartTheme } from './theme';
import type { TierStat } from '@/utils/analytics';

interface Props {
  tiers: TierStat[];
  height?: number;
}

/** 从暗到亮的灰阶，最后一档用强调色：数据密集的档位一眼可见 */
const TIER_COLORS_DARK = ['#4a5262', '#5a6478', '#6b7488', '#7c88a0', '#8f9cb5'];
const TIER_COLORS_LIGHT = ['#d9d9d9', '#bfc4cc', '#a3aab5', '#8892a0', '#6b7688'];

/**
 * 散件一速分段 —— 用横向条形而不是柱状：
 * 档位标签较长（156~158），横着放不用旋转，并且计数直接写在条内。
 */
export const SpeedTierChart = ({ tiers, height = 210 }: Props) => {
  const t = useChartTheme();

  const option = useMemo<EChartsCoreOption>(() => {
    if (!tiers.length) return emptyOption(t);
    const scale = t.isLight ? TIER_COLORS_LIGHT : TIER_COLORS_DARK;
    const top = Math.max(...tiers.map((x) => x.value)) || 1;
    return {
      grid: { top: 8, bottom: 8, left: 8, right: 40, containLabel: true },
      tooltip: {
        trigger: 'item',
        ...t.tooltip,
        formatter: (p: unknown) => {
          const item = p as { name: string; value: number };
          return `${item.name}：<b>${item.value}</b> 个账号`;
        },
      },
      xAxis: { type: 'value', max: top, show: false },
      yAxis: {
        type: 'category',
        data: tiers.map((x) => x.name),
        inverse: true,
        axisLabel: axisLabelStyle(t),
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: tiers.map((x, i) => ({
            value: x.value,
            itemStyle: {
              color: i === tiers.length - 1 ? t.accent : (scale[i] ?? t.accent),
              borderRadius: 4,
            },
          })),
          label: {
            show: true,
            position: 'insideLeft',
            distance: 7,
            fontSize: 10.5,
            fontWeight: 600,
            // 深色档位用白字，浅色档位用深字，保证都能看清
            color: t.text,
            formatter: '{c}',
          },
          barWidth: 16,
          showBackground: true,
          backgroundStyle: { color: t.track, borderRadius: 4 },
        },
      ],
    };
  }, [tiers, t]);

  return <EChart option={option} height={height} />;
};
