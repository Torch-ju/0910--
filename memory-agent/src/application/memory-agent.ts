import { randomUUID } from "node:crypto";

import { extractionResultSchema, processTurnInputSchema } from "../contracts.js";
import {
  normalizeName,
  unique,
  type CharacterMention,
  type CharacterRecord,
  type ConflictRecord,
  type CorrectionRecord,
  type Evidence,
  type EvidenceInput,
  type FactObservation,
  type FactRecord,
  type IdentityObservation,
  type PortraitSnapshot,
  type ProcessedTurnRecord,
  type ProcessTurnInput,
  type ProcessTurnResult,
  type RelationshipRecord,
  type UserNotification,
} from "../domain.js";
import type {
  Clock,
  IdGenerator,
  MemoryRepository,
  MemoryTransaction,
  NarrativeMemoryExtractor,
  PortraitSchemaAdapter,
} from "../ports.js";
import {
  canConfirmIdentity,
  isImportantRelationship,
  shouldAutomaticallySupersedeFact,
  sourceAuthority,
} from "../policies.js";

export class MemoryVersionConflictError extends Error {
  constructor(expected: number, actual: number) {
    super(`Memory version conflict: expected ${expected}, actual ${actual}`);
    this.name = "MemoryVersionConflictError";
  }
}

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class UuidGenerator implements IdGenerator {
  next(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }
}

interface TurnAccumulator {
  affectedCharacterIds: Set<string>;
  appendedEventIds: string[];
  relationshipIds: string[];
  conflictIds: string[];
  notifications: UserNotification[];
}

export class CharacterMemoryAgent<TPortrait = unknown> {
  constructor(
    private readonly repository: MemoryRepository,
    private readonly extractor: NarrativeMemoryExtractor,
    private readonly portraitAdapter: PortraitSchemaAdapter<TPortrait>,
    private readonly ids: IdGenerator = new UuidGenerator(),
    private readonly clock: Clock = new SystemClock(),
  ) {}

