import assert from "node:assert/strict";
import test from "node:test";

import {
  ChapterIllustrationAgent,
  CharacterReferenceService,
  InMemoryAssetStorage,
  InMemoryIllustrationRepository,
  JsonNovelVisualBiblePlanner,
  MockSeedreamImageGenerator,
  NovelVisualBibleService,
  RuleBasedNovelChapterAnalyzer,
  ScriptedIllustrationReviewer,
  StoryVisualSetupService,
  TosAssetStorage,
  assertNarrativeScenePlan,
  hashAnchor,
  type GenerateChapterIllustrationInput,
  type ImageGenerator,
  type IllustrationAudit,
  type IllustrationReviewer,
  type JsonModelRequest,
  type StructuredJsonModel,
  type TosObjectClient,
} from "../src/index.js";

const chapter: GenerateChapterIllustrationInput = {
  requestId: "req-chapter-1",
  storyId: "story-demo",
  chapterNo: 1,
  chapterVersion: 1,
  chapterTitle: "破局",
  narrative: {
    segments: [
      { segmentId: "s1", kind: "narration", order: 1, text: "张休在陌生的古代营帐中醒来，迅速判断自己的处境。" },
      { segmentId: "s2", kind: "dialogue", order: 2, speakerName: "张休", text: "张休压低声音说：先守住营门，再查清来敌。" },
      { segmentId: "s3", kind: "event", order: 3, text: "张休带人冲向营门，与来敌形成紧张对峙。" },
    ],
  },
};

async function lockBible(repository: InMemoryIllustrationRepository) {
  const setup = new StoryVisualSetupService(repository);
  await setup.saveDraft({
    storyId: chapter.storyId,
    novelTheme: "古代乱世中的生存与权谋",
    genre: "历史穿越",
    eraSetting: "中国古代军营，服饰、兵器和建筑符合时代语境",
    baseStyle: "写实国风电影概念插画，克制而有叙事张力",
    colorScript: "低饱和青灰与暖褐色",
    lightingRules: "自然光与火光形成明确层次",
    compositionRules: "16:9 横幅，主体位于中心 70% 安全区",
    forbiddenDrift: ["现代服饰", "科幻武器", "卡通Q版"],
  });
  await setup.lock(chapter.storyId);
}

function makeAgent(
  repository: InMemoryIllustrationRepository,
  storage: InMemoryAssetStorage,
  generator: ImageGenerator = new MockSeedreamImageGenerator(),
  reviewer: IllustrationReviewer = new ScriptedIllustrationReviewer(),
) {
  return new ChapterIllustrationAgent(
    repository,
    new RuleBasedNovelChapterAnalyzer(),
    generator,
    storage,
    reviewer,
  );
}

async function approveDiscoveredMainCharacter(
  repository: InMemoryIllustrationRepository,
  storage: InMemoryAssetStorage,
) {
  const discoveryAgent = makeAgent(repository, storage);
  const waiting = await discoveryAgent.processChapter(chapter);
  assert.equal(waiting.status, "waiting_reference_approval");
  const characterId = waiting.missingReferenceCharacterIds[0];
  assert.ok(characterId);
  const references = new CharacterReferenceService(
    repository,
    new MockSeedreamImageGenerator(),
    storage,
  );
  const candidates = await references.generateCandidates(chapter.storyId, characterId, 2);
  await references.approveCandidate(chapter.storyId, characterId, candidates[0]!.candidateId);
  return characterId;
}

test("requires a locked visual bible before analyzing a chapter", async () => {
  const repository = new InMemoryIllustrationRepository();
  const result = await makeAgent(repository, new InMemoryAssetStorage()).processChapter(chapter);
  assert.equal(result.status, "waiting_visual_bible_lock");
  assert.equal(result.attempts, 0);
});

test("discovers characters from novel text and waits for main reference approval", async () => {
  const repository = new InMemoryIllustrationRepository();
  await lockBible(repository);
  const result = await makeAgent(repository, new InMemoryAssetStorage()).processChapter(chapter);
  assert.equal(result.status, "waiting_reference_approval");
  assert.equal(result.missingReferenceCharacterIds.length, 1);
  const profiles = await repository.listCharacterVisualProfiles(chapter.storyId);
  assert.equal(profiles[0]?.displayName, "张休");
});

