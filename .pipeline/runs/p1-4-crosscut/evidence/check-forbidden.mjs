// C11：禁止路径相对改造前快照无 diff（index.css、src/api/、src/store/、vite.config.mjs、.pipeline/templates/）
// 运行目录：cbg-web。基线：evidence/baseline/forbidden-tree.sha256
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const repoRoot = resolve('..');
const baselinePath = resolve(repoRoot, '.pipeline/runs/p1-4-crosscut/evidence/baseline/forbidden-tree.sha256');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const walk = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
};

const baseline = new Map();
for (const line of readFileSync(baselinePath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
  if (m) baseline.set(m[2].split(sep).join('/').replace(/\\/g, '/'), m[1]);
}

const current = new Map();
const targets = ['cbg-web/src/api', 'cbg-web/src/store', '.pipeline/templates'];
for (const t of targets) {
  for (const f of walk(resolve(repoRoot, t))) {
    current.set(relative(repoRoot, f).split(sep).join('/'), sha(readFileSync(f)));
  }
}
for (const f of ['cbg-web/src/index.css', 'cbg-web/vite.config.mjs']) {
  current.set(f, sha(readFileSync(resolve(repoRoot, f))));
}

let ok = true;
for (const [k, v] of baseline) {
  if (current.get(k) !== v) {
    ok = false;
    console.log('DIFF', k, 'baseline=', v, 'now=', current.get(k) ?? '(missing)');
  }
}
for (const k of current.keys()) {
  if (!baseline.has(k)) {
    ok = false;
    console.log('NEW', k);
  }
}
if (ok) console.log('FORBIDDEN_UNTOUCHED_OK', `files=${baseline.size}`);
process.exit(ok ? 0 : 1);
