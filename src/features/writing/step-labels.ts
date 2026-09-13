import type { Run, StepName } from "@/lib/orchestration/contracts";

/** One place for the pipeline wording shared by the waiting marker and the detailed progress list. */
export const STEP_LABELS: Record<StepName, string> = { roles: "角色准备", narrator: "场景准备", transcription: "正文", memory_extraction: "记忆整理", memory_update: "记忆更新", summary: "摘要", chapter: "章节" };
export const STEP_STATUS_LABELS = { running: "进行中", done: "完成", failed: "失败" };

const isLocalPipeline = (pipeline: Run["pipeline"]) => pipeline === "direct_v1" || pipeline === "interactive_v1" || pipeline === "dialogue_v2";

export function stepLabel(name: StepName, pipeline?: Run["pipeline"]): string {
  if (isLocalPipeline(pipeline) && name === "narrator") return "场景准备（本地）";
  if (isLocalPipeline(pipeline) && name === "transcription") return "故事创作";
  return STEP_LABELS[name];
}
