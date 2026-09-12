# 接入契约

## 边界

生图 Agent 是独立服务。上游只需提供小说正文，不需要提供人物画像，也不需要调用 `memory-agent`。人物识别、视觉档案、参考图和跨章节一致性均由本 Agent 自己维护。

## 章节输入

```json
{
  "requestId": "chapter-18-v1",
  "storyId": "novel-001",
  "chapterNo": 18,
  "chapterVersion": 1,
  "chapterTitle": "夜袭",
  "narrative": {
    "segments": [
      {
        "segmentId": "p-1801",
        "kind": "narration",
        "order": 1,
        "text": "夜色压在营门上……"
      },
      {
        "segmentId": "p-1802",
        "kind": "dialogue",
        "speakerName": "张休",
        "order": 2,
        "text": "张休低声下令……"
      },
      {
        "segmentId": "p-1803",
        "kind": "event",
        "order": 3,
        "text": "众人冲向营门……"
      }
    ]
  }
}
```

要求：

- `requestId` 在同一故事内唯一，用于幂等。
- `segmentId` 和 `order` 在本章内唯一。
- `kind` 仅允许 `dialogue | narration | event`。
- `speakerName` 只在上游已经明确说话者时提供；不可猜测。
- 重新生成必须使用新 `requestId`，并额外提供 `regenerationReason`。

## 章节输出

成功时 `status=published`，下游以 `illustration` 为准：

```json
{
  "status": "published",
  "attempts": 1,
  "illustration": {
    "version": 2,
    "isCurrent": true,
    "model": "doubao-seedream-4.5",
    "scenePlan": {
      "insertAfterSegmentId": "p-1803",
      "anchorTextHash": "sha256...",
      "anchorQuote": "众人冲向营门……",
      "evidenceSegmentIds": ["p-1802", "p-1803"],
      "characterIds": ["char_..."],
      "theme": "营门夜袭",
      "environment": "夜色笼罩的古代军营，营门与火把清晰可见",
      "keyAction": "张休带人冲向营门并迎敌",
      "subjectInteraction": "张休与来敌隔着营门形成对峙",
      "composition": "16:9 中远景，前景为守军，中景为张休，远景为逼近的敌军",
      "caption": "……"
    },
    "asset": {
      "permanentUri": "tos://bucket/stories/novel-001/chapters/18/illustrations/.../v2.png",
      "objectKey": "stories/novel-001/chapters/18/illustrations/.../v2.png",
      "width": 2560,
      "height": 1440
    },
    "audit": {
      "passed": true,
      "safetyPassed": true,
      "scores": {
        "narrativeMatch": 0.94,
        "sceneStorytelling": 0.95,
        "characterConsistency": 0.95,
        "imageQuality": 0.92
      }
    }
  }
}
```

Web 正文服务必须先用 `insertAfterSegmentId` 找段落，再校验当前段落文本的 SHA-256 是否等于 `anchorTextHash`。哈希不一致说明章节已编辑，必须重新规划锚点，不可按旧位置盲插。

`environment + keyAction + subjectInteraction + composition` 是正式章节图的强制场景字段。标准参考图只约束人物外观，不向正式章节图传递背景、姿势、灯光或镜头。自动审核若判定成图属于人物写真、角色海报或无剧情动作的静态站姿，必须拒绝展示。

## 等待状态

- `waiting_visual_bible_lock`：全书画风尚未确认/锁定；不得生图。
- `waiting_reference_approval`：返回 `missingReferenceCharacterIds`；为这些人物生成候选标准图并让用户确认。
- `generation_failed`：首次生成和最多三次重试都未完成生成/永久化。
- `review_rejected`：最多四张候选均未通过自动审核；不得展示任何一张。

等待状态不写入幂等终态，因此完成审批后可以用原 `requestId` 再次处理。成功或最终失败后，同一 `requestId` 只返回原结果。

## 标准参考图接口

1. `CharacterReferenceService.generateCandidates(storyId, characterId, count)`：`count` 为 1–4。
2. 前端展示候选图。
3. `approveCandidate(storyId, characterId, candidateId)`：用户确认一张，其余同版本候选标记为 rejected。
4. 未确认主要人物参考图时，章节生图不会开始。

## 供其他 Agent/服务接入的稳定入口

- `ChapterIllustrationAgentPort`
- `NovelChapterAnalyzer`
- `NovelVisualBiblePlanner`
- `ImageGenerator`
- `IllustrationReviewer`
- `AssetStorage`
- `IllustrationRepository`

具体 TypeScript 定义位于 `src/ports.ts` 和 `src/domain.ts`。替换模型、存储或数据库时无需改变应用层主流程。