test("publishes one 16:9 illustration after reference approval and keeps an exact paragraph anchor", async () => {
  const repository = new InMemoryIllustrationRepository();
  const storage = new InMemoryAssetStorage();
  await lockBible(repository);
  await approveDiscoveredMainCharacter(repository, storage);

  const result = await makeAgent(repository, storage).processChapter(chapter);
  assert.equal(result.status, "published");
  assert.equal(result.attempts, 1);
  assert.equal(result.illustration?.asset.width, 2560);
  assert.equal(result.illustration?.asset.height, 1440);
  assert.equal(result.illustration?.scenePlan.insertAfterSegmentId, "s3");
  assert.equal(result.illustration?.scenePlan.anchorTextHash, hashAnchor(chapter.narrative.segments[2]!.text));
  assert.equal((await repository.listIllustrationHistory(chapter.storyId, 1)).length, 1);
});

test("uses the approved reference only for appearance and builds a narrative scene prompt", async () => {
  const repository = new InMemoryIllustrationRepository();
  const storage = new InMemoryAssetStorage();
  const generator = new MockSeedreamImageGenerator();
  await lockBible(repository);
  await approveDiscoveredMainCharacter(repository, storage);

  const result = await makeAgent(repository, storage, generator).processChapter({
    ...chapter,
    requestId: "req-narrative-scene",
  });

  assert.equal(result.status, "published");
  const request = generator.requests[0];
  assert.ok(request);
  assert.match(request.prompt, /章节叙事插图/);
  assert.match(request.prompt, /参考图只用于锁定人物五官、发型、年龄感和体型/);
  assert.match(request.prompt, /忽略并替换参考图中的背景、姿势、灯光、镜头和写真构图/);
  assert.match(request.prompt, /【具体环境】/);
  assert.match(request.prompt, /【关键动作】/);
  assert.match(request.prompt, /【主体互动与空间关系】/);
  assert.match(request.negativePrompt, /个人写真/);
  assert.match(request.negativePrompt, /沿用参考图的背景或姿势/);
});

test("generates multiple chapters concurrently while preserving input result order", async () => {
  const repository = new InMemoryIllustrationRepository();
  const storage = new InMemoryAssetStorage();
  await lockBible(repository);
  await approveDiscoveredMainCharacter(repository, storage);

  let active = 0;
  let maxActive = 0;
  const generator: ImageGenerator = {
    model: "doubao-seedream-4.5",
    async generate(request) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active -= 1;
      return {
        bytes: new Uint8Array([request.chapterNo]),
        mimeType: "image/png",
        width: request.width,
        height: request.height,
      };
    },
  };
  const agent = makeAgent(repository, storage, generator);
  const results = await agent.processChapters([
    { ...chapter, chapterNo: 1, requestId: "req-fast-1" },
    { ...chapter, chapterNo: 2, requestId: "req-fast-2" },
    { ...chapter, chapterNo: 3, requestId: "req-fast-3" },
  ]);

  assert.equal(maxActive, 3);
  assert.deepEqual(results.map((result) => result.chapterNo), [1, 2, 3]);
  assert.ok(results.every((result) => result.status === "published"));
});

test("rejects a portrait-only chapter scene plan before image generation", () => {
  assert.throws(() => assertNarrativeScenePlan({
    planId: "plan-portrait",
    storyId: "story-demo",
    chapterNo: 1,
    chapterVersion: 1,
    theme: "错误示例",
    synopsis: "张休准备迎敌",
    environment: "古代营门",
    keyAction: "张休拔剑",
    subjectInteraction: "张休面对逼近的敌军",
    composition: "16:9 中景",
    insertAfterSegmentId: "s3",
    anchorTextHash: "0".repeat(64),
    anchorQuote: "张休带人冲向营门",
    evidenceSegmentIds: ["s3"],
    characterIds: ["char-1"],
    caption: "迎敌",
    prompt: "张休个人写真，纯色背景",
    negativePrompt: "水印",
  }), /章节插图不能采用写真式构图/);
});

test("retries up to three times after the initial request", async () => {
  const repository = new InMemoryIllustrationRepository();
  const storage = new InMemoryAssetStorage();
  await lockBible(repository);
  await approveDiscoveredMainCharacter(repository, storage);
  const result = await makeAgent(
    repository,
    storage,
    new MockSeedreamImageGenerator(3),
  ).processChapter({ ...chapter, requestId: "req-retry" });
  assert.equal(result.status, "published");
  assert.equal(result.attempts, 4);
  assert.equal((await repository.listGenerationAttempts(chapter.storyId, 1)).length, 4);
});

