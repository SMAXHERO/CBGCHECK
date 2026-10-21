import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ModuleHeader } from '@/components/ModuleHeader';

/** 静态渲染，不依赖 jsdom；ModuleTabs 需要路由上下文，包一层 MemoryRouter */
const render = (props: Parameters<typeof ModuleHeader>[0]) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <ModuleHeader {...props} />
    </MemoryRouter>,
  );

describe('ModuleHeader', () => {
  it('minimal 模式只渲染 h1 + pill-tag，不含 tabs 与主题按钮', () => {
    const html = render({ title: 'T', badge: '实时模式', minimal: true });
    expect(html).toContain('<header class="app-header">');
    expect(html).toContain('<h1>T</h1>');
    expect(html).toContain('<span class="pill-tag">实时模式</span>');
    expect(html).not.toContain('mod-tabs');
    expect(html).not.toContain('icon-btn');
  });

  it('text 模式：主题按钮 aria-label 固定为「切换主题」，子节点为文本图标', () => {
    const html = render({ title: 'T', themeVariant: 'text', meta: '说明' });
    expect(html).toContain('class="mod-tabs"');
    expect(html).toContain('<span class="head-meta">说明</span>');
    expect(html).toContain('aria-label="切换主题"');
    expect(html).toMatch(/class="icon-btn"[^>]*>(☀|🌙)</);
    expect(html).not.toContain('M13.5 9.6A5.8');
  });

  it('svg 模式：主题按钮带 SVG 图标，且无固定 aria-label', () => {
    const html = render({ title: 'T', themeVariant: 'svg' });
    expect(html).toContain('class="icon-btn"');
    expect(html).toMatch(/aria-label="切换到(浅色|深色)主题"/);
    expect(html).toContain('<svg');
  });

  it('搜索框与 chips 仅在传入时出现；chips 位于 head-in 之外', () => {
    const onChange = vi.fn();
    const html = render({
      title: 'T',
      themeVariant: 'svg',
      conditionSearch: { value: 'x', onChange },
      statusNode: <span className="status-pill">实时</span>,
      chipsNode: <div className="chips">C</div>,
    });
    expect(html).toContain('class="search-wrap-head"');
    expect(html).toContain('class="status-pill"');
    // chips 必须位于 head-in 闭合之后、header 闭合之前
    const chipsAt = html.indexOf('class="chips"');
    const headInClose = html.indexOf('search-wrap-head');
    expect(chipsAt).toBeGreaterThan(headInClose);
    expect(html.indexOf('</header>')).toBeGreaterThan(chipsAt);
  });

  it('未传 statusNode/搜索框/meta 时不渲染对应节点', () => {
    const html = render({ title: 'T', themeVariant: 'text' });
    expect(html).not.toContain('status-pill');
    expect(html).not.toContain('search-wrap-head');
    expect(html).not.toContain('head-meta');
    expect(html).not.toContain('chips');
  });
});
