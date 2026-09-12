import type {
  CharacterVisualProfile,
  GenerationAttempt,
  IllustrationVersion,
  ProcessedIllustrationRequest,
  ReferenceCandidate,
  StoryVisualBible,
} from "../domain.js";
import type { IllustrationRepository } from "../ports.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryIllustrationRepository implements IllustrationRepository {
  private readonly visualBibles = new Map<string, StoryVisualBible>();
  private readonly profiles = new Map<string, CharacterVisualProfile>();
  private readonly candidates = new Map<string, ReferenceCandidate>();
  private readonly attempts = new Map<string, GenerationAttempt>();
  private readonly illustrations = new Map<string, IllustrationVersion>();
  private readonly processed = new Map<string, ProcessedIllustrationRequest>();

  async getVisualBible(storyId: string): Promise<StoryVisualBible | undefined> {
    const value = this.visualBibles.get(storyId);
    return value ? clone(value) : undefined;
  }

  async saveVisualBible(bible: StoryVisualBible): Promise<void> {
    this.visualBibles.set(bible.storyId, clone(bible));
  }

  async getCharacterVisualProfile(storyId: string, characterId: string): Promise<CharacterVisualProfile | undefined> {
    const value = this.profiles.get(`${storyId}:${characterId}`);
    return value ? clone(value) : undefined;
  }

  async listCharacterVisualProfiles(storyId: string): Promise<CharacterVisualProfile[]> {
    return [...this.profiles.values()]
      .filter((profile) => profile.storyId === storyId)
      .map(clone);
  }

  async saveCharacterVisualProfile(profile: CharacterVisualProfile): Promise<void> {
    this.profiles.set(`${profile.storyId}:${profile.characterId}`, clone(profile));
  }

  async saveReferenceCandidate(candidate: ReferenceCandidate): Promise<void> {
    this.candidates.set(candidate.candidateId, clone(candidate));
  }

  async listReferenceCandidates(storyId: string, characterId: string): Promise<ReferenceCandidate[]> {
    return [...this.candidates.values()]
      .filter((candidate) => candidate.storyId === storyId && candidate.characterId === characterId)
      .sort((left, right) => left.candidateNo - right.candidateNo)
      .map(clone);
  }

  async saveGenerationAttempt(attempt: GenerationAttempt): Promise<void> {
    this.attempts.set(attempt.attemptId, clone(attempt));
  }

  async listGenerationAttempts(storyId: string, chapterNo: number): Promise<GenerationAttempt[]> {
    return [...this.attempts.values()]
      .filter((attempt) => attempt.storyId === storyId && attempt.chapterNo === chapterNo)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(clone);
  }

  async getCurrentIllustration(storyId: string, chapterNo: number): Promise<IllustrationVersion | undefined> {
    const value = [...this.illustrations.values()].find(
      (illustration) => illustration.storyId === storyId && illustration.chapterNo === chapterNo && illustration.isCurrent,
    );
    return value ? clone(value) : undefined;
  }

  async listIllustrationHistory(storyId: string, chapterNo: number): Promise<IllustrationVersion[]> {
    return [...this.illustrations.values()]
      .filter((illustration) => illustration.storyId === storyId && illustration.chapterNo === chapterNo)
      .sort((left, right) => right.version - left.version)
      .map(clone);
  }

  async promoteIllustration(version: IllustrationVersion): Promise<void> {
    const archivedAt = version.createdAt;
    for (const [id, illustration] of this.illustrations) {
      if (illustration.storyId === version.storyId && illustration.chapterNo === version.chapterNo && illustration.isCurrent) {
        this.illustrations.set(id, {
          ...illustration,
          isCurrent: false,
          status: "archived",
          archivedAt,
        });
      }
    }
    this.illustrations.set(version.illustrationId, clone(version));
  }

  async findProcessedRequest(storyId: string, requestId: string): Promise<ProcessedIllustrationRequest | undefined> {
    const value = this.processed.get(`${storyId}:${requestId}`);
    return value ? clone(value) : undefined;
  }

  async saveProcessedRequest(request: ProcessedIllustrationRequest): Promise<void> {
    this.processed.set(`${request.storyId}:${request.requestId}`, clone(request));
  }

  snapshot() {
    return {
      visualBibles: [...this.visualBibles.values()].map(clone),
      profiles: [...this.profiles.values()].map(clone),
      candidates: [...this.candidates.values()].map(clone),
      attempts: [...this.attempts.values()].map(clone),
      illustrations: [...this.illustrations.values()].map(clone),
      processed: [...this.processed.values()].map(clone),
    };
  }
}
