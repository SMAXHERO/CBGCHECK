#!/usr/bin/env python3
"""保真比对：拆分前(orig) vs 拆分后(壳 + inspector/*) 的 className 集合与中文文案集合。

替代原 fidelity.sh 里的中文区间 grep 写法（本机 grep 不支持，会直接报错）。
只看集合而不是顺序：拆分允许 JSX 分块，不允许丢内容或改语义。
"""
import re, sys, pathlib

LO, HI = chr(0x4E00), chr(0x9FFF)
BT = chr(96)  # JSX 模板字符串的定界符
CJK = re.compile('[' + LO + '-' + HI + '][' + LO + '-' + HI + '0-9A-Za-z，。、；：？！「」《》%~ ]*')
CLASS_ATTR = re.compile('className=(?:"([^"]*)"|' + BT + '([^' + BT + ']*)' + BT + '|[{]([^{}]*)[}])')
EXPR = re.compile('[$][{][^}]*[}]')

def class_names(text):
    out = set()
    for m in CLASS_ATTR.finditer(text):
        raw = m.group(1) or m.group(2) or m.group(3) or ''
        raw = EXPR.sub('<expr>', raw)   # 模板表达式整体归一，变量改名不算差异
        for tok in raw.split():
            tok = tok.strip()
            if tok and not tok.startswith('<expr>') and not tok.startswith('class'):
                out.add(tok)
    return out

def cjk_strings(text):
    found = set()
    for m in CJK.finditer(text):
        s = re.sub(r'\s+', ' ', m.group(0).strip())
        if len(s) >= 2:
            found.add(s)
    return found

def read(p):
    return p.read_text(encoding='utf-8')

def main():
    repo = pathlib.Path.cwd()
    orig_p = repo / '.pipeline/evidence/InspectorReport.orig.tsx'
    shell_p = repo / 'cbg-web/src/pages/InspectorReport.tsx'
    parts = sorted((repo / 'cbg-web/src/pages/inspector').glob('*.ts*'))
    if not orig_p.exists():
        print('missing baseline', orig_p); return 2
    orig = read(orig_p)
    shell = read(shell_p)
    new_text = shell + '\n' + '\n'.join(read(p) for p in parts)

    ok = True
    for label, fn in (('className', class_names), ('中文文案', cjk_strings)):
        a, b = fn(orig), fn(new_text)
        missing, added = sorted(a - b), sorted(b - a)
        print('== %s: orig=%d new=%d 缺失=%d 新增=%d' % (label, len(a), len(b), len(missing), len(added)))
        for x in missing[:15]: print('   - 缺失:', x)
        for x in added[:15]: print('   + 新增:', x)
        if missing: ok = False

    hooks = re.compile('use(?:State|Effect|Callback|Memo|Ref)[(]')
    ho, hn = len(hooks.findall(orig)), len(hooks.findall(shell))
    print('== hooks: orig=%d shell=%d %s' % (ho, hn, 'OK' if ho == hn else 'MISMATCH'))
    if ho != hn: ok = False

    req = re.compile('[^A-Za-z0-9_](loadReport|run|runDemo|reloadRelics|runCalc|runPve|pollJob)[^A-Za-z0-9_]')
    print('== 请求函数出现次数: orig=%d shell=%d' % (len(req.findall(orig)), len(req.findall(shell))))
    print('== 被比对文件:', ', '.join(p.name for p in parts))
    print('RESULT:', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1

if __name__ == '__main__':
    sys.exit(main())
