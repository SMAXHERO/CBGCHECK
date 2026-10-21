# 假设记录（P1-5 样式轮，模型 A）

approval 已改为 never：全程不请求 sandbox 升级、不调用 ask_user_question，按下列默认处理。

| 编号 | 问题 | 默认处理 |
|---|---|---|
| Q1 | `.btn-primary` 白字压 accent 对比度仅 3.09（深浅两套相同） | 视为 4.5 文本阈值失败，但不改品牌色 `--accent`（改色会动全站品牌）；改为 `.btn-primary` 用深色字 / 或加深按钮底色仅限 `--accent-btn` 新令牌，两主题各一。执行者按「最小幅度」实现，结果写入 contrast 报告。 |
| Q2 | `--faint` 在深色 3.32、浅色 2.55 | 不保留低于 4.5 的 faint 作为正文色：调亮 faint 至 ≥4.5（深色 surface 上），并把仅作装饰的 faint 文字（如纯分隔符）列入例外清单并给理由。 |
| Q3 | `--link` / `--ok` 浅色 4.10 / 3.30 | 调暗同色相明度至 ≥4.5（文本用途）。 |
| Q4 | 图表动画关闭的判定范围 | 只读 `prefers-reduced-motion: reduce`，不做用户设置项。 |
| Q5 | SoulReport 表格内空态尺寸 | 用 `state-box--compact`（padding 18px，无 `.big`）。 |
| Q6 | 测试位置 | 放 `cbg-web/src/utils/__tests__/contrast.test.ts`，纳入现有 vitest include，不改 vitest.config.ts。 |
| Q7 | 「176 用例」基线 | 执行前先跑一次记录基线；若基线 ≠176，以执行前实测为准并在 evidence 注明。 |
