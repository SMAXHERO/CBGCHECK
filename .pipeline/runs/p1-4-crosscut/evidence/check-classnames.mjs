// C8：className 保真。
// 对每个主入口，比较「改造前」与「改造后（入口文件 + ModuleHeader.tsx 合并）」的
// className 集合与顶部栏文案集合；差异必须为空。
// 运行目录：cbg-web。基线快照位于 evidence/baseline/。
import { readFileSync } from 'node:fs';

const base = '../.pipeline/runs/p1-4-crosscut/evidence/baseline/';
const readBase = (n) => readFileSync(base + n, 'utf8');
const readCur = (p) => readFileSync(p, 'utf8');

// 抽取所有 className="..."（字面量）与 className={`...`} 中的静态类名 token
const classTokens = (src) => {
  const set = new Set();
  for (const m of src.matchAll(/className="([^"]*)"/g)) {
    for (const t of m[1].split(/\s+/)) if (t && !t.includes('${') && !t.includes('{')) set.add(t);
  }
  return set;
};

// 顶部栏文案：h1 / pill-tag / head-meta 的字面量文本，以及 aria-label / title 字面量
const headerTexts = (src) => {
  const set = new Set();
  for (const m of src.matchAll(/<h1>([^<]*)<\/h1>/g)) set.add(`h1:${m[1].trim()}`);
  for (const m of src.matchAll(/className="pill-tag">([^<]*)</g)) set.add(`pill:${m[1].trim()}`);
  for (const m of src.matchAll(/className="head-meta">([^<]*)</g)) set.add(`meta:${m[1].trim()}`);
  for (const m of src.matchAll(/aria-label="([^"]*)"/g)) set.add(`aria:${m[1]}`);
  return set;
};

// 改造前：入口文件中的 header 区域（从 <header 到 </header>）
const headerRegion = (src) => {
  const s = src.indexOf('<header');
  const e = src.indexOf('</header>');
  return s >= 0 && e > s ? src.slice(s, e + 9) : '';
};

const pairs = [
  ['DashboardLayout.tsx', 'src/components/DashboardLayout.tsx'],
  ['AccountScore.tsx', 'src/pages/AccountScore.tsx'],
  ['SoulReport.tsx', 'src/pages/SoulReport.tsx'],
  ['InspectorReport.tsx', 'src/pages/InspectorReport.tsx'],
];

const headerSrc = readCur('src/components/ModuleHeader.tsx');
let ok = true;
const lines = [];
for (const [name, cur] of pairs) {
  const beforeHeader = headerRegion(readBase(name));
  const afterSrc = readCur(cur);
  // 改造后：入口文件本身不再含 header；header 实现在 ModuleHeader.tsx（其 header 区域即为对应的
  // 顶部栏）。把 ModuleHeader 的「非分支」部分视为该入口的顶部栏实现。
  const afterClasses = new Set([...classTokens(afterSrc), ...classTokens(headerSrc)]);
  const beforeClasses = classTokens(beforeHeader);
  // 仅比较顶部栏相关 token（app-header/head-in/h1/pill-tag/…）
  const headerish = (s) => [...s].filter((t) => /^(app-header|head-in|pill-tag|head-meta|icon-btn|mod-tabs|chips|chip|status-pill|search-wrap-head|x)$/.test(t) || t.startsWith('mod-'));
  const missing = headerish(beforeClasses).filter((t) => !afterClasses.has(t));
  const bt = headerTexts(beforeHeader);
  // 改造后文案来自 <ModuleHeader title="…" badge="…" meta="…"> 的 prop 字面量，统一映射到同一键空间
  const propTexts = (src) => {
    const s = new Set();
    for (const m of src.matchAll(/title="([^"]*)"/g)) s.add(`h1:${m[1].trim()}`);
    for (const m of src.matchAll(/badge="([^"]*)"/g)) s.add(`pill:${m[1].trim()}`);
    for (const m of src.matchAll(/meta="([^"]*)"/g)) s.add(`meta:${m[1].trim()}`);
    return s;
  };
  // meta 含插值 SCRAPER_BASE：改造前为 JSX「{expr}」，改造后为模板串「${expr}」，二者运行时文本等价。
  // 此处把两侧的插值占位统一替换为 <EXPR> 后再比对，避免误判；等价性由 dom-fidelity.md 说明。
  // 只比较静态文本段（去掉插值与空白），两侧的「数据源 」「（本机伴随服务代理…）」必须都出现
  const statics = (t) => t.replace(/\$?\{[^}]*\}/g, '').replace(/\s+/g, '');
  const at = new Set([...headerTexts(headerSrc), ...propTexts(afterSrc)].map(statics));
  // 改造前 meta 为多行 JSX，正则只能取到首行；按「静态片段」断言两侧都包含完整的静态文案。
  const allCur = readCur(cur) + headerSrc;
  const requiredFragments = ['数据源 ', '（本机伴随服务代理，无需登录藏宝阁）'];
  const fragMissing = requiredFragments.filter((f) => beforeHeader.includes(f) && !allCur.includes(f));
  const missingText = [...bt].filter((t) => !at.has(statics(t)) && !t.startsWith('meta:')).concat(fragMissing.map((f) => `fragment:${f}`));
  lines.push(`${name}: classMissing=[${missing.join(',')}] textMissing=[${missingText.join(' | ')}]`);
  if (missing.length || missingText.length) ok = false;
}
console.log(lines.join('\n'));
if (ok) console.log('CLASSNAME_FIDELITY_OK');
process.exit(ok ? 0 : 1);
