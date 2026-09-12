import { createHash } from "node:crypto";
import { MemoryMaintenanceService } from "../../../memory-agent/src/application/memory-maintenance-service";
import { CharacterMemoryAgent } from "../../../memory-agent/src/application/memory-agent";
import { InMemoryMemoryRepository } from "../../../memory-agent/src/infrastructure/in-memory-repository";
import { JsonNarrativeMemoryExtractor } from "../../../memory-agent/src/adapters/json-narrative-memory-extractor";
import { PlaceholderPortraitAdapter } from "../../../memory-agent/src/adapters/placeholder-portrait-adapter";
import { extractionResultSchema } from "../../../memory-agent/src/contracts";
import { normalizeName, type ExtractionResult, type ProcessTurnInput } from "../../../memory-agent/src/domain";
import { OrchestrationError, type StorySession, type MemoryCommand } from "./contracts";

export { extractionResultSchema };

/** Replay validated extraction records, never replay paid model calls. Stable IDs survive restart. */
export async function restoreMemory(session: StorySession, verify = false) {
  const repository = new InMemoryMemoryRepository();
  const storyId = session.snapshot.world.story_id;
  const seed = session.seed_snapshot ?? session.snapshot;
  const stamp = seed.world.created_at;
  for (const character of seed.characters.characters) {
    await repository.createCharacter({ characterId: character.character_id, storyId, displayName: character.name.value, normalizedName: normalizeName(character.name.value), status: "active", createdAt: stamp, updatedAt: stamp });
    for (const [index, value] of character.aliases.entries()) {
      await repository.createAlias({ aliasId: `alias_${character.character_id}_${index}`, storyId, characterId: character.character_id, value, normalizedValue: normalizeName(value), confirmed: true, createdAt: stamp,
        evidence: { evidenceId: `seed_${character.character_id}_${index}`, storyId, chapterNo: 1, sceneNo: 1, turnId: "seed", sourceKind: "user_confirmation", segmentId: "seed", quote: value, confidence: 1 } });
    }
  }
  let counter = 0;
  const ids = { next: (prefix: string) => prefix + "_" + createHash("sha256").update(`${storyId}:${++counter}`).digest("hex").slice(0, 24) };
  const apply = async (input: ProcessTurnInput, extraction: ExtractionResult, createdAt: string) => {
    const agent = new CharacterMemoryAgent(repository, new JsonNarrativeMemoryExtractor(() => extraction), new PlaceholderPortraitAdapter(), ids, { now: () => createdAt });
    return agent.processTurn(input);
  };
  const refreshPortraits = async (characterIds: string[], stamp: string) => {
    const version = await repository.getMemoryVersion(storyId), adapter = new PlaceholderPortraitAdapter();
    for (const characterId of characterIds) {
      const character = await repository.getCharacter(characterId); if (!character) continue;
      await repository.savePortrait({ snapshotId: ids.next("portrait"), storyId, characterId, memoryVersion: version, schemaVersion: adapter.schemaVersion, createdAt: stamp, portrait: adapter.project({ character, aliases: await repository.listAliases(characterId), activeFacts: await repository.listActiveFacts(characterId), events: await repository.listEvents(characterId), relationships: await repository.listRelationships(characterId), memoryVersion: version }) });
    }
  };
  const maintain = async (command: MemoryCommand, operationId: string, stamp: string) => {
    const service = new MemoryMaintenanceService(repository, new PlaceholderPortraitAdapter(), ids, { now: () => stamp });
    if (command.kind === "acknowledge") return service.markNotificationStatus(storyId, command.notification_id, "acknowledged");
    if (command.kind === "resolve_fact") {
      const state = repository.exportCheckpoint();
      const conflict = state.conflicts.find(c => c.conflictId === command.conflict_id && c.storyId === storyId && c.type === "fact_conflict" && c.status === "pending");
      const chosen = state.facts.find(f => f.factId === command.fact_id && f.storyId === storyId);
      if (!command.confirmed || !command.reason.trim() || !conflict || !chosen || !conflict.evidenceIds.includes(chosen.evidence.evidenceId)) throw new OrchestrationError("invalid_resolution", "所选事实不属于该未决冲突。", 400);
      const version = await repository.getMemoryVersion(storyId) + 1;
      const factId = ids.next("fact");
      for (const fact of state.facts) if (fact.characterId === chosen.characterId && fact.key === chosen.key && fact.status !== "superseded") { fact.status = "superseded"; fact.validUntilVersion = version; fact.supersededByFactId = factId; }
      state.facts.push({ ...chosen, factId, inference: false, confidence: 1, authority: 100, status: "active", validFromVersion: version, validUntilVersion: undefined, supersededByFactId: undefined, createdAt: stamp, evidence: { ...chosen.evidence, evidenceId: ids.next("evidence"), turnId: operationId, segmentId: "user_resolution", quote: chosen.value + "；确认依据：" + command.reason, sourceKind: "user_confirmation", confidence: 1 } });
      conflict.status = "resolved"; conflict.resolvedAt = stamp;
      state.versions = [[storyId, version]];
      repository.restoreCheckpoint(state);
      await refreshPortraits([chosen.characterId], stamp);
      return;
    }
    if (!command.confirmed || !command.reason.trim() || command.source === command.target) throw new OrchestrationError("invalid_correction", "请确认两个不同人物与修正原因。", 400);
    const source = await repository.getCharacter(command.source), target = await repository.getCharacter(command.target);
    if (!source || !target || source.storyId !== storyId || target.storyId !== storyId) throw new OrchestrationError("invalid_correction", "人物不属于当前故事。", 400);
    const version = await repository.getMemoryVersion(storyId);
    if (command.kind === "merge") {
      if (source.status !== "active" || target.status !== "active") throw new OrchestrationError("invalid_correction", "只能合并两个有效人物。", 400);
      await repository.mergeCharacters(command.source, command.target, version + 1);
      await repository.setMemoryVersion(storyId, version + 1);
      await refreshPortraits([command.source, command.target], stamp);
    } else {
      const state = repository.snapshot();
      if (command.assignments.factIds.some(id => !state.facts.some(x => x.factId === id && x.characterId === command.target)) || command.assignments.aliasIds.some(id => !state.aliases.some(x => x.aliasId === id && x.characterId === command.target)) || command.assignments.eventIds.some(id => !state.events.some(x => x.eventId === id && x.participantIds.includes(command.target))) || command.assignments.relationshipEndpoints.some(item => !state.relationships.some(x => x.relationshipId === item.relationshipId && (item.endpoint === "from" ? x.fromCharacterId : x.toCharacterId) === command.target))) throw new OrchestrationError("invalid_assignment", "所选记忆不属于待拆分人物。", 400);
      await service.splitIncorrectMerge({ requestId: operationId, storyId, sourceMergedCharacterId: command.source, currentCanonicalCharacterId: command.target, previousMemoryVersion: version, reason: command.reason, userConfirmed: true, assignments: command.assignments });
    }
  };
  const savedCheckpoint = session.memory_checkpoint;
  if (savedCheckpoint) { repository.restoreCheckpoint(savedCheckpoint.state); counter = savedCheckpoint.counter; }
  const actions = session.memory_actions ?? [];
  let actionIndex = savedCheckpoint?.action_count ?? 0;
  for (let index = savedCheckpoint?.turn_count ?? 0; index <= session.memory_journal.length; index++) {
    while (actions[actionIndex]?.after_turn === index) {
      const action = actions[actionIndex++]; await maintain(action.command, action.operation_id, action.created_at);
    }
    const entry = session.memory_journal[index];
    if (entry) {
      if (verify) validateExtraction(entry.extraction, entry.input.narrative.text, new Set((await repository.getExtractionContext(storyId)).characters.map(c => c.characterId)));
      await apply(entry.input, entry.extraction, entry.created_at);
    }
  }
  for (const character of session.snapshot.characters.characters) {
    if (!await repository.getCharacter(character.character_id)) await repository.createCharacter({ characterId: character.character_id, storyId, displayName: character.name.value, normalizedName: normalizeName(character.name.value), status: "active", createdAt: stamp, updatedAt: stamp });
  }
  const checkpoint = () => {
    const state = repository.exportCheckpoint();
    // Full per-turn results remain in session.turns / memory_journal. Cache only latest projections.
    const latest = new Map(state.portraits.map(portrait => [portrait.characterId, portrait]));
    state.portraits = [...latest.values()];
    state.processedTurns = state.processedTurns.slice(-1);
    return { turn_count: session.memory_journal.length, action_count: actions.length, counter, state };
  };
  return { repository, apply, maintain, checkpoint };

}

