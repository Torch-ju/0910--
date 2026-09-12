import {
  characterVisualProfileInputSchema,
  visualBibleDraftInputSchema,
} from "../contracts.js";
import type {
  CharacterVisualProfile,
  CharacterVisualProfileInput,
  StoryVisualBible,
  VisualBibleDraftInput,
} from "../domain.js";
import type { Clock, IllustrationRepository } from "../ports.js";
import { SystemClock } from "./system.js";

export class StoryVisualSetupService {
  constructor(
    private readonly repository: IllustrationRepository,
    private readonly clock: Clock = new SystemClock(),
  ) {}

  async saveDraft(rawInput: VisualBibleDraftInput): Promise<StoryVisualBible> {
    const input = visualBibleDraftInputSchema.parse(rawInput) as VisualBibleDraftInput;
    const current = await this.repository.getVisualBible(input.storyId);
    if (current?.status === "locked") {
      throw new Error("视觉圣经已锁定；如需整体改版，请创建新的视觉圣经版本并走用户确认流程");
    }
    const now = this.clock.now();
    const bible: StoryVisualBible = {
      storyId: input.storyId,
      version: current?.version ?? 1,
      status: "draft",
      novelTheme: input.novelTheme,
      genre: input.genre,
      eraSetting: input.eraSetting,
      baseStyle: input.baseStyle,
      colorScript: input.colorScript,
      lightingRules: input.lightingRules,
      compositionRules: input.compositionRules,
      forbiddenDrift: input.forbiddenDrift ?? [],
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    await this.repository.saveVisualBible(bible);
    return bible;
  }

  async lock(storyId: string): Promise<StoryVisualBible> {
    const current = await this.repository.getVisualBible(storyId);
    if (!current) throw new Error(`故事 ${storyId} 尚无视觉圣经草案`);
    if (current.status === "locked") return current;
    const now = this.clock.now();
    const locked: StoryVisualBible = {
      ...current,
      status: "locked",
      updatedAt: now,
      lockedAt: now,
    };
    await this.repository.saveVisualBible(locked);
    return locked;
  }

  async upsertCharacterProfile(rawInput: CharacterVisualProfileInput): Promise<CharacterVisualProfile> {
    const input = characterVisualProfileInputSchema.parse(rawInput) as CharacterVisualProfileInput;
    const current = await this.repository.getCharacterVisualProfile(input.storyId, input.characterId);
    const immutableChanged =
      current !== undefined &&
      JSON.stringify(current.immutableTraits) !== JSON.stringify(input.immutableTraits);
    const now = this.clock.now();
    const profile: CharacterVisualProfile = {
      storyId: input.storyId,
      characterId: input.characterId,
      displayName: input.displayName,
      role: input.role,
      version: current ? current.version + 1 : 1,
      status: immutableChanged || !current?.canonicalReference ? "draft" : current.status,
      immutableTraits: input.immutableTraits,
      dynamicTraits: input.dynamicTraits ?? [],
      wardrobeRules: input.wardrobeRules ?? [],
      ...(immutableChanged ? {} : {
        ...(current?.canonicalReference ? { canonicalReference: current.canonicalReference } : {}),
        ...(current?.approvedCandidateId ? { approvedCandidateId: current.approvedCandidateId } : {}),
      }),
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    await this.repository.saveCharacterVisualProfile(profile);
    return profile;
  }
}
