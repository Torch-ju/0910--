export type SegmentKind = "dialogue" | "narration" | "event";

export interface NarrativeSegment {
  segmentId: string;
  kind: SegmentKind;
  text: string;
  order: number;
  speakerName?: string;
}

export interface GenerateChapterIllustrationInput {
  requestId: string;
  storyId: string;
  chapterNo: number;
  chapterVersion: number;
  chapterTitle?: string;
  regenerationReason?: string;
  narrative: {
    segments: NarrativeSegment[];
  };
}

export interface DetectedCharacter {
  displayName: string;
  role: "main" | "supporting";
  immutableTraits: string[];
  dynamicTraits: string[];
  wardrobeRules: string[];
  evidenceSegmentIds: string[];
}

export interface ChapterVisualAnalysis {
  characters: DetectedCharacter[];
  keyScene: {
    theme: string;
    synopsis: string;
    environment: string;
    keyAction: string;
    subjectInteraction: string;
    composition: string;
    insertAfterSegmentId: string;
    evidenceSegmentIds: string[];
    characterNames: string[];
    caption: string;
    prompt: string;
    negativePrompt: string;
  };
}

export type VisualBibleStatus = "draft" | "locked";

export interface StoryVisualBible {
  storyId: string;
  version: number;
  status: VisualBibleStatus;
  novelTheme: string;
  genre: string;
  eraSetting: string;
  baseStyle: string;
  colorScript: string;
  lightingRules: string;
  compositionRules: string;
  forbiddenDrift: string[];
  createdAt: string;
  updatedAt: string;
  lockedAt?: string;
}

export type VisualProfileStatus = "draft" | "awaiting_approval" | "approved";

export interface AssetRecord {
  assetId: string;
  permanentUri: string;
  objectKey: string;
  displayUrl?: string;
  mimeType: string;
  width: number;
  height: number;
  sha256: string;
  createdAt: string;
}

export interface CharacterVisualProfile {
  storyId: string;
  characterId: string;
  displayName: string;
  role: "main" | "supporting";
  version: number;
  status: VisualProfileStatus;
  immutableTraits: string[];
  dynamicTraits: string[];
  wardrobeRules: string[];
  canonicalReference?: AssetRecord;
  approvedCandidateId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReferenceCandidate {
  candidateId: string;
  storyId: string;
  characterId: string;
  visualProfileVersion: number;
  candidateNo: number;
  prompt: string;
  asset: AssetRecord;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt?: string;
}

export interface ScenePlan {
  planId: string;
  storyId: string;
  chapterNo: number;
  chapterVersion: number;
  theme: string;
  synopsis: string;
  environment: string;
  keyAction: string;
  subjectInteraction: string;
  composition: string;
  insertAfterSegmentId: string;
  anchorTextHash: string;
  anchorQuote: string;
  evidenceSegmentIds: string[];
  characterIds: string[];
  caption: string;
  prompt: string;
  negativePrompt: string;
}

export interface GenerationRequest {
  storyId: string;
  chapterNo: number;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  referenceImageUrls: string[];
  model: string;
  watermark: false;
}

export interface GeneratedImagePayload {
  sourceUrl?: string;
  bytes?: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
  providerRequestId?: string;
  revisedPrompt?: string;
}

export interface AuditScores {
  narrativeMatch: number;
  sceneStorytelling: number;
  characterConsistency: number;
  imageQuality: number;
}

export interface IllustrationAudit {
  auditId: string;
  attemptId: string;
  passed: boolean;
  scores: AuditScores;
  safetyPassed: boolean;
  reasons: string[];
  createdAt: string;
}

export interface GenerationAttempt {
  attemptId: string;
  storyId: string;
  chapterNo: number;
  requestId: string;
  attemptNo: number;
  status: "generated" | "review_rejected" | "generation_failed" | "published";
  asset?: AssetRecord;
  audit?: IllustrationAudit;
  errorMessage?: string;
  providerRequestId?: string;
  createdAt: string;
}

export interface IllustrationVersion {
  illustrationId: string;
  storyId: string;
  chapterNo: number;
  chapterVersion: number;
  version: number;
  isCurrent: boolean;
  status: "current" | "archived";
  scenePlan: ScenePlan;
  asset: AssetRecord;
  audit: IllustrationAudit;
  visualBibleVersion: number;
  characterVisualVersions: Record<string, number>;
  model: string;
  regenerationReason?: string;
  createdAt: string;
  archivedAt?: string;
}

export type ChapterIllustrationStatus =
  | "waiting_visual_bible_lock"
  | "waiting_reference_approval"
  | "published"
  | "generation_failed"
  | "review_rejected";

export interface ChapterIllustrationResult {
  requestId: string;
  storyId: string;
  chapterNo: number;
  chapterVersion: number;
  status: ChapterIllustrationStatus;
  idempotentReplay: boolean;
  attempts: number;
  missingReferenceCharacterIds: string[];
  illustration?: IllustrationVersion;
  message: string;
}

export interface ProcessedIllustrationRequest {
  requestId: string;
  storyId: string;
  result: ChapterIllustrationResult;
  createdAt: string;
}

export interface VisualBibleDraftInput {
  storyId: string;
  novelTheme: string;
  genre: string;
  eraSetting: string;
  baseStyle: string;
  colorScript: string;
  lightingRules: string;
  compositionRules: string;
  forbiddenDrift?: string[];
}

export interface NovelVisualBibleSourceInput {
  storyId: string;
  title?: string;
  synopsis?: string;
  segments: NarrativeSegment[];
}

export interface VisualBibleProposal {
  novelTheme: string;
  genre: string;
  eraSetting: string;
  baseStyle: string;
  colorScript: string;
  lightingRules: string;
  compositionRules: string;
  forbiddenDrift: string[];
}

export interface CharacterVisualProfileInput {
  storyId: string;
  characterId: string;
  displayName: string;
  role: "main" | "supporting";
  immutableTraits: string[];
  dynamicTraits?: string[];
  wardrobeRules?: string[];
}
