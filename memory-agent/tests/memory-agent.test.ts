import assert from "node:assert/strict";
import test from "node:test";

import {
  CharacterMemoryAgent,
  InMemoryMemoryRepository,
  JsonNarrativeMemoryExtractor,
  MemoryMaintenanceService,
  MemoryVersionConflictError,
  PlaceholderPortraitAdapter,
  type Clock,
  type EvidenceInput,
  type ExtractionResult,
  type IdGenerator,
  type ProcessTurnInput,
} from "../src/index.js";

class SequentialIds implements IdGenerator {
  private value = 0;
  next(prefix: string): string {
    this.value += 1;
    return `${prefix}_${this.value}`;
  }
}

class FixedClock implements Clock {
  now(): string {
    return "2026-09-12T08:00:00.000Z";
  }
}

const narration = (quote: string, segmentId = "n1"): EvidenceInput => ({
  sourceKind: "narration",
  segmentId,
  quote,
  confidence: 1,
});

const emptyExtraction = (): ExtractionResult => ({
  mentions: [],
  events: [],
  facts: [],
  relationships: [],
  identities: [],
});

function turn(turnId: string, previousMemoryVersion?: number): ProcessTurnInput {
  return {
    requestId: `request-${turnId}`,
    storyId: "story-1",
    chapterNo: 1,
    sceneNo: 1,
    turnId,
    narrative: { text: `第 ${turnId} 轮剧情` },
    ...(previousMemoryVersion === undefined ? {} : { previousMemoryVersion }),
  };
}

function createAgent(extractions: ExtractionResult[]) {
  const repository = new InMemoryMemoryRepository();
  const queue = [...extractions];
  const extractor = new JsonNarrativeMemoryExtractor(() => {
    const next = queue.shift();
    if (!next) throw new Error("No extraction fixture available");
    return next;
  });
  const agent = new CharacterMemoryAgent(
    repository,
    extractor,
    new PlaceholderPortraitAdapter(),
    new SequentialIds(),
    new FixedClock(),
  );
  return { agent, repository };
}

test("creates characters, immutable events, important relationships, and complete portraits", async () => {
  const extraction = emptyExtraction();
  extraction.mentions = [
    { ref: "lin", displayName: "林渊", evidence: narration("林渊走进院子") },
    { ref: "su", displayName: "苏雨", evidence: narration("苏雨迎了上来") },
  ];
  extraction.events = [
    {
      eventKey: "chapter-1-rescue",
      summary: "林渊救下苏雨",
      participantRefs: ["lin", "su"],
      importance: 0.9,
      evidence: narration("林渊挡下刀锋，救下了苏雨"),
    },
  ];
  extraction.facts = [
    {
      subjectRef: "lin",
      key: "阵营倾向",
      value: "倾向保护弱者",
      inference: true,
      temporal: "state",
      evidence: { ...narration("林渊挡下刀锋，救下了苏雨"), sourceKind: "agent_inference", confidence: 0.72 },
    },
  ];
  extraction.relationships = [
    {
      fromRef: "su",
      toRef: "lin",
      type: "救命恩人",
      description: "林渊在袭击中救下苏雨，这件事改变了两人的关系。",
      importance: 0.85,
      evidence: narration("林渊挡下刀锋，救下了苏雨"),
    },
  ];

  const { agent, repository } = createAgent([extraction]);
  const result = await agent.processTurn(turn("turn-1", 0));

  assert.equal(result.memoryVersion, 1);
  assert.equal(result.affectedCharacterIds.length, 2);
  assert.equal(result.portraits.length, 2);
  assert.equal(result.appendedEventIds.length, 1);
  assert.equal(result.relationshipIds.length, 1);
  assert.equal(repository.snapshot().events.length, 1);
  assert.equal(repository.snapshot().relationships[0]?.isImportant, true);

  const linPortrait = result.portraits.find(
    (snapshot) => snapshot.portrait.character.displayName === "林渊",
  )?.portrait;
  assert.ok(linPortrait);
  assert.match(linPortrait.coreSummary, /^林渊；行动：林渊救下苏雨；现状：倾向保护弱者。$/u);
  assert.equal(linPortrait.coreSummaryCharacterCount, Array.from(linPortrait.coreSummary).length);
  assert.ok(linPortrait.coreSummaryCharacterCount <= 100);
});