test("does not display an image when all four review attempts fail", async () => {
  const repository = new InMemoryIllustrationRepository();
  const storage = new InMemoryAssetStorage();
  await lockBible(repository);
  await approveDiscoveredMainCharacter(repository, storage);
  const rejected: Omit<IllustrationAudit, "auditId" | "attemptId" | "createdAt"> = {
    passed: false,
    scores: { narrativeMatch: 0.5, sceneStorytelling: 0.4, characterConsistency: 0.5, imageQuality: 0.9 },
    safetyPassed: true,
    reasons: ["人物与剧情不一致"],
  };
  const result = await makeAgent(
    repository,
    storage,
    new MockSeedreamImageGenerator(),
    new ScriptedIllustrationReviewer([rejected]),
  ).processChapter({ ...chapter, requestId: "req-review-reject" });
  assert.equal(result.status, "review_rejected");
  assert.equal(result.attempts, 4);
  assert.equal(result.illustration, undefined);
});

test("regeneration creates a new current version and archives the previous image", async () => {
  const repository = new InMemoryIllustrationRepository();
  const storage = new InMemoryAssetStorage();
  await lockBible(repository);
  await approveDiscoveredMainCharacter(repository, storage);
  await makeAgent(repository, storage).processChapter(chapter);
  const regenerated = await makeAgent(repository, storage).processChapter({
    ...chapter,
    requestId: "req-regenerate",
    regenerationReason: "人物表情不够紧张",
  });
  assert.equal(regenerated.illustration?.version, 2);
  assert.equal(regenerated.illustration?.regenerationReason, "人物表情不够紧张");
  const history = await repository.listIllustrationHistory(chapter.storyId, 1);
  assert.deepEqual(history.map((item) => [item.version, item.status]), [[2, "current"], [1, "archived"]]);
});

test("terminal requests are idempotent", async () => {
  const repository = new InMemoryIllustrationRepository();
  const storage = new InMemoryAssetStorage();
  await lockBible(repository);
  await approveDiscoveredMainCharacter(repository, storage);
  const agent = makeAgent(repository, storage);
  await agent.processChapter(chapter);
  const replay = await agent.processChapter(chapter);
  assert.equal(replay.idempotentReplay, true);
  assert.equal((await repository.listIllustrationHistory(chapter.storyId, 1)).length, 1);
});

test("derives a visual bible draft from novel text without memory-agent input", async () => {
  const repository = new InMemoryIllustrationRepository();
  const model: StructuredJsonModel = {
    async completeJson(_request: JsonModelRequest) {
      return {
        novelTheme: "乱世生存与成长",
        genre: "历史穿越",
        eraSetting: "中国古代军营",
        baseStyle: "写实国风电影概念插画",
        colorScript: "低饱和青灰和暖褐",
        lightingRules: "暮光与火光冷暖对比",
        compositionRules: "16:9 横幅，主体位于中心70%安全区",
        forbiddenDrift: ["现代物件", "人物随机变化", "明显血腥"],
      };
    },
  };
  const service = new NovelVisualBibleService(
    new JsonNovelVisualBiblePlanner(model),
    new StoryVisualSetupService(repository),
  );
  const draft = await service.deriveDraft({
    storyId: chapter.storyId,
    title: "测试小说",
    segments: chapter.narrative.segments,
  });
  assert.equal(draft.status, "draft");
  assert.equal(draft.baseStyle, "写实国风电影概念插画");
});

test("TOS adapter uses immutable object keys and can issue a display URL", async () => {
  const calls: unknown[] = [];
  const client: TosObjectClient = {
    async putObject(input) {
      calls.push(input);
      return {};
    },
    getPreSignedUrl(input) {
      return `https://signed.example/${input.key}`;
    },
  };
  const storage = new TosAssetStorage(client, { bucket: "private-novel-images" });
  const asset = await storage.persist({
    storyId: "story-1",
    chapterNo: 2,
    purpose: "chapter_illustration",
    logicalId: "attempt-1",
    version: 3,
    payload: {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
      width: 2560,
      height: 1440,
    },
  });
  assert.match(asset.objectKey, /stories\/story-1\/chapters\/2\/illustrations\/attempt-1\/v3\.png$/);
  assert.equal((calls[0] as { forbidOverwrite: boolean }).forbidOverwrite, true);
  assert.match(await storage.getDisplayUrl(asset), /^https:\/\/signed\.example\//);
});
