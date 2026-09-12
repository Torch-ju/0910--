import type {
  CharacterVisualProfile,
  ReferenceCandidate,
} from "../domain.js";
import type {
  AssetStorage,
  Clock,
  IdGenerator,
  IllustrationRepository,
  ImageGenerator,
} from "../ports.js";
import { REQUIRED_NEGATIVE_PROMPT } from "../policies.js";
import { SystemClock, UuidGenerator } from "./system.js";

export class CharacterReferenceService {
  constructor(
    private readonly repository: IllustrationRepository,
    private readonly generator: ImageGenerator,
    private readonly storage: AssetStorage,
    private readonly ids: IdGenerator = new UuidGenerator(),
    private readonly clock: Clock = new SystemClock(),
  ) {}

  async generateCandidates(storyId: string, characterId: string, count = 4): Promise<ReferenceCandidate[]> {
    if (!Number.isInteger(count) || count < 1 || count > 4) {
      throw new Error("标准参考图候选数量必须为 1–4 张");
    }
    const bible = await this.repository.getVisualBible(storyId);
    if (!bible || bible.status !== "locked") throw new Error("必须先锁定故事视觉圣经");
    const profile = await this.repository.getCharacterVisualProfile(storyId, characterId);
    if (!profile) throw new Error(`人物 ${characterId} 尚无视觉档案`);

    const existing = await this.repository.listReferenceCandidates(storyId, characterId);
    const candidates: ReferenceCandidate[] = [];
    for (let index = 0; index < count; index += 1) {
      const candidateNo = existing.length + index + 1;
      const prompt = this.buildReferencePrompt(bible.baseStyle, bible.eraSetting, profile, candidateNo);
      const payload = await this.generator.generate({
        storyId,
        chapterNo: 0,
        prompt,
        negativePrompt: REQUIRED_NEGATIVE_PROMPT,
        width: 1440,
        height: 1440,
        referenceImageUrls: [],
        model: this.generator.model,
        watermark: false,
      });
      const candidateId = this.ids.next("ref");
      const asset = await this.storage.persist({
        storyId,
        characterId,
        purpose: "character_reference",
        logicalId: candidateId,
        version: profile.version,
        payload,
      });
      const candidate: ReferenceCandidate = {
        candidateId,
        storyId,
        characterId,
        visualProfileVersion: profile.version,
        candidateNo,
        prompt,
        asset,
        status: "pending",
        createdAt: this.clock.now(),
      };
      await this.repository.saveReferenceCandidate(candidate);
      candidates.push(candidate);
    }
    await this.repository.saveCharacterVisualProfile({
      ...profile,
      status: "awaiting_approval",
      updatedAt: this.clock.now(),
    });
    return candidates;
  }

  async approveCandidate(storyId: string, characterId: string, candidateId: string): Promise<CharacterVisualProfile> {
    const profile = await this.repository.getCharacterVisualProfile(storyId, characterId);
    if (!profile) throw new Error(`人物 ${characterId} 尚无视觉档案`);
    const candidates = await this.repository.listReferenceCandidates(storyId, characterId);
    const selected = candidates.find((candidate) => candidate.candidateId === candidateId);
    if (!selected) throw new Error(`参考图候选 ${candidateId} 不存在`);
    if (selected.visualProfileVersion !== profile.version) {
      throw new Error("该候选图属于旧人物视觉版本，请重新生成候选图");
    }
    const decidedAt = this.clock.now();
    for (const candidate of candidates.filter((item) => item.visualProfileVersion === profile.version)) {
      await this.repository.saveReferenceCandidate({
        ...candidate,
        status: candidate.candidateId === candidateId ? "approved" : "rejected",
        decidedAt,
      });
    }
    const approved: CharacterVisualProfile = {
      ...profile,
      status: "approved",
      canonicalReference: selected.asset,
      approvedCandidateId: selected.candidateId,
      updatedAt: decidedAt,
    };
    await this.repository.saveCharacterVisualProfile(approved);
    return approved;
  }

  private buildReferencePrompt(
    baseStyle: string,
    eraSetting: string,
    profile: CharacterVisualProfile,
    candidateNo: number,
  ): string {
    return [
      "角色标准参考图，仅表现人物，不包含剧情事件。",
      `人物：${profile.displayName}。`,
      `固定外观：${profile.immutableTraits.join("；")}。`,
      `服饰规则：${profile.wardrobeRules.join("；") || "严格符合时代背景"}。`,
      `时代：${eraSetting}。`,
      `锁定画风：${baseStyle}。`,
      `候选方案 ${candidateNo}，正面三分之二身，五官清晰，姿态自然，中性背景，便于后续角色一致性引用。`,
    ].join("");
  }
}
