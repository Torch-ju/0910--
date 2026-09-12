import {
  unique,
  type AliasRecord,
  type CharacterRecord,
  type ConflictRecord,
  type CorrectionRecord,
  type EventRecord,
  type FactRecord,
  type PortraitSnapshot,
  type ProcessedTurnRecord,
  type RelationshipRecord,
  type RetrievalQuery,
  type RetrievedMemory,
  type SplitCharacterInput,
  type UserNotification,
} from "../domain.js";
import type { ExtractionContext, MemoryRepository, MemoryTransaction } from "../ports.js";

interface MemoryState {
  versions: Map<string, number>;
  processedTurns: ProcessedTurnRecord[];
  characters: CharacterRecord[];
  aliases: AliasRecord[];
  events: EventRecord[];
  facts: FactRecord[];
  relationships: RelationshipRecord[];
  conflicts: ConflictRecord[];
  corrections: CorrectionRecord[];
  notifications: UserNotification[];
  portraits: PortraitSnapshot[];
  identityChanges: Array<{
    storyId: string;
    type: "merge" | "split";
    sourceCharacterIds: string[];
    targetCharacterIds: string[];
    memoryVersion: number;
    reason: string;
  }>;
}

function emptyState(): MemoryState {
  return {
    versions: new Map(),
    processedTurns: [],
    characters: [],
    aliases: [],
    events: [],
    facts: [],
    relationships: [],
    conflicts: [],
    corrections: [],
    notifications: [],
    portraits: [],
    identityChanges: [],
  };
}

export class InMemoryMemoryRepository implements MemoryRepository, MemoryTransaction {
  private state = emptyState();
  private transactionTail: Promise<void> = Promise.resolve();

  async transaction<T>(_storyId: string, operation: (tx: MemoryTransaction) => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let release = (): void => undefined;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const backup = structuredClone(this.state);
    try {
      return await operation(this);
    } catch (error) {
      this.state = backup;
      throw error;
    } finally {
      release();
    }
  }

  async findProcessedTurn(
    storyId: string,
    requestId: string,
    turnId: string,
  ): Promise<ProcessedTurnRecord | undefined> {
    return this.state.processedTurns.find(
      (item) =>
        item.storyId === storyId && (item.requestId === requestId || item.turnId === turnId),
    );
  }

  async getExtractionContext(storyId: string): Promise<ExtractionContext> {
    const characters = this.state.characters
      .filter((item) => item.storyId === storyId && item.status !== "merged" && item.status !== "invalid")
      .map((character) => {
        const facts = this.state.facts.filter(
          (fact) => fact.characterId === character.characterId && fact.status === "active",
        );
        return {
          characterId: character.characterId,
          displayName: character.displayName,
          aliases: this.state.aliases
            .filter((alias) => alias.characterId === character.characterId && alias.confirmed)
            .map((alias) => alias.value),
          currentFacts: facts.reduce<Record<string, string[]>>((result, fact) => {
            result[fact.key] = unique([...(result[fact.key] ?? []), fact.value]);
            return result;
          }, {}),
        };
      });
    return {
      memoryVersion: this.state.versions.get(storyId) ?? 0,
      characters,
      recentEvents: this.state.events
        .filter((event) => event.storyId === storyId)
        .slice(-30)
        .reverse()
        .map((event) => ({
          eventId: event.eventId,
          summary: event.summary,
          participantIds: event.participantIds,
        })),
      pendingConflicts: this.state.conflicts.filter(
        (conflict) => conflict.storyId === storyId && conflict.status === "pending",
      ),
    };
  }

  async getMemoryVersion(storyId: string): Promise<number> {
    return this.state.versions.get(storyId) ?? 0;
  }

  async setMemoryVersion(storyId: string, version: number): Promise<void> {
    this.state.versions.set(storyId, version);
  }

  async listCharacters(storyId: string): Promise<CharacterRecord[]> {
    return this.state.characters.filter((character) => character.storyId === storyId);
  }

  async getCharacter(characterId: string): Promise<CharacterRecord | undefined> {
    return this.state.characters.find((character) => character.characterId === characterId);
  }

