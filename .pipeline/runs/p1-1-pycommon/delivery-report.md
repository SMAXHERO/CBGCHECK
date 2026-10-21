# 交付报告

- 计划版本：v1
- hash 校验：planSha256 / acceptanceSha256 与 `freeze.json` 一致 → **PASS**（plan `c81f832b…`，acceptance `c006ecb0…`）
- 执行模型：B（route: deepseek harness 执行角色）
- 执行时间：2026-10-21T20:45:48+08:00
- 自测结论：**PASS（L1/L2 共 6 项中 5 项 PASS，C6 有条件通过需确认）**，失败数 0（硬性失败）；L3 C7/C8 待终审

## 1. 产物清单

| 编号 | 路径 | artifact_type | 大小 | sha256 |
|---|---|---|---|---|
| A1 | tools/cbg/pycommon/__init__.py | code | 541 B | 69545d497eab8fe6f9344fff1cb00e88228ce5087bf64bc0acf2627220f8d3d0 |
| A2 | tools/cbg/pycommon/httpkit.py | code | 4439 B | cb4ea504560c113777eb51711880bbd00aef9ee312e4c7ddf5b87fec85513f10 |
| A3 | tools/cbg/pycommon/cli.py | code | 582 B | 350bd798c72ed95f723fd2815183ab2df81938d5838a4d42e18e9063e9f8bd5c |
| A4 | tools/cbg/soul-service/server.py（改造） | code | 9735 B | 871e7582d90d536e98d3826c2d112eb51ec618e45b361c8a4734fe1efa0332d4 |
| A5 | tools/cbg/inspector-service/server.py（改造） | code | 10981 B | c968ba278c807542858d67ff4c60b0ff0ed0eed73a67db2d1e41ccabae31be7c |
| A6 | tools/cbg/pycommon/tests/test_servers.py | code | 5899 B | e0044f35d863aa72bcd651be1c5aef1fb43ca080b6e626f2c2a43f0b5c017f90 |
| A7 | tools/cbg/pycommon/tests/__init__.py | code | 52 B | 3cf427fb12075573507dcf83837fe60ae261fd41c563ac5b30d88b166bafbb21 |
| A8 | tools/cbg/pycommon/README.md | doc | 2664 B | 42183a98659b4824709b508e969b6f3ce1c87448908399aac0c6095ab4a4150f |
| A9 | README.md（仓库根，仅末尾追加一节） | doc | 32585 B | 3cd6de0bf98b4e76c7803ed679ea0bf50e7d36d098f00dcd11132efae1f4dea9 |
| 附加 | tools/cbg/pycommon/tests/baseline_compare.py | code | 5109 B | ffde1cc7152ec1e5361e1ed10a5784b561e64d2d410316702a7394b9288db9bd |
| 附加 | tools/cbg/pycommon/tests/baseline.json | data | 15337 B | e41691e6579d406b7d5838230b5a8896c3cbcc61a644d3b6003c7d1f6f6376ed |

产物总数：11（A1–A9 + 附加 2）。

## 2. 执行环境

- 运行时 / 依赖版本：Python 3.13.9；仅标准库（`unittest`、`http.server`、`urllib`、`subprocess`、`socket`）；无新增第三方依赖。
- 工作目录：`D:\deepseek_work\github-work`（已用 `pwd` 确认；未读写 `D:\deepseek_work\.pipeline` 与 `pipeline-demo`）。
- 执行的命令（按顺序）：
  1. `cd /d/deepseek_work/github-work && pwd`
  2. `sha256sum .pipeline/plan.md .pipeline/acceptance.json` 并与 `freeze.json` 比对 → 一致
  3. 基线采集：`python tools/cbg/pycommon/tests/baseline_compare.py --capture tools/cbg/pycommon/tests/baseline.json`（**在改造前执行**，针对原始两服务）
  4. `python -m py_compile …`（C1）
  5. AST import 静态检查（C2）
  6. `python -m unittest tools.cbg.pycommon.tests.test_servers.TestStandaloneStart -v`（C3）
  7. `python -m unittest discover -s tools/cbg/pycommon/tests -t tools/cbg -v`（C4）
  8. `python tools/cbg/pycommon/tests/baseline_compare.py --check`（C5）
  9. `git status --porcelain -- tools/cbg/scraper-service cbg-web .pipeline/templates`（C6）
  10. `git status --porcelain -- tools/cbg`（自查，确认新增文件）