test("keeps the primary portrait summary within 100 characters while preserving core fields", async () => {
  const extraction = emptyExtraction();
  extraction.mentions = [
    { ref: "zhang", displayName: "张休", evidence: narration("张休出现") },
  ];
  extraction.events = [
    {
      eventKey: "recruit-general",
      summary: "张休在遭到项羽武力威胁后识别出对方最深的遗憾并以复活虞姬为条件成功完成招募",
      participantRefs: ["zhang"],
      importance: 0.98,
      evidence: narration("张休承诺有机会便复活虞姬，项羽随后与他结义"),
    },
  ];
  extraction.facts = [
    {
      subjectRef: "zhang",
      key: "身份",
      value: "来自后世并被最强王朝系统绑定的穿越者和系统宿主",
      inference: false,
      temporal: "state",
      evidence: narration("张休是后世之人，最强王朝系统已与他绑定"),
    },
    {
      subjectRef: "zhang",
      key: "当前状态",
      value: "已与项羽结为异姓兄弟并开始选择能够支撑统一三国任务的特殊兵种",
      inference: false,
      temporal: "state",
      evidence: narration("张休获得项羽，特殊兵种选择开启"),
    },
  ];

  const { agent } = createAgent([extraction]);
  const result = await agent.processTurn(turn("turn-summary", 0));
  const portrait = result.portraits[0]?.portrait;

  assert.ok(portrait);
  assert.match(portrait.coreSummary, /^张休；身份：/u);
  assert.match(portrait.coreSummary, /；行动：/u);
  assert.match(portrait.coreSummary, /；现状：/u);
  assert.equal(portrait.coreSummaryCharacterCount, Array.from(portrait.coreSummary).length);
  assert.ok(portrait.coreSummaryCharacterCount <= 100);
});

test("retains a concise cross-chapter character trajectory", async () => {
  const stage = (summary: string, eventKey: string): ExtractionResult => ({
    mentions: [{ ref: "zhang", displayName: "张休", evidence: narration(summary) }],
    events: [{
      eventKey,
      summary,
      participantRefs: ["zhang"],
      importance: 0.9,
      evidence: narration(summary),
    }],
    facts: [],
    relationships: [],
    identities: [],
  });
  const { agent } = createAgent([
    stage("张休作为后世穿越者进入帝王群聊", "enter-chat"),
    stage("张休利用历史信息反击帝王并接受统一三国任务", "gain-mission"),
    stage("张休说服项羽结义并开始组建军事班底", "recruit-xiang-yu"),
  ]);

  const first = await agent.processTurn({ ...turn("chapter-1", 0), chapterNo: 1 });
  const second = await agent.processTurn({ ...turn("chapter-2", 1), chapterNo: 2 });
  const third = await agent.processTurn({ ...turn("chapter-3", 2), chapterNo: 3 });

  assert.equal(first.portraits[0]?.portrait.dynamicTrajectory, "阶段变化尚未形成");
  assert.match(second.portraits[0]?.portrait.dynamicTrajectory ?? "", / → /u);
  assert.equal(
    third.portraits[0]?.portrait.dynamicTrajectory,
    "作为后世穿越者进入帝王群聊 → 利用历史信息反击帝王并接受统一三国任务 → 说服项羽结义并开始组建军事班底",
  );
  assert.equal(
    third.portraits[0]?.portrait.dynamicTrajectoryCharacterCount,
    Array.from(third.portraits[0]?.portrait.dynamicTrajectory ?? "").length,
  );
  assert.ok((third.portraits[0]?.portrait.dynamicTrajectoryCharacterCount ?? 101) <= 100);
});

test("is idempotent for duplicate request or turn", async () => {
  const extraction = emptyExtraction();
  extraction.mentions = [
    { ref: "lin", displayName: "林渊", evidence: narration("林渊出现") },
  ];
  const { agent, repository } = createAgent([extraction]);
  const input = turn("turn-1", 0);

  await agent.processTurn(input);
  const replay = await agent.processTurn(input);

  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.memoryVersion, 1);
  assert.equal(repository.snapshot().characters.length, 1);
  assert.equal(repository.snapshot().processedTurns.length, 1);
});