  async findCharactersByName(storyId: string, normalizedName: string): Promise<CharacterRecord[]> {
    const directIds = this.state.characters
      .filter(
        (character) =>
          character.storyId === storyId &&
          character.normalizedName === normalizedName &&
          character.status !== "merged" &&
          character.status !== "invalid",
      )
      .map((character) => character.characterId);
    const aliasIds = this.state.aliases
      .filter(
        (alias) =>
          alias.storyId === storyId &&
          alias.normalizedValue === normalizedName &&
          alias.confirmed,
      )
      .map((alias) => alias.characterId);
    const ids = new Set([...directIds, ...aliasIds]);
    return this.state.characters.filter((character) => ids.has(character.characterId));
  }

  async createCharacter(character: CharacterRecord): Promise<void> {
    this.state.characters.push(structuredClone(character));
  }

  async updateCharacter(character: CharacterRecord): Promise<void> {
    const index = this.state.characters.findIndex((item) => item.characterId === character.characterId);
    if (index < 0) throw new Error(`Character not found: ${character.characterId}`);
    this.state.characters[index] = structuredClone(character);
  }

  async listAliases(characterId: string): Promise<AliasRecord[]> {
    return this.state.aliases.filter((alias) => alias.characterId === characterId);
  }

  async createAlias(alias: AliasRecord): Promise<void> {
    this.state.aliases.push(structuredClone(alias));
  }

  async appendEvent(event: EventRecord): Promise<void> {
    this.state.events.push(structuredClone(event));
  }

  async listEvents(characterId: string, limit = 100): Promise<EventRecord[]> {
    return this.state.events
      .filter((event) => event.participantIds.includes(characterId))
      .sort((left, right) => left.memoryVersion - right.memoryVersion)
      .slice(-limit);
  }

  async listActiveFacts(characterId: string, key?: string): Promise<FactRecord[]> {
    return this.state.facts.filter(
      (fact) =>
        fact.characterId === characterId &&
        fact.status === "active" &&
        (key === undefined || fact.key === key),
    );
  }

  async createFact(fact: FactRecord): Promise<void> {
    this.state.facts.push(structuredClone(fact));
  }

  async updateFact(fact: FactRecord): Promise<void> {
    const index = this.state.facts.findIndex((item) => item.factId === fact.factId);
    if (index < 0) throw new Error(`Fact not found: ${fact.factId}`);
    this.state.facts[index] = structuredClone(fact);
  }

  async findRelationship(
    storyId: string,
    fromCharacterId: string,
    toCharacterId: string,
    type: string,
  ): Promise<RelationshipRecord | undefined> {
    return this.state.relationships.find(
      (relationship) =>
        relationship.storyId === storyId &&
        relationship.fromCharacterId === fromCharacterId &&
        relationship.toCharacterId === toCharacterId &&
        relationship.type === type &&
        relationship.status === "active",
    );
  }

  async saveRelationship(relationship: RelationshipRecord): Promise<void> {
    const index = this.state.relationships.findIndex(
      (item) => item.relationshipId === relationship.relationshipId,
    );
    if (index < 0) this.state.relationships.push(structuredClone(relationship));
    else this.state.relationships[index] = structuredClone(relationship);
  }

  async listRelationships(characterId: string): Promise<RelationshipRecord[]> {
    return this.state.relationships.filter(
      (relationship) =>
        relationship.status === "active" &&
        (relationship.fromCharacterId === characterId ||
          relationship.toCharacterId === characterId),
    );
  }

  async createConflict(conflict: ConflictRecord): Promise<void> {
    this.state.conflicts.push(structuredClone(conflict));
  }

  async createCorrection(correction: CorrectionRecord): Promise<void> {
    this.state.corrections.push(structuredClone(correction));
  }

  async createNotification(notification: UserNotification): Promise<void> {
    this.state.notifications.push(structuredClone(notification));
  }

  async savePortrait(snapshot: PortraitSnapshot): Promise<void> {
    this.state.portraits.push(structuredClone(snapshot));
  }

  async getLatestPortrait(characterId: string): Promise<PortraitSnapshot | undefined> {
    return this.state.portraits
      .filter((snapshot) => snapshot.characterId === characterId)
      .sort((left, right) => right.memoryVersion - left.memoryVersion)[0];
  }

