import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 设计令牌对比度（WCAG 2.1）。
 *
 * 解析 src/index.css 中两个主题块（:root / :root[data-theme='dark'] 与 :root[data-theme='light']）
 * 里的 hex 令牌，按配对计算相对亮度对比度：
 *   - 普通文本 ≥ 4.5（WCAG AA 1.4.3）
 *   - 大文本 / UI 组件 ≥ 3.0（WCAG AA 1.4.11）
 *
 * 不达标项只能进 EXCEPTIONS，且每项必须写 reason（测试断言 reason 非空）。
 * rgba() 类令牌（软底色、阴影）不参与计算，属于装饰层，跳过。
 */

const here = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(here, '../../index.css');

type Theme = 'dark' | 'light';

/** 从 CSS 文本中截出某个主题块的 body */
const extractBlock = (css: string, selector: string): string => {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`未找到主题块: ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
};

/** 解析块内 `--name: #hex;` 声明，仅保留 hex（rgba 跳过） */
const parseTokens = (block: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const re = /--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    out[m[1]] = m[2].toLowerCase();
  }
  return out;
};

const css = readFileSync(CSS_PATH, 'utf8');
const TOKENS: Record<Theme, Record<string, string>> = {
  // 深色是 :root 默认 + :root[data-theme='dark']，两者同步，取 data-theme 块即可
  dark: parseTokens(extractBlock(css, ":root[data-theme='dark']")),
  light: parseTokens(extractBlock(css, ":root[data-theme='light']")),
};

/** WCAG 相对亮度 */
const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/** WCAG 对比度，保留两位小数 */
export const contrastRatio = (a: string, b: string): number => {
  const la = luminance(a);
  const lb = luminance(b);
  const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  return Math.round(ratio * 100) / 100;
};

/** 阈值 */
const TEXT = 4.5;
const UI = 3.0;

interface Pair {
  fg: string;
  bg: string;
  /** 用途：text=文字，ui=图标/边框/填充 */
  kind: 'text' | 'ui';
}

/** 需要校验的配对（前景 / 背景 均为令牌名） */
const PAIRS: Pair[] = [
  { fg: 'text', bg: 'surface', kind: 'text' },
  { fg: 'text', bg: 'surface-2', kind: 'text' },
  { fg: 'dim', bg: 'surface', kind: 'text' },
  { fg: 'dim', bg: 'surface-2', kind: 'text' },
  { fg: 'faint', bg: 'surface', kind: 'text' },
  { fg: 'faint', bg: 'surface-2', kind: 'text' },
  { fg: 'text-mid', bg: 'surface', kind: 'text' },
  { fg: 'link', bg: 'surface', kind: 'text' },
  { fg: 'ok', bg: 'surface', kind: 'text' },
  { fg: 'warn', bg: 'surface', kind: 'text' },
  { fg: 'danger', bg: 'surface', kind: 'text' },
  { fg: 'accent', bg: 'surface', kind: 'ui' },
  { fg: 'on-accent', bg: 'accent-btn', kind: 'text' },
  { fg: 'on-accent', bg: 'danger-btn', kind: 'text' },
];

/**
 * 例外清单：无法（或不应）达到阈值的项。每项必须有 reason。
 * 目前为空——所有配对已通过最小幅度调整达标；--accent 作为品牌填充色仅满足 UI 阈值 3.0。
 */
interface Exception {
  theme: Theme;
  fg: string;
  bg: string;
  threshold: number;
  reason: string;
}
const EXCEPTIONS: Exception[] = [];

const thresholdOf = (kind: Pair['kind']) => (kind === 'text' ? TEXT : UI);

const isException = (theme: Theme, p: Pair): Exception | undefined =>
  EXCEPTIONS.find((e) => e.theme === theme && e.fg === p.fg && e.bg === p.bg);

describe('设计令牌对比度（WCAG 2.1）', () => {
  it('解析出两个主题的关键令牌', () => {
    for (const theme of ['dark', 'light'] as const) {
      for (const name of ['text', 'surface', 'surface-2', 'faint', 'accent', 'accent-btn', 'on-accent']) {
        expect(TOKENS[theme][name], `${theme} 缺少 --${name}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('对比度计算自洽（黑白 = 21）', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
  });

  for (const theme of ['dark', 'light'] as const) {
    for (const p of PAIRS) {
      const threshold = thresholdOf(p.kind);
      it(`${theme}: --${p.fg} / --${p.bg} ≥ ${threshold}`, () => {
        const ex = isException(theme, p);
        const ratio = contrastRatio(TOKENS[theme][p.fg], TOKENS[theme][p.bg]);
        if (ex) {
          // 例外项只记录，不断言达标
          expect(ex.reason.trim().length, '例外必须有 reason').toBeGreaterThan(0);
          return;
        }
        expect(ratio, `${theme} --${p.fg}(${TOKENS[theme][p.fg]}) on --${p.bg}(${TOKENS[theme][p.bg]})`).toBeGreaterThanOrEqual(threshold);
      });
    }
  }

  it('例外清单每一项都带 reason 且字段完整', () => {
    for (const e of EXCEPTIONS) {
      expect(e.reason.trim().length).toBeGreaterThan(0);
      expect(['dark', 'light']).toContain(e.theme);
      expect([TEXT, UI]).toContain(e.threshold);
    }
  });
});

/**
 * 静态扫描：凡是「白字压在品牌色实底上」的规则，底色必须用 --accent-btn。
 *
 * 为什么单独立一条：令牌配对测试只能验证「--on-accent on --accent-btn」这一对，
 * 挡不住某条规则写了 `background: var(--accent); color: var(--on-accent)`——
 * 那种组合白字只有 3.09:1。终审就抓到过 .opt.on / .card-head .badge / .guide-step .n 三处。
 * 这条测试把"规则级"的组合也纳入回归。
 */
describe('CSS 规则级：品牌色实底 + 白字必须用 --accent-btn', () => {
  /** 粗略按「选择器 { 声明 }」切块；@media 内的规则同样会被切到，够用 */
  const ruleBlocks = (): { selector: string; body: string }[] => {
    const out: { selector: string; body: string }[] = [];
    const re = /([^{}]+){([^{}]*)}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
      // 取本块的最后一个选择器（多行选择器取末尾那行），压平空白便于报错定位
      const selector = m[1].replace(/\s+/g, ' ').trim();
      if (!selector || selector.startsWith('@') || selector.startsWith('/*')) continue;
      out.push({ selector, body: m[2] });
    }
    return out;
  };

  it('没有规则同时使用 background: var(--accent) 与 color: var(--on-accent)', () => {
    const offenders = ruleBlocks()
      .filter((r) => /background(-color)?:[ ]*var[(]--accent[)]/.test(r.body) && /color:[ ]*var[(]--on-accent[)]/.test(r.body))
      .map((r) => r.selector);
    expect(offenders, '这些选择器应为白字改用 --accent-btn 实底').toEqual([]);
  });

  it('实底填充件（btn-primary / opt.on / badge 等）用的是 --accent-btn', () => {
    const filled = ruleBlocks().filter((r) => /color:[ ]*var[(]--on-accent[)]/.test(r.body));
    expect(filled.length).toBeGreaterThan(0);
    for (const r of filled) {
      // 白字规则必须用「实底按钮色」令牌：--accent-btn 或 --danger-btn（后者也过 4.5）
      expect(r.body, `${r.selector} 有白字就应配 --accent-btn / --danger-btn 底色`).toMatch(
        /background(-color)?:[ ]*var[(]--(accent|danger)-btn[)]/,
      );
    }
  });
});
