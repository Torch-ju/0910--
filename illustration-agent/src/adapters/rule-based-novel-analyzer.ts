import type { ChapterVisualAnalysis, NarrativeSegment } from "../domain.js";
import type { NovelAnalysisContext, NovelChapterAnalyzer } from "../ports.js";
import { createHash } from "node:crypto";

export function hashAnchor(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function importance(segment: NarrativeSegment, names: string[]): number {
  const kindScore = segment.kind === "event" ? 30 : segment.kind === "narration" ? 20 : 10;
  const nameScore = names.filter((name) => segment.text.includes(name)).length * 8;
  const actionScore = /冲|战|逃|救|杀|揭|发现|决定|对峙|相认|背叛|抵达|离开|闯|抓|夺/.test(segment.text) ? 10 : 0;
  return kindScore + nameScore + actionScore + Math.min(segment.text.length / 100, 5);
}

/**
 * Local validation fallback. Production should use JsonNovelChapterAnalyzer with a capable LLM.
 * It only trusts explicit dialogue speaker fields and names already discovered in this story.
 */
export class RuleBasedNovelChapterAnalyzer implements NovelChapterAnalyzer {
  async analyze(context: NovelAnalysisContext): Promise<ChapterVisualAnalysis> {
    const { input, visualBible, existingCharacterProfiles } = context;
    const ordered = [...input.narrative.segments].sort((left, right) => left.order - right.order);
    const speakerNames = ordered
      .map((segment) => segment.speakerName)
      .filter((name): name is string => Boolean(name));
    const knownNames = existingCharacterProfiles
      .filter((profile) => ordered.some((segment) => segment.text.includes(profile.displayName)))
      .map((profile) => profile.displayName);
    const names = [...new Set([...speakerNames, ...knownNames])];
    if (names.length === 0) {
      throw new Error("规则解析器未找到人物；生产环境请配置小说视觉分析模型");
    }
    const counts = new Map(names.map((name) => [
      name,
      ordered.filter((segment) => segment.speakerName === name || segment.text.includes(name)).length,
    ]));
    const mainName = [...names].sort((left, right) => (counts.get(right) ?? 0) - (counts.get(left) ?? 0))[0];
    const characters = names.map((displayName) => {
      const existing = existingCharacterProfiles.find((profile) => profile.displayName === displayName);
      const evidenceSegmentIds = ordered
        .filter((segment) => segment.speakerName === displayName || segment.text.includes(displayName))
        .map((segment) => segment.segmentId);
      return {
        displayName,
        role: displayName === mainName ? "main" as const : "supporting" as const,
        immutableTraits: existing?.immutableTraits ?? ["外貌细节仅采用小说明确描写"],
        dynamicTraits: existing?.dynamicTraits ?? [],
        wardrobeRules: existing?.wardrobeRules ?? [`符合${visualBible.eraSetting}的服饰`],
        evidenceSegmentIds,
      };
    });
    const selected = [...ordered].sort(
      (left, right) => importance(right, names) - importance(left, names) || left.order - right.order,
    )[0];
    if (!selected) throw new Error("章节没有可用于插图的剧情片段");
    const selectedNames = names.filter((name) => selected.text.includes(name));
    const characterNames = (selectedNames.length > 0 ? selectedNames : [mainName]).filter(
      (name): name is string => Boolean(name),
    ).slice(0, 3);
    const selectedIndex = ordered.findIndex((segment) => segment.segmentId === selected.segmentId);
    const evidence = ordered.slice(Math.max(0, selectedIndex - 1), Math.min(ordered.length, selectedIndex + 2));
    const synopsis = evidence.map((segment) => segment.text).join(" ");
    const environment = `${visualBible.eraSetting}；画面环境严格依据：${synopsis}`;
    const subjectInteraction = characterNames.length > 1
      ? `${characterNames.join("、")}围绕该事件发生明确互动，位置和视线关系服务于剧情`
      : `${characterNames[0]}正在对该事件与周围环境作出明确反应`;
    const composition = "16:9 横幅中远景叙事构图，完整呈现环境、事件和人物空间关系，人物不以写真姿态面对镜头";
    return {
      characters,
      keyScene: {
        theme: input.chapterTitle ? `${input.chapterTitle}的关键场面` : "本章关键剧情",
        synopsis,
        environment,
        keyAction: selected.text,
        subjectInteraction,
        composition,
        insertAfterSegmentId: selected.segmentId,
        evidenceSegmentIds: evidence.map((segment) => segment.segmentId),
        characterNames,
        caption: selected.text.slice(0, 80),
        prompt: `以${visualBible.baseStyle}呈现正在发生的章节事件：${synopsis}。具体环境：${environment}。关键动作：${selected.text}。主体互动：${subjectInteraction}。采用${composition}，环境与事件承担主要叙事。`,
        negativePrompt: visualBible.forbiddenDrift.join("，"),
      },
    };
  }
}
