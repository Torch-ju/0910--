import type {
  AliasRecord,
  CharacterRecord,
  ConflictRecord,
  CorrectionRecord,
  EventRecord,
  ExtractionResult,
  FactRecord,
  PortraitProjectionContext,
  PortraitSnapshot,
  ProcessedTurnRecord,
  ProcessTurnInput,
  RelationshipRecord,
  RetrievalQuery,
  RetrievedMemory,
  SplitCharacterInput,
  UserNotification,
} from "./domain.js";

export interface ExtractionContext {
  memoryVersion: number;
  characters: Array<{
    characterId: string;
    displayName: string;
    aliases: string[];
    currentFacts: Record<string, string[]>;
  }>;
  recentEvents: Array<{
    eventId: string;
    summary: string;
    participantIds: string[];
  }>;
  pendingConflicts: ConflictRecord[];
}

export interface NarrativeMemoryExtractor {
  extract(input: ProcessTurnInput, context: ExtractionContext): Promise<ExtractionResult>;
}

export interface PortraitSchemaAdapter<TPortrait = unknown> {
  readonly schemaVersion: string;
  project(context: PortraitProjectionContext): TPortrait;
}

export interface MemoryTransaction {
  getMemoryVersion(storyId: string): Promise<number>;
  findProcessedTurn(storyId: string, requestId: string, turnId: string): Promise<ProcessedTurnRecord | undefined>;
  listCharacters(storyId: string): Promise<CharacterRecord[]>;
  getCharacter(characterId: string): Promise<CharacterRecord | undefined>;
  findCharactersByName(storyId: string, normalizedName: string): Promise<CharacterRecord[]>;
  createCharacter(character: CharacterRecord): Promise<void>;
  updateCharacter(character: CharacterRecord): Promise<void>;
  listAliases(characterId: string): Promise<AliasRecord[]>;
  createAlias(alias: AliasRecord): Promise<void>;
  appendEvent(event: EventRecord): Promise<void>;
  listEvents(characterId: string, limit?: number): Promise<EventRecord[]>;
  listActiveFacts(characterId: string, key?: string): Promise<FactRecord[]>;
  createFact(fact: FactRecord): Promise<void>;
  updateFact(fact: FactRecord): Promise<void>;
  findRelationship(
    storyId: string,
    fromCharacterId: string,
    toCharacterId: string,
    type: string,
  ): Promise<RelationshipRecord | undefined>;
  saveRelationship(relationship: RelationshipRecord): Promise<void>;
  listRelationships(characterId: string): Promise<RelationshipRecord[]>;
  createConflict(conflict: ConflictRecord): Promise<void>;
  createCorrection(correction: CorrectionRecord): Promise<void>;
  createNotification(notification: UserNotification): Promise<void>;
  savePortrait(snapshot: PortraitSnapshot): Promise<void>;
  getLatestPortrait(characterId: string): Promise<PortraitSnapshot | undefined>;
  mergeCharacters(
    sourceCharacterId: string,
    targetCharacterId: string,
    memoryVersion: number,
  ): Promise<void>;
  splitCharacter(input: SplitCharacterInput, memoryVersion: number): Promise<void>;
  setMemoryVersion(storyId: string, version: number): Promise<void>;
  saveProcessedTurn(record: ProcessedTurnRecord): Promise<void>;
}

export interface MemoryRepository {
  transaction<T>(storyId: string, operation: (tx: MemoryTransaction) => Promise<T>): Promise<T>;
  findProcessedTurn(
    storyId: string,
    requestId: string,
    turnId: string,
  ): Promise<ProcessedTurnRecord | undefined>;
  getExtractionContext(storyId: string): Promise<ExtractionContext>;
  getLatestPortrait(characterId: string): Promise<PortraitSnapshot | undefined>;
  listEvents(characterId: string, limit?: number): Promise<EventRecord[]>;
  listRelationships(characterId: string): Promise<RelationshipRecord[]>;
  search(query: RetrievalQuery): Promise<RetrievedMemory[]>;
  listPendingNotifications(storyId: string): Promise<UserNotification[]>;
  updateNotificationStatus(
    storyId: string,
    notificationId: string,
    status: "delivered" | "acknowledged",
  ): Promise<void>;
}

export interface IdGenerator {
  next(prefix: string): string;
}

export interface Clock {
  now(): string;
}
