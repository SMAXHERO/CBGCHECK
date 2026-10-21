// C12：Dashboard 守卫态（offline / need-browser / need-login|captcha）只能是 minimal 模式：
//   1) 三处守卫均调用 <ModuleHeader minimal ...>；
//   2) minimal 实现内部不渲染 ModuleTabs 与 icon-btn（由 ModuleHeader.tsx 的分支保证）。
// 运行目录：cbg-web。
import { readFileSync } from 'node:fs';

const dash = readFileSync('src/pages/Dashboard.tsx', 'utf8');
const header = readFileSync('src/components/ModuleHeader.tsx', 'utf8');

const minimalCalls = (dash.match(/<ModuleHeader\s+minimal\b/g) || []).length;
let ok = minimalCalls === 3;
console.log('minimal ModuleHeader calls in Dashboard =', minimalCalls, '(expect 3)');

// minimal 分支在 return 中先于 ModuleTabs / ThemeToggle 出现
const minimalBlock = header.slice(header.indexOf('if (minimal)'), header.indexOf('return (', header.indexOf('if (minimal)') + 10));
const forbiddenInMinimal = ['ModuleTabs', 'ThemeToggle', 'icon-btn', 'mod-tabs'].filter((w) => minimalBlock.includes(w));
console.log('forbidden tokens inside minimal branch =', forbiddenInMinimal.length ? forbiddenInMinimal.join(',') : 'none');
if (forbiddenInMinimal.length) ok = false;

// Dashboard 不得残留手写的守卫 app-header
const handWritten = (dash.match(/className="app-header"/g) || []).length;
console.log('hand-written app-header in Dashboard =', handWritten, '(expect 0)');
if (handWritten !== 0) ok = false;

if (ok) console.log('MINIMAL_GUARD_OK');
process.exit(ok ? 0 : 1);
