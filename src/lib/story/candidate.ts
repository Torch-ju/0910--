import type { Candidate, StorySnapshot, ValidationIssue } from "./contracts";
import { isFact, lockedChanges, validatePair } from "./validation";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown) => object(v) ? Object.entries(v).find(([k, x]) => k.endsWith("_id") && typeof x === "string")?.[1] as string | undefined : undefined;

/** Three-way merge by stable entity ID. Conflicting user edits always win until explicitly resolved. */
function merge(base: unknown, proposed: unknown, current: unknown, path: string, issues: ValidationIssue[]): unknown {
  if (same(base, proposed) || same(proposed, current)) return structuredClone(current);
  if (same(base, current)) return structuredClone(proposed);
  if (isFact(base) || isFact(proposed) || isFact(current)) {
    if (isFact(base) && isFact(proposed) && same(base.value, proposed.value)) return structuredClone(current);
    issues.push({ code: "EDIT_CONFLICT", path, message: "此字段在生成后被你修改或锁定，AI 建议不能覆盖它；保留原稿后可针对该字段重新请求。" });
    return structuredClone(current);
  }
  if (Array.isArray(base) && Array.isArray(proposed) && Array.isArray(current) && [...base, ...proposed, ...current].every(v => id(v))) {
    const before = new Map(base.map(v => [id(v), v]));
    const after = new Map(proposed.map(v => [id(v), v]));
    const present = new Map(current.map(v => [id(v), v]));
    const result: unknown[] = [];
    for (const [index, item] of current.entries()) {
      const key = id(item);
      if (before.has(key) && !after.has(key)) {
        if (!same(before.get(key), item)) {
          issues.push({ code: "DELETE_CONFLICT", path: path + "/" + index, message: "AI 建议删除的实体已有用户修改，不能删除。" });
          result.push(item);
        }
      } else if (!before.has(key) && !after.has(key)) result.push(item);
      else result.push(merge(before.get(key), after.get(key), item, path + "/" + index, issues));
    }
    for (const item of proposed) {
      const key = id(item);
      if (present.has(key)) continue;
      if (!before.has(key)) result.push(structuredClone(item));
      else if (!same(before.get(key), item)) issues.push({ code: "DELETED_ENTITY_CONFLICT", path, message: "AI 修改的人物或事件已被用户删除，不能自动重新加入。" });
    }
    return result;
  }
  if (object(base) && object(proposed) && object(current)) {
    const result: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(proposed), ...Object.keys(current)])) {
      result[key] = merge(base[key], proposed[key], current[key], path + "/" + key, issues);
    }
    return result;
  }
  issues.push({ code: "EDIT_CONFLICT", path, message: "这项结构与生成时的版本发生冲突；当前编辑已保留。" });
  return structuredClone(current);
}
export function prepareCandidate(snapshot: StorySnapshot, candidate: Candidate): { candidate: Candidate; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  if (candidate.base && (candidate.base.story_idea !== snapshot.input || candidate.base.preset_id !== snapshot.preset_id)) issues.push({ code: "STORY_CONTEXT_CHANGED", path: "/input", message: "共同故事想法或场景已改变；请保留原稿，再按新想法生成建议。" });
  if (candidate.base_revision !== snapshot.snapshot_revision && !candidate.base) issues.push({ code: "LEGACY_CANDIDATE_STALE", path: "/revision", message: "这份旧候选没有完整比对基线，无法安全合并；请保留原稿后重新生成，不会自动扣费。" });
  let proposed = structuredClone(candidate);
  if (candidate.base && candidate.base_revision !== snapshot.snapshot_revision) {
    proposed = {
      ...proposed,
      world: merge(candidate.base.world, candidate.world, snapshot.world, "/world", issues) as Candidate["world"],
      characters: merge(candidate.base.characters, candidate.characters, snapshot.characters, "/characters", issues) as Candidate["characters"],
      timeline_suggestions: merge(candidate.base.timeline_suggestions, candidate.timeline_suggestions, snapshot.timeline_suggestions, "/timeline_suggestions", issues) as Candidate["timeline_suggestions"],
    };
  }
  issues.push(...validatePair(proposed.world, proposed.characters), ...lockedChanges(snapshot.world, proposed.world, "/world"), ...lockedChanges(snapshot.characters, proposed.characters, "/characters"));
  if (!issues.length) proposed.base_revision = snapshot.snapshot_revision;
  return { candidate: proposed, issues };
}

/** Automatically adopt non-conflicting changes; the three-way merge already preserves user edits. */
export function prepareAutomaticCandidate(snapshot: StorySnapshot, candidate: Candidate) {
  const prepared = prepareCandidate(snapshot, candidate);
  const resolved = new Set(["EDIT_CONFLICT", "DELETE_CONFLICT", "DELETED_ENTITY_CONFLICT"]);
  const issues = prepared.issues.filter(issue => !resolved.has(issue.code));
  if (!issues.length) prepared.candidate.base_revision = snapshot.snapshot_revision;
  return { candidate: prepared.candidate, issues, preservedEdits: prepared.issues.length - issues.length };
}