  async mergeCharacters(
    sourceCharacterId: string,
    targetCharacterId: string,
    memoryVersion: number,
  ): Promise<void> {
    if (sourceCharacterId === targetCharacterId) return;
    const source = await this.getCharacter(sourceCharacterId);
    const target = await this.getCharacter(targetCharacterId);
    if (!source || !target) throw new Error("Cannot merge missing characters");

    await this.updateCharacter({
      ...source,
      status: "merged",
      mergedIntoCharacterId: targetCharacterId,
      updatedAt: new Date().toISOString(),
    });
    this.state.aliases = this.state.aliases.map((alias) =>
      alias.characterId === sourceCharacterId
        ? { ...alias, characterId: targetCharacterId }
        : alias,
    );
    this.state.facts = this.state.facts.map((fact) =>
      fact.characterId === sourceCharacterId
        ? { ...fact, characterId: targetCharacterId }
        : fact,
    );
    this.state.events = this.state.events.map((event) => ({
      ...event,
      participantIds: unique(
        event.participantIds.map((id) => (id === sourceCharacterId ? targetCharacterId : id)),
      ),
    }));
    this.state.relationships = this.state.relationships
      .map((relationship) => ({
        ...relationship,
        fromCharacterId:
          relationship.fromCharacterId === sourceCharacterId
            ? targetCharacterId
            : relationship.fromCharacterId,
        toCharacterId:
          relationship.toCharacterId === sourceCharacterId
            ? targetCharacterId
            : relationship.toCharacterId,
      }))
      .filter((relationship) => relationship.fromCharacterId !== relationship.toCharacterId);
    this.state.identityChanges.push({
      storyId: source.storyId,
      type: "merge",
      sourceCharacterIds: [sourceCharacterId],
      targetCharacterIds: [targetCharacterId],
      memoryVersion,
      reason: "Authorized narration, explicit identity reveal, or user confirmation",
    });
  }

