import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from './EChart';
import { axisLabelStyle, CHART_HEIGHT, emptyOption, useChartTheme } from './theme';
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
export const SpeedTierChart = ({ tiers, height = CHART_HEIGHT }: Props) => {
  const t = useChartTheme();

  const option = useMemo<EChartsCoreOption>(() => {
    if (!tiers.length) return emptyOption(t);
    const scale = t.isLight ? TIER_COLORS_LIGHT : TIER_COLORS_DARK;
    const top = Math.max(...tiers.map((x) => x.value)) || 1;
    return {
      // right 留够：数字标签画在条形外侧，需要给它位置
      grid: { top: 8, bottom: 8, left: 8, right: 46, containLabel: true },
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
        axisLabel: { ...axisLabelStyle(t), margin: 10 },
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
            // 关键：画在条形**外侧**而不是内部。
            // 用 insideLeft 时，占比很低的档位（条形只有几像素宽）会把数字裁掉，
            // 并和左侧的档位标签挤在一起。靠右固定位置则任何数据量下都可读。
            position: 'right',
            distance: 6,
            fontSize: 11,
            fontWeight: 600,
            color: t.label,
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