  async processTurn(rawInput: ProcessTurnInput): Promise<ProcessTurnResult<TPortrait>> {
    const input = processTurnInputSchema.parse(rawInput) as ProcessTurnInput;
    const replay = await this.repository.findProcessedTurn(input.storyId, input.requestId, input.turnId);
    if (replay) return { ...(replay.result as ProcessTurnResult<TPortrait>), idempotentReplay: true };

    const context = await this.repository.getExtractionContext(input.storyId);
    const extraction = extractionResultSchema.parse(
      await this.extractor.extract(input, context),
    );

    return this.repository.transaction(input.storyId, async (tx) => {
      const duplicate = await tx.findProcessedTurn(input.storyId, input.requestId, input.turnId);
      if (duplicate) {
        return { ...(duplicate.result as ProcessTurnResult<TPortrait>), idempotentReplay: true };
      }

      const currentVersion = await tx.getMemoryVersion(input.storyId);
      if (
        input.previousMemoryVersion !== undefined &&
        input.previousMemoryVersion !== currentVersion
      ) {
        throw new MemoryVersionConflictError(input.previousMemoryVersion, currentVersion);
      }
      const memoryVersion = currentVersion + 1;
      const accumulator: TurnAccumulator = {
        affectedCharacterIds: new Set(),
        appendedEventIds: [],
        relationshipIds: [],
        conflictIds: [],
        notifications: [],
      };

      const refToCharacterId = new Map<string, string>();
      for (const mention of extraction.mentions) {
        const character = await this.resolveMention(tx, input, mention, accumulator);
        refToCharacterId.set(mention.ref, character.characterId);
        accumulator.affectedCharacterIds.add(character.characterId);
      }

      for (const identity of extraction.identities) {
        await this.applyIdentityObservation(
          tx,
          input,
          identity,
          refToCharacterId,
          memoryVersion,
          accumulator,
        );
      }

      for (const event of extraction.events) {
        const participantIds = unique(
          event.participantRefs
            .map((ref) => refToCharacterId.get(ref))
            .filter((id): id is string => id !== undefined),
        );
        if (participantIds.length === 0) continue;
        const eventId = this.ids.next("evt");
        await tx.appendEvent({
          eventId,
          eventKey: event.eventKey,
          storyId: input.storyId,
          summary: event.summary,
          participantIds,
          importance: event.importance,
          evidence: this.buildEvidence(input, event.evidence),
          memoryVersion,
          createdAt: this.clock.now(),
        });
        accumulator.appendedEventIds.push(eventId);
        participantIds.forEach((id) => accumulator.affectedCharacterIds.add(id));
      }

      for (const fact of extraction.facts) {
        const characterId = refToCharacterId.get(fact.subjectRef);
        if (!characterId) continue;
        await this.applyFactObservation(
          tx,
          input,
          characterId,
          fact,
          memoryVersion,
          accumulator,
        );
      }

      for (const relationship of extraction.relationships) {
        const fromCharacterId = refToCharacterId.get(relationship.fromRef);
        const toCharacterId = refToCharacterId.get(relationship.toRef);
        if (!fromCharacterId || !toCharacterId || fromCharacterId === toCharacterId) continue;

        const existing = await tx.findRelationship(
          input.storyId,
          fromCharacterId,
          toCharacterId,
          relationship.type,
        );
        const record: RelationshipRecord = {
          relationshipId: existing?.relationshipId ?? this.ids.next("rel"),
          storyId: input.storyId,
          fromCharacterId,
          toCharacterId,
          type: relationship.type,
          description: relationship.description,
          importance: Math.max(existing?.importance ?? 0, relationship.importance),
          occurrenceCount: (existing?.occurrenceCount ?? 0) + 1,
          isImportant: isImportantRelationship(relationship, existing),
          status: "active",
          evidence: [
            ...(existing?.evidence ?? []),
            this.buildEvidence(input, relationship.evidence),
          ],
          updatedAt: this.clock.now(),
        };
        await tx.saveRelationship(record);
        accumulator.relationshipIds.push(record.relationshipId);
        accumulator.affectedCharacterIds.add(fromCharacterId);
        accumulator.affectedCharacterIds.add(toCharacterId);
      }

      const activeAffectedIds = unique(
        await Promise.all(
          [...accumulator.affectedCharacterIds].map(async (id) => {
            const character = await tx.getCharacter(id);
            return character?.mergedIntoCharacterId ?? id;
          }),
        ),
      );
      const portraits: Array<PortraitSnapshot<TPortrait>> = [];
      for (const characterId of activeAffectedIds) {
        const character = await tx.getCharacter(characterId);
        if (!character || character.status === "merged" || character.status === "invalid") continue;
        const snapshot: PortraitSnapshot<TPortrait> = {
          snapshotId: this.ids.next("portrait"),
          storyId: input.storyId,
          characterId,
          memoryVersion,
          schemaVersion: this.portraitAdapter.schemaVersion,
          portrait: this.portraitAdapter.project({
            character,
            aliases: await tx.listAliases(characterId),
            activeFacts: await tx.listActiveFacts(characterId),
            events: await tx.listEvents(characterId),
            relationships: await tx.listRelationships(characterId),
            memoryVersion,
          }),
          createdAt: this.clock.now(),
        };
        await tx.savePortrait(snapshot);
        portraits.push(snapshot);
      }

      await tx.setMemoryVersion(input.storyId, memoryVersion);
      const result: ProcessTurnResult<TPortrait> = {
        storyId: input.storyId,
        turnId: input.turnId,
        requestId: input.requestId,
        memoryVersion,
        idempotentReplay: false,
        affectedCharacterIds: activeAffectedIds,
        portraits,
        appendedEventIds: accumulator.appendedEventIds,
        relationshipIds: unique(accumulator.relationshipIds),
        conflictIds: accumulator.conflictIds,
        notifications: accumulator.notifications,
      };
      const processedRecord: ProcessedTurnRecord = {
        storyId: input.storyId,
        turnId: input.turnId,
        requestId: input.requestId,
        memoryVersion,
        result: result as ProcessTurnResult<unknown>,
        createdAt: this.clock.now(),
      };
      await tx.saveProcessedTurn(processedRecord);
      return result;
    });
  }

  getLatestPortrait(characterId: string): Promise<PortraitSnapshot | undefined> {
    return this.repository.getLatestPortrait(characterId);
  }

  getCharacterHistory(characterId: string, limit?: number) {
    return this.repository.listEvents(characterId, limit);
  }

  getCharacterRelationships(characterId: string) {
    return this.repository.listRelationships(characterId);
  }

  searchRelevantMemories(query: Parameters<MemoryRepository["search"]>[0]) {
    return this.repository.search(query);
  }