- 与计划的偏差（逐条）：
  1. **soul 的 Ctrl-C 文案**：原实现 `KeyboardInterrupt` 时打印 `"\nbye"`；共享 `serve()` 在中断时静默返回，故 soul 不再打印 `bye`。仅影响中断时的 stdout 文案，HTTP 行为不变。
  2. **inspector 信号**：`serve()` 统一注册 SIGINT/SIGTERM 并调用 `on_shutdown=app.stopping.set`，与原 `_bye` 语义一致（先置 stopping，再异步 shutdown）。
  3. **baseline_compare.py 与 baseline.json**：计划 C5 引用了 `tests/baseline_compare.py`，但该文件不在 acceptance 产物清单中。已按 C5 意图实现，并附加 `baseline.json` 作为基线数据。属于计划未列明的附加产物。
  4. `serve()` 支持 `server_attrs` 与 `daemon_threads` 参数，用于 inspector 挂载 `App` 与设置守护线程（计划第 4 节允许的扩展）。
  5. 计划第 4 节 `send_json` 建议签名为 `send_json(handler, status, payload, *, origin, cache_control)`；实现额外增加 `extra_cors` 参数以区分两服务的 CORS 形态（soul 仅 Allow-Origin；inspector 三件套）。这是为保持对外头部一致而做的必要扩展。

## 3. 自测结果（L1 / L2）

| 检查项 | 命令 | 退出码 | 结果 | 证据路径 |
|---|---|---|---|---|
| C1 | `python -m py_compile …` | 0 | PASS | .pipeline/evidence/C1.log |
| C2 | AST import 静态检查 | 0 | PASS（`OK []`） | .pipeline/evidence/C2.log |
| C3 | `unittest …TestStandaloneStart` | 0 | PASS | .pipeline/evidence/C3.log |
| C4 | `unittest discover …`（8 tests） | 0 | PASS | .pipeline/evidence/C4.log |
| C5 | `baseline_compare.py --check` | 0 | PASS（NO_DIFF） | .pipeline/evidence/C5-baseline-diff.txt |
| C6 | `git status --porcelain -- …禁止路径` | 0 | 有条件 PASS，见 §4 | .pipeline/evidence/C6-git-status.txt |

L3（C7 README 评审、C8 终审）未在本轮执行，留待终审。

## 4. 未通过项与处理

- **C6（有条件，需确认）**：字面期望为禁止路径“无任何状态”，但 `cbg-web/**`、`.pipeline/templates/`、`tools/cbg/scraper-service/server.mjs` 在本次执行前即已存在未提交/未跟踪状态。本执行者**未写入**这些路径。
  - 根因：工作区既有改动，非本次引入。
  - 处理：未做任何回滚（严禁回滚他人改动，且 plan 要求保留）。请 Lead 确认以“增量口径”判定，或提供执行前 git 快照。
- 其余 L1/L2 检查全部通过，无需修复轮次（maxFixRounds 未消耗）。

## 5. 假设与待确认

| 编号 | 内容 | 影响 |
|---|---|---|
| Q1 | `soul-service/web/` 不存在，soul 的 `GET /`、`/web/*` 返回 404。按现状保持，未补资源。 | 与改造前一致；需项目 owner 确认是否为误删 |
| Q2 | 根 `README.md` 有既有未提交改动。仅在末尾追加“本机服务共享代码与测试”一节，未触碰其他内容。 | 低；若冲突可删除该追加节 |
| Q3 | `scraper-service/server.mjs` 既有改动未触碰。 | 无 |
| Q4 | 两服务错误信封保持不统一（硬约束）。 | 无 |
| Q5 | 测试使用 unittest，未用 pytest。 | 无 |
| Q6 | pycommon 放在 `tools/cbg/pycommon`（采用建议路径）。 | 无 |
| A-extra | `baseline_compare.py` / `baseline.json` 为计划未列明的附加产物，按 C5 意图实现。 | 需终审确认是否保留为正式产物 |

## 6. 遗留风险

1. **soul 中断文案偏差**：Ctrl-C 不再打印 `bye`（见 §2 偏差 1）。低风险，仅 stdout。
2. **C6 判定口径**：工作区既有未提交改动使字面 C6 无法通过，需 Lead 决断口径（见 §4）。
3. **`baseline.json` 绑定当前环境**：其中记录的是采集时的响应；若将来 `/api/inspector/meta` 等内容含动态字段（时间戳、uptime），比对只看键集合与头部，已规避；但 `health` 中的 `uptime`/`cacheDir` 不参与键值比对，风险可控。
4. 测试会在本机启动两个子进程并占用临时端口，不触网；在端口被占满的极端环境可能偶发失败（已用 `bind(0)` 取空闲端口降低概率）。
5. 未执行 L3 评审（C7/C8），终审前 README 与 diff 的人工审阅仍需完成。
6. 未做 git commit / push（符合约束）。
