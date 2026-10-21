# C7 评审：tools/cbg/pycommon/README.md（README 质量 rubric）

- 评审模型：模型 A（终审，独立会话）
- 评审对象：`tools/cbg/pycommon/README.md`
- 评审方法：逐条核对 README 声明与 `httpkit.py` / `cli.py` 实际签名与行为

## 评分

| 维度 | 分数(1-5 语境 4 为及格线) | 结论 |
|---|---|---|
| accuracy（准确） | 4 | 通过 |
| completeness（完整） | 4 | 通过 |
| clarity（清晰） | 4 | 通过 |

## 逐项事实核对

- `cors_headers(handler, origin="*", methods=None, allow_headers="Content-Type", cache_control=None)`：与代码签名一致；"cache_control 为 None 时不写" 正确。
- `send_json(..., extra_cors=False)`：与代码一致；`extra_cors=True` 为 inspector 三件套形态、否则仅 Allow-Origin 为 soul 形态，描述正确。
- `read_body(handler) -> bytes`：正确。
- `serve(..., on_shutdown, install_signals, poll_interval, daemon_threads, server_attrs) -> 0`：签名与代码一致，返回 0 正确。
- `register_signal_handlers(fn)`：实际还接受 `signals` 参数，README 未列出，属轻微不完整（非错误）。
- `add_server_args(parser, *, default_host, default_port)`：与代码一致。
- 运行测试命令 `python -m unittest discover -s tools/cbg/pycommon/tests -t tools/cbg -v`：与 plan 及实际可运行（C4 已通过）一致。
- 错误信封"刻意不统一"与 soul `OPTIONS` 不带 `Cache-Control`：与黑盒实测一致（见 C8）。
- "soul-service/web 目录在磁盘上不存在"：已核实 `tools/cbg/soul-service/` 下无 `web/`，描述准确。

## 发现的问题（不阻断）

1. `register_signal_handlers` 的 `signals` 参数未在 README 中说明（低优先级，建议补一行）。
2. README 示例端口 `8790/8793` 与 plan 一致，但 inspector 默认端口实际为 `8793`，示例可接受。

## 结论

**C7 PASS**（accuracy/completeness/clarity 均 ≥ 4；无事实错误；存在 1 处轻微遗漏，不阻断）。
