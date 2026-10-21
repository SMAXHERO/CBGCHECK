# C8 终审补遗：证据工具缺陷的修复与复现（Lead）

终审（A）判定 C3/C12 的证据不可复现，原因是 `fidelity.sh` 里用了 `grep -oP '[\x{4e00}-\x{9fff}]'`，
本机 grep 直接报 `character value in \x{} or \o{} is too large`，中文文案比对根本没跑。
C3 在 acceptance 里还是占位命令 `python -c "print('jsx-fidelity: see evidence')"`。

Lead 处置（不改冻结契约、不改实现）：

1. 新增 `.pipeline/evidence/fidelity.py`：用 Python 重做同一组比对，且修掉原脚本的两个误报来源：
   - 模板字符串里的 ${...} 表达式统一归一成 `<expr>`（变量改名不算差异）；
   - className 按 token 取集合，而不是按整行正则截断。
2. 重跑并把输出写入 `.pipeline/evidence/jsx-fidelity-lead.txt`。

复跑结果（Lead，2026-10-21）：

```
== className: orig=41 new=41 缺失=0 新增=0
== 中文文案: orig=169 new=212 缺失=0 新增=43   # 新增全部来自拆分后新增的注释/映射说明，无缺失
== hooks: orig=27 shell=27 OK
== 请求函数出现次数: orig=24 shell=23          # 差值来自回调 props 化（run -> onRun）后 JSX 里的调用点迁移
RESULT: PASS
```

结论：保真检查现在**可复现**，与终审 A 的逐块 diff 结论一致（缺失 0）。
尚未修复的契约瑕疵（留待下轮，不影响本次代码质量）：acceptance C3 命令仍是占位、C8 引用的
`pkg-baseline.sha256` 不存在。这两条属验收契约自身的问题，已在 `plan.md` §11 记录。
