import type {
  AssetRecord,
  ChapterVisualAnalysis,
  ChapterIllustrationResult,
  CharacterVisualProfile,
  GenerateChapterIllustrationInput,
  GeneratedImagePayload,
  GenerationAttempt,
  GenerationRequest,
  IllustrationAudit,
  IllustrationVersion,
  ProcessedIllustrationRequest,
  ReferenceCandidate,
  ScenePlan,
  StoryVisualBible,
  NovelVisualBibleSourceInput,
  VisualBibleProposal,
} from "./domain.js";

export interface NovelAnalysisContext {
  input: GenerateChapterIllustrationInput;
  visualBible: StoryVisualBible;
  existingCharacterProfiles: CharacterVisualProfile[];
}

export interface NovelChapterAnalyzer {
  analyze(context: NovelAnalysisContext): Promise<ChapterVisualAnalysis>;
}

export interface NovelVisualBiblePlanner {
  propose(input: NovelVisualBibleSourceInput): Promise<VisualBibleProposal>;
}

export interface ImageGenerator {
  readonly model: string;
  generate(request: GenerationRequest): Promise<GeneratedImagePayload>;
}

export interface ImageReviewContext {
  input: GenerateChapterIllustrationInput;
  plan: ScenePlan;
  visualBible: StoryVisualBible;
  characterProfiles: CharacterVisualProfile[];
  asset: AssetRecord;
  imageUrl: string;
  referenceImageUrls: string[];
  attemptId: string;
}

export interface JsonModelRequest {
  systemPrompt: string;
  userPrompt: string;
  imageUrls?: string[];
}

export interface StructuredJsonModel {
  completeJson(request: JsonModelRequest): Promise<unknown>;
}

export interface IllustrationReviewer {
  review(context: ImageReviewContext): Promise<Omit<IllustrationAudit, "auditId" | "attemptId" | "createdAt">>;
}

export interface PersistAssetInput {
  storyId: string;
  chapterNo?: number;
  characterId?: string;
  purpose: "chapter_illustration" | "character_reference";
  logicalId: string;
  version: number;
  payload: GeneratedImagePayload;
}

export interface AssetStorage {
  persist(input: PersistAssetInput): Promise<AssetRecord>;
  getDisplayUrl(asset: AssetRecord): Promise<string>;
}

export interface IllustrationRepository {
  getVisualBible(storyId: string): Promise<StoryVisualBible | undefined>;
  saveVisualBible(bible: StoryVisualBible): Promise<void>;
  getCharacterVisualProfile(storyId: string, characterId: string): Promise<CharacterVisualProfile | undefined>;
  listCharacterVisualProfiles(storyId: string): Promise<CharacterVisualProfile[]>;
  saveCharacterVisualProfile(profile: CharacterVisualProfile): Promise<void>;
  saveReferenceCandidate(candidate: ReferenceCandidate): Promise<void>;
  listReferenceCandidates(storyId: string, characterId: string): Promise<ReferenceCandidate[]>;
  saveGenerationAttempt(attempt: GenerationAttempt): Promise<void>;
  listGenerationAttempts(storyId: string, chapterNo: number): Promise<GenerationAttempt[]>;
  getCurrentIllustration(storyId: string, chapterNo: number): Promise<IllustrationVersion | undefined>;
  listIllustrationHistory(storyId: string, chapterNo: number): Promise<IllustrationVersion[]>;
  promoteIllustration(version: IllustrationVersion): Promise<void>;
  findProcessedRequest(storyId: string, requestId: string): Promise<ProcessedIllustrationRequest | undefined>;
  saveProcessedRequest(request: ProcessedIllustrationRequest): Promise<void>;
}

export interface IdGenerator {
  next(prefix: string): string;
}

export interface Clock {
  now(): string;
}

export interface ChapterIllustrationAgentPort {
  processChapter(input: GenerateChapterIllustrationInput): Promise<ChapterIllustrationResult>;
}