export function validateExtraction(raw: unknown, text: string, knownIds: Set<string>): ExtractionResult {
  const evidenceIssues: string[] = [];
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    for (const key of ["mentions", "events", "facts", "relationships", "identities"]) {
      const items = record[key]; if (!Array.isArray(items)) continue;
      for (const [index, item] of items.entries()) {
        const evidence = item?.evidence;
        if (typeof evidence?.quote === "string" && !text.includes(evidence.quote)) {
          // Correct typography only when it maps to one exact contiguous source span.
          const typography = (value: string) => value.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
          const candidate = typography(evidence.quote.replace(/\\(["'\\])/g, "$1"));
          const source = typography(text), at = candidate ? source.indexOf(candidate) : -1;
          if (at >= 0 && source.indexOf(candidate, at + 1) < 0) evidence.quote = text.slice(at, at + candidate.length);
        }
        if (typeof evidence?.quote === "string" && (!text.includes(evidence.quote) || evidence.segmentId !== "prose")) evidenceIssues.push(`/${key}/${index}/evidence：${JSON.stringify(evidence.quote)}`);
      }
    }
  }
  if (evidenceIssues.length) throw new OrchestrationError("memory_evidence_invalid", "以下 quote 不是正文中的连续逐字引文；请删除无证据条目或换成原文短片段，segmentId=prose：" + evidenceIssues.join("；"), 422);
  const extraction = extractionResultSchema.parse(raw);
  const refs = new Set(extraction.mentions.map(item => item.ref));
  const invalid = (message: string): never => { throw new OrchestrationError("memory_evidence_invalid", message, 422); };
  if (refs.size !== extraction.mentions.length) invalid("人物抽取的 ref 重复。");
  for (const item of [...extraction.mentions, ...extraction.events, ...extraction.facts, ...extraction.relationships, ...extraction.identities]) {
    if (!text.includes(item.evidence.quote) || item.evidence.segmentId !== "prose") invalid("记忆证据必须是正文的连续逐字片段，不能拼接或改写。问题 quote：" + JSON.stringify(item.evidence.quote) + "；segmentId 必须为 prose。请删除无证据条目或换成真实的短引文。");
    if (item.evidence.sourceKind === "user_confirmation") invalid("模型不能自行授予用户确认权限。");
  }
  for (const mention of extraction.mentions) if (mention.characterIdHint && !knownIds.has(mention.characterIdHint)) invalid("人物抽取引用未知角色 ID。");
  const referenced = [
    ...extraction.events.flatMap(item => item.participantRefs), ...extraction.facts.map(item => item.subjectRef),
    ...extraction.relationships.flatMap(item => [item.fromRef, item.toRef]), ...extraction.identities.flatMap(item => [item.leftRef, item.rightRef]),
  ];
  if (referenced.some(ref => !refs.has(ref))) invalid("记忆抽取引用未声明的人物 ref。");
  for (const fact of extraction.facts) if (fact.inference && fact.evidence.sourceKind !== "agent_inference") invalid("推断事实必须标注为 agent_inference。");
  return extraction;
}
