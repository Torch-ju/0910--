# Novel Illustration Agent

面向 Web 连载小说的独立章节生图 Agent。它只读取小说正文及自己维护的视觉状态，不读取、也不依赖 `memory-agent`。

## 已实现

- 每章只选择一个关键场景、生成一张 16:9 插图，默认 2560×1440。
- 批量章节默认并发 3 路（可配置 1–4）；各章互不等待，只有审核失败的章节单独重试。
- 正式章节图必须是“环境＋关键事件＋主体互动”的叙事场景；标准参考图只约束人物外观，禁止把章节图生成个人写真或角色海报。
- 从小说的结构化对话、旁白、事件中独立识别人物和视觉信息。
- 根据小说主题生成视觉圣经草案；锁定后供全书复用，避免逐章随机换画风。
- 主要人物首次出图前生成 1–4 张标准参考图候选，必须由用户确认。
- Seedream 4.5 文生图/参考图生图适配器，关闭可见水印，单次只请求一张图。
- 自动审核剧情一致性、场景叙事性、人物一致性、画质与合规；写真式成图直接拒绝，审核通过后才展示。
- 首次失败后最多自动重试 3 次，即最多 4 次调用。
- 精确返回正文插入锚点：`insertAfterSegmentId + anchorTextHash + anchorQuote`。
- “重新生成”创建新版本；旧版本归档但不覆盖。
- Seedream 临时 URL 立即转存 TOS；支持私有桶临时签名地址或 CDN 自定义域名。
- PostgreSQL 保存视觉圣经、人物视觉档案、参考图审批、生成尝试、插图版本和幂等请求。
- 防提示词注入、禁止未来剧透和凭空补剧情；战斗可以有张力，但不得明显血腥。

## 快速验证

```bash
npm install
npm test
npm run dev:validation
```

打开 [http://127.0.0.1:4183](http://127.0.0.1:4183)。验证台使用本地模拟图片，不调用真实 Seedream，也不会产生费用。依次点击：

1. 创建并锁定视觉圣经；
2. 解析第一章；
3. 生成 4 张人物候选图并确认一张；
4. 自动生成、审核并插入章节插图；
5. 填写原因后重新生成，检查历史版本。

## 生产接入

核心入口是 `ChapterIllustrationAgent.processChapter()`。输入仅含故事/章节标识和小说正文片段，完整契约见 [docs/integration-contract.md](docs/integration-contract.md)。

```ts
const result = await agent.processChapter({
  requestId: "chapter-18-v1",
  storyId: "novel-001",
  chapterNo: 18,
  chapterVersion: 1,
  chapterTitle: "夜袭",
  narrative: {
    segments: [
      { segmentId: "p-1", kind: "narration", order: 1, text: "……" },
      { segmentId: "p-2", kind: "dialogue", order: 2, speakerName: "张休", text: "……" },
      { segmentId: "p-3", kind: "event", order: 3, text: "……" }
    ]
  }
});
```

推荐生产组合：

- `JsonNovelVisualBiblePlanner`：从小说样本提炼全书画风。
- `JsonNovelChapterAnalyzer`：独立识别人物与章节关键场景。
- `Seedream45ImageGenerator`：调用豆包 Seedream 4.5。
- `JsonVisionIllustrationReviewer`：多模态自动审核。
- `TosAssetStorage`：立即永久化图片，禁止覆盖同一对象键。
- `PostgresIllustrationRepository`：保存元数据和完整版本历史。

TOS 适配器要求宿主注入一个符合 `TosObjectClient` 的 Client。这样本包不会强制携带官方 SDK 当前存在安全公告的旧 Axios 依赖；宿主可以按自身安全基线选择已审计的官方 SDK 版本或内部 TOS 网关。

## 环境变量

复制 `.env.example`，配置 Seedream、视觉分析/审核模型、TOS 和 PostgreSQL。真实服务必须由后端持有密钥，禁止把任何密钥打包进 Web 前端。

## 数据库

先执行：

```bash
psql "$DATABASE_URL" -f db/migrations/001_illustration_agent.sql
```

TOS 建议使用私有桶、开启桶版本控制，并通过后端短时签名 URL 或 CDN 鉴权链接展示。数据库只保存 `tos://bucket/object-key`、对象键及业务版本，不保存 24 小时后失效的 Seedream URL。

## 当前验证边界

自动化测试和 Web 验证台已通过；真实 Seedream、视觉分析模型、TOS 和 PostgreSQL 需要部署环境的账号与密钥后才能做联调。`RuleBasedNovelChapterAnalyzer` 仅用于本地演示，生产必须换成 `JsonNovelChapterAnalyzer`。
