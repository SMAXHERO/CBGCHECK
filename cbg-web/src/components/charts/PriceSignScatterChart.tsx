import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { EChart } from './EChart';
import { axisLabelStyle, baseGrid, CHART_HEIGHT, emptyOption, useChartTheme } from './theme';
import type { ScatterPoint } from '@/utils/analytics';

interface Props {
  points: ScatterPoint[];
  height?: number;
}

/**
 * 对数轴的显式刻度。
 *
 * 只取 10 的幂（1000 / 10000）在「800~2000」这种窄区间里只剩一两条线，
 * 所以每个数量级内插入 1.5/2/2.5/3/4/5/6/8 这些「好读」的中间值；
 * 区间很宽时 dots 会被筛掉大半，也不会挤。
 */
const logTicks = (lo: number, hi: number): number[] => {
  const MANTISSAS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
  const out: number[] = [];
  if (!(lo > 0) || !(hi > lo)) return out;
  for (let exp = Math.floor(Math.log10(lo)); exp <= Math.ceil(Math.log10(hi)) + 1; exp += 1) {
    for (const m of MANTISSAS) {
      const v = m * 10 ** exp;
      if (v >= lo && v <= hi) out.push(v);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
};

/**
 * 价格 × 签到天数 散点图（价格轴取对数）。
 *
 * 这是面板里信息量最大的一张图：横轴账号「资历」、纵轴「入手成本」，
 * 同一列纵向分布能直接看出「同样签到天数下，价格跨度有多大」。
 * 价格轴用 log 是因为几千到十几万的跨度在线性轴上会把低价区压成一条线。
 */
export const PriceSignScatterChart = ({ points, height = CHART_HEIGHT }: Props) => {
  const t = useChartTheme();

  const option = useMemo<EChartsCoreOption>(() => {
    if (!points.length) return emptyOption(t, '缺少「签到天数」或「价格」数据');
    const years = points.map((p) => Number((p.value[0] / 365).toFixed(2)));
    const minYear = Math.floor(Math.min(...years));
    const maxYear = Math.ceil(Math.max(...years));
    const prices = points.map((p) => p.value[2]).filter((v) => v > 0);
    // 轴范围取整到整千，刻度才会落在 1000/2000/5000/1万 这种值上
    const loPrice = prices.length ? Math.max(100, Math.floor((Math.min(...prices) * 0.9) / 100) * 100) : 100;
    const hiPrice = prices.length ? Math.ceil((Math.max(...prices) * 1.05) / 1000) * 1000 : 1000;
    const ticks = logTicks(loPrice, hiPrice);

    return {
            // bottom 要同时放下「刻度标签」和「距标签 24px 的轴名(签到年数)」，
      // 36 会不够导致轴名下边缘被裁；44 是实测够用的值
      grid: baseGrid({ left: 46, right: 24, bottom: 44, top: 20 }),
      tooltip: {
        trigger: 'item',
        ...t.tooltip,
        formatter: (p: unknown) => {
          const item = p as { value: [number, number, number]; name: string };
          const [days, speed, price] = item.value;
          return [
            `<b>${item.name}</b>`,
            `签到：${days} 天（${(days / 365).toFixed(1)} 年）`,
            `散件一速：${speed}`,
            `价格：¥${price.toLocaleString('zh-CN')}`,
          ].join('<br/>');
        },
      },
      xAxis: {
        type: 'value',
        name: '签到年数',
        nameLocation: 'middle',
        nameGap: 24,
        nameTextStyle: { fontSize: 10.5, color: t.label },
        min: Number.isFinite(minYear) ? minYear : undefined,
        max: Number.isFinite(maxYear) ? maxYear : undefined,
        axisLabel: { ...axisLabelStyle(t), formatter: '{value} 年' },
        axisLine: { lineStyle: { color: t.axis } },
        splitLine: { lineStyle: { color: t.split } },
      },
      yAxis: {
        type: 'log',
        name: '价格（元）',
        nameTextStyle: { fontSize: 10.5, color: t.label },
        axisLabel: {
          ...axisLabelStyle(t),
          formatter: (v: number) => (v >= 10000 ? `${v / 10000}万` : String(Math.round(v))),
        },
        axisLine: { lineStyle: { color: t.axis } },
        splitLine: { lineStyle: { color: t.split } },
        min: loPrice,
        max: hiPrice,
        // log 轴既不支持 interval 也不支持 splitNumber 的语义化刻度；
        // splitList 才能把刻度钉在 1000/2000/5000/1万 这种可读的值上
        ...(ticks.length ? { splitList: ticks } : {}),
        minorTick: { show: false },
        minorSplitLine: { show: false },
      },
      series: [
        {
          type: 'scatter',
          symbolSize: 9,
          data: points.map((p) => ({
            value: [Number((p.value[0] / 365).toFixed(2)), p.value[2], p.value[1]],
            name: p.name,
          })),
          itemStyle: {
            color: t.accent,
            opacity: 0.66,
            borderColor: t.ownSurface,
            borderWidth: 0.8,
          },
          emphasis: { itemStyle: { opacity: 1, borderWidth: 1.5, borderColor: t.text } },
        },
      ],
    };
  }, [points, t]);

  return <EChart option={option} height={height} />;
};
