# .pipeline —— 双模型流水线的审计痕迹

每轮改造一个目录，互不覆盖：

| 目录 | 目标 | 模型 | 结果 |
|---|---|---|---|
| `runs/p1-1-pycommon/` | 抽 Python 服务公共 HTTP 外壳 | A=opencode-go/claude-haiku-5-5 · B=deepseek-account/deepseek-v4.1-flash-1017 | 落地并通过终审（`evidence/C8-review.md`） |
| `runs/p1-2-inspector-split/` | 拆分 `InspectorReport.tsx`（1015 行 → 壳 + 8 个文件） | 同上 | 落地；终审判 v2（`plan.md` §11，C6 阈值属计划缺陷）；证据工具缺陷由 Lead 补遗修复（`evidence/C8-review-addendum.md`） |

每个 run 目录里：

- `plan.md` / `acceptance.json` / `freeze.json` —— 冻结的契约（v2 时会另有 `.v1` 备份）；
- `delivery-report.md` —— 执行者的交付与自测报告；
- `evidence/` —— 每条检查的原始输出、保真比对、评审结论。

## 复用方式

1. 把 `templates/` 复制到新 run 目录；
2. **清空/新建 run 目录，不要让会话看到其它 run 的 plan.md**（上一轮就出现过"读到旧契约还校验通过"的跑偏）；
3. 卡片 prompt 里写死绝对路径、先 `pwd` 自证、禁止 `ask_user_question`（卡片会话无人应答会卡死）。