  async splitCharacter(input: SplitCharacterInput, memoryVersion: number): Promise<void> {
    if (input.sourceMergedCharacterId === input.currentCanonicalCharacterId) {
      throw new Error("Split source and canonical character must differ");
    }
    const source = await this.getCharacter(input.sourceMergedCharacterId);
    const target = await this.getCharacter(input.currentCanonicalCharacterId);
    if (!source || !target) throw new Error("Cannot split missing characters");
    if (source.status !== "merged" || source.mergedIntoCharacterId !== target.characterId) {
      throw new Error("Split source is not merged into the supplied canonical character");
    }

    const restored: CharacterRecord = {
      characterId: source.characterId,
      storyId: source.storyId,
      displayName: source.displayName,
      normalizedName: source.normalizedName,
      status: "active",
      createdAt: source.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await this.updateCharacter(restored);

    const factIds = new Set(input.assignments.factIds);
    const aliasIds = new Set(input.assignments.aliasIds);
    const eventIds = new Set(input.assignments.eventIds);
    this.state.facts = this.state.facts.map((fact) =>
      fact.characterId === target.characterId && factIds.has(fact.factId)
        ? { ...fact, characterId: restored.characterId }
        : fact,
    );
    this.state.aliases = this.state.aliases.map((alias) =>
      alias.characterId === target.characterId && aliasIds.has(alias.aliasId)
        ? { ...alias, characterId: restored.characterId }
        : alias,
    );
    this.state.events = this.state.events.map((event) => ({
      ...event,
      participantIds: eventIds.has(event.eventId)
        ? unique(
            event.participantIds.map((id) =>
              id === target.characterId ? restored.characterId : id,
            ),
          )
        : event.participantIds,
    }));
    const endpoints = new Map(
      input.assignments.relationshipEndpoints.map((item) => [
        `${item.relationshipId}:${item.endpoint}`,
        true,
      ]),
    );
    this.state.relationships = this.state.relationships.map((relationship) => ({
      ...relationship,
      fromCharacterId: endpoints.has(`${relationship.relationshipId}:from`)
        ? restored.characterId
        : relationship.fromCharacterId,
      toCharacterId: endpoints.has(`${relationship.relationshipId}:to`)
        ? restored.characterId
        : relationship.toCharacterId,
    }));
    this.state.identityChanges.push({
      storyId: input.storyId,
      type: "split",
      sourceCharacterIds: [target.characterId],
      targetCharacterIds: [target.characterId, restored.characterId],
      memoryVersion,
      reason: input.reason,
    });
  }

  async saveProcessedTurn(record: ProcessedTurnRecord): Promise<void> {
    this.state.processedTurns.push(structuredClone(record));
  }

  async search(query: RetrievalQuery): Promise<RetrievedMemory[]> {
    const limit = query.limit ?? 20;
    const terms = query.queryText
      .toLocaleLowerCase("zh-CN")
      .split(/[\s，。！？、；：,.!?;:]+/)
      .filter(Boolean);
    const characterIds = new Set(query.currentCharacterIds ?? []);
    const scoreText = (text: string): number => {
      if (terms.length === 0) return 0;
      const normalized = text.toLocaleLowerCase("zh-CN");
      return terms.filter((term) => normalized.includes(term)).length / terms.length;
    };

    const results: RetrievedMemory[] = [];
    for (const portrait of this.state.portraits.filter(
      (item) => item.storyId === query.storyId &&
        this.state.portraits.every(
          (other) =>
            other.characterId !== item.characterId || other.memoryVersion <= item.memoryVersion,
        ),
    )) {
      const currentBoost = characterIds.has(portrait.characterId) ? 0.6 : 0;
      results.push({
        memoryType: "portrait",
        memoryId: portrait.snapshotId,
        content: portrait,
        score: Math.min(1, currentBoost + scoreText(JSON.stringify(portrait.portrait))),
        reason: currentBoost > 0 ? ["current_character", "latest_portrait"] : ["latest_portrait"],
      });
    }
    for (const event of this.state.events.filter((item) => item.storyId === query.storyId)) {
      const characterBoost = event.participantIds.some((id) => characterIds.has(id)) ? 0.35 : 0;
      const score = Math.min(1, scoreText(event.summary) * 0.55 + event.importance * 0.1 + characterBoost);
      if (score > 0) {
        results.push({
          memoryType: "event",
          memoryId: event.eventId,
          content: event,
          score,
          reason: characterBoost > 0 ? ["character_overlap", "semantic_match"] : ["semantic_match"],
        });
      }
    }
    for (const relationship of this.state.relationships.filter(
      (item) => item.storyId === query.storyId && item.isImportant,
    )) {
      const characterBoost =
        characterIds.has(relationship.fromCharacterId) || characterIds.has(relationship.toCharacterId)
          ? 0.4
          : 0;
      const score = Math.min(
        1,
        scoreText(`${relationship.type} ${relationship.description}`) * 0.5 +
          relationship.importance * 0.1 +
          characterBoost,
      );
      if (score > 0) {
        results.push({
          memoryType: "relationship",
          memoryId: relationship.relationshipId,
          content: relationship,
          score,
          reason: characterBoost > 0 ? ["character_overlap", "important_relationship"] : ["important_relationship"],
        });
      }
    }
    for (const conflict of this.state.conflicts.filter(
      (item) => item.storyId === query.storyId && item.status === "pending",
    )) {
      const characterBoost = conflict.characterIds.some((id) => characterIds.has(id)) ? 0.5 : 0;
      results.push({
        memoryType: "conflict",
        memoryId: conflict.conflictId,
        content: conflict,
        score: Math.min(1, 0.4 + characterBoost + scoreText(conflict.description) * 0.1),
        reason: ["unresolved_conflict"],
      });
    }
    return results.sort((left, right) => right.score - left.score).slice(0, limit);
  }

  async listPendingNotifications(storyId: string): Promise<UserNotification[]> {
    return this.state.notifications.filter(
      (notification) => notification.storyId === storyId && notification.status === "pending",
    );
  }

  async updateNotificationStatus(
    storyId: string,
    notificationId: string,
    status: "delivered" | "acknowledged",
  ): Promise<void> {
    const index = this.state.notifications.findIndex(
      (notification) =>
        notification.storyId === storyId && notification.notificationId === notificationId,
    );
    if (index < 0 || !this.state.notifications[index]) {
      throw new Error(`Notification not found: ${notificationId}`);
    }
    this.state.notifications[index] = {
      ...this.state.notifications[index],
      status,
    };
  }

  // Intended for tests and administrative diagnostics only.
  snapshot(): Readonly<MemoryState> {
    return structuredClone(this.state);
  }
}
