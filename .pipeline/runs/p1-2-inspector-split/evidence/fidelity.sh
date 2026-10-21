#!/usr/bin/env bash
# 对比原文件与拆分后所有文件中的 className 字符串与中文文案集合
ORIG=.pipeline/evidence/InspectorReport.orig.tsx
NEW="cbg-web/src/pages/InspectorReport.tsx cbg-web/src/pages/inspector/*.ts cbg-web/src/pages/inspector/*.tsx"
ext() { grep -oE 'className="[^"]*"|className=\{`[^`]*`\}' "$@" | sed -E 's/^[^:]*://' | sort -u; }
ext_cn() { grep -oP '[\x{4e00}-\x{9fff}][^<>{}"`\n]*' "$@" | sort -u; }
ext "$ORIG" > /tmp/cls_orig.txt
cat $NEW | grep -oE 'className="[^"]*"|className=\{`[^`]*`\}' | sort -u > /tmp/cls_new.txt
echo "== className 集合差异（原有但新缺失，应为空）=="
comm -23 /tmp/cls_orig.txt /tmp/cls_new.txt
echo "== className 集合差异（新增，应为空）=="
comm -13 /tmp/cls_orig.txt /tmp/cls_new.txt
echo "== 原文件 className 条数 / 新文件 className 条数 =="
wc -l < /tmp/cls_orig.txt; wc -l < /tmp/cls_new.txt
echo "== 中文文案：原有但新缺失（应为空）=="
grep -oP '[\x{4e00}-\x{9fff}][^<>{}"`\n]*' "$ORIG" | sed 's/[ \t]*$//' | sort -u > /tmp/cn_orig.txt
cat $NEW | grep -oP '[\x{4e00}-\x{9fff}][^<>{}"`\n]*' | sed 's/[ \t]*$//' | sort -u > /tmp/cn_new.txt
comm -23 /tmp/cn_orig.txt /tmp/cn_new.txt
echo "== 中文文案：新增（应为空）=="
comm -13 /tmp/cn_orig.txt /tmp/cn_new.txt
