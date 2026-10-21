import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { useAppStore } from '@/store/useAppStore';

/**
 * 图表主题 —— 把配色收进 hook，跟随深色/浅色切换。
 *
 * 之前是一组静态常量，主题一换图表就会和页面脱节（深色底上摆浅色网格线）。
 * 现在按当前主题返回整套 token，图表用 useMemo 依赖 theme，切换时会重绘。
 */

/**
 * 图表画布的统一点高度。
 *
 * 约定：**所有图表都使用这个值**，不要再在各组件里写 210 / 230 / 260 这类数字。
 * 原因：同一行里的图表卡如果画布高度不同，卡片就会高低不齐（网格行会拉伸对齐，
 * 但右下角留白不一致，看着像没对齐）。以后新增图表模块时沿用这个常量即可保持一致。
 */
export const CHART_HEIGHT = 230;

/** 紧凑型图表的画布高度（用于将来需要更矮的小图，保持同一套刻度感） */
export const CHART_HEIGHT_SM = 210;

export interface ChartTheme {
  /** 当前是否浅色主题（个别图表需要按明暗选不同的灰阶） */
  isLight: boolean;
  axis: string;
  split: string;
  label: string;
  text: string;
  track: string;
  accent: string;
  /** 强调色渐变的下端（深色下压暗，浅色下提亮） */
  accentDeep: string;
  priceText: string;
  ownSurface: string;
  palette: string[];
  tooltip: {
    backgroundColor: string;
    borderColor: string;
    borderWidth: number;
    textStyle: { color: string; fontSize: number };
    extraCssText: string;
  };
}

const DARK: ChartTheme = {
  isLight: false,
  axis: '#4a5262',
  split: '#232833',
  label: '#8f99ab',
  text: '#e9ecf2',
  track: '#191d26',
  accent: '#ff5a45',
  accentDeep: '#c53f2d',
  priceText: '#ff8b74',
  ownSurface: '#1c2029',
  palette: ['#ff5a45', '#1677ff', '#34d07f', '#e5b567', '#b37feb', '#36cfc9', '#ff9c6e', '#6aa9ff'],
  tooltip: {
    backgroundColor: 'rgba(22,25,32,.96)',
    borderColor: '#272c37',
    borderWidth: 1,
    textStyle: { color: '#e9ecf2', fontSize: 12 },
    extraCssText: 'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.4);',
  },
};

const LIGHT: ChartTheme = {
  isLight: true,
  axis: '#bfbfbf',
  split: '#f0f0f0',
  label: '#8c8c8c',
  text: '#262626',
  track: '#f0f2f5',
  accent: '#ff5a45',
  accentDeep: '#ffb3a7',
  priceText: '#d4380d',
  ownSurface: '#ffffff',
  palette: ['#ff5a45', '#1677ff', '#34d07f', '#d48806', '#722ed1', '#13c2c2', '#fa8c16', '#2f54eb'],
  tooltip: {
    backgroundColor: 'rgba(255,255,255,.98)',
    borderColor: '#e5e7eb',
    borderWidth: 1,
    textStyle: { color: '#262626', fontSize: 12 },
    extraCssText: 'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);',
  },
};

const THEMES: Record<string, ChartTheme> = { dark: DARK, light: LIGHT };

/** 在图表组件里调用：拿到随主题变化的配色（未知模式一律退回深色，绝不返回 undefined） */
export const useChartTheme = (): ChartTheme => {
  const mode = useAppStore((s) => s.theme);
  return useMemo(() => THEMES[mode] ?? DARK, [mode]);
};

/** 兼容旧用法：默认取深色（仅在非 React 环境或兜底路径使用） */
export const CHART_THEME = DARK;

export const axisLabelStyle = (t: ChartTheme) => ({ color: t.label, fontSize: 11 });

export const baseGrid = (
  opts: { top?: number; bottom?: number; left?: number; right?: number } = {},
) => ({
  top: opts.top ?? 32,
  bottom: opts.bottom ?? 44,
  left: opts.left ?? 56,
  right: opts.right ?? 20,
  containLabel: true,
});

/** 柱子上的数值标签 */
export const valueLabel = (t: ChartTheme) => ({
  show: true,
  position: 'top' as const,
  fontSize: 11,
  color: t.label,
});

export const tooltipBase = (t: ChartTheme) => ({
  trigger: 'axis' as const,
  axisPointer: { type: 'shadow' as const },
  ...t.tooltip,
});

export const emptyOption = (t: ChartTheme, text = '当前条件下没有数据'): EChartsCoreOption => ({
  title: {
    text,
    left: 'center',
    top: 'middle',
    textStyle: { color: t.axis, fontSize: 13, fontWeight: 'normal' },
  },
});

/**
 * 系统是否要求「减少动态效果」。matchMedia 不可用（SSR / 旧环境 / 测试桩）时返回 false，
 * 即默认保留动画，不误伤正常用户。
 */
export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 图表动画选项：减少动态时关闭 ECharts 入场/更新动画；否则返回空对象（保留 ECharts 默认）。
 * EChart 组件会把它合并进每次 setOption 的 option 里，调用方显式写的 animation 仍优先。
 */
export const chartMotionOptions = (): { animation?: boolean; animationDuration?: number } =>
  prefersReducedMotion() ? { animation: false, animationDuration: 0 } : {};

/** 统一的数值轴样式 */
export const valueAxis = (t: ChartTheme, name?: string) => ({
  type: 'value' as const,
  name,
  nameTextStyle: { fontSize: 11, color: t.label },
  axisLabel: axisLabelStyle(t),
  axisLine: { lineStyle: { color: t.axis } },
  splitLine: { lineStyle: { color: t.split } },
});