test("updates dynamic state, preserves old fact, and notifies the user", async () => {
  const first = emptyExtraction();
  first.mentions = [{ ref: "lin", displayName: "林渊", evidence: narration("林渊救人") }];
  first.facts = [
    {
      subjectRef: "lin",
      key: "当前行为倾向",
      value: "保护无辜者",
      inference: false,
      temporal: "state",
      evidence: narration("林渊保护了无辜者"),
    },
  ];
  const second = emptyExtraction();
  second.mentions = [{ ref: "lin", displayName: "林渊", evidence: narration("林渊再次出现") }];
  second.facts = [
    {
      subjectRef: "lin",
      key: "当前行为倾向",
      value: "开始伤害无辜者",
      inference: false,
      temporal: "state",
      evidence: narration("林渊下令伤害无辜者", "n2"),
    },
  ];

  const { agent, repository } = createAgent([first, second]);
  await agent.processTurn(turn("turn-1", 0));
  const updated = await agent.processTurn(turn("turn-2", 1));

  assert.equal(updated.memoryVersion, 2);
  assert.equal(updated.notifications[0]?.type, "automatic_correction");
  const facts = repository.snapshot().facts;
  assert.equal(facts.find((fact) => fact.value === "保护无辜者")?.status, "superseded");
  assert.equal(facts.find((fact) => fact.value === "开始伤害无辜者")?.status, "active");
  assert.equal(repository.snapshot().corrections.length, 1);
});

test("does not silently overwrite equal-authority static facts", async () => {
  const first = emptyExtraction();
  first.mentions = [{ ref: "lin", displayName: "林渊", evidence: narration("林渊来自北境") }];
  first.facts = [
    {
      subjectRef: "lin",
      key: "出生地",
      value: "北境",
      inference: false,
      temporal: "static",
      evidence: narration("林渊出生于北境"),
    },
  ];
  const second = emptyExtraction();
  second.mentions = [{ ref: "lin", displayName: "林渊", evidence: narration("林渊来自南境", "n2") }];
  second.facts = [
    {
      subjectRef: "lin",
      key: "出生地",
      value: "南境",
      inference: false,
      temporal: "static",
      evidence: narration("林渊其实出生于南境", "n2"),
    },
  ];

  const { agent, repository } = createAgent([first, second]);
  await agent.processTurn(turn("turn-1", 0));
  const result = await agent.processTurn(turn("turn-2", 1));

  assert.equal(result.conflictIds.length, 1);
  assert.equal(result.notifications[0]?.type, "memory_conflict");
  assert.equal(repository.snapshot().facts.find((fact) => fact.value === "南境")?.status, "disputed");
});

test("applies an explicit narrator correction to a static fact and notifies the user", async () => {
  const first = emptyExtraction();
  first.mentions = [{ ref: "lin", displayName: "林渊", evidence: narration("林渊来自北境") }];
  first.facts = [
    {
      subjectRef: "lin",
      key: "出生地",
      value: "北境",
      inference: false,
      temporal: "static",
      evidence: narration("旧档案记载林渊出生于北境"),
    },
  ];
  const correction = emptyExtraction();
  correction.mentions = [{ ref: "lin", displayName: "林渊", evidence: narration("旁白纠正记录", "n2") }];
  correction.facts = [
    {
      subjectRef: "lin",
      key: "出生地",
      value: "南境",
      inference: false,
      temporal: "static",
      correctionIntent: true,
      evidence: narration("此前记载有误，林渊实际出生于南境", "n2"),
    },
  ];
  const { agent, repository } = createAgent([first, correction]);
  await agent.processTurn(turn("turn-1", 0));
  const result = await agent.processTurn(turn("turn-2", 1));

  assert.equal(result.conflictIds.length, 0);
  assert.equal(result.notifications[0]?.type, "automatic_correction");
  assert.equal(repository.snapshot().facts.find((fact) => fact.value === "北境")?.status, "superseded");
  assert.equal(repository.snapshot().facts.find((fact) => fact.value === "南境")?.status, "active");
});

