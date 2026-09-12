# 人物画像 Schema Adapter

正式人物画像 Schema 尚未提供，因此核心流程不依赖任何具体展示字段。

`PortraitSchemaAdapter` 只接收稳定的投影上下文：

- 人物主记录。
- 确认和待确认的别名。
- 当前有效事实。
- 有序事件。
- 人物关系。
- 当前记忆版本。

当前 `PlaceholderPortraitAdapter` 输出 `placeholder-v2`，用于开发与自动化测试。它包含：

- `coreSummary`：下游默认展示的人物画像；对本章或本轮每个受影响人物分别生成，最多 100 个 Unicode 字符。
- 摘要优先表达人物是谁、最近做了什么、当前是什么状态，只选择最核心的信息。
- `coreSummaryCharacterCount`：可直接用于接口校验和前端字数显示。
- `dynamicTrajectory`：跨章节人物变化，采用“起点 → 关键转折 → 当前阶段”表达，最多 100 字。
- `dynamicTrajectoryCharacterCount`：轨迹字数。超过三章时选择首章阶段、最重要的中间转折和最新阶段。
- `currentFacts`、`importantRelationships`、`eventTimeline`：保留完整结构化依据，不计入 100 字展示限制。

收到正式 Schema 后应：

1. 新建 Adapter 类，不直接修改核心 Agent。
2. 将正式版本号写入 `schemaVersion`。
3. 明确每个展示字段来自事实、事件、关系还是推断。
4. 保留证据与置信度，不能在展示层把推断改成事实。
5. 用历史快照回放测试新 Adapter。
6. 下游完成版本兼容后再停用 `placeholder-v2`。

如果正式 Schema 包含模型生成的自然语言人物简介，建议增加独立的“画像表达器”：先由当前稳定结构生成内容，再调用模型润色。模型只能表达已存事实，不能在该阶段新增人物事实，并且最终仍须经过 100 字硬限制校验。
