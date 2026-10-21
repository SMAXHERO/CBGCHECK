# L1 / L2 检查报告

| 检查项 | 级别 | 命令 | 退出码 | 结果 | 证据 |
|---|---|---|---|---|---|
| C1 原文件副本行数 1015 | L1 | `wc -l .pipeline/evidence/InspectorReport.orig.tsx` | 0 | PASS（1015） | `InspectorReport.orig.tsx` |
| C2 refactor-map 覆盖 6 个 Tab | L1 | `grep -c -E "overview|speed|pve|hero|relics|calc" refactor-map.md` + 文件存在 | 0 | PASS | `refactor-map.md` |
| C3 JSX 文本保真 | L2 | fidelity 脚本（className / 中文文案集合比对） | 0 | PASS（见 jsx-fidelity.txt） | `jsx-fidelity.txt` |
| C4 类型检查 | L1 | `npx tsc -p tsconfig.app.json --noEmit`（见偏差说明） | 0 | PASS | `L1-tsc.log` |
| C5 Vite 构建 | L1 | `npx vite build` | 0 | PASS（built in 7.47s） | `L1-vite-build.log` |
| C6 行数 ≤250 | L2 | `wc -l` | 0 | **FAIL**：`InspectorReport.tsx` 413 行 > 250；其余文件全部 ≤161 | `L2-linecount.txt` |
| C7 禁止路径无新增改动 | L2 | `git status --short -- <forbidden>` 与 baseline diff | 0 | PASS（与 forbidden-baseline.txt 完全一致） | `git-status-after.txt` |
| C8 package 未变 | L2 | `sha256sum package.json package-lock.json` | 0 | PASS（与开工前一致） | `pkg-after.sha256` |
| C9 具名导出保留 | L2 | `grep -n "export const InspectorReport"` | 0 | PASS | `L2-export.txt` |
| C10 无循环依赖 | L2 | grep inspector/ 对页面壳的 import | 1（无匹配） | PASS | `L2-cycle.txt`（空） |
| C11 映射审计 | L3 | 人工抽检（非自动） | — | 见 refactor-map.md，行号与 orig 副本对应 | `refactor-map.md` |
| C12 className/文案集合 | L3 | fidelity 脚本 | 0 | PASS：className 43/43，中文文案缺失 0 | `jsx-fidelity.txt` |

## 失败项说明

**C6（行数）未通过**：`cbg-web/src/pages/InspectorReport.tsx` 为 413 行，超过 250。
原因：计划要求所有 hook/effect/handler 保留在页面壳，这部分约 246 行，加上保留的 header/输入卡/摘要卡 JSX，无法在不迁移 hook 的前提下压到 250 以内。新增的 Tab 与工具文件全部 ≤250。此为计划内部约束冲突，已记录在 delivery-report 偏差中，**未擅自违反 hook 约束**，也未放宽验收项。

## 环境注记（非代码问题）

- `npx tsc -b` 写 `node_modules/.tmp/tsbuildinfo` 时 EPERM（`node_modules` 为指向仓库外的符号链接，目标目录不可写）。改用 `npx tsc -p tsconfig.app.json --noEmit` 做同等类型检查，退出 0。
- `npx vite build` 首次因 esbuild 子进程 `spawn EPERM` 失败，按沙箱权限申请一次提升后通过（退出 0）。