test("merges disguised identity only after authoritative reveal and retains the surface name as alias", async () => {
  const setup = emptyExtraction();
  setup.mentions = [
    { ref: "masked", displayName: "蒙面剑客", provisional: true, evidence: narration("蒙面剑客出现") },
    { ref: "lin", displayName: "林渊", evidence: narration("林渊留在城中") },
  ];
  const selfClaim = emptyExtraction();
  selfClaim.mentions = [
    { ref: "masked", displayName: "蒙面剑客", provisional: true, evidence: narration("众人谈到蒙面剑客", "n2") },
    { ref: "lin", displayName: "林渊", evidence: narration("林渊开口", "n2") },
  ];
  selfClaim.identities = [
    {
      leftRef: "masked",
      rightRef: "lin",
      relation: "same_person",
      evidence: {
        sourceKind: "character_statement",
        segmentId: "d2",
        quote: "林渊说：我就是蒙面剑客",
        confidence: 0.9,
      },
    },
  ];
  const reveal = emptyExtraction();
  reveal.mentions = [
    { ref: "masked", displayName: "蒙面剑客", provisional: true, evidence: narration("蒙面剑客摘下面具", "n3") },
    { ref: "lin", displayName: "林渊", evidence: narration("面具下正是林渊", "n3") },
  ];
  reveal.identities = [
    {
      leftRef: "masked",
      rightRef: "lin",
      relation: "same_person",
      evidence: {
        sourceKind: "explicit_identity_reveal",
        segmentId: "n3",
        quote: "林渊正是当日的蒙面剑客",
        confidence: 1,
      },
    },
  ];

  const { agent, repository } = createAgent([setup, selfClaim, reveal]);
  await agent.processTurn(turn("turn-1", 0));
  const pending = await agent.processTurn(turn("turn-2", 1));
  assert.equal(pending.conflictIds.length, 1);
  assert.equal(repository.snapshot().characters.filter((item) => item.status !== "merged").length, 2);

  await agent.processTurn(turn("turn-3", 2));
  const active = repository.snapshot().characters.filter((item) => item.status !== "merged");
  assert.equal(active.length, 1);
  assert.equal(active[0]?.displayName, "林渊");
  assert.equal(
    repository.snapshot().aliases.some(
      (alias) => alias.characterId === active[0]?.characterId && alias.value === "蒙面剑客" && alias.confirmed,
    ),
    true,
  );
});

test("rejects stale memory versions", async () => {
  const first = emptyExtraction();
  first.mentions = [{ ref: "lin", displayName: "林渊", evidence: narration("林渊出现") }];
  const second = emptyExtraction();
  const { agent } = createAgent([first, second]);
  await agent.processTurn(turn("turn-1", 0));

  await assert.rejects(
    () => agent.processTurn(turn("turn-2", 0)),
    MemoryVersionConflictError,
  );
});

