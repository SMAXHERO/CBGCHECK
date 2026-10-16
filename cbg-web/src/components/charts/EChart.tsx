import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, PieChart, ScatterChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  // 饼图中心的「总数」是用 graphic 画的；按需引入时漏了它会静默不渲染并报运行时警告
  GraphicComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

// 按需注册：只引入用到的图表与组件，产物比全量引入小 60% 以上
echarts.use([
  BarChart,
  PieChart,
  ScatterChart,
  GridComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  GraphicComponent,
  CanvasRenderer,
]);

export interface EChartProps {
  option: EChartsCoreOption;
  height?: number | string;
  /** 数据变化时是否清空旧图再重绘（切换维度时避免残留动画） */
  notMerge?: boolean;
  onEvents?: Record<string, (params: unknown) => void>;
  className?: string;
}

/**
 * ECharts 的 React 薄封装：自己管生命周期，不引第三方 wrapper。
 * - 容器尺寸变化时自动 resize（用 ResizeObserver，兼容侧栏折叠 / 窗口缩放）
 * - 卸载时 dispose，避免内存泄漏
 * - 图例/坐标轴里需要「点击联动筛选」时，通过 onEvents 传回调进来
 */
export const EChart = ({
  option,
  height = 300,
  notMerge = true,
  onEvents,
  className,
}: EChartProps) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  // 初始化 + 尺寸同步
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    // 挂到 DOM 上：出问题时能在控制台 getInstanceByDom(el).getOption() 直接看真实配置，
    // 也让自动化测试能读到渲染后的坐标轴刻度
    (el as HTMLElement & { __echarts?: echarts.ECharts }).__echarts = chart;

    /**
     * 反复核对「图表内部尺寸」与「容器实际尺寸」，直到一致或到达重试上限。
     *
     * 为什么不能只调一次 resize()：窗口缩放时 CSS 栅格回流可能晚于 resize 事件，
     * 那一瞬间容器还是旧宽度，resize() 会把 canvas 定在错的值上。
     * 实测表现：窄屏下图表卡比容器宽出几百像素，被父级的 overflow:hidden 裁掉右侧。
     *
     * 用 requestAnimationFrame 逐帧复核 + 延迟重试兜底：
     * 逐帧负责「布局已经稳了但图表还没跟上」的情况，
     * 延迟重试负责「容器的最终宽度比当前晚很多才确定」的情况（栅格在多级断点间切换时常见）。
     */
    let raf = 0;
    let retryTimer = 0;
    let disposed = false;
    let attempt = 0;

    const isSynced = () => chart.getWidth() === el.clientWidth && chart.getHeight() === el.clientHeight;

    const sync = () => {
      if (disposed) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return; // 还没布局，等下次
      if (!isSynced()) chart.resize();

      attempt += 1;
      if (!isSynced() && attempt < 60) {
        raf = requestAnimationFrame(sync);
      } else {
        attempt = 0;
        // 兜底：布局可能仍在继续变化，过一会儿再核对一次
        retryTimer = window.setTimeout(sync, 320);
      }
    };

    const scheduleSync = () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(retryTimer);
      attempt = 0;
      raf = requestAnimationFrame(sync);
    };

    // 两级触发：ResizeObserver 管容器自身变化，window.resize 管窗口变化
    const ro = new ResizeObserver(scheduleSync);
    ro.observe(el);
    window.addEventListener('resize', scheduleSync);
    // 首帧布局可能还没稳定（字体、滚动条），补一次
    const timer = window.setTimeout(scheduleSync, 80);
    scheduleSync();

    return () => {
      disposed = true;
      ro.disconnect();
      window.removeEventListener('resize', scheduleSync);
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
      cancelAnimationFrame(raf);
      chart.dispose();
      chartRef.current = null;
      delete (el as HTMLElement & { __echarts?: echarts.ECharts }).__echarts;
    };
  }, []);

  // 应用配置
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(option, { notMerge });
  }, [option, notMerge]);

  // 绑定事件（每次 option 变化后重新绑定，保证闭包里的回调是最新的）
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onEvents) return;
    const entries = Object.entries(onEvents);
    entries.forEach(([evt, handler]) => chart.on(evt, handler));
    return () => entries.forEach(([evt, handler]) => chart.off(evt, handler));
  }, [onEvents, option]);

  return <div ref={ref} className={className} style={{ width: '100%', height }} />;
};
