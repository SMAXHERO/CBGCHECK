# L1 / L2 自测报告

执行目录：`D:\deepseek_work\github-work`（Python 3.13.9）

| 检查项 | 级别 | 命令 | 退出码 | 结果 | 证据路径 |
|---|---|---|---|---|---|
| C1 | L1 | `python -m py_compile tools/cbg/pycommon/{__init__,httpkit,cli}.py tools/cbg/soul-service/server.py tools/cbg/inspector-service/server.py` | 0 | PASS | `.pipeline/evidence/C1.log` |
| C2 | L1 | 静态 AST 检查 pycommon 的 import（禁止 service/engine/requests/cbg_inspector/store/vendor） | 0 | PASS（输出 `OK []`） | `.pipeline/evidence/C2.log` |
| C3 | L2 | `python -m unittest tools.cbg.pycommon.tests.test_servers.TestStandaloneStart -v` | 0 | PASS（1 test，两服务独立启动 health 均 200 且 ok==true） | `.pipeline/evidence/C3.log` |
| C4 | L2 | `python -m unittest discover -s tools/cbg/pycommon/tests -t tools/cbg -v` | 0 | PASS（8 tests OK） | `.pipeline/evidence/C4.log` |
| C5 | L2 | `python tools/cbg/pycommon/tests/baseline_compare.py --check` | 0 | PASS（`NO_DIFF`） | `.pipeline/evidence/C5-baseline-diff.txt` |
| C6 | L2 | `git status --porcelain -- tools/cbg/scraper-service cbg-web .pipeline/templates` | 0 | **见下方说明：有条件 PASS / 需人工确认** | `.pipeline/evidence/C6-git-status.txt` |
| C7 | L3 | 人工 rubric 审阅 `tools/cbg/pycommon/README.md` | — | 未在本轮执行（L3 由 Lead/终审完成） | `.pipeline/evidence/C7-review.md`（待终审） |
| C8 | L3 | 人工 rubric 终审 diff | — | 未在本轮执行（L3 由 Lead/终审完成） | `.pipeline/evidence/C8-review.md`（待终审） |

## C6 说明（重要）

C6 字面期望 `stdoutContains: ""` 且要求禁止路径相对执行前基线“无新增或修改”。实际输出显示：

- `tools/cbg/scraper-service/server.mjs`：**预先存在**的未提交改动（plan Q3 已声明，本次未触碰）。
- `cbg-web/**`、`.pipeline/templates/`：**同样为执行前即存在的未提交/未跟踪状态**。本执行者全程未写入这些路径（所有写入仅限 `tools/cbg/pycommon/`、`tools/cbg/soul-service/server.py`、`tools/cbg/inspector-service/server.py`、根 `README.md` 末尾追加一节）。

因此本次任务**未引入**对禁止路径的新改动，但 C6 的字面判定会失败。建议 Lead 以“相对执行前基线的增量”口径确认，或提供执行前的 git 快照以精确比对。

## 偏差与备注

- 测试中 C4 的 `unittest` 输出包名为 `pycommon.tests.test_servers`（discover 的 `-t tools/cbg` 行为），与 C3 使用的 `tools.cbg.pycommon...` 完全限定名并存，二者均通过。
- 对照脚本 `baseline_compare.py` 不在 acceptance 产物清单中，按 plan C5 意图实现，已记入交付报告“假设与待确认”。