test("splits an incorrect merge without deleting history", async () => {
  const setup = emptyExtraction();
  setup.mentions = [
    { ref: "masked", displayName: "蒙面剑客", provisional: true, evidence: narration("蒙面剑客救人") },
    { ref: "lin", displayName: "林渊", evidence: narration("林渊在城中") },
  ];
  setup.events = [
    {
      eventKey: "masked-rescue",
      summary: "蒙面剑客救下一名路人",
      participantRefs: ["masked"],
      importance: 0.8,
      evidence: narration("蒙面剑客救下一名路人"),
    },
  ];
  setup.facts = [
    {
      subjectRef: "masked",
      key: "武器",
      value: "长剑",
      inference: false,
      temporal: "static",
      evidence: narration("蒙面剑客手持长剑"),
    },
  ];
  const reveal = emptyExtraction();
  reveal.mentions = [
    { ref: "masked", displayName: "蒙面剑客", provisional: true, evidence: narration("蒙面剑客出现", "n2") },
    { ref: "lin", displayName: "林渊", evidence: narration("林渊摘下面具", "n2") },
  ];
  reveal.identities = [
    {
      leftRef: "masked",
      rightRef: "lin",
      relation: "same_person",
      evidence: {
        sourceKind: "explicit_identity_reveal",
        segmentId: "n2",
        quote: "蒙面剑客就是林渊",
        confidence: 1,
      },
    },
  ];

  const { agent, repository } = createAgent([setup, reveal]);
  await agent.processTurn(turn("turn-1", 0));
  await agent.processTurn(turn("turn-2", 1));
  const mergedState = repository.snapshot();
  const source = mergedState.characters.find((item) => item.displayName === "蒙面剑客");
  const target = mergedState.characters.find((item) => item.displayName === "林渊");
  const fact = mergedState.facts.find((item) => item.value === "长剑");
  const event = mergedState.events.find((item) => item.eventKey === "masked-rescue");
  const alias = mergedState.aliases.find((item) => item.value === "蒙面剑客");
  assert.ok(source && target && fact && event && alias);
  assert.equal(source.status, "merged");

  const maintenance = new MemoryMaintenanceService(
    repository,
    new PlaceholderPortraitAdapter(),
    new SequentialIds(),
    new FixedClock(),
  );
  const result = await maintenance.splitIncorrectMerge({
    requestId: "split-1",
    storyId: "story-1",
    sourceMergedCharacterId: source.characterId,
    currentCanonicalCharacterId: target.characterId,
    previousMemoryVersion: 2,
    reason: "用户确认旁白身份揭示有误",
    userConfirmed: true,
    assignments: {
      factIds: [fact.factId],
      aliasIds: [alias.aliasId],
      eventIds: [event.eventId],
      relationshipEndpoints: [],
    },
  });

  const splitState = repository.snapshot();
  assert.equal(result.memoryVersion, 3);
  assert.equal(result.portraits.length, 2);
  assert.equal(splitState.characters.find((item) => item.characterId === source.characterId)?.status, "active");
  assert.equal(splitState.facts.find((item) => item.factId === fact.factId)?.characterId, source.characterId);
  assert.deepEqual(
    splitState.events.find((item) => item.eventId === event.eventId)?.participantIds,
    [source.characterId],
  );
  assert.equal(splitState.identityChanges.at(-1)?.type, "split");
});

test("supports distinct same-name characters when narration marks a new identity", async () => {
  const first = emptyExtraction();
  first.mentions = [{ ref: "guard", displayName: "阿青", evidence: narration("守卫阿青站在门口") }];
  const second = emptyExtraction();
  second.mentions = [
    {
      ref: "merchant",
      displayName: "阿青",
      forceNewIdentity: true,
      evidence: narration("商人也叫阿青，但他并不是门口的守卫", "n2"),
    },
  ];
  const { agent, repository } = createAgent([first, second]);

  await agent.processTurn(turn("turn-1", 0));
  await agent.processTurn(turn("turn-2", 1));

  const active = repository.snapshot().characters.filter((item) => item.status === "active");
  assert.equal(active.length, 2);
  assert.equal(active[0]?.displayName, "阿青");
  assert.equal(active[1]?.displayName, "阿青");
  assert.notEqual(active[0]?.characterId, active[1]?.characterId);
});

test("retrieval always favors current-character portraits and relevant important memories", async () => {
  const extraction = emptyExtraction();
  extraction.mentions = [
    { ref: "lin", displayName: "林渊", evidence: narration("林渊救下苏雨") },
    { ref: "su", displayName: "苏雨", evidence: narration("苏雨被救") },
  ];
  extraction.events = [
    {
      eventKey: "rescue",
      summary: "林渊在城门救下苏雨",
      participantRefs: ["lin", "su"],
      importance: 0.95,
      evidence: narration("林渊在城门救下苏雨"),
    },
  ];
  const { agent } = createAgent([extraction]);
  const result = await agent.processTurn(turn("turn-1", 0));
  const linId = result.portraits.find(
    (snapshot) => (snapshot.portrait as { character: { displayName: string } }).character.displayName === "林渊",
  )?.characterId;
  assert.ok(linId);

  const memories = await agent.searchRelevantMemories({
    storyId: "story-1",
    queryText: "城门救人",
    currentCharacterIds: [linId],
    limit: 5,
  });
  assert.equal(memories[0]?.memoryType, "portrait");
  assert.equal(memories.some((item) => item.memoryType === "event"), true);
});
