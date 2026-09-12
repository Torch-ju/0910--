export type SourceKind =
  | "narration"
  | "explicit_identity_reveal"
  | "user_confirmation"
  | "character_statement"
  | "other_character_statement"
  | "agent_inference";

export type SegmentKind = "narration" | "dialogue" | "event";

export interface NarrativeSegment {
  segmentId: string;
  kind: SegmentKind;
  text: string;
  order: number;
  speakerName?: string;
}

export interface ProcessTurnInput {
  requestId: string;
  storyId: string;
  chapterNo: number;
  sceneNo: number;
  turnId: string;
  narrative: {
    text: string;
    segments?: NarrativeSegment[];
  };
  storyTime?: string;
  previousMemoryVersion?: number;
}

export interface EvidenceInput {
  sourceKind: SourceKind;
  segmentId: string;
  quote: string;
  confidence: number;
}

export interface Evidence extends EvidenceInput {
  evidenceId: string;
  storyId: string;
  chapterNo: number;
  sceneNo: number;
  turnId: string;
  storyTime?: string;
}

export interface CharacterMention {
  ref: string;
  displayName: string;
  evidence: EvidenceInput;
  characterIdHint?: string | undefined;
  forceNewIdentity?: boolean | undefined;
  aliases?: string[] | undefined;
  provisional?: boolean | undefined;
}

export interface EventObservation {
  eventKey: string;
  summary: string;
  participantRefs: string[];
  importance: number;
  evidence: EvidenceInput;
}

export interface FactObservation {
  subjectRef: string;
  key: string;
  value: string;
  inference: boolean;
  temporal?: "static" | "state" | undefined;
  correctionIntent?: boolean | undefined;
  evidence: EvidenceInput;
}

export interface RelationshipObservation {
  fromRef: string;
  toRef: string;
  type: string;
  description: string;
  importance: number;
  evidence: EvidenceInput;
}

export type IdentityRelation = "same_person" | "different_person" | "alias_of";

export interface IdentityObservation {
  leftRef: string;
  rightRef: string;
  relation: IdentityRelation;
  evidence: EvidenceInput;
}

export interface ExtractionResult {
  mentions: CharacterMention[];
  events: EventObservation[];
  facts: FactObservation[];
  relationships: RelationshipObservation[];
  identities: IdentityObservation[];
}

export type CharacterStatus = "active" | "provisional" | "merged" | "invalid";

export interface CharacterRecord {
  characterId: string;
  storyId: string;
  displayName: string;
  normalizedName: string;
  status: CharacterStatus;
  mergedIntoCharacterId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AliasRecord {
  aliasId: string;
  storyId: string;
  characterId: string;
  value: string;
  normalizedValue: string;
  evidence: Evidence;
  confirmed: boolean;
  createdAt: string;
}

export type FactStatus = "active" | "superseded" | "disputed";

export interface FactRecord {
  factId: string;
  storyId: string;
  characterId: string;
  key: string;
  value: string;
  inference: boolean;
  confidence: number;
  authority: number;
  status: FactStatus;
  evidence: Evidence;
  validFromVersion: number;
  validUntilVersion?: number;
  supersededByFactId?: string;
  createdAt: string;
}

export interface EventRecord {
  eventId: string;
  eventKey: string;
  storyId: string;
  summary: string;
  participantIds: string[];
  importance: number;
  evidence: Evidence;
  memoryVersion: number;
  createdAt: string;
}

export interface RelationshipRecord {
  relationshipId: string;
  storyId: string;
  fromCharacterId: string;
  toCharacterId: string;
  type: string;
  description: string;
  importance: number;
  occurrenceCount: number;
  isImportant: boolean;
  status: "active" | "superseded" | "disputed";
  evidence: Evidence[];
  updatedAt: string;
}

export type ConflictType = "fact_conflict" | "identity_ambiguity" | "same_name_ambiguity";

export interface ConflictRecord {
  conflictId: string;
  storyId: string;
  type: ConflictType;
  characterIds: string[];
  description: string;
  evidenceIds: string[];
  status: "pending" | "resolved";
  createdAt: string;
  resolvedAt?: string;
}

export interface CorrectionRecord {
  correctionId: string;
  storyId: string;
  characterId: string;
  oldFactId: string;
  newFactId: string;
  reason: string;
  automatic: boolean;
  createdAt: string;
}

export type NotificationType = "automatic_correction" | "identity_needs_confirmation" | "memory_conflict";

export interface UserNotification {
  notificationId: string;
  storyId: string;
  type: NotificationType;
  message: string;
  relatedCharacterIds: string[];
  status: "pending" | "delivered" | "acknowledged";
  createdAt: string;
}

export interface PortraitProjectionContext {
  character: CharacterRecord;
  aliases: AliasRecord[];
  activeFacts: FactRecord[];
  events: EventRecord[];
  relationships: RelationshipRecord[];
  memoryVersion: number;
}

export interface PortraitSnapshot<TPortrait = unknown> {
  snapshotId: string;
  storyId: string;
  characterId: string;
  memoryVersion: number;
  schemaVersion: string;
  portrait: TPortrait;
  createdAt: string;
}

export interface ProcessedTurnRecord {
  storyId: string;
  turnId: string;
  requestId: string;
  memoryVersion: number;
  result: ProcessTurnResult<unknown>;
  createdAt: string;
}

export interface ProcessTurnResult<TPortrait = unknown> {
  storyId: string;
  turnId: string;
  requestId: string;
  memoryVersion: number;
  idempotentReplay: boolean;
  affectedCharacterIds: string[];
  portraits: Array<PortraitSnapshot<TPortrait>>;
  appendedEventIds: string[];
  relationshipIds: string[];
  conflictIds: string[];
  notifications: UserNotification[];
}

export interface RetrievalQuery {
  storyId: string;
  queryText: string;
  currentCharacterIds?: string[];
  chapterNo?: number;
  sceneNo?: number;
  limit?: number;
  queryEmbedding?: number[];
}

export interface RetrievedMemory {
  memoryType: "portrait" | "event" | "relationship" | "conflict";
  memoryId: string;
  content: unknown;
  score: number;
  reason: string[];
}

export interface SplitCharacterInput {
  requestId: string;
  storyId: string;
  sourceMergedCharacterId: string;
  currentCanonicalCharacterId: string;
  previousMemoryVersion: number;
  reason: string;
  userConfirmed: boolean;
  assignments: {
    factIds: string[];
    aliasIds: string[];
    eventIds: string[];
    relationshipEndpoints: Array<{
      relationshipId: string;
      endpoint: "from" | "to";
    }>;
  };
}

export interface SplitCharacterResult<TPortrait = unknown> {
  storyId: string;
  requestId: string;
  memoryVersion: number;
  restoredCharacterId: string;
  currentCanonicalCharacterId: string;
  portraits: Array<PortraitSnapshot<TPortrait>>;
}

export function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN").replaceAll(/\s+/g, "");
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
