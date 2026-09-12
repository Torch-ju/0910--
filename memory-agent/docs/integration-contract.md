# 其他 Agent 接入契约

## 稳定服务接口

其他 Agent 应调用 `CharacterMemoryAgent` 和 `MemoryMaintenanceService`，不要直接写人物记忆表。

### processTurn

用途：处理上游情景演绎 Agent 生成的一轮新增剧情。

必填输入：

| 字段 | 说明 |
|---|---|
| `requestId` | 本次调用的幂等 ID |
| `storyId` | 故事稳定 ID |
| `chapterNo` | 章节号，从 1 开始 |
| `sceneNo` | 场景号，从 1 开始 |
| `turnId` | 故事内轮次稳定 ID |
| `narrative.text` | 本轮新增的完整情景演绎文本 |

可选输入：

| 字段 | 说明 |
|---|---|
| `narrative.segments` | 已切分的旁白、对话和事件；推荐提供 |
| `storyTime` | 原文明确提供的剧情内时间 |
| `previousMemoryVersion` | 上游读取到的记忆版本；提供后启用乐观锁 |

输出包含：

- 新记忆版本。
- 是否为幂等重放。
- 受到影响的人物 ID。
- 受影响人物的最新完整画像；每个人物的 `portrait.coreSummary` 独立限制在 100 字以内。
- 新增事件 ID。
- 更新关系 ID。
- 冲突 ID。
- 必须向用户展示的通知。

### getLatestPortrait

按人物 ID 获取最新完整画像。正式画像 Schema 发布前返回 `placeholder-v2`。下游默认展示 `portrait.coreSummary`，需要展示成长变化时读取 `portrait.dynamicTrajectory`；详细事实、事件和关系仅用于追溯或展开查看。

### getCharacterHistory

按人物 ID 返回有序事件历史。调用者可以设置数量上限。

### getCharacterRelationships

返回人物作为起点或终点的关系。画像默认只展示 `isImportant=true` 的关系，底层仍保留关系候选和证据。

### searchRelevantMemories

输入当前剧情文本、涉及人物 ID 和可选查询向量，返回人物画像、事件、关系和待解决冲突的混合排序结果。

### splitIncorrectMerge

由运营或用户纠错界面调用。必须提供：

- 被恢复的已合并人物 ID。
- 当前规范人物 ID。
- 上一记忆版本。
- 用户确认。
- 拆分原因。
- 需要归还给被恢复人物的事实、别名、事件和关系端点 ID。

拆分不会删除事件或历史画像。

### listPendingNotifications 与 markNotificationStatus

通知模块应定期读取待发送通知。消息成功显示或发送给用户后标记为 `delivered`；用户确认后标记为 `acknowledged`。自动纠错不能在没有创建通知记录的情况下完成。

## 错误语义

| 情况 | 建议 HTTP 映射 | 调用方处理 |
|---|---:|---|
| 输入格式错误 | 400 | 修正字段，不重试原请求 |
| `MemoryVersionConflictError` | 409 | 重新读取最新版本后重新分析 |
| 模型暂时失败 | 502/503 | 使用同一 `requestId` 重试 |
| 数据库暂时失败 | 503 | 使用同一 `requestId` 重试 |
| 身份或事实不确定 | 业务成功 | 读取 `conflictIds` 和 `notifications`，不要当作系统异常 |

## 同名人物

抽取结果中的 `characterIdHint` 用于指定已知人物。旁白明确引入另一个同名人物时使用 `forceNewIdentity=true`。无法判断时不填写提示 ID，核心流程会创建临时人物并通知用户，避免静默合并。

## 版本兼容

- 输入契约与人物画像 Schema 分别版本化。
- 正式人物画像 Schema 发布时新增 Adapter，不修改事件、事实和关系存储。
- 下游必须检查 `schemaVersion`，不能假定 `placeholder-v2` 永久存在。
