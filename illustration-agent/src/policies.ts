import type { AuditScores, ScenePlan } from "./domain.js";

export const REQUIRED_NEGATIVE_PROMPT = [
  "明显鲜血",
  "血腥特写",
  "断肢",
  "内脏",
  "尸块",
  "水印",
  "logo",
  "乱码文字",
  "对话气泡",
  "现代物件（除非原文明确出现）",
  "畸形肢体",
  "多余手指",
  "凭空新增人物",
  "未来剧情剧透",
  "个人写真",
  "人物写真",
  "角色海报",
  "证件照",
  "影棚背景",
  "纯色背景",
  "空白背景",
  "单人静态站姿",
  "只画人物而没有剧情环境",
  "沿用参考图的背景或姿势",
].join("，");

const GRAPHIC_TERMS = ["血肉横飞", "断肢", "内脏外露", "尸块", "喷血特写", "开膛破肚"];

export function sanitizePromptForSafety(prompt: string): string {
  return GRAPHIC_TERMS.reduce(
    (current, term) => current.replaceAll(term, "激烈但克制的战斗氛围"),
    prompt,
  );
}

export function attachRequiredNegativePrompt(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `${trimmed}，${REQUIRED_NEGATIVE_PROMPT}` : REQUIRED_NEGATIVE_PROMPT;
}

export function auditPasses(scores: AuditScores, safetyPassed: boolean): boolean {
  return (
    safetyPassed &&
    scores.narrativeMatch >= 0.8 &&
    scores.sceneStorytelling >= 0.85 &&
    scores.characterConsistency >= 0.85 &&
    scores.imageQuality >= 0.75
  );
}

const PORTRAIT_ONLY_TERMS = [
  "个人写真",
  "人物写真",
  "角色写真",
  "角色海报",
  "证件照",
  "影棚肖像",
  "纯色背景",
  "空白背景",
  "单人静态站姿",
];

export function assertNarrativeScenePlan(plan: ScenePlan): void {
  const requiredNarrativeFields = [
    plan.environment,
    plan.keyAction,
    plan.subjectInteraction,
    plan.composition,
  ];
  if (requiredNarrativeFields.some((value) => value.trim().length === 0)) {
    throw new Error("章节插图必须包含具体环境、关键动作、主体互动和镜头构图");
  }
  const forbiddenTerm = PORTRAIT_ONLY_TERMS.find((term) => plan.prompt.includes(term));
  if (forbiddenTerm) {
    throw new Error(`章节插图不能采用写真式构图: ${forbiddenTerm}`);
  }
}

export function assertPlanScope(plan: ScenePlan, availableSegmentIds: Set<string>): void {
  if (!availableSegmentIds.has(plan.insertAfterSegmentId)) {
    throw new Error(`插图锚点不存在: ${plan.insertAfterSegmentId}`);
  }
  for (const evidenceId of plan.evidenceSegmentIds) {
    if (!availableSegmentIds.has(evidenceId)) {
      throw new Error(`插图证据片段不存在: ${evidenceId}`);
    }
  }
  if (!plan.evidenceSegmentIds.includes(plan.insertAfterSegmentId)) {
    throw new Error("正文插入锚点必须属于场景证据片段");
  }
}