  private async resolveMention(
    tx: MemoryTransaction,
    input: ProcessTurnInput,
    mention: CharacterMention,
    accumulator: TurnAccumulator,
  ): Promise<CharacterRecord> {
    const normalizedName = normalizeName(mention.displayName);
    const now = this.clock.now();
    const hintedCharacter = mention.characterIdHint
      ? await tx.getCharacter(mention.characterIdHint)
      : undefined;
    if (
      hintedCharacter &&
      (hintedCharacter.storyId !== input.storyId ||
        hintedCharacter.status === "merged" ||
        hintedCharacter.status === "invalid")
    ) {
      throw new Error(`Invalid characterIdHint: ${mention.characterIdHint}`);
    }
    const matches = mention.forceNewIdentity
      ? []
      : await tx.findCharactersByName(input.storyId, normalizedName);
    let character = hintedCharacter ?? (matches.length === 1 ? matches[0] : undefined);
    if (!character) {
      character = {
        characterId: this.ids.next("char"),
        storyId: input.storyId,
        displayName: mention.displayName,
        normalizedName,
        status: mention.provisional || matches.length > 1 ? "provisional" : "active",
        createdAt: now,
        updatedAt: now,
      };
      await tx.createCharacter(character);
    }

    if (!hintedCharacter && !mention.forceNewIdentity && matches.length > 1) {
      const evidence = this.buildEvidence(input, mention.evidence);
      const conflict = this.makeConflict(
        input.storyId,
        "same_name_ambiguity",
        [character.characterId, ...matches.map((item) => item.characterId)],
        `“${mention.displayName}”匹配到多个人物，已创建临时人物，等待旁白证据或用户确认。`,
        [evidence.evidenceId],
      );
      await tx.createConflict(conflict);
      accumulator.conflictIds.push(conflict.conflictId);
      await this.notify(
        tx,
        accumulator,
        input.storyId,
        "identity_needs_confirmation",
        conflict.description,
        conflict.characterIds,
      );
    }

    const existingAliases = await tx.listAliases(character.characterId);
    for (const aliasValue of mention.aliases ?? []) {
      if (
        existingAliases.some(
          (alias) => alias.normalizedValue === normalizeName(aliasValue),
        )
      ) {
        continue;
      }
      const confirmed = canConfirmIdentity(mention.evidence);
      await tx.createAlias({
        aliasId: this.ids.next("alias"),
        storyId: input.storyId,
        characterId: character.characterId,
        value: aliasValue,
        normalizedValue: normalizeName(aliasValue),
        evidence: this.buildEvidence(input, mention.evidence),
        confirmed,
        createdAt: now,
      });
      if (!confirmed) {
        await this.notify(
          tx,
          accumulator,
          input.storyId,
          "identity_needs_confirmation",
          `“${aliasValue}”与“${mention.displayName}”的别名关系缺少旁白、明确身份揭示或用户确认。`,
          [character.characterId],
        );
      }
    }
    return character;
  }

  private async applyIdentityObservation(
    tx: MemoryTransaction,
    input: ProcessTurnInput,
    observation: IdentityObservation,
    refs: Map<string, string>,
    memoryVersion: number,
    accumulator: TurnAccumulator,
  ): Promise<void> {
    const leftId = refs.get(observation.leftRef);
    const rightId = refs.get(observation.rightRef);
    if (!leftId || !rightId || leftId === rightId || observation.relation === "different_person") return;

    if (!canConfirmIdentity(observation.evidence)) {
      const evidence = this.buildEvidence(input, observation.evidence);
      const conflict = this.makeConflict(
        input.storyId,
        "identity_ambiguity",
        [leftId, rightId],
        "人物身份关系只有角色陈述或模型推断，尚不能自动合并。",
        [evidence.evidenceId],
      );
      await tx.createConflict(conflict);
      accumulator.conflictIds.push(conflict.conflictId);
      await this.notify(
        tx,
        accumulator,
        input.storyId,
        "identity_needs_confirmation",
        conflict.description,
        conflict.characterIds,
      );
      return;
    }

    const left = await tx.getCharacter(leftId);
    const right = await tx.getCharacter(rightId);
    if (!left || !right) return;
    const target = observation.relation === "alias_of"
      ? right
      : left.status === "active" && right.status === "provisional"
        ? left
        : right;
    const source = target.characterId === left.characterId ? right : left;
    await tx.createAlias({
      aliasId: this.ids.next("alias"),
      storyId: input.storyId,
      characterId: target.characterId,
      value: source.displayName,
      normalizedValue: normalizeName(source.displayName),
      evidence: this.buildEvidence(input, observation.evidence),
      confirmed: true,
      createdAt: this.clock.now(),
    });
    await tx.mergeCharacters(source.characterId, target.characterId, memoryVersion);
    for (const [ref, characterId] of refs) {
      if (characterId === source.characterId) refs.set(ref, target.characterId);
    }
    accumulator.affectedCharacterIds.add(target.characterId);
  }

