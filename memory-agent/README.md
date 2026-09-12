# 动态人物记忆 Agent

这是写作陪伴系统中位于“情景演绎 Agent”下游的人物记忆模块。它不续写剧情，只把每轮新增剧情转换成可追溯的人物事件、事实、关系和动态人物画像。

当前版本已经实现：

- 每轮输入校验、幂等处理和乐观锁版本检查。
- 人物识别、稳定人物 ID、同名歧义与临时人物。
- 旁白、明确身份揭示或用户确认后的人物合并。
- 角色自述不足以触发身份合并。
- 不可变事件记录、动态状态更新、静态事实冲突检测。
- 自动纠错留痕并产生用户通知。
- 重要人物关系判定和完整画像快照。
- 每章（或每轮）为每个受影响人物生成不超过 100 字的核心画像摘要，默认只写“是谁、做了什么、当前状态”。
- 保留跨章节动态轨迹，以“起点 → 关键转折 → 当前阶段”概括人物变化。
- 错误合并后按证据分配事件、事实、别名和关系的拆分恢复。
- PostgreSQL 分表存储与 `pgvector` 混合检索基础设施。
- 模型供应商无关的抽取接口，以及兼容 Chat Completions JSON 输出的参考适配器。
- 可替换的人物画像 Schema Adapter；正式 Schema 到达后无需重写主流程。

## 快速验证

```bash
npm install
npm run typecheck
npm test
npm run build
```

## PostgreSQL

迁移文件在 `db/migrations/001_character_memory.sql`。如本机具备 Docker，可启动带 pgvector 的 PostgreSQL：

```bash
docker compose up -d
```

首次创建容器时会自动执行迁移。若使用已有数据库，请通过现有迁移工具执行该 SQL。

`memory_embeddings.embedding` 暂定为 1536 维。模型供应商确定后，如果向量维度不同，需要先修改迁移中的 `vector(1536)`，再创建数据库。

## 最小接入示例

```ts
import {
  CharacterMemoryAgent,
  LlmNarrativeMemoryExtractor,
  OpenAiCompatibleJsonClient,
  PlaceholderPortraitAdapter,
  PostgresMemoryRepository,
} from "dynamic-character-memory-agent";

const repository = new PostgresMemoryRepository({
  connectionString: process.env.DATABASE_URL,
});

const extractor = new LlmNarrativeMemoryExtractor(
  new OpenAiCompatibleJsonClient({
    baseUrl: process.env.MODEL_BASE_URL!,
    apiKey: process.env.MODEL_API_KEY!,
    model: process.env.MODEL_NAME!,
  }),
);

const agent = new CharacterMemoryAgent(
  repository,
  extractor,
  new PlaceholderPortraitAdapter(),
);

const result = await agent.processTurn({
  requestId: "req-story-1-turn-12",
  storyId: "story-1",
  chapterNo: 2,
  sceneNo: 3,
  turnId: "turn-12",
  previousMemoryVersion: 11,
  narrative: {
    text: "林渊摘下面具。他正是此前救下苏雨的蒙面剑客。",
  },
});

// 每个受影响人物各有一条不超过 100 字的摘要：
// result.portraits[n].portrait.coreSummary
// 跨章节的人物变化轨迹：
// result.portraits[n].portrait.dynamicTrajectory
```

生产环境建议由上游把旁白、对话和事件切成带 `segmentId` 的 segments，以便每条记忆精确追溯到原文。

## 文档

- [工作流与记忆规则](docs/workflow.md)
- [其他 Agent 接入契约](docs/integration-contract.md)
- [数据模型与检索策略](docs/data-model.md)
- [人物画像 Schema 替换说明](docs/portrait-schema-adapter.md)
