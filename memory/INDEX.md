# 开发记忆索引

本目录是“书中人”唯一的项目开发记忆库。开发记忆不包含产品用户的真实故事数据，也不写入全局 Codex 记忆目录。

## 固定入口

| 文档 ID | 唯一文件 | 存什么 |
| --- | --- | --- |
| RULES | [AGENTS.md](<D:/研究生学习资料/竞赛/20260911 黑客松比赛/AGENTS.md>) | 项目接续与维护规则 |
| ENTRY | [README.md](<D:/研究生学习资料/竞赛/20260911 黑客松比赛/README.md>) | 人类阅读入口和真实启动命令 |
| SPEC-L1 | [PRODUCT_SPEC.md](<D:/研究生学习资料/竞赛/20260911 黑客松比赛/docs/PRODUCT_SPEC.md>) | 产品本意、功能、UI 与 Schema 要求 |
| CURRENT | [CURRENT.md](<D:/研究生学习资料/竞赛/20260911 黑客松比赛/memory/CURRENT.md>) | 现在进行到哪里、允许做什么、接下来做什么 |
| DECISIONS | [DECISIONS.md](<D:/研究生学习资料/竞赛/20260911 黑客松比赛/memory/DECISIONS.md>) | 决策的来源、理由和有效性 |
| HISTORY | [HISTORY.md](<D:/研究生学习资料/竞赛/20260911 黑客松比赛/memory/HISTORY.md>) | 已发生的操作、文件与检查证据 |

本文件不复制任务状态。后续源码入口和正式 Schema 创建后，在这里登记真实路径和对应功能 ID，不预填不存在的文件。

## 按问题找内容

| 要恢复的问题 | 定位 |
| --- | --- |
| 我们为什么做这个产品 | SPEC-L1 开头、一至三；D-001 |
| 第一层的终点和后续边界 | SPEC-L1 二、十八；D-002 |
| 简约 UI、输入和卡片怎么协作 | SPEC-L1 四至六；F-01、F-09；D-003 |
| 识别意味着什么 | SPEC-L1 七；F-02；D-004 |
| Schema 与实例的区别、字段描述 | SPEC-L1 八、九；F-06；D-005 |
| 来源、锁定、确认与关系如何保存 | SPEC-L1 九；F-04、F-05；D-008 |
| 重试、旧响应覆盖、刷新恢复 | SPEC-L1 十二；F-07、F-08；D-009 |
| 模型接入和演示边界 | SPEC-L1 十；F-10；D-006 |
| 目前完成和未完成的任务 | CURRENT 的任务表与最近证据 |
| 上一轮到底写过、测过什么 | CURRENT 的 last_operation_id → HISTORY 同 ID |
| Windows 写入工具错误 | HISTORY 的环境注记，不视为产品问题 |

## 编号和检索

- `F-01..F-10`：功能 ID，只在 SPEC-L1 定义。
- `L1-00..L1-06`：任务 ID，只在 CURRENT 维护状态。
- `D-001..`：决策 ID，只在 DECISIONS 登记。
- `OP-YYYYMMDD-NNN`：开发操作 ID，在 HISTORY 只有一个对应标题。
- 检索单个 ID 时限定到对应文件，例如 `rg -n "L1-03" memory/CURRENT.md`，不扫描全部历史聊天。
- 索引只保存定位，不重复存放详细要求、任务状态或决定正文。
- 相同 ID 的语义保持稳定；改变决定时新建决定并明确替代关系。
- 增删或迁移知识文件时同次更新入口；保留历史事件的原路径并追加迁移说明，不改写历史事实。

## 维护机制

每个有意义的开发单元结束时，按 AGENTS 的串行步骤维护 HISTORY 和 CURRENT。新文件或入口变化才更新此索引；没有变化时不刷新日期或复制事件。

若历史文件以后确实过长，经实际需要在本目录内按年份拆分，再更新索引和 CURRENT 的事件定位；当前不预建归档树。任何归档只存过去事实，不生成第二份当前状态。


## 第一层实施接续入口

- 最新真实状态、模型预算和下一项动作：CURRENT.md。
- 本轮实施与检查历史：HISTORY.md 中 OP-20260912-002。
- 公共 Schema 与内部模型投影取舍：DECISIONS.md 中 D011。
- 文本模型与真实证据分级：DECISIONS.md 中 D012。
- 运行、检查命令及目录导航：根目录 README.md。
- 正式数据权威：schemas/common.schema.json、schemas/story-world.schema.json、schemas/character-profiles.schema.json。
- 合成浏览器证据位于 output/playwright；模型请求账本位于 runtime/model-requests.json，均不能混同为功能规格或第二份开发记忆。


## 字段级共创与候选冲突

功能入口：PRODUCT_SPEC 的 FR-L1-COCREATE-01/02/03。实现定位：src/lib/story/field-contract.ts、src/lib/story/candidate.ts、src/features/story/use-workbench.ts。执行事件：HISTORY 的 OP-20260912-003。最新结果仅看 CURRENT；取舍见 DECISIONS 的 D014。