  private async applyFactObservation(
    tx: MemoryTransaction,
    input: ProcessTurnInput,
    characterId: string,
    observation: FactObservation,
    memoryVersion: number,
    accumulator: TurnAccumulator,
  ): Promise<void> {
    const activeFacts = await tx.listActiveFacts(characterId, observation.key);
    const conflictingFacts = activeFacts.filter((fact) => fact.value !== observation.value);
    const evidence = this.buildEvidence(input, observation.evidence);
    const fact: FactRecord = {
      factId: this.ids.next("fact"),
      storyId: input.storyId,
      characterId,
      key: observation.key,
      value: observation.value,
      inference: observation.inference,
      confidence: observation.evidence.confidence,
      authority: sourceAuthority(observation.evidence.sourceKind),
      status: "active",
      evidence,
      validFromVersion: memoryVersion,
      createdAt: this.clock.now(),
    };

    if (conflictingFacts.length === 0) {
      await tx.createFact(fact);
      accumulator.affectedCharacterIds.add(characterId);
      return;
    }

    const strongestAuthority = Math.max(...conflictingFacts.map((item) => item.authority));
    const autoCorrect = shouldAutomaticallySupersedeFact(
      observation.evidence,
      strongestAuthority,
      observation.temporal ?? "static",
      observation.correctionIntent ?? false,
    );
    if (autoCorrect) {
      await tx.createFact(fact);
      for (const oldFact of conflictingFacts) {
        await tx.updateFact({
          ...oldFact,
          status: "superseded",
          validUntilVersion: memoryVersion,
          supersededByFactId: fact.factId,
        });
        const correction: CorrectionRecord = {
          correctionId: this.ids.next("correction"),
          storyId: input.storyId,
          characterId,
          oldFactId: oldFact.factId,
          newFactId: fact.factId,
          reason: `新${observation.temporal === "state" ? "状态" : "事实"}由更高或同等级权威证据确认。`,
          automatic: true,
          createdAt: this.clock.now(),
        };
        await tx.createCorrection(correction);
      }
      await this.notify(
        tx,
        accumulator,
        input.storyId,
        "automatic_correction",
        `人物 ${characterId} 的“${observation.key}”已自动更新为“${observation.value}”，旧记录仍保留。`,
        [characterId],
      );
    } else {
      fact.status = "disputed";
      await tx.createFact(fact);
      const conflict = this.makeConflict(
        input.storyId,
        "fact_conflict",
        [characterId],
        `“${observation.key}”出现互相矛盾的信息，当前证据不足以覆盖已有事实。`,
        [evidence.evidenceId, ...conflictingFacts.map((item) => item.evidence.evidenceId)],
      );
      await tx.createConflict(conflict);
      accumulator.conflictIds.push(conflict.conflictId);
      await this.notify(
        tx,
        accumulator,
        input.storyId,
        "memory_conflict",
        conflict.description,
        [characterId],
      );
    }
    accumulator.affectedCharacterIds.add(characterId);
  }

  private buildEvidence(input: ProcessTurnInput, evidence: EvidenceInput): Evidence {
    return {
      evidenceId: this.ids.next("evidence"),
      storyId: input.storyId,
      chapterNo: input.chapterNo,
      sceneNo: input.sceneNo,
      turnId: input.turnId,
      ...(input.storyTime === undefined ? {} : { storyTime: input.storyTime }),
      ...evidence,
    };
  }

  private makeConflict(
    storyId: string,
    type: ConflictRecord["type"],
    characterIds: string[],
    description: string,
    evidenceIds: string[],
  ): ConflictRecord {
    return {
      conflictId: this.ids.next("conflict"),
      storyId,
      type,
      characterIds: unique(characterIds),
      description,
      evidenceIds: unique(evidenceIds),
      status: "pending",
      createdAt: this.clock.now(),
    };
  }

  private async notify(
    tx: MemoryTransaction,
    accumulator: TurnAccumulator,
    storyId: string,
    type: UserNotification["type"],
    message: string,
    relatedCharacterIds: string[],
  ): Promise<void> {
    const notification: UserNotification = {
      notificationId: this.ids.next("notification"),
      storyId,
      type,
      message,
      relatedCharacterIds: unique(relatedCharacterIds),
      status: "pending",
      createdAt: this.clock.now(),
    };
    await tx.createNotification(notification);
    accumulator.notifications.push(notification);
  }
}
