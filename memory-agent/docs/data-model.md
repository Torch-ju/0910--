# 人物记忆数据模型与检索策略

## PostgreSQL 分表

| 表 | 用途 |
|---|---|
| `memory_story_versions` | 每个故事的当前记忆版本 |
| `memory_processed_turns` | 幂等结果和轮次处理记录 |
| `memory_characters` | 规范人物和临时人物 |
| `memory_character_aliases` | 确认或待确认的别名 |
| `memory_events` | 不可变剧情事件 |
| `memory_event_participants` | 事件与人物多对多关系 |
| `memory_facts` | 人物事实、推断、状态和被取代记录 |
| `memory_relationships` | 有方向的人物关系和多条证据 |
| `memory_conflicts` | 静态事实、身份和同名歧义 |
| `memory_corrections` | 自动与人工纠正审计 |
| `memory_identity_changes` | 合并、拆分和失效审计 |
| `memory_notifications` | 必须通知用户的纠错和冲突 |
| `memory_portrait_snapshots` | 各版本完整人物画像 |
| `memory_embeddings` | 事件、画像和关系的向量索引 |

没有人物或事件的物理删除接口。无效人物通过状态表达，事实通过 `superseded` 表达。

## 长剧情检索

向量检索只负责召回，不是事实来源。推荐按以下顺序组装上下文：

1. 始终加载当前涉及人物的最新完整画像。
2. 加载当前章节、场景和最近若干轮事件。
3. 加载这些人物之间的重要关系。
4. 加载未解决的身份和事实冲突。
5. 使用故事 ID、人物 ID、章节和场景做结构化过滤。
6. 对剩余历史事件执行向量召回。
7. 综合人物重合、语义相关性、重要性、时间接近度和证据权威性重排。
8. 去重后按上下文预算截断，但固定事实、当前状态和未解决冲突不能被向量结果挤出。

`PostgresEmbeddingIndexer` 异步处理空向量记录。这样即使向量供应商不可用，结构化记忆仍然可以正常写入和查询。

## 重要关系

当前默认满足任一条件即标记为重要：

- 抽取器重要度不低于 0.6。
- 同一种关系至少重复出现两次。
- 关系描述篇幅较长。
- 属于亲属、夫妻、恋人、敌人、盟友或师徒等高影响类型。

该策略独立封装，可以在获得真实小说样本后调整，不影响数据表和接入接口。
